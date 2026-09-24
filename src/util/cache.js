// JSON 文件缓存：命中不触网，支持断网复现
import fs from "node:fs/promises";
import path from "node:path";
import { CACHE_DIR } from "../config.js";

const safeKey = (key) => key.replace(/[^a-zA-Z0-9._-]+/g, "_");

export async function readCache(key, dir = CACHE_DIR) {
  const file = path.join(dir, `${safeKey(key)}.json`);
  try {
    const raw = await fs.readFile(file, "utf-8");
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

export async function writeCache(key, data, dir = CACHE_DIR) {
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, `${safeKey(key)}.json`);
  await fs.writeFile(file, JSON.stringify(data, null, 2), "utf-8");
  return file;
}

/**
 * 命中缓存则返回缓存；否则调用 producer 并写缓存。
 * producer 返回值会被包一层 fetchedAt 元数据（若为普通对象）。
 */
export async function getOrFetch(key, producer, { dir = CACHE_DIR, ttlMs } = {}) {
  const cached = await readCache(key, dir);
  if (cached && (!ttlMs || Date.now() - cached.fetchedAt < ttlMs)) {
    return { data: cached.data ?? cached, cached: true };
  }
  const data = await producer();
  const envelope =
    data && typeof data === "object"
      ? { fetchedAt: Date.now(), data }
      : { fetchedAt: Date.now(), data };
  await writeCache(key, envelope, dir);
  return { data, cached: false };
}
