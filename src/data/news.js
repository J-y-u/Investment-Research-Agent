// news-events：Hacker News（Algolia Search API）检索，作为 curated 事件库的补充
import { HN_SEARCH_URL } from "../config.js";
import { getJson } from "../util/http.js";

const hnItemUrl = (id) => `https://news.ycombinator.com/item?id=${id}`;

/**
 * 检索 HN 故事。
 * @param {string} query 关键词
 * @param {object} opts
 * @param {number} opts.limit
 * @param {string} [opts.startDate] YYYY-MM-DD
 * @param {string} [opts.endDate] YYYY-MM-DD
 * @returns {Promise<Array>} 条目；网络/解析失败时返回 []（不致命）
 */
export async function searchHn(
  query,
  { limit = 20, startDate, endDate, useProxy = true } = {},
) {
  const params = new URLSearchParams({
    query,
    tags: "story",
    hitsPerPage: String(limit),
  });
  const nf = [];
  if (startDate)
    nf.push(`created_at_i>${Math.floor(Date.parse(`${startDate}T00:00:00Z`) / 1000)}`);
  if (endDate)
    nf.push(`created_at_i<${Math.floor(Date.parse(`${endDate}T00:00:00Z`) / 1000)}`);
  if (nf.length) params.set("numericFilters", nf.join(","));

  const url = `${HN_SEARCH_URL}?${params}`;
  try {
    const json = await getJson(url, { useProxy });
    return (json.hits || [])
      .filter((h) => h.title || h.story_title)
      .map((h) => ({
        id: `hn-${h.objectID}`,
        date: h.created_at.slice(0, 10),
        title: h.title || h.story_title,
        category: "news",
        summary: `Hacker News（points ${h.points ?? 0}，comments ${h.num_comments ?? 0}）`,
        points: h.points ?? 0,
        comments: h.num_comments ?? 0,
        sources: [h.url || hnItemUrl(h.objectID), hnItemUrl(h.objectID)],
        relevance: "ai",
      }));
  } catch (err) {
    return []; // 显式降级：资讯补充缺失不阻断主流程
  }
}

/**
 * 多关键词检索并去重（按来源 URL/标题）。
 */
export async function searchHnMulti(queries, opts = {}) {
  const results = await Promise.all(queries.map((q) => searchHn(q, opts)));
  const seen = new Set();
  const out = [];
  for (const item of results.flat()) {
    const key = item.sources[0];
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}
