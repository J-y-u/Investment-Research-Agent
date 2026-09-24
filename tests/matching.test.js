import { test } from "node:test";
import assert from "node:assert/strict";
import { matchEvents } from "../src/analytics/matching.js";

function makeBars(n, start = "2022-01-03") {
  const t0 = Date.parse(`${start}T00:00:00Z`);
  return Array.from({ length: n }, (_, i) => {
    const date = new Date(t0 + i * 86400000).toISOString().slice(0, 10);
    const close = 100 + i;
    return { date, open: close, high: close, low: close, close, volume: 1 };
  });
}
const pivot = (bars, index, type, mag, confirmed = true) => ({
  index, date: bars[index].date, type, price: bars[index].close,
  magnitude: mag, confirmed,
});
const evt = (id, date, { valence = "bullish", weight = 3, category = "gpu" } = {}) => ({
  id, date, title: `${id} title`, category, summary: "",
  sources: ["https://example.com"], relevance: "ai", valence, weight,
});

test("ChatGPT 场景：peak 拐点 + bullish 事件 -> 方向利好而非利空", () => {
  const bars = makeBars(40);
  const m = matchEvents(bars, [pivot(bars, 10, "peak", 0.6)], [
    evt("chatgpt", bars[11].date, { valence: "bullish", weight: 5 }),
  ])[0];
  assert.equal(m.direction, "bullish");
  assert.equal(m.impactScore, 5); // 先验权重 5
  assert.match(m.impactLabel, /利好/);
  assert.doesNotMatch(m.impactLabel, /利空/);
});

test("DeepSeek 冲击场景：trough 拐点 + bearish 事件 -> 方向利空而非利好", () => {
  const bars = makeBars(40); // pivot 后价格上涨，与 bearish 短期冲突
  const m = matchEvents(bars, [pivot(bars, 10, "trough", -0.2)], [
    evt("crash", bars[10].date, { valence: "bearish", weight: 5 }),
  ])[0];
  assert.equal(m.direction, "bearish");
  assert.match(m.impactLabel, /利空/);
  assert.doesNotMatch(m.impactLabel, /利好催化/);
});

test("事件后 1 日暴跌 ~17% -> 市场反应评级捕捉即时冲击", () => {
  const t0 = Date.parse("2025-01-20T00:00:00Z");
  const closes = [];
  // index0..9 平稳在 130 附近；index10=130(拐点)，index11=108(-17%)，之后回升
  for (let i = 0; i < 10; i++) closes.push(130);
  closes.push(130); // 10: pivot
  closes.push(108); // 11: 单日 -16.9%
  for (let i = 12; i < 30; i++) closes.push(120 + (i - 12) * 0.8);
  const bars = closes.map((close, i) => {
    const date = new Date(t0 + i * 86400000).toISOString().slice(0, 10);
    return { date, open: close, high: close, low: close, close, volume: 1 };
  });
  const m = matchEvents(bars, [pivot(bars, 10, "trough", -0.18)], [
    evt("crash", bars[10].date, { valence: "bearish", weight: 5 }),
  ])[0];
  assert.ok(m.forwardReturns.d1 < -0.15);
  assert.equal(m.impactScore, 5);
  assert.equal(m.direction, "bearish");
});

test("窗口外事件不匹配：event=null 且标注未归因", () => {
  const bars = makeBars(40);
  const m = matchEvents(bars, [pivot(bars, 10, "peak", 0.3)], [
    evt("far", bars[25].date),
  ])[0];
  assert.equal(m.event, null);
  assert.match(m.impactLabel, /无重大已知事件/);
});

test("neutral 事件：中性、评级取 weight", () => {
  const bars = makeBars(40);
  const m = matchEvents(bars, [pivot(bars, 10, "peak", 0.4)], [
    evt("split", bars[11].date, { valence: "neutral", weight: 1, category: "company" }),
  ])[0];
  assert.equal(m.direction, "neutral");
  assert.equal(m.impactScore, 1);
  assert.match(m.impactLabel, /中性/);
});

test("一一对应：lag 更小的 pivot 获得唯一事件", () => {
  const bars = makeBars(40);
  const pivots = [pivot(bars, 10, "peak", 0.3), pivot(bars, 13, "peak", 0.3)];
  const matches = matchEvents(bars, pivots, [evt("only", bars[11].date)]);
  assert.equal(matches[0].event.id, "only");
  assert.equal(matches[1].event, null);
});

test("无 pivot / 无 bars 返回空", () => {
  assert.deepEqual(matchEvents(makeBars(5), [], [evt("e", "2022-01-04")]), []);
});
