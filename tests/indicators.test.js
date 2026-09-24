import { test } from "node:test";
import assert from "node:assert/strict";
import {
  returnsFromCloses,
  totalReturn,
  maxDrawdown,
  annualizedVolatility,
  correlation,
  alignByDate,
  growthOf,
} from "../src/analytics/indicators.js";

const mkBars = (closes) =>
  closes.map((c, i) => ({
    date: `2022-01-${String(i + 3).padStart(2, "0")}`,
    open: c, high: c, low: c, close: c, volume: 1,
  }));

test("简单收益率（首项 0）", () => {
  const r = returnsFromCloses([100, 110, 105]);
  assert.ok(Math.abs(r[0]) < 1e-12);
  assert.ok(Math.abs(r[1] - 0.1) < 1e-12);
  assert.ok(Math.abs(r[2] - (105 - 110) / 110) < 1e-12);
});

test("累计收益", () => {
  assert.ok(Math.abs(totalReturn(mkBars([100, 110, 105])) - 0.05) < 1e-12);
});

test("净值序列起点为 1", () => {
  const g = growthOf(mkBars([100, 200, 150]));
  assert.deepEqual(g, [1, 2, 1.5]);
});

test("最大回撤：120->90 = -25%", () => {
  const r = maxDrawdown(mkBars([100, 120, 90, 95]));
  assert.ok(Math.abs(r.maxDrawdown - -0.25) < 1e-12);
  assert.equal(r.peakDate, "2022-01-04");
  assert.equal(r.troughDate, "2022-01-05");
});

test("年化波动率为正", () => {
  const v = annualizedVolatility(mkBars([100, 110, 90, 115, 105]), 252);
  assert.ok(v > 0);
});

test("相关性：完全正相关=1，完全负相关=-1", () => {
  const a = [1, 2, 3, 4, 5];
  const b = [2, 4, 6, 8, 10];
  const c = [10, 8, 6, 4, 2];
  assert.ok(Math.abs(correlation(a, b) - 1) < 1e-12);
  assert.ok(Math.abs(correlation(a, c) + 1) < 1e-12);
});

test("alignByDate：仅保留共同日期", () => {
  const a = mkBars([1, 2]); // 01-03,01-04
  const b = [
    { date: "2022-01-04", close: 20 },
    { date: "2022-01-05", close: 30 },
  ];
  const rows = alignByDate({ a, b });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].date, "2022-01-04");
  assert.equal(rows[0].a.close, 2);
  assert.equal(rows[0].b.close, 20);
});
