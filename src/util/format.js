// 日期/数字/CSV 工具

// 秒/毫秒时间戳 -> YYYY-MM-DD（UTC，避免时区漂移）
export function toDateString(tsSeconds) {
  const d = new Date(tsSeconds * 1000);
  return d.toISOString().slice(0, 10);
}

export function parseDate(s) {
  return new Date(`${s}T00:00:00Z`);
}

// 两个 YYYY-MM-DD 相差天数（按日历日）
export function daysBetween(a, b) {
  return Math.round(
    (parseDate(b).getTime() - parseDate(a).getTime()) / 86400000,
  );
}

export const pct = (x, digits = 2) =>
  x === null || x === undefined || Number.isNaN(x)
    ? "-"
    : `${(x * 100).toFixed(digits)}%`;

export const num = (x, digits = 2) =>
  x === null || x === undefined || Number.isNaN(x)
    ? "-"
    : Number(x).toFixed(digits);

// 文件名安全化：去掉 = （如 GC=F -> GCF），其余非法字符转下划线，保留 . 和 -
export const safeFileName = (s) =>
  String(s).replace(/=/g, "").replace(/[^A-Za-z0-9.-]+/g, "_");

// 简单数组转 CSV
export function toCsv(rows, columns) {
  const head = columns.join(",");
  const body = rows
    .map((r) =>
      columns
        .map((c) => {
          const v = r[c] ?? "";
          const s = String(v);
          return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        })
        .join(","),
    )
    .join("\n");
  return `${head}\n${body}`;
}
