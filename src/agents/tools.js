// agent-core：交付 agent 的自定义工具，经由 pi 扩展用 pi.registerTool 注册。
// 扩展方式注册后，子代理才能通过 subagentOnlyExtensions / ambient extensions 使用。
// 所有数字仍由代码产生；LLM 通过这些工具取数、分析、生成产物，不自行计算数字。
import { Type } from "typebox";
import { fetchBars } from "../data/market.js";
import { getCuratedEvents } from "../data/curated-events.js";
import { searchHn } from "../data/news.js";
import { detectPivots } from "../analytics/pivots.js";
import { summarizeAsset } from "../analytics/indicators.js";
import { matchEvents } from "../analytics/matching.js";
import {
  runNvdaPipeline, runHedgePipeline, runEquityEventPipeline, runComparePipeline,
} from "../pipeline.js";
import { ANALYSIS } from "../config.js";

const ok = (obj) => ({
  content: [{ type: "text", text: JSON.stringify(obj, null, 1) }],
});
const fail = (err) => ({
  content: [{ type: "text", text: `TOOL ERROR: ${err.message}` }],
  error: true,
});

function toolDefinitions() {
  return [
    {
      name: "get_ohlcv",
      label: "Get OHLCV",
      description: "获取某标的近五年日线的概况（来源、区间、数量、最近收盘价）。完整数据由其他分析工具内部使用。",
      parameters: Type.Object({
        symbol: Type.String({ description: "行情代码，如 NVDA / GC=F / BTC-USD" }),
      }),
      execute: async (_id, { symbol }) => {
        try {
          const { bars, meta, manifest } = await fetchBars(symbol);
          return ok({
            symbol, meta,
            recent: bars.slice(-10).map((b) => ({ date: b.date, close: +b.close.toFixed(2) })),
            source: manifest.source,
            note: `共 ${bars.length} 根日线；如需拐点用 detect_pivots、指标用 summarize_asset、事件归因用 match_events。`,
          });
        } catch (e) {
          return fail(e);
        }
      },
    },
    {
      name: "summarize_asset",
      label: "Summarize Asset",
      description: "计算某标的的累计/年化收益、年化波动、最大回撤、Sharpe 等指标。",
      parameters: Type.Object({ symbol: Type.String() }),
      execute: async (_id, { symbol }) => {
        try {
          const { bars } = await fetchBars(symbol);
          return ok({ symbol, summary: summarizeAsset(bars) });
        } catch (e) {
          return fail(e);
        }
      },
    },
    {
      name: "detect_pivots",
      label: "Detect Pivots",
      description: `用 ZigZag（阈值 ${ANALYSIS.zigzagThreshold}）检测显著行情拐点，返回高点/低点、日期、波段幅度、是否确认。`,
      parameters: Type.Object({ symbol: Type.String() }),
      execute: async (_id, { symbol }) => {
        try {
          const { bars } = await fetchBars(symbol);
          const pivots = detectPivots(bars, { threshold: ANALYSIS.zigzagThreshold });
          return ok({ symbol, count: pivots.length, pivots });
        } catch (e) {
          return fail(e);
        }
      },
    },
    {
      name: "list_curated_events",
      label: "List Events",
      description: "列出经核实的近五年 AI 行业大事件（含日期、基本面方向 valence、重要度 weight、来源）。",
      parameters: Type.Object({}),
      execute: async () => {
        try {
          return ok({ events: getCuratedEvents() });
        } catch (e) {
          return fail(e);
        }
      },
    },
    {
      name: "search_news",
      label: "Search News",
      description: "在 Hacker News 检索相关资讯作为事件库补充；可能返回空，不影响主流程。",
      parameters: Type.Object({
        keyword: Type.String({ description: "检索关键词，如 DeepSeek / Blackwell" }),
        limit: Type.Optional(Type.Number({ description: "返回条数，默认 10" })),
      }),
      execute: async (_id, { keyword, limit = 10 }) => {
        try {
          const hits = await searchHn(keyword, { limit });
          return ok({ keyword, count: hits.length, hits });
        } catch (e) {
          return fail(e);
        }
      },
    },
    {
      name: "match_events",
      label: "Match Events",
      description: `在 ±${ANALYSIS.matchWindowDays} 交易日窗口内把事件匹配到行情拐点，给出影响评级、事件后1/5/20日市场反应、方向与置信度；配不上的拐点如实标注未归因。`,
      parameters: Type.Object({ symbol: Type.String() }),
      execute: async (_id, { symbol }) => {
        try {
          const { bars } = await fetchBars(symbol);
          const pivots = detectPivots(bars, { threshold: ANALYSIS.zigzagThreshold });
          const matches = matchEvents(bars, pivots, getCuratedEvents(), {
            windowDays: ANALYSIS.matchWindowDays,
          });
          const slim = matches.map((m) => ({
            pivot: { date: m.pivot.date, type: m.pivot.type, confirmed: m.pivot.confirmed },
            event: m.event ? { title: m.event.title, date: m.event.date, valence: m.event.valence } : null,
            lagTradingDays: m.lagTradingDays,
            forwardReturns: m.forwardReturns,
            impactScore: m.impactScore,
            impactLabel: m.impactLabel,
            confidence: m.confidence,
          }));
          return ok({
            symbol,
            matched: slim.filter((x) => x.event).length,
            totalPivots: slim.length,
            matches: slim,
          });
        } catch (e) {
          return fail(e);
        }
      },
    },
    {
      name: "build_nvda_html",
      label: "Build NVDA HTML",
      description: "运行确定性管线生成英伟达行情×事件的自包含可交互 HTML，返回文件路径。",
      parameters: Type.Object({}),
      execute: async () => {
        try {
          const r = await runNvdaPipeline();
          return ok({ file: r.file, events: r.annotated.length, major: r.annotated.filter((e) => e.impactScore >= 4).length });
        } catch (e) {
          return fail(e);
        }
      },
    },
    {
      name: "build_equity_report",
      label: "Build Equity Report",
      description: "生成任意标的的行情×事件自包含交互 HTML 报告（有深度事件库则用，否则自动检索新闻），返回文件路径。",
      parameters: Type.Object({
        symbol: Type.String({ description: "如 AAPL / 0700.HK / 600519.SS / GC=F / BTC-USD" }),
        query: Type.Optional(Type.String({ description: "公司名/关键词，News 检索更准时用" })),
      }),
      execute: async (_id, { symbol, query }) => {
        try {
          const r = await runEquityEventPipeline(symbol, { query });
          return ok({ file: r.file, events: r.events });
        } catch (e) {
          return fail(e);
        }
      },
    },
    {
      name: "build_compare_reports",
      label: "Build Compare Reports",
      description: "生成任意两标的对比的 Excel 回测底稿、PPT 决策框架、Word 策略报告，返回文件路径。",
      parameters: Type.Object({
        symbol1: Type.String({ description: "如 GC=F / AAPL / 0700.HK" }),
        symbol2: Type.String({ description: "如 BTC-USD / MSFT / 600519.SS" }),
      }),
      execute: async (_id, { symbol1, symbol2 }) => {
        try {
          return ok(await runComparePipeline(symbol1, symbol2));
        } catch (e) {
          return fail(e);
        }
      },
    },
  ];
}

// 由扩展 factory 调用，把工具注册到宿主 pi。
export function registerTools(pi) {
  for (const def of toolDefinitions()) pi.registerTool(def);
}
