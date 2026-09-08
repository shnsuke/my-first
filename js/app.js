import { loadState, saveState, makeId } from "./storage.js";
import { generateSuggestion, getCurrentE1RM, estimateOneRM, toDate } from "./suggestion.js";
import { drawProgressChart } from "./chart.js";

const state = loadState();

const SESSION_LABELS = {
  volume: "ボリューム",
  intensity: "インテンシティ",
  technique: "テクニック/軽負荷",
  test: "1RMテスト",
};

function formatTokyoDate(date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

// 端末時計から即座に計算した暫定値(オフラインでもこれで動く)。
// オンライン時はsyncReferenceDateFromNetworkがサーバー時刻で上書きする。
let referenceDate = formatTokyoDate(new Date());

function todayStr() {
  return referenceDate;
}

// 自ホスト(このページ自身)へHEADリクエストを送り、レスポンスのDateヘッダーから
// 端末の時計・タイムゾーン設定に依存しない正確な東京時間を取得する。
// 起動直後にまだユーザーが手で変更していない日付欄だけを補正する。
async function syncReferenceDateFromNetwork() {
  if (!navigator.onLine) return;
  const staleDate = referenceDate;
  const dateInputs = [document.getElementById("onerm-date"), document.getElementById("training-date")];
  try {
    const res = await fetch(location.href, {
      method: "HEAD",
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
    const dateHeader = res.headers.get("date");
    if (!dateHeader) return;
    const networkDate = formatTokyoDate(new Date(dateHeader));
    if (networkDate === staleDate) return;
    referenceDate = networkDate;
    for (const input of dateInputs) {
      if (input && input.value === staleDate) input.value = referenceDate;
    }
  } catch {
    // オフライン・タイムアウト・file://実行時などは端末時計の推定値のまま続行
  }
}

function persist() {
  saveState(state);
  renderAll();
}

// --- タブ切り替え ---
document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById(`tab-${btn.dataset.tab}`).classList.add("active");
    if (btn.dataset.tab === "history" || btn.dataset.tab === "dashboard") renderCharts();
  });
});

// --- ① 目標設定 ---
const goalForm = document.getElementById("goal-form");
goalForm.addEventListener("submit", (e) => {
  e.preventDefault();
  state.goal = {
    targetWeight: parseFloat(document.getElementById("goal-weight").value),
    targetDate: document.getElementById("goal-date").value,
  };
  persist();
});

function renderGoal() {
  const el = document.getElementById("goal-current");
  if (!state.goal) {
    el.textContent = "目標は未設定です。";
    return;
  }
  document.getElementById("goal-weight").value = state.goal.targetWeight;
  document.getElementById("goal-date").value = state.goal.targetDate;
  el.textContent = `現在の目標: ${state.goal.targetWeight}kg / ${state.goal.targetDate}`;
}

// --- ② 1RM記録 ---
document.getElementById("onerm-date").value = todayStr();
const onermForm = document.getElementById("onerm-form");
onermForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const weight = parseFloat(document.getElementById("onerm-weight").value);
  const reps = parseInt(document.getElementById("onerm-reps").value, 10);
  state.oneRMRecords.push({
    id: makeId(),
    date: document.getElementById("onerm-date").value,
    weight,
    reps,
    note: document.getElementById("onerm-note").value,
  });
  onermForm.reset();
  document.getElementById("onerm-date").value = todayStr();
  document.getElementById("onerm-reps").value = 1;
  persist();
});

function renderOneRMTable() {
  const tbody = document.querySelector("#onerm-table tbody");
  tbody.innerHTML = "";
  const sorted = [...state.oneRMRecords].sort((a, b) => toDate(b.date) - toDate(a.date));
  for (const r of sorted) {
    const tr = document.createElement("tr");
    const est = estimateOneRM(r.weight, r.reps);
    tr.innerHTML = `
      <td>${r.date}</td>
      <td>${r.weight}kg</td>
      <td>${r.reps}</td>
      <td>${est.toFixed(1)}kg</td>
      <td>${r.note || ""}</td>
      <td><button data-id="${r.id}" class="del-onerm">削除</button></td>
    `;
    tbody.appendChild(tr);
  }
  tbody.querySelectorAll(".del-onerm").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.oneRMRecords = state.oneRMRecords.filter((r) => r.id !== btn.dataset.id);
      persist();
    });
  });
}

// --- ③ トレーニング記録 ---
document.getElementById("training-date").value = todayStr();
const setsContainer = document.getElementById("training-sets");

function addSetRow(weight = "", reps = "", rpe = "") {
  const row = document.createElement("div");
  row.className = "set-row";
  row.innerHTML = `
    <input type="number" step="0.5" placeholder="重量kg" class="set-weight" value="${weight}" />
    <input type="number" placeholder="回数" class="set-reps" value="${reps}" />
    <input type="number" step="0.5" min="1" max="10" placeholder="RPE" class="set-rpe" value="${rpe}" />
    <button type="button" class="remove-set">×</button>
  `;
  row.querySelector(".remove-set").addEventListener("click", () => row.remove());
  setsContainer.appendChild(row);
}

document.getElementById("add-set-btn").addEventListener("click", () => addSetRow());
addSetRow();

syncReferenceDateFromNetwork();

const trainingForm = document.getElementById("training-form");
trainingForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const sets = [...setsContainer.querySelectorAll(".set-row")]
    .map((row) => ({
      weight: parseFloat(row.querySelector(".set-weight").value),
      reps: parseInt(row.querySelector(".set-reps").value, 10),
      rpe: parseFloat(row.querySelector(".set-rpe").value),
    }))
    .filter((s) => !isNaN(s.weight) && !isNaN(s.reps));

  state.trainingLogs.push({
    id: makeId(),
    date: document.getElementById("training-date").value,
    sessionType: document.getElementById("training-type").value,
    sets,
    note: document.getElementById("training-note").value,
  });

  trainingForm.reset();
  document.getElementById("training-date").value = todayStr();
  setsContainer.innerHTML = "";
  addSetRow();
  persist();
});

function renderTrainingTable() {
  const tbody = document.querySelector("#training-table tbody");
  tbody.innerHTML = "";
  const sorted = [...state.trainingLogs].sort((a, b) => toDate(b.date) - toDate(a.date));
  for (const log of sorted) {
    const setsText = (log.sets || [])
      .map((s) => `${s.weight}kg×${s.reps}${isNaN(s.rpe) ? "" : `@RPE${s.rpe}`}`)
      .join(", ");
    const rpes = (log.sets || []).map((s) => s.rpe).filter((r) => !isNaN(r));
    const avgRpe = rpes.length ? (rpes.reduce((a, b) => a + b, 0) / rpes.length).toFixed(1) : "-";
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${log.date}</td>
      <td>${SESSION_LABELS[log.sessionType] || log.sessionType}</td>
      <td>${setsText}</td>
      <td>${avgRpe}</td>
      <td>${log.note || ""}</td>
      <td><button data-id="${log.id}" class="del-training">削除</button></td>
    `;
    tbody.appendChild(tr);
  }
  tbody.querySelectorAll(".del-training").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.trainingLogs = state.trainingLogs.filter((l) => l.id !== btn.dataset.id);
      persist();
    });
  });
}

// --- ④ 今日のトレーニング案 ---
// state(目標・1RM記録・トレーニング記録)は既にlocalStorageに永続化されているため、
// 提案はアプリを開くたび(=renderAll経由)に自動で再計算・再表示される。
// アプリを閉じて再度開いても、記録が変わっていなければ同じ内容が表示される。
document.getElementById("generate-suggestion-btn").addEventListener("click", () => {
  renderSuggestion();
});

function buildSuggestionHtml(result) {
  if (result.status === "insufficient_data") {
    return `<p class="warning">${result.message}</p>`;
  }

  const p = result.prescription;
  const warmupHtml = p.warmups
    ? `<p>ウォームアップ目安: ${p.warmups.join(" → ")}kg</p>`
    : "";

  return `
    <p class="status-message">${result.message}</p>
    <div class="prescription-card">
      <h3>今日: ${SESSION_LABELS[p.sessionType]}</h3>
      <p>${p.sets}セット × ${p.reps}回 @ ${p.weight}kg (目標RPE ${p.targetRPE[0]}〜${p.targetRPE[1]})</p>
      ${warmupHtml}
      <p class="muted">${p.feedbackNote}</p>
    </div>
  `;
}

function renderSuggestion() {
  const result = generateSuggestion(state, todayStr());
  document.getElementById("suggestion-result").innerHTML = buildSuggestionHtml(result);
  return result;
}

// --- ダッシュボード ---
function renderDashboard() {
  const el = document.getElementById("dashboard-summary");
  const currentE1RM = getCurrentE1RM(state.oneRMRecords, state.trainingLogs, todayStr());
  const goalText = state.goal
    ? `目標 ${state.goal.targetWeight}kg (期限: ${state.goal.targetDate})`
    : "目標未設定";
  el.innerHTML = `
    <h2>現在の状況</h2>
    <p>${goalText}</p>
    <p>推定現在1RM: ${currentE1RM != null ? currentE1RM.toFixed(1) + "kg" : "未記録"}</p>
  `;

  const result = generateSuggestion(state, todayStr());
  document.getElementById("dashboard-suggestion").innerHTML = `
    <h2>今日のトレーニング案</h2>
    ${buildSuggestionHtml(result)}
  `;
}

function buildE1RMSeries() {
  const points = [];
  for (const r of state.oneRMRecords) {
    points.push({ date: r.date, value: estimateOneRM(r.weight, r.reps) });
  }
  for (const log of state.trainingLogs) {
    for (const s of log.sets || []) {
      if (s.reps >= 1 && s.reps <= 10 && s.weight > 0) {
        points.push({ date: log.date, value: estimateOneRM(s.weight, s.reps) });
      }
    }
  }
  return points;
}

function renderCharts() {
  const points = buildE1RMSeries();
  const dashboardCanvas = document.getElementById("dashboard-chart");
  const historyCanvas = document.getElementById("history-chart");
  if (dashboardCanvas.offsetParent !== null) drawProgressChart(dashboardCanvas, points, state.goal);
  if (historyCanvas.offsetParent !== null) drawProgressChart(historyCanvas, points, state.goal);
}

// --- エクスポート/インポート ---
document.getElementById("export-btn").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `deadlift-tracker-${todayStr()}.json`;
  a.click();
  URL.revokeObjectURL(url);
});

document.getElementById("import-input").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const text = await file.text();
  try {
    const imported = JSON.parse(text);
    state.goal = imported.goal ?? null;
    state.oneRMRecords = imported.oneRMRecords ?? [];
    state.trainingLogs = imported.trainingLogs ?? [];
    persist();
  } catch {
    alert("JSONの読み込みに失敗しました。");
  }
});

function renderAll() {
  renderGoal();
  renderOneRMTable();
  renderTrainingTable();
  renderDashboard();
  renderSuggestion();
  renderCharts();
}

renderAll();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  });
}
