// 純粋関数のみで構成した提案エンジン。DOM に依存しないため
// ブラウザからも Node のテストからもそのまま import できる。

const DAY_MS = 24 * 60 * 60 * 1000;
const E1RM_ESTIMATE_MAX_REPS = 10; // Epley式は高レップになるほど誤差が大きくなる
const RECENT_WINDOW_DAYS = 21; // この期間内の最良値を「現在の1RM」とみなす
const TEST_INTERVAL_DAYS = 28; // このペースで1RMテスト日を挟んで再計測する
const FINAL_TEST_LOOKAHEAD_DAYS = 10; // 目標期限が迫ったら直前にもう一度テストを挟む
const SAFE_WEEKLY_MAX_KG = 1.0; // これを超える週次成長率が必要な場合は「危険水準」
const PLATE_INCREMENT_KG = 2.5;

const SESSION_CYCLE = ["volume", "intensity", "technique"];

const SESSION_TABLE = {
  volume: { sets: 4, reps: 5, pct: 0.73, targetRPE: [7, 8] },
  intensity: { sets: 4, reps: 2, pct: 0.88, targetRPE: [8, 9] },
  technique: { sets: 3, reps: 5, pct: 0.62, targetRPE: [5, 6] },
  test: { sets: 1, reps: 1, pct: 1.0, targetRPE: [9, 10] },
};

export function toDate(value) {
  return value instanceof Date ? value : new Date(`${value}T00:00:00`);
}

export function daysBetween(from, to) {
  return (toDate(to).getTime() - toDate(from).getTime()) / DAY_MS;
}

// Epley式: 1RM = 重量 * (1 + 回数/30)
export function estimateOneRM(weight, reps) {
  if (reps <= 1) return weight;
  return weight * (1 + reps / 30);
}

export function roundToIncrement(value, increment = PLATE_INCREMENT_KG) {
  return Math.round(value / increment) * increment;
}

// 実測1RM記録と直近のトレーニング記録(トップセット)から、
// 「現時点で最も信頼できる1RM」を1つ選ぶ。
export function getCurrentE1RM(oneRMRecords, trainingLogs, today) {
  const candidates = [];

  for (const record of oneRMRecords) {
    candidates.push({ date: record.date, value: record.weight });
  }

  for (const log of trainingLogs) {
    for (const set of log.sets || []) {
      if (set.reps >= 1 && set.reps <= E1RM_ESTIMATE_MAX_REPS && set.weight > 0) {
        candidates.push({ date: log.date, value: estimateOneRM(set.weight, set.reps) });
      }
    }
  }

  if (candidates.length === 0) return null;

  const recent = candidates.filter(
    (c) => daysBetween(c.date, today) <= RECENT_WINDOW_DAYS && daysBetween(c.date, today) >= 0
  );
  const pool = recent.length > 0 ? recent : candidates;

  return pool.reduce((best, c) => (c.value > best.value ? c : best)).value;
}

// 目標に対する現在位置を評価する。
export function computeTrajectory(goal, currentE1RM, today) {
  if (!goal || currentE1RM == null) return null;

  const weeksRemaining = Math.max(1, Math.ceil(daysBetween(today, goal.targetDate) / 7));
  const gap = goal.targetWeight - currentE1RM;

  if (gap <= 0) {
    return { weeksRemaining, gap, weeklyRateNeeded: 0, status: "achieved" };
  }

  const weeklyRateNeeded = gap / weeksRemaining;
  const status = weeklyRateNeeded > SAFE_WEEKLY_MAX_KG ? "at_risk" : "on_track";

  return { weeksRemaining, gap, weeklyRateNeeded, status };
}

function daysSinceLastTest(trainingLogs, today) {
  const testLogs = trainingLogs
    .filter((l) => l.sessionType === "test")
    .sort((a, b) => toDate(b.date) - toDate(a.date));
  if (testLogs.length > 0) return daysBetween(testLogs[0].date, today);

  // まだテストを実施したことがない場合は、記録開始日を起点にする。
  // 記録自体がまだ無ければ「経過0日」とし、初回からテストを強制しない。
  if (trainingLogs.length === 0) return 0;
  const firstLog = [...trainingLogs].sort((a, b) => toDate(a.date) - toDate(b.date))[0];
  return daysBetween(firstLog.date, today);
}

// ②③④のサイクル: volume → intensity → technique を繰り返し、
// 一定間隔および目標期限直前でテスト(1RM再計測)を挟む。
export function getNextSessionType(trainingLogs, goal, today) {
  const nonTestCount = trainingLogs.filter((l) => l.sessionType !== "test").length;
  const sinceTest = daysSinceLastTest(trainingLogs, today);

  if (sinceTest >= TEST_INTERVAL_DAYS) return "test";

  if (goal) {
    const daysToDeadline = daysBetween(today, goal.targetDate);
    if (daysToDeadline >= 0 && daysToDeadline <= FINAL_TEST_LOOKAHEAD_DAYS && sinceTest > 7) {
      return "test";
    }
  }

  return SESSION_CYCLE[nonTestCount % SESSION_CYCLE.length];
}

function averageRPE(log) {
  const sets = (log.sets || []).filter((s) => typeof s.rpe === "number");
  if (sets.length === 0) return null;
  return sets.reduce((sum, s) => sum + s.rpe, 0) / sets.length;
}

function findLastLogOfType(trainingLogs, sessionType) {
  return trainingLogs
    .filter((l) => l.sessionType === sessionType)
    .sort((a, b) => toDate(b.date) - toDate(a.date))[0];
}

// 前回同種セッションのRPEを見て、次回の負荷を自動調整(オートレギュレーション)する。
export function prescribeSession(sessionType, currentE1RM, trainingLogs, trajectory) {
  const spec = SESSION_TABLE[sessionType];
  const lastLog = findLastLogOfType(trainingLogs, sessionType);
  const lastRPE = lastLog ? averageRPE(lastLog) : null;

  let adjustment = 0;
  let feedbackNote = "前回の記録がないため標準値で提案します。";

  if (lastRPE != null) {
    if (lastRPE < spec.targetRPE[0]) {
      adjustment = 0.02;
      feedbackNote = `前回RPE ${lastRPE.toFixed(1)} は目標より低かったため、負荷を上げます。`;
    } else if (lastRPE > spec.targetRPE[1]) {
      adjustment = -0.05;
      feedbackNote = `前回RPE ${lastRPE.toFixed(1)} は目標より高かったため、負荷を下げて回復を優先します。`;
    } else {
      adjustment = 0.01;
      feedbackNote = `前回RPE ${lastRPE.toFixed(1)} は目標範囲内だったため、通常の漸進を適用します。`;
    }
  }

  if (sessionType === "test") {
    const trend = trajectory && trajectory.status === "at_risk" ? 0.03 : 0.02;
    const weight = roundToIncrement(currentE1RM * (1 + trend));
    return {
      sessionType,
      sets: 1,
      reps: 1,
      weight,
      targetRPE: spec.targetRPE,
      feedbackNote: "1RM再計測日です。ウォームアップを重ねたうえで挑戦重量に挑んでください。",
      warmups: [0.4, 0.6, 0.75, 0.85, 0.93].map((p) => roundToIncrement(weight * p)),
    };
  }

  const weight = roundToIncrement(currentE1RM * spec.pct * (1 + adjustment));

  return {
    sessionType,
    sets: spec.sets,
    reps: spec.reps,
    weight,
    targetRPE: spec.targetRPE,
    feedbackNote,
  };
}

function trajectoryMessage(trajectory) {
  if (!trajectory) return "目標が未設定、または現在の1RMが未記録です。";
  if (trajectory.status === "achieved") return "目標重量に到達済みです。おめでとうございます!";
  if (trajectory.status === "at_risk") {
    return (
      `残り${trajectory.weeksRemaining}週で${trajectory.gap.toFixed(1)}kgの伸びが必要です` +
      `(週あたり${trajectory.weeklyRateNeeded.toFixed(2)}kg)。このペースは一般的な安全な伸び率を` +
      `超えています。期限の見直しも検討してください。`
    );
  }
  return (
    `残り${trajectory.weeksRemaining}週で${trajectory.gap.toFixed(1)}kgの伸びが必要です` +
    `(週あたり${trajectory.weeklyRateNeeded.toFixed(2)}kg)。順調なペースです。`
  );
}

// アプリのメインエントリーポイント: ②③(履歴)から④(次回提案)を組み立てる。
export function generateSuggestion(state, today) {
  const { goal, oneRMRecords, trainingLogs } = state;
  const currentE1RM = getCurrentE1RM(oneRMRecords, trainingLogs, today);

  if (currentE1RM == null) {
    return {
      status: "insufficient_data",
      message: "まず現在の1RMを記録してください(②)。",
    };
  }

  const trajectory = computeTrajectory(goal, currentE1RM, today);
  const sessionType = getNextSessionType(trainingLogs, goal, today);
  const prescription = prescribeSession(sessionType, currentE1RM, trainingLogs, trajectory);

  return {
    status: "ok",
    currentE1RM,
    trajectory,
    prescription,
    message: trajectoryMessage(trajectory),
  };
}

export const CONSTANTS = {
  DAY_MS,
  E1RM_ESTIMATE_MAX_REPS,
  RECENT_WINDOW_DAYS,
  TEST_INTERVAL_DAYS,
  FINAL_TEST_LOOKAHEAD_DAYS,
  SAFE_WEEKLY_MAX_KG,
  PLATE_INCREMENT_KG,
  SESSION_CYCLE,
  SESSION_TABLE,
};
