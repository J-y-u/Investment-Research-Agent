// 读取 .env 为对象（简单解析；不依赖 dotenv）
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "../config.js";

export function loadEnv(file = path.join(ROOT, ".env")) {
  const env = {};
  let text;
  try {
    text = fs.readFileSync(file, "utf-8");
  } catch {
    return env;
  }
  for (const line of text.split("\n")) {
    const l = line.trim();
    if (!l || l.startsWith("#")) continue;
    const i = l.indexOf("=");
    if (i < 0) continue;
    let v = l.slice(i + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    )
      v = v.slice(1, -1);
    env[l.slice(0, i).trim()] = v;
  }
  return env;
}
