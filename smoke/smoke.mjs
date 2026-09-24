// 最小验证：pi SDK 作为交付框架 —— 自定义 tool + 真实 agent 调用
import {
  createAgentSession,
  ModelRuntime,
  SessionManager,
  defineTool,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

// 记录自定义 tool 被调用的情况
const toolCalls = [];

// 自定义 tool：模拟行情摘要（smoke 阶段不依赖外网，返回写死数据）
const quoteTool = defineTool({
  name: "quote_summary",
  label: "Quote Summary",
  description: "Return a test OHLCV summary for a stock symbol",
  parameters: Type.Object({
    symbol: Type.String({ description: "Ticker symbol, e.g. NVDA" }),
  }),
  execute: async (_id, params) => {
    toolCalls.push(params.symbol);
    return {
      content: [
        {
          type: "text",
          text: `TEST DATA for ${params.symbol}: close=120.50, volume=40,000,000`,
        },
      ],
      details: { symbol: params.symbol, close: 120.5 },
    };
  },
});

const modelRuntime = await ModelRuntime.create();
const { session } = await createAgentSession({
  cwd: process.cwd(),
  modelRuntime,
  customTools: [quoteTool],
  sessionManager: SessionManager.inMemory(),
});

let out = "";
session.subscribe((e) => {
  if (
    e.type === "message_update" &&
    e.assistantMessageEvent?.type === "text_delta"
  ) {
    out += e.assistantMessageEvent.delta;
    process.stdout.write(e.assistantMessageEvent.delta);
  }
});

console.log("=== model:", session.model?.providerId, "/", session.model?.id, "===");
await session.prompt(
  "Call the quote_summary tool with symbol NVDA, then in one sentence repeat the returned numbers.",
);

console.log("\n\n=== tool calls ===", toolCalls);
session.dispose();

// 断言：自定义 tool 确实被 LLM 调用
if (!toolCalls.includes("NVDA")) {
  console.error("FAIL: quote_summary was not called with NVDA");
  process.exit(1);
}
console.log("SMOKE PASS ✅");
