import { toDate } from "./suggestion.js";

// 依存ライブラリなしのシンプルな折れ線チャート。
// points: [{date, value}], goal: {targetWeight, targetDate} | null
export function drawProgressChart(canvas, points, goal) {
  const ctx = canvas.getContext("2d");
  const width = canvas.width;
  const height = canvas.height;
  const padding = 40;

  ctx.clearRect(0, 0, width, height);

  if (points.length === 0) {
    ctx.fillStyle = "#888";
    ctx.font = "14px sans-serif";
    ctx.fillText("記録がまだありません", padding, height / 2);
    return;
  }

  const sorted = [...points].sort((a, b) => toDate(a.date) - toDate(b.date));
  const dates = sorted.map((p) => toDate(p.date).getTime());
  const values = sorted.map((p) => p.value);

  let minDate = Math.min(...dates);
  let maxDate = Math.max(...dates);
  let minValue = Math.min(...values);
  let maxValue = Math.max(...values);

  if (goal) {
    maxDate = Math.max(maxDate, toDate(goal.targetDate).getTime());
    maxValue = Math.max(maxValue, goal.targetWeight);
  }

  if (minDate === maxDate) maxDate += 24 * 60 * 60 * 1000;
  if (minValue === maxValue) {
    minValue -= 5;
    maxValue += 5;
  } else {
    const pad = (maxValue - minValue) * 0.1;
    minValue -= pad;
    maxValue += pad;
  }

  const x = (d) => padding + ((d - minDate) / (maxDate - minDate)) * (width - padding * 2);
  const y = (v) => height - padding - ((v - minValue) / (maxValue - minValue)) * (height - padding * 2);

  // 軸
  ctx.strokeStyle = "#ccc";
  ctx.beginPath();
  ctx.moveTo(padding, padding);
  ctx.lineTo(padding, height - padding);
  ctx.lineTo(width - padding, height - padding);
  ctx.stroke();

  // 目標ライン(現在値から目標日・目標重量への直線)
  if (goal) {
    ctx.strokeStyle = "#e07a5f";
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.moveTo(x(dates[0]), y(values[0]));
    ctx.lineTo(x(toDate(goal.targetDate).getTime()), y(goal.targetWeight));
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = "#e07a5f";
    ctx.font = "12px sans-serif";
    ctx.fillText(`目標 ${goal.targetWeight}kg`, x(toDate(goal.targetDate).getTime()) - 60, y(goal.targetWeight) - 8);
  }

  // 実績ライン
  ctx.strokeStyle = "#3d5a80";
  ctx.lineWidth = 2;
  ctx.beginPath();
  sorted.forEach((p, i) => {
    const px = x(toDate(p.date).getTime());
    const py = y(p.value);
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  });
  ctx.stroke();

  ctx.fillStyle = "#3d5a80";
  sorted.forEach((p) => {
    const px = x(toDate(p.date).getTime());
    const py = y(p.value);
    ctx.beginPath();
    ctx.arc(px, py, 3, 0, Math.PI * 2);
    ctx.fill();
  });
}
