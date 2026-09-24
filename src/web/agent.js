// Web 受控投研 agent：pi-ai 驱动，工具白名单，流式输出结构化事件。
// 安全：无 bash/任意执行；系统提示限定投研；数字只来自工具；密钥不出后端。
import { Type, StringEnum } from "@earendil-works/pi-ai";
import { resolveModel } from "../model/index.js";
import { fetchBars } from "../data/market.js";
import { searchHn } from "../data/news.js";
import { getEventsForSymbol } from "../data/event-source.js";
import { detectPivots } from "../analytics/pivots.js";
import { annotateEvents } from "../analytics/event-study.js";
import {
  summarizeAsset, alignByDate, correlation,
} from "../analytics/indicators.js";
import {
  runNvdaPipeline, runHedgePipeline, runEquityEventPipeline, runComparePipeline,
} from "../pipeline.js";
import { ANALYSIS } from "../config.js";
import {
  createSession, getSession, appendMessages, historyForContext,
} from "./session-store.js";

const SYSTEM = `你是"投研助手"，只服务投资研究类需求：行情查询、资产指标、事件研究、资产对比、回测与研究报告。

严格遵守：
1. 只处理金融/投研问题。若用户问无关内容（闲聊、写作、编程、解题、政治、生活等），礼貌说明你只做投研并拒绝，不要调用任何工具。
2. 所有数字必须来自工具返回；不得编造行情/财务数字，不预测价格涨跌，不给出"买入/卖出"式指令建议，可做信息整理、历史统计与风险提示。
3. 需要图表或完整报告时调用 generate_report；只查数据则用对应工具。
4. **始终用中文回复**（包括调用工具前的说明），不要输出英文；数字注明口径与日期。`;

const MAX_ROUNDS = 8;

// 符号白名单格式校验（防注入）
function validSymbol(s) {
  return typeof s === "string" && /^[A-Z0-9][A-Z0-9.\-=]{0,9}$/.test(s);
}
const checkSym = (s) => {
  if (!validSymbol(s)) throw new Error(`不支持的标的代码：${s}`);
  return s;
};

// —— 工具执行（按名分发）——
async function executeTool(name, args) {
  switch (name) {
    case "get_quote": {
      const symbol = checkSym(args.symbol);
      const { bars, meta } = await fetchBars(symbol);
      return {
        symbol, meta,
        recent: bars.slice(-8).map((b) => ({ date: b.date, close: +b.close.toFixed(2) })),
      };
    }
    case "get_indicators": {
      const symbol = checkSym(args.symbol);
      const { bars } = await fetchBars(symbol);
      return { symbol, indicators: summarizeAsset(bars) };
    }
    case "search_news": {
      const keyword = String(args.keyword || "").trim().slice(0, 40);
      if (!keyword) throw new Error("请提供检索关键词");
      const hits = await searchHn(keyword, { limit: Math.min(args.limit || 10, 30) });
      return {
        keyword,
        news: hits.map((h) => ({
          date: h.date, title: h.title, points: h.points,
          comments: h.comments, url: h.sources[0],
        })),
      };
    }
    case "analyze_events": {
      const symbol = checkSym(args.symbol || "NVDA");
      const { bars } = await fetchBars(symbol);
      const sourceEvents = await getEventsForSymbol(symbol, { query: args.query });
      const pivots = detectPivots(bars, { threshold: ANALYSIS.zigzagThreshold });
      const annotated = annotateEvents(bars, pivots, sourceEvents, {
        windowDays: ANALYSIS.matchWindowDays,
      });
      // 精简：标题、日期、后5/20日、评级、邻近拐点
      return {
        symbol,
        events: annotated.map((e) => ({
          date: e.date, title: e.title, category: e.category,
          d5: e.reaction.d5, d20: e.reaction.d20, impact: e.impactScore,
          pivot: e.nearestPivot ? { type: e.nearestPivot.type, lag: e.nearestPivot.lag } : null,
        })),
      };
    }
    case "compare_assets": {
      const s1 = checkSym(args.symbol1), s2 = checkSym(args.symbol2);
      const [a, b] = await Promise.all([fetchBars(s1), fetchBars(s2)]);
      const aligned = alignByDate({ a: a.bars, b: b.bars });
      const rA = aligned.slice(1).map((r, i) => r.a.close / aligned[i].a.close - 1);
      const rB = aligned.slice(1).map((r, i) => r.b.close / aligned[i].b.close - 1);
      return {
        [s1]: summarizeAsset(a.bars), [s2]: summarizeAsset(b.bars),
        commonDays: aligned.length, returnCorrelation: correlation(rA, rB),
      };
    }
    case "generate_report": {
      if (args.task === "equity_events") {
        const symbol = checkSym(args.symbol || "NVDA");
        const r = await runEquityEventPipeline(symbol, { query: args.query });
        return {
          artifacts: [{ name: r.name, label: `${symbol} 行情×事件 交互报告` }],
        };
      }
      if (args.task === "nvda_events") {
        await runNvdaPipeline();
        return { artifacts: [{ name: "nvda.html", label: "NVDA 行情×事件 交互报告" }] };
      }
      if (args.task === "gold_vs_btc") {
        const r = await runHedgePipeline();
        return { artifacts: r.artifacts };
      }
      if (args.task === "compare_report") {
        const s1 = checkSym(args.symbol1 || "GC=F");
        const s2 = checkSym(args.symbol2 || "BTC-USD");
        const r = await runComparePipeline(s1, s2);
        return { artifacts: r.artifacts };
      }
      throw new Error(`未知报告类型：${args.task}`);
    }
    default:
      throw new Error(`未知工具：${name}`);
  }
}

// pi-ai 工具定义（只暴露投研能力）
const TOOLS = [
  {
    name: "get_quote",
    description: "查询某标的近五年日线概况与最近若干日收盘价。",
    parameters: Type.Object({ symbol: Type.String({ description: "如 NVDA / GC=F / BTC-USD" }) }),
  },
  {
    name: "get_indicators",
    description: "计算某标的的累计/年化收益、年化波动、最大回撤、Sharpe。",
    parameters: Type.Object({ symbol: Type.String() }),
  },
  {
    name: "search_news",
    description: "按关键词检索 Hacker News 资讯（标题、日期、链接、热度），用于事件核实。",
    parameters: Type.Object({
      keyword: Type.String(),
      limit: Type.Optional(Type.Number()),
    }),
  },
  {
    name: "analyze_events",
    description: "对任意标的做事件研究：事件对齐行情，给事件后收益、评级与邻近拐点；内置深度事件库的标的更完整。",
    parameters: Type.Object({
      symbol: Type.Optional(Type.String({ description: "默认 NVDA" })),
      query: Type.Optional(Type.String({ description: "公司名/关键词（新闻检索更准时用）" })),
    }),
  },
  {
    name: "compare_assets",
    description: "对比两个标的的风险收益指标与日收益相关性。",
    parameters: Type.Object({ symbol1: Type.String(), symbol2: Type.String() }),
  },
  {
    name: "generate_report",
    description: "生成完整产物（交互 HTML 或 Excel/PPT/Word），返回可点击下载/打开的文件。",
    parameters: Type.Object({
      task: StringEnum(
        ["equity_events", "compare_report", "nvda_events", "gold_vs_btc"],
        {
          description:
            "equity_events=任意标的事件HTML（需 symbol）；compare_report=任意两标的对比报告三件套（需 symbol1/symbol2）；nvda_events=英伟达；gold_vs_btc=黄金vs比特币",
        },
      ),
      symbol: Type.Optional(Type.String()),
      symbol1: Type.Optional(Type.String()),
      symbol2: Type.Optional(Type.String()),
      query: Type.Optional(Type.String()),
    }),
  },
];

/**
 * 运行一次投研对话（带会话记忆）。
 * @param {object} opts
 * @param {string} opts.message 用户需求
 * @param {string} [opts.sessionId] 继续已有会话
 * @param {(e:object)=>void} opts.onEvent 流式事件
 * @returns {Promise<{sessionId:string}>}
 */
export async function runInvestAgent({ message, sessionId, onEvent }) {
  const { models, model, provider, modelId, label, degraded, reason } = await resolveModel();
  onEvent({ type: "model", provider, modelId, label, degraded, reason });

  const session = (sessionId && getSession(sessionId)) || createSession();
  onEvent({ type: "session", id: session.id });

  // 带上历史多轮上下文（只取文本对，避开历史 tool 配对错位）
  const history = historyForContext(session.messages);
  const context = {
    systemPrompt: SYSTEM,
    messages: [...history, { role: "user", content: message, timestamp: Date.now() }],
    tools: TOOLS,
  };

  const collected = [{ role: "user", content: message, timestamp: Date.now() }];
  const runArtifacts = [];

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const stream = models.stream(model, context);
    for await (const ev of stream) {
      if (ev.type === "text_delta") onEvent({ type: "text", delta: ev.delta });
      if (ev.type === "toolcall_end")
        onEvent({ type: "tool_start", name: ev.toolCall.name, args: ev.toolCall.arguments });
    }
    const finalMessage = await stream.result();
    if (finalMessage.stopReason === "error") {
      onEvent({ type: "error", message: finalMessage.errorMessage || "模型调用失败" });
      break;
    }
    context.messages.push(finalMessage);
    collected.push(finalMessage);

    const calls = finalMessage.content.filter((b) => b.type === "toolCall");
    if (!calls.length) break;

    for (const call of calls) {
      let payload, isError = false;
      try {
        payload = await executeTool(call.name, call.arguments);
      } catch (e) {
        payload = { error: e.message };
        isError = true;
      }
      if (payload.artifacts) {
        runArtifacts.push(...payload.artifacts);
        onEvent({ type: "tool_end", name: call.name, artifacts: payload.artifacts });
      } else {
        onEvent({ type: "tool_end", name: call.name });
      }
      const tr = {
        role: "toolResult",
        toolCallId: call.id,
        toolName: call.name,
        content: [{ type: "text", text: JSON.stringify(payload) }],
        isError,
        timestamp: Date.now(),
      };
      context.messages.push(tr);
      collected.push(tr);
    }
  }

  // 产出挂到本次会话（历史恢复时也能看到文件）
  if (runArtifacts.length) collected.push({ role: "artifacts", artifacts: runArtifacts });
  appendMessages(session.id, collected);

  onEvent({ type: "done", artifacts: runArtifacts, sessionId: session.id });
  return { sessionId: session.id };
}
