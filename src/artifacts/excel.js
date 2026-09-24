// office-docs：任意两标的回测底稿（ExcelJS，多 sheet 保留可复核数据）
import fs from "node:fs/promises";
import path from "node:path";
import ExcelJS from "exceljs";

const HEADER_FILL = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F4E79" } };
const HEADER_FONT = { bold: true, color: { argb: "FFFFFFFF" } };

function styleHeader(ws, ncols) {
  const r = ws.getRow(1);
  for (let c = 1; c <= ncols; c++) {
    const cell = r.getCell(c);
    cell.fill = HEADER_FILL;
    cell.font = HEADER_FONT;
    cell.alignment = { vertical: "middle" };
  }
}

function addSheet(wb, name, columns, rows, { pctCols = [], numCols = [] } = {}) {
  const ws = wb.addWorksheet(name);
  ws.columns = columns;
  ws.addRows(rows);
  styleHeader(ws, columns.length);
  for (let r = 2; r <= rows.length + 1; r++) {
    pctCols.forEach((c) => (ws.getRow(r).getCell(c).numFmt = "0.00%"));
    numCols.forEach((c) => (ws.getRow(r).getCell(c).numFmt = "#,##0.00"));
  }
  ws.views = [{ state: "frozen", ySplit: 1 }];
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
  return ws;
}

/** @param {object} data 对比数据包（a/b 两标的） */
export async function renderExcel(data) {
  const { a, b, aligned, yearly, rollCorr, drawdowns, manifests = [], generatedAt } = data;
  const la = a.label || a.ticker;
  const lb = b.label || b.ticker;

  const wb = new ExcelJS.Workbook();
  wb.creator = "realtime-agent";
  wb.created = new Date(generatedAt);

  // —— 说明 ——
  const cover = wb.addWorksheet("说明");
  cover.columns = [{ key: "k", width: 22 }, { key: "v", width: 96 }];
  [
    ["产物", `${la} vs ${lb} 比较分析 · 回测底稿`],
    ["生成时间", generatedAt],
    ["标的 A", `${a.ticker}（${a.bars.length} 根日线，${a.bars[0].date} ~ ${a.bars[a.bars.length - 1].date}）`],
    ["标的 B", `${b.ticker}（${b.bars.length} 根日线，${b.bars[0].date} ~ ${b.bars[b.bars.length - 1].date}）`],
    ["口径", "价格为拆股/连续合约口径日线；净值起点归一为 1；年化按 252 交易日；风险利率 0"],
    ["对齐", "净值/日收益/回撤按共同交易日 inner join"],
    ["免责", "本底稿仅用于研究方法演示，历史表现不代表未来，不构成投资建议"],
  ].forEach(([k, v]) => cover.addRow({ k, v }));
  cover.getColumn("k").font = { bold: true };

  // —— 指标汇总 ——
  const sA = a.summary;
  const sB = b.summary;
  addSheet(
    wb,
    "指标汇总",
    [
      { header: "指标", key: "metric", width: 20 },
      { header: la, key: "a", width: 20 },
      { header: lb, key: "b", width: 20 },
    ],
    [
      { metric: "区间起始", a: sA.firstDate, b: sB.firstDate },
      { metric: "区间结束", a: sA.lastDate, b: sB.lastDate },
      { metric: "交易日数", a: sA.barCount, b: sB.barCount },
      { metric: "累计收益", a: sA.totalReturn, b: sB.totalReturn },
      { metric: "年化收益", a: sA.annualizedReturn, b: sB.annualizedReturn },
      { metric: "年化波动", a: sA.annualizedVolatility, b: sB.annualizedVolatility },
      { metric: "最大回撤", a: sA.maxDrawdown, b: sB.maxDrawdown },
      { metric: "Sharpe", a: sA.sharpe, b: sB.sharpe },
    ],
    { pctCols: [2, 3] },
  );

  // —— 年度收益 ——
  const yA = new Map(yearly.a.map((y) => [y.year, y.return]));
  const yB = new Map(yearly.b.map((y) => [y.year, y.return]));
  const years = [...new Set([...yA.keys(), ...yB.keys()])].sort();
  addSheet(
    wb,
    "年度收益",
    [
      { header: "年份", key: "year", width: 10 },
      { header: la, key: "a", width: 16 },
      { header: lb, key: "b", width: 16 },
    ],
    years.map((y) => ({ year: y, a: yA.get(y) ?? null, b: yB.get(y) ?? null })),
    { pctCols: [2, 3] },
  );

  // —— 净值 ——
  const a0 = aligned[0].a.close;
  const b0 = aligned[0].b.close;
  addSheet(
    wb,
    "净值",
    [
      { header: "日期", key: "date", width: 12 },
      { header: `${la} 价格`, key: "ap", width: 14 },
      { header: `${lb} 价格`, key: "bp", width: 14 },
      { header: `${la} 净值`, key: "an", width: 14 },
      { header: `${lb} 净值`, key: "bn", width: 14 },
    ],
    aligned.map((r) => ({
      date: r.date,
      ap: r.a.close,
      bp: r.b.close,
      an: r.a.close / a0,
      bn: r.b.close / b0,
    })),
    { pctCols: [4, 5], numCols: [2, 3] },
  );

  // —— 日收益 ——
  addSheet(
    wb,
    "日收益",
    [
      { header: "日期", key: "date", width: 12 },
      { header: la, key: "a", width: 14 },
      { header: lb, key: "b", width: 14 },
    ],
    aligned.slice(1).map((r, i) => ({
      date: r.date,
      a: r.a.close / aligned[i].a.close - 1,
      b: r.b.close / aligned[i].b.close - 1,
    })),
    { pctCols: [2, 3] },
  );

  // —— 滚动相关性 ——
  addSheet(
    wb,
    "滚动相关性",
    [
      { header: "日期", key: "date", width: 12 },
      { header: "90日滚动相关", key: "corr", width: 16 },
    ],
    rollCorr.map((r) => ({ date: r.date, corr: r.correlation })),
    { numCols: [2] },
  );

  // —— 回撤 ——
  const ddA = new Map(drawdowns.a.map((d) => [d.date, d.drawdown]));
  const ddB = new Map(drawdowns.b.map((d) => [d.date, d.drawdown]));
  addSheet(
    wb,
    "回撤",
    [
      { header: "日期", key: "date", width: 12 },
      { header: `${la} 回撤`, key: "a", width: 16 },
      { header: `${lb} 回撤`, key: "b", width: 16 },
    ],
    aligned.map((r) => ({
      date: r.date,
      a: ddA.get(r.date) ?? null,
      b: ddB.get(r.date) ?? null,
    })),
    { pctCols: [2, 3] },
  );

  // —— 来源 ——
  const src = wb.addWorksheet("来源");
  src.columns = [
    { header: "标的", key: "ticker", width: 14 },
    { header: "来源", key: "source", width: 26 },
    { header: "抓取时间", key: "fetched", width: 26 },
    { header: "链接", key: "url", width: 70 },
  ];
  manifests.forEach((m) => {
    const row = src.addRow({
      ticker: m.ticker, source: m.source, fetched: m.fetchedAt, url: m.sourceUrl,
    });
    row.getCell(4).value = { text: m.sourceUrl, hyperlink: m.sourceUrl };
    row.getCell(4).font = { color: { argb: "FF2563EB" }, underline: true };
  });
  styleHeader(src, 4);

  return wb;
}

export async function writeExcel(data, file) {
  const wb = await renderExcel(data);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await wb.xlsx.writeFile(file);
  return file;
}
