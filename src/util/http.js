// HTTP 工具：代理 dispatcher + 超时 + 重试，fetch 可注入（测试）
import { ProxyAgent, Agent, fetch as undiciFetch } from "undici";
import { PROXY_URL } from "../config.js";

let defaultDispatcher;
function getDispatcher() {
  if (!defaultDispatcher) {
    defaultDispatcher = PROXY_URL
      ? new ProxyAgent(PROXY_URL)
      : new Agent();
  }
  return defaultDispatcher;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 带超时/重试的 JSON GET。
 * @param {string} url
 * @param {object} opts
 * @param {number} opts.timeoutMs
 * @param {number} opts.retries
 * @param {boolean} opts.useProxy
 * @param {typeof fetch} opts.fetchImpl 注入 fetch（测试）
 */
export async function getJson(
  url,
  { timeoutMs = 15000, retries = 2, useProxy = true, fetchImpl } = {},
) {
  // fetch 与 dispatcher 必须来自同一个 undici，避免与 Node 内置 fetch 版本错配
  const doFetch = fetchImpl || undiciFetch;
  const dispatcher = useProxy ? getDispatcher() : undefined;
  let lastErr;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await doFetch(url, {
        dispatcher,
        signal: AbortSignal.timeout(timeoutMs),
        headers: {
          Accept: "application/json",
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) realtime-agent/1.0",
        },
      });
      if (!res.ok) {
        throw new HttpError(`HTTP ${res.status} for ${url}`, res.status);
      }
      return await res.json();
    } catch (err) {
      lastErr = err;
      // 4xx（除 429）不重试
      if (
        err instanceof HttpError &&
        err.status >= 400 &&
        err.status < 500 &&
        err.status !== 429
      ) {
        break;
      }
      if (attempt < retries) await sleep(400 * (attempt + 1));
    }
  }
  throw lastErr;
}

export class HttpError extends Error {
  constructor(message, status) {
    super(message);
    this.name = "HttpError";
    this.status = status;
  }
}
