// office-docs：任意两标的对比 · 决策框架（pptxgenjs）
import fs from "node:fs/promises";
import path from "node:path";
import pptxgen from "pptxgenjs";
import { correlation } from "../analytics/indicators.js";
import { pct, num } from "../util/format.js";

const NAVY = "1F4E79";
const A_C = "C99A2E";
const B_C = "E8832A";
const GRAY = "5A6572";

const fp = (x) => (x === null || x === undefined ? "-" : pct(x, 1));

export async function renderPpt(data) {
  const { a, b, aligned, rollCorr, manifests = [], generatedAt } = data;
  const la = a.label || a.ticker;
  const lb = b.label || b.ticker;
  const sA = a.summary;
  const sB = b.summary;

  const rA = aligned.slice(1).map((r, i) => r.a.close / aligned[i].a.close - 1);
  const rB = aligned.slice(1).map((r, i) => r.b.close / aligned[i].b.close - 1);
  const corrFull = correlation(rA, rB);
  const validRoll = rollCorr.filter((x) => Number.isFinite(x.correlation));
  const avgRoll = validRoll.length
    ? validRoll.reduce((s, x) => s + x.correlation, 0) / validRoll.length
    : null;

  // 谁的风险调整收益更好
  const better = sA.sharpe >= sB.sharpe ? la : lb;
  const higherVol = sA.annualizedVolatility >= sB.annualizedVolatility ? la : lb;

  const p = new pptxgen();
  p.layout = "LAYOUT_WIDE";
  p.author = "realtime-agent";

  const header = (slide, title) => {
    slide.addShape("rect", { x: 0, y: 0, w: 13.33, h: 0.9, fill: { color: NAVY } });
    slide.addText(title, { x: 0.5, y: 0.12, w: 12.3, h: 0.66, fontSize: 24, bold: true, color: "FFFFFF", valign: "middle" });
  };
  const cell = (t, o = {}) => ({ text: t, options: { align: "center", valign: "middle", fontSize: 14, ...o } });
  const head = (t, c) => cell(t, { bold: true, color: "FFFFFF", fill: { color: c } });

  // 1 封面
  let s = p.addSlide();
  s.background = { color: NAVY };
  s.addText(`${la}  vs  ${lb}`, { x: 0.8, y: 2.0, w: 11.7, h: 1.1, fontSize: 42, bold: true, color: "FFFFFF" });
  s.addText("双标的对比分析与配置决策框架", { x: 0.8, y: 3.2, w: 11.7, h: 0.7, fontSize: 22, color: "D8DEE6" });
  s.addText(`近五年日线  ${sA.firstDate} ~ ${sA.lastDate}  ｜  生成于 ${generatedAt.slice(0, 10)}`, {
    x: 0.8, y: 5.6, w: 11.7, h: 0.5, fontSize: 14, color: "AEB8C4",
  });

  // 2 执行摘要
  s = p.addSlide();
  header(s, "执行摘要");
  s.addText(
    [
      { text: "风险调整收益更优：", options: { bold: true, fontSize: 18, color: NAVY } },
      { text: `${better}（Sharpe ${num(sA.sharpe >= sB.sharpe ? sA.sharpe : sB.sharpe)}）。`, options: { fontSize: 18, breakLine: true } },
      { text: "波动更高者：", options: { bold: true, fontSize: 18, color: B_C } },
      { text: `${higherVol}（年化波动 ${fp(sA.annualizedVolatility >= sB.annualizedVolatility ? sA.annualizedVolatility : sB.annualizedVolatility)}）。`, options: { fontSize: 18, breakLine: true } },
      { text: "相关性：", options: { bold: true, fontSize: 18, color: NAVY } },
      { text: `全期日收益相关 ${num(corrFull)}，90 日滚动均值 ${avgRoll === null ? "-" : num(avgRoll)}。`, options: { fontSize: 18, breakLine: true } },
      { text: "对比区间：", options: { bold: true, fontSize: 18, color: NAVY } },
      { text: `共同交易日 ${aligned.length} 天；${la} 最大回撤 ${fp(sA.maxDrawdown)}、${lb} ${fp(sB.maxDrawdown)}。`, options: { fontSize: 18 } },
    ],
    { x: 0.7, y: 1.3, w: 12, h: 5.6, lineSpacingMultiple: 1.25, valign: "top" },
  );

  // 3 指标对比
  s = p.addSlide();
  header(s, "核心指标对比");
  s.addTable(
    [
      [head("指标", NAVY), head(la, A_C), head(lb, B_C)],
      [cell("累计收益", { bold: true, fill: { color: "EDF1F6" } }), cell(fp(sA.totalReturn)), cell(fp(sB.totalReturn))],
      [cell("年化收益", { bold: true, fill: { color: "EDF1F6" } }), cell(fp(sA.annualizedReturn)), cell(fp(sB.annualizedReturn))],
      [cell("年化波动", { bold: true, fill: { color: "EDF1F6" } }), cell(fp(sA.annualizedVolatility)), cell(fp(sB.annualizedVolatility))],
      [cell("最大回撤", { bold: true, fill: { color: "EDF1F6" } }), cell(fp(sA.maxDrawdown)), cell(fp(sB.maxDrawdown))],
      [cell("Sharpe", { bold: true, fill: { color: "EDF1F6" } }), cell(num(sA.sharpe)), cell(num(sB.sharpe))],
    ],
    { x: 1.2, y: 1.3, w: 10.9, colW: [3.6, 3.65, 3.65], rowH: 0.75, border: { type: "solid", color: "D7DDE5" } },
  );

  // 4 年度收益
  const yA = new Map(data.yearly.a.map((y) => [y.year, y.return]));
  const yB = new Map(data.yearly.b.map((y) => [y.year, y.return]));
  const years = [...new Set([...yA.keys(), ...yB.keys()])].sort().slice(-6);
  s = p.addSlide();
  header(s, "近六年年度收益对比");
  s.addTable(
    [
      [head("年份", NAVY), head(la, A_C), head(lb, B_C)],
      ...years.map((y) => [
        cell(y, { bold: true, fill: { color: "EDF1F6" } }),
        cell(fp(yA.get(y) ?? null)),
        cell(fp(yB.get(y) ?? null)),
      ]),
    ],
    { x: 1.6, y: 1.3, w: 10, colW: [3.3, 3.35, 3.35], rowH: 0.66, border: { type: "solid", color: "D7DDE5" } },
  );

  // 5 分散化与组合含义
  s = p.addSlide();
  header(s, "相关性与组合含义");
  s.addText(
    [
      { text: `全期日收益相关性 ${num(corrFull)}：`, options: { bold: true, fontSize: 19, color: NAVY, breakLine: true } },
      {
        text:
          Math.abs(corrFull) < 0.3
            ? "相关性偏低，两者搭配具备分散化价值：同涨同跌的倾向弱，组合波动可能低于单一持有。"
            : "相关性偏高，分散化作用有限：同涨同跌明显，需靠权重与再平衡控制风险。",
        options: { fontSize: 17, breakLine: true },
      },
      { text: "滚动相关性不稳定：", options: { bold: true, fontSize: 19, color: NAVY, breakLine: true } },
      { text: `90 日滚动相关均值 ${avgRoll === null ? "-" : num(avgRoll)}，极端行情下相关性可能显著上升，分散化会阶段性失效。`, options: { fontSize: 17, breakLine: true } },
      { text: "配置含义：", options: { bold: true, fontSize: 19, color: NAVY, breakLine: true } },
      { text: "可按风险预算（等波动贡献）分配权重，设定阈值或定期再平衡，并对高波动标的做极端回撤压力测试。", options: { fontSize: 17 } },
    ],
    { x: 0.7, y: 1.2, w: 12, h: 6, lineSpacingMultiple: 1.2 },
  );

  // 6 风险与来源
  s = p.addSlide();
  header(s, "风险提示与数据来源");
  s.addText(
    [
      { text: "风险提示：", options: { bold: true, fontSize: 18, color: "C0392B", breakLine: true } },
      { text: "历史表现不代表未来；相关系数在危机中可能上升、分散化失效；不同资产类别面临各自的流动性与监管风险。", options: { fontSize: 16, breakLine: true } },
      { text: "数据来源：", options: { bold: true, fontSize: 18, color: NAVY, breakLine: true } },
      ...manifests.flatMap((m) => [
        { text: `${m.ticker} — ${m.source}（抓取 ${m.fetchedAt.slice(0, 10)}）`, options: { fontSize: 14, breakLine: true } },
        { text: m.sourceUrl, options: { fontSize: 11, color: "2563EB", breakLine: true } },
      ]),
    ],
    { x: 0.7, y: 1.2, w: 12, h: 6, lineSpacingMultiple: 1.15 },
  );

  return p;
}

export async function writePpt(data, file) {
  const p = await renderPpt(data);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await p.writeFile({ fileName: file });
  return file;
}
