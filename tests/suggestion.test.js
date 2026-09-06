import test from "node:test";
import assert from "node:assert/strict";
import {
  estimateOneRM,
  getCurrentE1RM,
  computeTrajectory,
  getNextSessionType,
  prescribeSession,
  generateSuggestion,
  roundToIncrement,
} from "../js/suggestion.js";

test("estimateOneRM: reps=1 は重量そのまま", () => {
  assert.equal(estimateOneRM(150, 1), 150);
});

test("estimateOneRM: Epley式で高くなる", () => {
  const est = estimateOneRM(140, 5);
  assert.ok(est > 140);
  assert.ok(Math.abs(est - 163.33) < 0.1);
});

test("roundToIncrement: 2.5kg刻みに丸める", () => {
  assert.equal(roundToIncrement(101), 100);
  assert.equal(roundToIncrement(102.6), 102.5);
});

test("getCurrentE1RM: 記録がなければnull", () => {
  assert.equal(getCurrentE1RM([], [], "2026-09-06"), null);
});

test("getCurrentE1RM: 直近21日以内の最大値を採用", () => {
  const oneRMRecords = [
    { date: "2026-08-01", weight: 150, reps: 1 }, // 古い(範囲外)
    { date: "2026-09-01", weight: 160, reps: 1 }, // 直近
  ];
  const value = getCurrentE1RM(oneRMRecords, [], "2026-09-06");
  assert.equal(value, 160);
});

test("computeTrajectory: 目標達成済みならachieved", () => {
  const goal = { targetWeight: 150, targetDate: "2026-12-01" };
  const result = computeTrajectory(goal, 160, "2026-09-06");
  assert.equal(result.status, "achieved");
});

test("computeTrajectory: 週次成長率が安全範囲を超えるとat_risk", () => {
  const goal = { targetWeight: 200, targetDate: "2026-09-20" }; // 2週間で50kg
  const result = computeTrajectory(goal, 150, "2026-09-06");
  assert.equal(result.status, "at_risk");
});

test("computeTrajectory: 現実的なペースならon_track", () => {
  const goal = { targetWeight: 160, targetDate: "2027-01-06" }; // 約17週で10kg
  const result = computeTrajectory(goal, 150, "2026-09-06");
  assert.equal(result.status, "on_track");
});

test("getNextSessionType: 記録なしなら最初はvolume", () => {
  const type = getNextSessionType([], null, "2026-09-06");
  assert.equal(type, "volume");
});

test("getNextSessionType: volume→intensity→techniqueの循環", () => {
  const logs = [
    { date: "2026-09-01", sessionType: "volume", sets: [] },
    { date: "2026-09-03", sessionType: "intensity", sets: [] },
  ];
  assert.equal(getNextSessionType(logs, null, "2026-09-06"), "technique");
});

test("getNextSessionType: 前回テストから28日以上でtest", () => {
  const logs = [{ date: "2026-08-01", sessionType: "test", sets: [] }];
  assert.equal(getNextSessionType(logs, null, "2026-09-06"), "test");
});

test("prescribeSession: 前回RPEが低ければ負荷を上げる", () => {
  const logs = [
    { date: "2026-09-01", sessionType: "volume", sets: [{ weight: 100, reps: 5, rpe: 6 }] },
  ];
  const p = prescribeSession("volume", 150, logs, null);
  // 標準73%(109.5)より高い値になっているはず
  assert.ok(p.weight > roundToIncrement(150 * 0.73));
});

test("generateSuggestion: データ不足時はinsufficient_data", () => {
  const result = generateSuggestion({ goal: null, oneRMRecords: [], trainingLogs: [] }, "2026-09-06");
  assert.equal(result.status, "insufficient_data");
});

test("generateSuggestion: 一連のデータがあれば提案を返す", () => {
  const state = {
    goal: { targetWeight: 180, targetDate: "2027-03-01" },
    oneRMRecords: [{ date: "2026-09-01", weight: 150, reps: 1 }],
    trainingLogs: [],
  };
  const result = generateSuggestion(state, "2026-09-06");
  assert.equal(result.status, "ok");
  assert.equal(result.prescription.sessionType, "volume");
  assert.ok(result.prescription.weight > 0);
});
