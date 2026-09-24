import { test } from "node:test";
import assert from "node:assert/strict";
import { detectPivots } from "../src/analytics/pivots.js";

function barsFromCloses(closes, start = "2022-01-03") {
  const d = Date.parse(`${start}T00:00:00Z`);
  return closes.map((c, i) => ({
    date: new Date(d + i * 86400000).toISOString().slice(0, 10),
    open: c,
    high: c,
    low: c,
    close: c,
    volume: 1,
  }));
}

function ramp(from, to, step) {
  const arr = [];
  if (to >= from) for (let v = from; v <= to + 1e-9; v += step) arr.push(+v.toFixed(4));
  else for (let v = from; v >= to - 1e-9; v -= step) arr.push(+v.toFixed(4));
  return arr;
}

test("空、undefined、单根返回空数组", () => {
  assert.deepEqual(detectPivots([]), []);
  assert.deepEqual(detectPivots(undefined), []);
  assert.deepEqual(detectPivots(barsFromCloses([100])), []);
});

test("单调上涨无确认拐点，仅末尾未确认 peak", () => {
  const bars = barsFromCloses(ramp(100, 130, 1));
  const pivots = detectPivots(bars, { threshold: 0.15 });
  assert.equal(pivots.every((p) => p.confirmed === false), true);
  assert.equal(pivots.length, 1);
  assert.equal(pivots[0].type, "peak");
});

test("V 形：确认 peak 130 与 trough 90，末尾追加未确认 peak 120", () => {
  const closes = [
    ...ramp(100, 130, 5), // 上涨到 130
    ...ramp(125, 90, 5), // 下跌到 90
    ...ramp(95, 120, 5), // 反弹到 120
  ];
  const bars = barsFromCloses(closes);
  const pivots = detectPivots(bars, { threshold: 0.15 });
  const confirmed = pivots.filter((p) => p.confirmed);

  assert.equal(confirmed.length, 2);
  assert.equal(confirmed[0].type, "peak");
  assert.equal(confirmed[0].price, 130);
  assert.equal(confirmed[1].type, "trough");
  assert.equal(confirmed[1].price, 90);
  // trough 相对前一 peak 的幅度
  assert.ok(Math.abs(confirmed[1].magnitude - (90 - 130) / 130) < 1e-9);

  const tail = pivots[pivots.length - 1];
  assert.equal(tail.confirmed, false);
  assert.equal(tail.type, "peak");
  assert.equal(tail.price, 120);
});

test("阈值 50% 时同样波动不足以确认", () => {
  const closes = [...ramp(100, 130, 5), ...ramp(125, 90, 5), ...ramp(95, 120, 5)];
  const pivots = detectPivots(barsFromCloses(closes), { threshold: 0.5 });
  assert.equal(pivots.some((p) => p.confirmed), false);
});
