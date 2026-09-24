#!/usr/bin/env node
// CLI 入口：node src/run.js <nvda|hedge|all> [--pipeline]
const args = process.argv.slice(2);
const task = args.find((a) => ["nvda", "hedge", "all"].includes(a));
const pipelineOnly = args.includes("--pipeline");

function usage() {
  console.log(`用法:
  node src/run.js nvda           # 任务 A：agent 自主完成 NVDA 行情×事件 HTML
  node src/run.js hedge          # 任务 B：agent 完成 黄金 vs BTC 的 Excel/PPT/Word
  node src/run.js all            # 两个任务
  node src/run.js <task> --pipeline   # 纯确定性管线（无 LLM，可复现/CI/断网）

代理（如需要）:
  HTTPS_PROXY=http://127.0.0.1:7892 node src/run.js nvda`);
}

if (!task) {
  usage();
  process.exit(1);
}

try {
  if (pipelineOnly) {
    const mod = await import("./pipeline.js");
    const run =
      task === "nvda"
        ? mod.runNvdaPipeline
        : task === "hedge"
          ? mod.runHedgePipeline
          : mod.runAll;
    const result = await run();
    console.log("pipeline done:", JSON.stringify(result, null, 2));
  } else {
    const { runAgent } = await import("./agents/orchestrator.js");
    await runAgent(task);
  }
} catch (err) {
  console.error("\n运行失败:", err);
  process.exit(1);
}
