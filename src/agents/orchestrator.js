// agent-core：pi 编排会话。加载自定义 tools + .pi/agents 子代理 + .pi/skills，
// 由主 agent 根据任务自主分派子代理、调用工具、产出交付物。
import {
  createAgentSession,
  ModelRuntime,
  SessionManager,
  DefaultResourceLoader,
  getAgentDir,
} from "@earendil-works/pi-coding-agent";
import path from "node:path";
import { ROOT } from "../config.js";

// 编排者只保留“分派 + 分析”工具；去掉 bash/edit/write/read，避免越界实现与误改文件系统。
const ORCHESTRATOR_TOOLS = [
  "subagent",
  "get_ohlcv",
  "summarize_asset",
  "detect_pivots",
  "list_curated_events",
  "search_news",
  "match_events",
  "build_nvda_html",
  "build_equity_report",
  "build_compare_reports",
];

const TASK_PROMPTS = {
  nvda: `请完成任务 A：回顾英伟达 NVDA 近五年行情（开/收/高/低、成交量），梳理同期 AI 行业大事件，在 K 线行情拐点上标注触发事件与影响评级，产出一个可交互、可溯源的单文件 HTML。

请以编排者身份分派子代理协作（用 subagent）：
- market-analyst：行情数据、ZigZag 拐点、指标；
- event-researcher：整理经核实的 AI 事件与来源；
- quant-analyst：把事件在硬约束窗口内匹配到拐点并评级；
- artifact-builder：生成自包含 HTML。
你也可以让分析子代理直接使用 match_events / detect_pivots 等工具。所有数字以工具返回为准，不要自行计算。
完成后报告：HTML 文件路径、匹配到事件的拐点数量、最关键的若干结论。`,

  hedge: `请完成任务 B：构建黄金（GC=F）与比特币（BTC-USD）作为避险/抗通胀资产的可交互比较体系，产出 Excel 回测底稿、PPT 决策框架、Word 策略报告。

请以编排者身份分派子代理（用 subagent）：market-analyst / quant-analyst 完成行情与对比分析，artifact-builder 生成 Excel/PPT/Word 三件套。所有数字以工具返回为准。
完成后报告：三个文件的路径与核心比较结论（收益、波动、回撤、相关性）。`,

  all: `请依次完成任务 A（NVDA HTML）与任务 B（黄金 vs 比特币 Excel/PPT/Word），分派相应子代理，最后汇总全部产物路径。`,
};

export async function runAgent(task, { verbose = true } = {}) {
  const modelRuntime = await ModelRuntime.create();
  const loader = new DefaultResourceLoader({
    cwd: ROOT,
    agentDir: getAgentDir(),
    additionalExtensionPaths: [path.join(ROOT, ".pi/extensions/realtime-agent.mjs")],
  });
  await loader.reload();

  const { session } = await createAgentSession({
    cwd: ROOT,
    agentDir: getAgentDir(),
    modelRuntime,
    resourceLoader: loader,
    tools: ORCHESTRATOR_TOOLS,
    sessionManager: SessionManager.inMemory(),
  });

  const toolNames = session.agent.state.tools.map((t) => t.name);
  if (verbose) {
    console.error(`[orchestrator] tools (${toolNames.length}): ${toolNames.join(", ")}`);
    console.error(`[orchestrator] model: ${session.model?.providerId}/${session.model?.id}\n`);
  }

  session.subscribe((e) => {
    if (!verbose) return;
    if (e.type === "message_update" && e.assistantMessageEvent?.type === "text_delta") {
      process.stdout.write(e.assistantMessageEvent.delta);
    }
    if (e.type === "tool_execution_start") {
      process.stdout.write(`\n\x1b[90m[call ${e.toolName}]\x1b[0m `);
    }
  });

  await session.prompt(TASK_PROMPTS[task]);
  if (verbose) process.stdout.write("\n");
  session.dispose();
}
