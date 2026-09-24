// 确定性代码管线：无 LLM，可复现 / CI / 断网（命中缓存）
// agent 模式的 tools 内部也复用这里的函数，保证两模式数字一致。
import path from "node:path";
import { fetchBars } from "./data/market.js";
import { getCuratedEvents } from "./data/curated-events.js";
import { detectPivots } from "./analytics/pivots.js";
import { annotateEvents } from "./analytics/event-study.js";
import { getEventsForSymbol } from "./data/event-source.js";
import {
  summarizeAsset,
  alignByDate,
  yearlyReturns,
  drawdownSeries,
  rollingCorrelation,
  correlation,
} from "./analytics/indicators.js";
import { writeHtml } from "./artifacts/html.js";
import { writeExcel } from "./artifacts/excel.js";
import { writePpt } from "./artifacts/ppt.js";
import { writeWord } from "./artifacts/word.js";
import { OUTPUT_DIR, ANALYSIS } from "./config.js";
import { safeFileName } from "./util/format.js";

// —— 任务 A 数据包 ——
export async function buildNvdaData() {
  const { bars, manifest } = await fetchBars("NVDA");
  const events = getCuratedEvents();
  const pivots = detectPivots(bars, { threshold: ANALYSIS.zigzagThreshold });
  const annotated = annotateEvents(bars, pivots, events, { windowDays: ANALYSIS.matchWindowDays });
  const summary = summarizeAsset(bars);
  return { bars, events, pivots, annotated, summary, manifest };
}

// —— 任务 B 数据包（任意两标的对比）——
export async function buildCompareData(symbol1, symbol2, labels = {}) {
  const g = await fetchBars(symbol1);
  const b = await fetchBars(symbol2);
  const a = {
    ticker: symbol1,
    label: labels[symbol1] || symbol1,
    bars: g.bars,
    summary: summarizeAsset(g.bars),
  };
  const bSide = {
    ticker: symbol2,
    label: labels[symbol2] || symbol2,
    bars: b.bars,
    summary: summarizeAsset(b.bars),
  };

  const aligned = alignByDate({ a: g.bars, b: b.bars });
  const rA = aligned.slice(1).map((r, i) => r.a.close / aligned[i].a.close - 1);
  const rB = aligned.slice(1).map((r, i) => r.b.close / aligned[i].b.close - 1);
  const rollCorr = rollingCorrelation(rA, rB, 90).map((x) => ({
    date: aligned[x.index + 1].date,
    correlation: x.correlation,
  }));
  const corrFull = correlation(rA, rB);
  const validRoll = rollCorr.filter((x) => Number.isFinite(x.correlation));
  const avgRoll = validRoll.length
    ? validRoll.reduce((a, x) => a + x.correlation, 0) / validRoll.length
    : null;

  return {
    a,
    b: bSide,
    aligned,
    corrFull,
    avgRoll,
    yearly: { a: yearlyReturns(g.bars), b: yearlyReturns(b.bars) },
    rollCorr,
    drawdowns: { a: drawdownSeries(g.bars), b: drawdownSeries(b.bars) },
    manifests: [g.manifest, b.manifest],
    generatedAt: new Date().toISOString(),
  };
}

// 默认样例：黄金 vs 比特币
export async function buildHedgeData() {
  return buildCompareData("GC=F", "BTC-USD");
}

// —— 通用：任意标的的行情×事件 HTML ——
export async function runEquityEventPipeline(
  symbol,
  { outDir = OUTPUT_DIR, query } = {},
) {
  const { bars, manifest } = await fetchBars(symbol);
  const events = await getEventsForSymbol(symbol, { query });
  const pivots = detectPivots(bars, { threshold: ANALYSIS.zigzagThreshold });
  const annotated = annotateEvents(bars, pivots, events, {
    windowDays: ANALYSIS.matchWindowDays,
  });
  const summary = summarizeAsset(bars);
  const safe = safeFileName(symbol);
  const name = `${safe}-events.html`;
  const file = path.join(outDir, name);
  await writeHtml(
    {
      title: `${symbol} 近五年行情 × 事件（可交互·可溯源）`,
      subtitle: "OHLCV 日线 + 事件标记带 + 事件后实际收益",
      bars,
      summary,
      annotated,
      manifests: [manifest],
      windowDays: ANALYSIS.matchWindowDays,
    },
    file,
  );
  return { file, name, events: annotated.length };
}

// —— 生成产物（NVDA 深度样例）——
export async function runNvdaPipeline(outDir = OUTPUT_DIR) {
  const d = await buildNvdaData();
  const file = await writeHtml(
    {
      title: "英伟达 NVDA 近五年行情 × AI 行业事件（可交互·可溯源）",
      subtitle: "OHLCV 日线 + 事件标记带 + 事件后实际收益",
      bars: d.bars,
      summary: d.summary,
      annotated: d.annotated,
      manifests: [d.manifest],
      generatedAt: new Date().toISOString(),
      windowDays: ANALYSIS.matchWindowDays,
    },
    path.join(outDir, "nvda.html"),
  );
  return { file, annotated: d.annotated };
}

export async function runHedgePipeline(outDir = OUTPUT_DIR) {
  return runComparePipeline("GC=F", "BTC-USD", { outDir });
}

// —— 通用：任意两标的对比报告（Excel / PPT / Word）——
export async function runComparePipeline(
  symbol1,
  symbol2,
  { outDir = OUTPUT_DIR } = {},
) {
  const d = await buildCompareData(symbol1, symbol2);
  const base = `${safeFileName(symbol1)}_vs_${safeFileName(symbol2)}`;
  const [excel, ppt, word] = await Promise.all([
    writeExcel(d, path.join(outDir, `${base}.xlsx`)),
    writePpt(d, path.join(outDir, `${base}-framework.pptx`)),
    writeWord(d, path.join(outDir, `${base}-strategy.docx`)),
  ]);
  return {
    excel,
    ppt,
    word,
    artifacts: [
      { name: path.basename(excel), label: `${symbol1} vs ${symbol2} Excel 回测底稿` },
      { name: path.basename(ppt), label: `${symbol1} vs ${symbol2} PPT 决策框架` },
      { name: path.basename(word), label: `${symbol1} vs ${symbol2} Word 策略报告` },
    ],
    summary: {
      corrFull: d.corrFull,
      avgRoll: d.avgRoll,
      [symbol1]: d.a.summary,
      [symbol2]: d.b.summary,
    },
  };
}

export async function runAll(outDir = OUTPUT_DIR) {
  const [nvda, hedge] = await Promise.all([
    runNvdaPipeline(outDir),
    runHedgePipeline(outDir),
  ]);
  return { nvda, hedge };
}
