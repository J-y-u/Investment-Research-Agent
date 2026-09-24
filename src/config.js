// 全局配置：标的、时间窗、分析阈值、环境变量
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
export const CACHE_DIR = path.join(ROOT, ".cache");
export const OUTPUT_DIR = path.join(ROOT, "output");
export const FIXTURES_DIR = path.join(ROOT, "fixtures");

// 代理（Node fetch 不自动读环境变量，需显式用于 dispatcher）
// 优先进程环境，回退读 .env，保证服务自带代理配置。
function proxyFromEnvFile() {
  try {
    const txt = fs.readFileSync(path.join(ROOT, ".env"), "utf-8");
    const m = txt.match(/^\s*HTTPS_PROXY\s*=\s*(.+)\s*$/m);
    return m ? m[1].trim() : "";
  } catch {
    return "";
  }
}
export const PROXY_URL =
  process.env.HTTPS_PROXY ||
  process.env.https_proxy ||
  process.env.HTTP_PROXY ||
  process.env.http_proxy ||
  proxyFromEnvFile();

// 标的定义
export const SYMBOLS = {
  nvda: { ticker: "NVDA", label: "英伟达 NVDA", asset: "equity" },
  gold: { ticker: "GC=F", label: "黄金（COMEX 主力）", asset: "commodity" },
  btc: { ticker: "BTC-USD", label: "比特币 BTC", asset: "crypto" },
};

// 近五年（秒）。按 UTC 天归一化，保证同一天内 range 与缓存 key 稳定。
// period2 向上取整到次日 0 点以覆盖当天；period1 = period2 - 5 年。
export function fiveYearRange(now = Date.now()) {
  const period2 = Math.ceil(now / 1000 / 86400) * 86400;
  const period1 = period2 - Math.round(5 * 365.25) * 86400;
  return { period1, period2 };
}

// 分析参数
export const ANALYSIS = {
  zigzagThreshold: 0.15, // 拐点反转幅度阈值 15%
  matchWindowDays: 10, // 事件-拐点匹配窗口（±交易日）
  tradingDaysPerYear: 252,
  riskFreeRate: 0.0,
};

// Yahoo Chart API
export const YAHOO_CHART_URL = "https://query1.finance.yahoo.com/v8/finance/chart";
// HN Algolia 搜索
export const HN_SEARCH_URL = "https://hn.algolia.com/api/v1/search";
// HN Firebase item
export const HN_ITEM_URL = "https://hacker-news.firebaseio.com/v0/item";
