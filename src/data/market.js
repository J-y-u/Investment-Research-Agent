// market-data：Yahoo Finance Chart API -> Bar[]，带缓存与溯源 manifest
import {
  YAHOO_CHART_URL,
  fiveYearRange,
  CACHE_DIR,
} from "../config.js";
import { getJson } from "../util/http.js";
import { getOrFetch } from "../util/cache.js";
import { toDateString } from "../util/format.js";

function buildUrl(ticker, { period1, period2 }) {
  const q = new URLSearchParams({
    period1: String(period1),
    period2: String(period2),
    interval: "1d",
    events: "history",
  });
  return `${YAHOO_CHART_URL}/${encodeURIComponent(ticker)}?${q}`;
}

function parseChart(json, ticker) {
  const result = json?.chart?.result?.[0];
  if (!result) {
    const msg = json?.chart?.error?.description || "empty chart result";
    throw new Error(`Yahoo parse failed for ${ticker}: ${msg}`);
  }
  const ts = result.timestamp || [];
  const q0 = result.indicators?.quote?.[0] || {};
  const bars = [];
  for (let i = 0; i < ts.length; i++) {
    const close = q0.close?.[i];
    if (close === null || close === undefined) continue; // 跳过非交易日/缺失
    bars.push({
      date: toDateString(ts[i]),
      open: q0.open?.[i] ?? null,
      high: q0.high?.[i] ?? null,
      low: q0.low?.[i] ?? null,
      close,
      volume: q0.volume?.[i] ?? null,
    });
  }
  const meta = {
    symbol: result.meta?.symbol || ticker,
    currency: result.meta?.currency || null,
    exchange: result.meta?.exchangeName || null,
    instrumentType: result.meta?.instrumentType || null,
    barCount: bars.length,
    firstDate: bars[0]?.date || null,
    lastDate: bars[bars.length - 1]?.date || null,
  };
  return { bars, meta };
}

/**
 * 拉取（或读缓存）日线 OHLCV。
 * @returns {{ticker:string, bars:Bar[], meta:object, manifest:object}}
 */
export async function fetchBars(ticker, { range = fiveYearRange(), dir = CACHE_DIR, useProxy = true } = {}) {
  const url = buildUrl(ticker, range);
  const key = `market_${ticker}_${range.period1}_${range.period2}`;
  const { data, cached } = await getOrFetch(
    key,
    () => getJson(url, { useProxy }).then((json) => parseChart(json, ticker)),
    { dir },
  );
  const manifest = {
    ticker,
    source: "Yahoo Finance Chart API",
    sourceUrl: url,
    fetchedAt: new Date().toISOString(),
    fromCache: cached,
    adjust: "split-adjusted（已按拆股向后复权），未做股息复权；未使用 adjclose",
    interval: "1d",
    currency: data.meta.currency,
  };
  return { ticker, bars: data.bars, meta: data.meta, manifest };
}
