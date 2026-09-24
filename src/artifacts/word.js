// office-docs：任意两标的对比 · 策略报告（docx）
import fs from "node:fs/promises";
import path from "node:path";
import {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
  Table, TableRow, TableCell, WidthType, BorderStyle,
} from "docx";
import { correlation } from "../analytics/indicators.js";
import { pct, num } from "../util/format.js";

const NAVY = "1F4E79";
const fp = (x) => (x === null || x === undefined ? "-" : pct(x, 1));

const h1 = (t) => new Paragraph({ text: t, heading: HeadingLevel.HEADING_1, spacing: { before: 280, after: 140 } });
const h2 = (t) => new Paragraph({ text: t, heading: HeadingLevel.HEADING_2, spacing: { before: 200, after: 100 } });
const p = (children, opts = {}) =>
  new Paragraph({
    children: Array.isArray(children) ? children : [new TextRun({ text: children })],
    spacing: { after: 120, line: 320 },
    ...opts,
  });
const bullet = (t) => new Paragraph({ text: t, bullet: { level: 0 }, spacing: { after: 80, line: 300 } });

function dataCell(text, { head = false, bold = false } = {}) {
  return new TableCell({
    children: [new Paragraph({
      children: [new TextRun({ text: String(text), bold: head || bold, color: head ? "FFFFFF" : "000000" })],
    })],
    shading: head ? { fill: NAVY } : undefined,
    verticalAlign: "center",
  });
}

function metricTable(la, lb, sA, sB) {
  const rows = [
    ["指标", la, lb],
    ["累计收益", fp(sA.totalReturn), fp(sB.totalReturn)],
    ["年化收益", fp(sA.annualizedReturn), fp(sB.annualizedReturn)],
    ["年化波动", fp(sA.annualizedVolatility), fp(sB.annualizedVolatility)],
    ["最大回撤", fp(sA.maxDrawdown), fp(sB.maxDrawdown)],
    ["Sharpe", num(sA.sharpe), num(sB.sharpe)],
  ];
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 4, color: "BFC8D2" },
      bottom: { style: BorderStyle.SINGLE, size: 4, color: "BFC8D2" },
      left: { style: BorderStyle.SINGLE, size: 4, color: "BFC8D2" },
      right: { style: BorderStyle.SINGLE, size: 4, color: "BFC8D2" },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 4, color: "D7DDE5" },
      insideVertical: { style: BorderStyle.SINGLE, size: 4, color: "D7DDE5" },
    },
    rows: rows.map((r, i) =>
      new TableRow({
        tableHeader: i === 0,
        children: r.map((c, j) => dataCell(c, { head: i === 0, bold: j === 0 && i > 0 })),
      }),
    ),
  });
}

export async function renderWord(data) {
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
  const better = sA.sharpe >= sB.sharpe ? la : lb;

  const children = [
    new Paragraph({
      text: `${la} vs ${lb}：双标的对比策略报告`,
      heading: HeadingLevel.TITLE,
      alignment: AlignmentType.CENTER,
    }),
    p(`研究区间：${sA.firstDate} ~ ${sA.lastDate}（近五年日线）｜ 生成时间：${generatedAt.slice(0, 10)}`, {
      alignment: AlignmentType.CENTER,
    }),

    h1("一、执行摘要"),
    bullet(`${better} 的风险调整收益更优：Sharpe 分别为 ${la} ${num(sA.sharpe)}、${lb} ${num(sB.sharpe)}。`),
    bullet(`波动与回撤：${la} 年化波动 ${fp(sA.annualizedVolatility)}、最大回撤 ${fp(sA.maxDrawdown)}；${lb} 分别为 ${fp(sB.annualizedVolatility)}、${fp(sB.maxDrawdown)}。`),
    bullet(`日收益全期相关 ${num(corrFull)}，90 日滚动均值 ${avgRoll === null ? "-" : num(avgRoll)}。`),
    bullet("核心判断：两者风险收益特征差异明显，配置价值取决于相关性水平与投资者的风险承受能力。"),

    h1("二、研究背景与目标"),
    p(`本报告基于近五年可复核的公开市场数据，对 ${la} 与 ${lb} 在收益、风险、回撤与相关性四个维度进行对比，为配置决策提供数据依据与框架。`),

    h1("三、数据与方法"),
    bullet("数据来源：Yahoo Finance Chart API 日线数据，均为免费公开数据源。"),
    bullet("口径：净值起点归一为 1；年化按 252 交易日；风险利率取 0；两标的按共同交易日 inner join。"),
    bullet("指标：累计/年化收益、年化波动、最大回撤、Sharpe、全期与 90 日滚动相关系数。"),
    bullet("方法定位：本报告衡量时间窗口内的历史表现与相关性，属统计描述而非因果推断，极端时期相关性可能变化。"),

    h1("四、结果分析"),
    metricTable(la, lb, sA, sB),
    p(" "),
    p([
      new TextRun({ text: "解读：", bold: true }),
      new TextRun({
        text: `${la} 累计收益 ${fp(sA.totalReturn)}、年化 ${fp(sA.annualizedReturn)}；${lb} 累计 ${fp(sB.totalReturn)}、年化 ${fp(sB.annualizedReturn)}。波动率之比约 ${num(
          (sB.annualizedVolatility || 1) / (sA.annualizedVolatility || 1),
        )} 倍（B/A），显示两者风险量级差异。`,
      }),
    ]),

    h1("五、相关性与分散化"),
    p(`全期日收益相关性为 ${num(corrFull)}。${
      Math.abs(corrFull) < 0.3
        ? "相关性偏低，两者搭配具备分散化价值。"
        : "相关性偏高，分散化作用有限，需依靠权重控制风险。"
    } 需注意 90 日滚动相关均值 ${avgRoll === null ? "-" : num(avgRoll)}，说明相关性随时间波动，压力时期可能上升。`),

    h1("六、配置建议"),
    bullet("以风险预算（等波动贡献）分配权重，避免高波动标的过度主导组合波动。"),
    bullet("设定阈值或定期再平衡，纪律化执行，避免情绪化追涨杀跌。"),
    bullet("对高波动标的按其历史最大回撤做压力测试，确认组合可承受。"),
    bullet("持续跟踪相关性变化；分散化在高相关阶段会失效。"),

    h1("七、风险提示"),
    p("历史表现不代表未来收益；低相关不等于危机中持续有效，极端抛售期相关性可能上升；不同资产类别面临各自的流动性、监管与汇率风险。本报告仅用于研究方法演示，不构成投资建议。"),

    h1("八、参考来源"),
    ...manifests.map((m) => new Paragraph({
      spacing: { after: 60 },
      children: [
        new TextRun({ text: `${m.ticker} — ${m.source}，抓取于 ${m.fetchedAt.slice(0, 10)}：`, bold: true, break: 1 }),
        new TextRun({ text: m.sourceUrl, color: "2563EB", break: 1 }),
      ],
    })),
  ];

  return new Document({
    creator: "realtime-agent",
    title: `${la} vs ${lb} 对比策略报告`,
    sections: [{ properties: {}, children }],
  });
}

export async function writeWord(data, file) {
  const doc = await renderWord(data);
  const buf = await Packer.toBuffer(doc);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, buf);
  return file;
}
