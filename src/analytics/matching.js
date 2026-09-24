// analytics：事件-拐点硬约束匹配 + 影响评级（纯函数，宁空不凑）
// 方向：由事件基本面 valence 决定（不由拐点类型推断）；
// 强度：事件先验 weight 与事件后 1/5/20 日实际市场反应取较大者，
//       避免重大事件被短期波动低估，也避免平淡事件被波段幅度夸大。
import { pct } from "../util/format.js";

const STRENGTH_WORDS = ["", "轻微", "有限", "中等", "显著", "重大"];
const DIR_WORDS = { bullish: "利好", bearish: "利空", neutral: "中性" };

// 事件日期对应的最近 bar 索引（精确命中优先，否则最近 bar，用于跨周末）
function nearestBarIndex(bars, date) {
  const exact = bars.findIndex((b) => b.date === date);
  if (exact >= 0) return exact;
  let best = null;
  let bd = Infinity;
  bars.forEach((b, i) => {
    const d = Math.abs(Date.parse(`${b.date}T00:00:00Z`) - Date.parse(`${date}T00:00:00Z`));
    if (d < bd) {
      bd = d;
      best = i;
    }
  });
  return best;
}

function scoreFromStrength(strength) {
  if (strength >= 0.3) return 5;
  if (strength >= 0.2) return 4;
  if (strength >= 0.1) return 3;
  if (strength >= 0.05) return 2;
  return 1;
}

// 拐点后 n 个交易日收益
function forwardReturn(bars, index, n) {
  if (index >= bars.length - 1) return null;
  const t = Math.min(index + n, bars.length - 1);
  return bars[t].close / bars[index].close - 1;
}

function buildMatch(bars, pivot, event, lag, { windowDays }) {
  const pointName = pivot.type === "peak" ? "高点" : "低点";
  const f1 = forwardReturn(bars, pivot.index, 1);
  const f5 = forwardReturn(bars, pivot.index, 5);
  const f20 = forwardReturn(bars, pivot.index, 20);
  const reacts = [f1, f5, f20].filter((x) => x !== null);

  // 无事件：诚实标注未归因；颜色仅按拐点类型
  if (!event) {
    const sig = scoreFromStrength(Math.abs(pivot.magnitude ?? 0));
    return {
      pivot,
      event: null,
      lagTradingDays: null,
      segmentMove: pivot.magnitude,
      forwardReturns: { d1: f1, d5: f5, d20: f20 },
      impactScore: sig,
      impactLabel: "无重大已知事件（未归因）",
      direction: pivot.type === "trough" ? "bullish" : "bearish",
      confidence: "low",
      rationale: `该${pointName}在 ±${windowDays} 个交易日内未检索到可溯源的重大事件；所在波段幅度 ${pct(
        pivot.magnitude,
      )}，拐点后 5 日 ${pct(f5)}、20 日 ${pct(f20)}。时间窗口内无对应事件，不作因果归因。`,
    };
  }

  // 中性公司行动（如拆股）：价值无变化
  if (event.valence === "neutral") {
    return {
      pivot,
      event,
      lagTradingDays: lag,
      segmentMove: pivot.magnitude,
      forwardReturns: { d1: f1, d5: f5, d20: f20 },
      impactScore: event.weight ?? 1,
      impactLabel: "中性事件（价值无变化）",
      direction: "neutral",
      confidence: pivot.confirmed ? "medium" : "low",
      rationale: `「${event.title}」发生于 ${event.date}，距该${pointName} ${lag} 个交易日；属公司行动，不改变公司价值，影响中性。`,
    };
  }

  // 市场实际反应强度（事件后多窗口最大绝对收益）
  const maxAbs = reacts.length ? Math.max(...reacts.map(Math.abs)) : 0;
  const marketScore = scoreFromStrength(maxAbs);
  const score = Math.max(event.weight ?? marketScore, marketScore);

  // 事件性质与短期（5日）实际反应是否冲突
  const conflict =
    f5 !== null &&
    ((event.valence === "bullish" && f5 < -0.05) ||
      (event.valence === "bearish" && f5 > 0.05));

  const confidence = !pivot.confirmed
    ? "low"
    : conflict
      ? "low"
      : lag <= 5
        ? "high"
        : "medium";

  const label = `${STRENGTH_WORDS[score]}·${DIR_WORDS[event.valence]}${
    conflict ? "（短期反应相反）" : ""
  }`;

  const conflictNote = conflict
    ? ` 注意：事件性质为${DIR_WORDS[event.valence]}，但拐点后 5 日实际收益 ${pct(
        f5,
      )}，方向相反（可能受大盘/利好出尽影响），置信度下调。`
    : "";

  return {
    pivot,
    event,
    lagTradingDays: lag,
    segmentMove: pivot.magnitude,
    forwardReturns: { d1: f1, d5: f5, d20: f20 },
    impactScore: score,
    impactLabel: label,
    direction: event.valence,
    confidence,
    rationale: `「${event.title}」发生于 ${event.date}，距该${pointName} ${lag} 个交易日；事件性质：${DIR_WORDS[event.valence]}（先验权重 ${event.weight}）。拐点后 1 日 ${pct(
      f1,
    )}、5 日 ${pct(f5)}、20 日 ${pct(f20)}，市场反应强度评级 ${marketScore}/5，综合评级 ${score}/5。${conflictNote}`,
  };
}

/**
 * 事件与拐点匹配（贪心一一对应：交易日 lag 最小者优先）。
 * 以 pivot 为中心返回，每个 pivot 一条；未匹配 pivot 的 event=null。
 */
export function matchEvents(
  bars,
  pivots,
  events,
  { windowDays = 10 } = {},
) {
  if (!bars.length || !pivots.length) return [];

  const located = events.map((e) => ({ e, idx: nearestBarIndex(bars, e.date) }));

  const candidates = [];
  pivots.forEach((p, pi) => {
    for (const { e, idx: ei } of located) {
      if (ei === null || ei === undefined) continue;
      const lag = Math.abs(ei - p.index);
      if (lag <= windowDays) candidates.push({ pi, p, e, lag });
    }
  });

  candidates.sort((a, b) => a.lag - b.lag);
  const usedPivot = new Set();
  const usedEvent = new Set();
  const chosen = new Map();
  for (const c of candidates) {
    if (usedPivot.has(c.pi) || usedEvent.has(c.e.id)) continue;
    usedPivot.add(c.pi);
    usedEvent.add(c.e.id);
    chosen.set(c.pi, c);
  }

  return pivots.map((p, pi) =>
    buildMatch(bars, p, chosen.get(pi)?.e ?? null, chosen.get(pi)?.lag ?? null, {
      windowDays,
    }),
  );
}
