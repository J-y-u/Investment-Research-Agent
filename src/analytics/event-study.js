// analytics：以事件为中心的事件研究（纯函数）
// 为每个事件计算事件前/后的实际收益（市场反应）与邻近的显著拐点。
// 这是新版可视化的数据基础：不把"未归因拐点"当主体，而把"事件 + 实际市场反应"讲清楚。

function nearestBarIndex(bars, date) {
  const exact = bars.findIndex((b) => b.date === date);
  if (exact >= 0) return exact;
  let best = null;
  let bd = Infinity;
  bars.forEach((b, i) => {
    const d = Math.abs(
      Date.parse(`${b.date}T00:00:00Z`) - Date.parse(`${date}T00:00:00Z`),
    );
    if (d < bd) {
      bd = d;
      best = i;
    }
  });
  return best;
}

// a 相对 b 的收益：a/b-1
const rel = (a, b) => (a === null || b === null ? null : a / b - 1);
const at = (bars, i) =>
  i < 0 || i >= bars.length ? null : bars[i].close;

// 事件后最大窗口绝对收益 -> 强度分
export function scoreFromMove(maxAbs) {
  if (maxAbs >= 0.25) return 5;
  if (maxAbs >= 0.15) return 4;
  if (maxAbs >= 0.1) return 3;
  if (maxAbs >= 0.05) return 2;
  return 1;
}

// 关联强度（事件与行情的贴合程度 1-5）：
// 同时考虑事件后实际反应与是否邻近显著拐点，避免“没够上15%大拐点”被误判为无关联。
function anchorStrength(marketScore, nearestPivot, maxAbs) {
  if (nearestPivot) return Math.max(marketScore, 3);
  // 无大拐点但事件自身有可见反应 → 仍成立
  if (maxAbs >= 0.03) return Math.max(marketScore, 2);
  return 1;
}
// 关联类型
export function anchorKind(nearestPivot, maxAbs) {
  if (nearestPivot) return "pivot";   // 与显著拐点贴合
  if (maxAbs >= 0.03) return "reaction"; // 有可见反应但未形成大拐点
  return "weak";                        // 反应微弱
}

/**
 * @param {Bar[]} bars
 * @param {Pivot[]} pivots
 * @param {IndustryEvent[]} events
 * @param {object} opts
 * @param {number} opts.windowDays 邻近拐点搜索窗口
 */
export function annotateEvents(bars, pivots, events, { windowDays = 10 } = {}) {
  if (!bars.length) return [];

  // 仅保留落在行情区间内的事件（避免检索到更早的新闻把时间轴拉宽）
  const first = bars[0].date;
  const last = bars[bars.length - 1].date;
  const inRange = events.filter((e) => e.date >= first && e.date <= last);

  return inRange.map((event) => {
    const idx = nearestBarIndex(bars, event.date);
    if (idx === null) return { ...event, barIndex: null };

    // 财报等事件的拐点搜索窗口可更宽（反应有时在 10 日外）
    const pivotWindow = event.category === "earnings" ? windowDays + 5 : windowDays;

    // 事件前 5 日（是否提前反应）；事件后 1/5/20 日
    const pre5 = rel(at(bars, idx), at(bars, idx - 5));
    const d1 = rel(at(bars, idx + 1), at(bars, idx));
    const d5 = rel(at(bars, idx + 5), at(bars, idx));
    const d20 = rel(at(bars, idx + 20), at(bars, idx));
    const reaction = { pre5, d1, d5, d20 };

    const fwd = [d1, d5, d20].filter((x) => x !== null);
    const maxAbs = fwd.length ? Math.max(...fwd.map(Math.abs)) : 0;
    const marketScore = scoreFromMove(maxAbs);
    const impactScore = Math.max(event.weight ?? marketScore, marketScore);
    const reactionDir =
      d5 === null ? null : d5 > 0.02 ? "up" : d5 < -0.02 ? "down" : "flat";

    // 邻近显著拐点（窗口内绝对 lag 最小）
    let nearestPivot = null;
    let bestLag = Infinity;
    for (const p of pivots) {
      const lag = p.index - idx; // 负=拐点在事件前
      if (Math.abs(lag) <= pivotWindow && Math.abs(lag) < bestLag) {
        bestLag = Math.abs(lag);
        nearestPivot = {
          date: p.date,
          type: p.type,
          confirmed: p.confirmed,
          lag,
        };
      }
    }

    // 事件自身锚点：关联强度与类型
    const anchor = {
      strength: anchorStrength(marketScore, nearestPivot, maxAbs),
      kind: anchorKind(nearestPivot, maxAbs),
    };

    return {
      ...event,
      barIndex: idx,
      reaction,
      maxMove: maxAbs,
      marketScore,
      impactScore,
      reactionDir,
      nearestPivot,
      anchor,
    };
  });
}
