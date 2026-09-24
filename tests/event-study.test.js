import { test } from "node:test";
import assert from "node:assert/strict";
import { annotateEvents, scoreFromMove, anchorKind } from "../src/analytics/event-study.js";

const t0 = Date.parse("2022-01-03T00:00:00Z");
function makeBars(closes) {
  return closes.map((close, i) => {
    const date = new Date(t0 + i * 86400000).toISOString().slice(0, 10);
    return { date, open: close, high: close, low: close, close, volume: 1 };
  });
}
const evt = (id, date, { weight = 3, valence = "bullish", category = "gpu" } = {}) => ({
  id, date, title: id, category, summary: "",
  sources: ["https://x"], valence, weight,
});
const pivot = (bars, i, type = "peak") => ({
  index: i, date: bars[i].date, type, price: bars[i].close,
  magnitude: 0.2, confirmed: true,
});

test("事件后 1/5 日收益与事件前 5 日收益计算正确；d20 越界为 null", () => {
  const closes = Array.from({ length: 25 }, (_, i) => 100 + i); // 100..124
  const bars = makeBars(closes);
  const out = annotateEvents(bars, [], [evt("e", bars[10].date)], { windowDays: 10 });
  const a = out[0];
  assert.ok(Math.abs(a.reaction.d1 - 111 / 110 + 1) < 1e-12);
  assert.ok(Math.abs(a.reaction.d5 - 115 / 110 + 1) < 1e-12);
  assert.equal(a.reaction.d20, null); // idx30 越界
  assert.ok(Math.abs(a.reaction.pre5 - 110 / 105 + 1) < 1e-12);
  assert.equal(a.reactionDir, "up");
});

test("窗口内邻近拐点被记录（peak，lag=+2）", () => {
  const bars = makeBars(Array.from({ length: 25 }, (_, i) => 100 + i));
  const pivots = [pivot(bars, 12, "peak")];
  const a = annotateEvents(bars, pivots, [evt("e", bars[10].date)], { windowDays: 10 })[0];
  assert.equal(a.nearestPivot.type, "peak");
  assert.equal(a.nearestPivot.lag, 2);
});

test("窗口外拐点不匹配：nearestPivot null", () => {
  const bars = makeBars(Array.from({ length: 40 }, (_, i) => 100 + i));
  const pivots = [pivot(bars, 25, "peak")]; // 距事件 idx5 有20
  const a = annotateEvents(bars, pivots, [evt("e", bars[5].date)], { windowDays: 10 })[0];
  assert.equal(a.nearestPivot, null);
});

test("impactScore = max(weight, 市场反应强度)", () => {
  // idx10 后大跌：构造 close 100..110 然后跌到 80
  const closes = [];
  for (let i = 0; i <= 10; i++) closes.push(100 + i);
  for (let i = 11; i < 41; i++) closes.push(110 - (i - 10) * 2);
  const bars = makeBars(closes);
  const a = annotateEvents(bars, [], [evt("crash", bars[10].date, { weight: 2 })], { windowDays: 10 })[0];
  assert.ok(a.marketScore > a.weight);
  assert.equal(a.impactScore, a.marketScore);
  assert.equal(a.reactionDir, "down");
});

test("scoreFromMove 分档", () => {
  assert.equal(scoreFromMove(0.3), 5);
  assert.equal(scoreFromMove(0.16), 4);
  assert.equal(scoreFromMove(0.1), 3);
  assert.equal(scoreFromMove(0.05), 2);
  assert.equal(scoreFromMove(0.01), 1);
});

test("anchor 关联类型：窗口内有拐点=pivot，无拐点但有可见反应=reaction", () => {
  const bars = makeBars(Array.from({ length: 40 }, (_, i) => 100 + i));
  // 事件 idx20，拐点 idx22（窗口内）→ pivot
  let a = annotateEvents(bars, [pivot(bars, 22, "peak")], [evt("e", bars[20].date)], { windowDays: 10 })[0];
  assert.equal(a.anchor.kind, "pivot");
  assert.equal(anchorKind(a.nearestPivot, a.maxMove), "pivot");
  // 无拐点但平稳上行有可见反应 → reaction
  a = annotateEvents(bars, [], [evt("e2", bars[5].date)], { windowDays: 3 })[0];
  assert.equal(a.anchor.kind, "reaction");
  assert.equal(a.anchor.strength >= 2, true);
});
