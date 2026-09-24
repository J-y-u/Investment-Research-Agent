// analytics：资产指标（纯函数）
// 所有函数输入数值或 Bar[]，不触网、不读时钟。

export function mean(xs) {
  if (!xs.length) return NaN;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

// 样本标准差（ddof=1）
export function std(xs) {
  if (xs.length < 2) return NaN;
  const m = mean(xs);
  const v = xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1);
  return Math.sqrt(v);
}

// 日简单收益率，首项为 0，与 closes 等长
export function returnsFromCloses(closes) {
  return closes.map((c, i) => (i === 0 ? 0 : (c - closes[i - 1]) / closes[i - 1]));
}

export function barReturns(bars) {
  return returnsFromCloses(bars.map((b) => b.close));
}

// 净值序列（起点归一为 1）
export function growthOf(bars) {
  const c0 = bars[0].close;
  return bars.map((b) => b.close / c0);
}

export function totalReturn(bars) {
  if (bars.length < 2) return 0;
  return bars[bars.length - 1].close / bars[0].close - 1;
}

// 年化收益：(末/初)^(每年周期数/区间周期数)-1
export function annualizedReturn(bars, periodsPerYear = 252) {
  if (bars.length < 2) return 0;
  const ratio = bars[bars.length - 1].close / bars[0].close;
  const periods = bars.length - 1;
  return ratio ** (periodsPerYear / periods) - 1;
}

export function annualizedVolatility(bars, periodsPerYear = 252) {
  const r = barReturns(bars).slice(1);
  if (r.length < 2) return 0;
  return std(r) * Math.sqrt(periodsPerYear);
}

export function maxDrawdown(bars) {
  let peak = bars[0]?.close ?? 1;
  let peakDate = bars[0]?.date ?? null;
  let mdd = 0;
  let mddPeakDate = peakDate;
  let mddTroughDate = peakDate;
  for (const b of bars) {
    if (b.close > peak) {
      peak = b.close;
      peakDate = b.date;
    }
    const dd = b.close / peak - 1;
    if (dd < mdd) {
      mdd = dd;
      mddPeakDate = peakDate;
      mddTroughDate = b.date;
    }
  }
  return { maxDrawdown: mdd, peakDate: mddPeakDate, troughDate: mddTroughDate };
}

export function sharpeRatio(bars, rf = 0, periodsPerYear = 252) {
  const r = barReturns(bars).slice(1);
  if (r.length < 2) return 0;
  const excess = mean(r) - rf / periodsPerYear;
  return (excess / std(r)) * Math.sqrt(periodsPerYear);
}

// 皮尔逊相关系数
export function correlation(xs, ys) {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return NaN;
  const x = xs.slice(0, n);
  const y = ys.slice(0, n);
  const mx = mean(x);
  const my = mean(y);
  let cov = 0;
  let vx = 0;
  let vy = 0;
  for (let i = 0; i < n; i++) {
    cov += (x[i] - mx) * (y[i] - my);
    vx += (x[i] - mx) ** 2;
    vy += (y[i] - my) ** 2;
  }
  return vx && vy ? cov / Math.sqrt(vx * vy) : NaN;
}

// 多序列按日期 inner join，返回共同日期的 {date, a:{bar}, b:{bar}}
export function alignByDate(series) {
  const keys = Object.keys(series);
  const maps = keys.map((k) => new Map(series[k].map((b) => [b.date, b])));
  const [firstMap] = maps;
  const rows = [];
  for (const date of [...firstMap.keys()].sort()) {
    const row = { date };
    let ok = true;
    keys.forEach((k, i) => {
      const b = maps[i].get(date);
      if (!b) ok = false;
      row[k] = b;
    });
    if (ok) rows.push(row);
  }
  return rows;
}

export function summarizeAsset(bars, { periodsPerYear = 252, rf = 0 } = {}) {
  const dd = maxDrawdown(bars);
  return {
    barCount: bars.length,
    firstDate: bars[0]?.date ?? null,
    lastDate: bars[bars.length - 1]?.date ?? null,
    totalReturn: totalReturn(bars),
    annualizedReturn: annualizedReturn(bars, periodsPerYear),
    annualizedVolatility: annualizedVolatility(bars, periodsPerYear),
    maxDrawdown: dd.maxDrawdown,
    maxDrawdownPeak: dd.peakDate,
    maxDrawdownTrough: dd.troughDate,
    sharpe: sharpeRatio(bars, rf, periodsPerYear),
  };
}

// 每日回撤序列（相对截至当日的历史峰值）
export function drawdownSeries(bars) {
  let peak = -Infinity;
  return bars.map((b) => {
    peak = Math.max(peak, b.close);
    return { date: b.date, drawdown: b.close / peak - 1 };
  });
}

// 滚动相关：输入两条等长日收益序列与窗口，输出每个右端点的相关系数
export function rollingCorrelation(returnsA, returnsB, window) {
  const out = [];
  for (let i = window - 1; i < returnsA.length; i++) {
    const xa = returnsA.slice(i - window + 1, i + 1);
    const xb = returnsB.slice(i - window + 1, i + 1);
    out.push({ index: i, correlation: correlation(xa, xb) });
  }
  return out;
}

// 分年度收益（按日历年）
export function yearlyReturns(bars) {
  const years = new Map();
  for (const b of bars) {
    const y = b.date.slice(0, 4);
    if (!years.has(y)) years.set(y, []);
    years.get(y).push(b);
  }
  return [...years.entries()].map(([y, bs]) => ({
    year: y,
    return: totalReturn(bs),
    firstDate: bs[0].date,
    lastDate: bs[bs.length - 1].date,
  }));
}
