// 事件源解析：为任意标的提供行业事件。
// ① 有 curated 深度事件映射的标的（如 NVDA）→ 人工核实的预置事件；
// ② 其他任意标的 → Hacker News 动态检索（免费、可溯源），无 valence，方向完全看市场实际反应。
import { searchHn } from "./news.js";
import { getCuratedEvents } from "./curated-events.js";

// ticker -> 深度事件库（可扩展：A股/港股重点标的可在此挂接预置事件）
const CURATED_MAP = {
  NVDA: () => getCuratedEvents(),
};

/**
 * @param {string} symbol 行情代码
 * @param {object} opts
 * @param {string} [opts.query] 检索关键词（默认用代码；公司名更准时模型可传）
 */
export async function getEventsForSymbol(
  symbol,
  { query, hnLimit = 15 } = {},
) {
  const key = symbol.toUpperCase().split(".")[0];
  if (CURATED_MAP[key]) return CURATED_MAP[key]();

  const hits = await searchHn(query || symbol, { limit: hnLimit });
  // HN 条目转成统一事件结构；无先验方向，weight 中等，结论由事件后收益支撑
  return hits.map((h) => ({ ...h, valence: "neutral", weight: 2 }));
}
