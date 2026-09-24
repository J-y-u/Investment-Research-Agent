// analytics：ZigZag 拐点检测（基于收盘价，纯函数）
// 相邻确认拐点之间的反转幅度需达到 threshold；末尾未反转的当前极端作为未确认拐点追加。

function makePivot(bars, index, type, price, confirmed, prev) {
  return {
    index,
    date: bars[index].date,
    type,
    price,
    magnitude: prev ? (price - prev.price) / prev.price : null,
    confirmed,
  };
}

/**
 * @param {Bar[]} bars
 * @param {object} opts
 * @param {number} opts.threshold 反转阈值（如 0.15 = 15%）
 * @returns {Pivot[]}
 */
export function detectPivots(bars, { threshold = 0.15 } = {}) {
  const pivots = [];
  if (!bars || bars.length < 2) return pivots;

  let trend = 0; // 0 未定，1 上升，-1 下降
  let hi = bars[0].close;
  let hiIdx = 0;
  let lo = bars[0].close;
  let loIdx = 0;

  for (let i = 1; i < bars.length; i++) {
    const c = bars[i].close;

    if (trend >= 0 && c <= hi * (1 - threshold)) {
      // 自高点回撤达阈值 -> 确认前高为 peak
      if (trend !== 0) {
        pivots.push(makePivot(bars, hiIdx, "peak", hi, true, pivots[pivots.length - 1]));
      }
      trend = -1;
      lo = c;
      loIdx = i;
    } else if (trend <= 0 && c >= lo * (1 + threshold)) {
      // 自低点反弹达阈值 -> 确认前低为 trough
      if (trend !== 0) {
        pivots.push(makePivot(bars, loIdx, "trough", lo, true, pivots[pivots.length - 1]));
      }
      trend = 1;
      hi = c;
      hiIdx = i;
    } else {
      if (trend >= 0 && c > hi) {
        hi = c;
        hiIdx = i;
      }
      if (trend <= 0 && c < lo) {
        lo = c;
        loIdx = i;
      }
    }
  }

  // 末尾追加当前趋势的未确认极端（覆盖最近一段，置信度低）
  const lastIdx = trend === 1 ? hiIdx : trend === -1 ? loIdx : -1;
  if (lastIdx >= 0) {
    const isPeak = trend === 1;
    const price = isPeak ? hi : lo;
    const prevPushed = pivots[pivots.length - 1];
    if (!prevPushed || prevPushed.index !== lastIdx) {
      pivots.push(makePivot(bars, lastIdx, isPeak ? "peak" : "trough", price, false, prevPushed));
    }
  }

  return pivots;
}
