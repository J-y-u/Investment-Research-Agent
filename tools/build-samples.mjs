// 一次性生成 4 个打包样例到 output 子目录。
// runXxx 均输出确定性产物；行情命中缓存或联网拉取（走 .env 的代理）。
import path from "node:path";
import {
  runNvdaPipeline,
  runComparePipeline,
  runEquityEventPipeline,
} from "../src/pipeline.js";

const OUT = path.resolve("output");

const jobs = [
  ["sample1-nvda-events", () => runNvdaPipeline(path.join(OUT, "sample1-nvda-events"))],
  ["sample2-gold-vs-btc", () =>
    runComparePipeline("GC=F", "BTC-USD", { outDir: path.join(OUT, "sample2-gold-vs-btc") })],
  ["sample3-aapl-events", () =>
    runEquityEventPipeline("AAPL", {
      outDir: path.join(OUT, "sample3-aapl-events"),
    })],
  ["sample4-aapl-vs-msft", () =>
    runComparePipeline("AAPL", "MSFT", {
      outDir: path.join(OUT, "sample4-aapl-vs-msft"),
    })],];

for (const [name, fn] of jobs) {
  process.stdout.write(`\n=== ${name} ===\n`);
  const r = await fn();
  console.log("OK", JSON.stringify(r).slice(0, 200));
}
console.log("\nALL SAMPLES DONE");
