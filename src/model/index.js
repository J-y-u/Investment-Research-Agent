// 模型接入：火山方舟 ARK 为主，DeepSeek 为备用（均为 OpenAI 兼容），密钥只在后端。
// 自动降级：启动/缓存过期时探测首选 provider，不可用（限流/连不上）则切到备用。
import { createProvider, createModels } from "@earendil-works/pi-ai";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import { loadEnv } from "../util/load-env.js";

const PROVIDER_LABEL = { ark: "火山方舟 ARK", deepseek: "DeepSeek" };
const isReasoningModel = (id) => /flash|pro|reasoner|thinking/i.test(id);

function providerSpec(name, env) {
  if (name === "ark") {
    return {
      id: "ark",
      label: PROVIDER_LABEL.ark,
      baseUrl: env.ARK_OPENAI_BASE_URL,
      key: env.ARK_API_KEY,
      modelId: env.ARK_MODEL || "doubao-seed-evolving",
    };
  }
  return {
    id: "deepseek",
    label: PROVIDER_LABEL.deepseek,
    baseUrl: env.DEEPSEEK_OPENAI_BASE_URL,
    key: env.DEEPSEEK_API_KEY,
    modelId: env.DEEPSEEK_MODEL || "deepseek-chat",
  };
}

// 优先级：首选来自 .env MODEL_PROVIDER（默认 ark），另一个作备用
function priorityOrder(env) {
  const first = (env.MODEL_PROVIDER || "ark").toLowerCase() === "deepseek" ? "deepseek" : "ark";
  return first === "ark" ? ["ark", "deepseek"] : ["deepseek", "ark"];
}

function mkModel(spec) {
  return {
    id: spec.modelId,
    name: spec.modelId,
    api: "openai-completions",
    provider: spec.id,
    baseUrl: spec.baseUrl,
    reasoning: isReasoningModel(spec.modelId),
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128000,
    maxTokens: 32000,
    compat: { supportsDeveloperRole: false },
  };
}

function build(spec) {
  const provider = createProvider({
    id: spec.id,
    name: spec.label,
    baseUrl: spec.baseUrl,
    auth: {
      apiKey: { name: spec.label, resolve: async () => ({ auth: { apiKey: spec.key } }) },
    },
    models: [mkModel(spec)],
    api: openAICompletionsApi(),
  });
  const models = createModels();
  models.setProvider(provider);
  return {
    models,
    model: models.getModel(spec.id, spec.modelId),
    provider: spec.id,
    modelId: spec.modelId,
    label: spec.label,
  };
}

/** 轻量探测：是否真的能调用（/models 通过不代表配额没用完） */
async function probe(spec, timeoutMs = 8000) {
  try {
    const res = await fetch(`${spec.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${spec.key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: spec.modelId,
        messages: [{ role: "user", content: "ping" }],
        max_tokens: 1,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (res.ok) return { ok: true };
    let reason = `HTTP ${res.status}`;
    try {
      const j = await res.json();
      if (j?.error?.code) reason = j.error.code;
    } catch { /* ignore */ }
    return { ok: false, reason };
  } catch (err) {
    return { ok: false, reason: err.name === "TimeoutError" ? "timeout" : "unreachable" };
  }
}

// 探测结果缓存：可用缓存 5 分钟；不可用缓存 2 分钟（便于配额重置后自动恢复）
const OK_TTL = 5 * 60 * 1000;
const FAIL_TTL = 2 * 60 * 1000;
let cache = null;

/**
 * 解析当前应使用的 provider（带自动降级与缓存）。
 * @param {boolean} force 忽略缓存重新探测
 * @returns {Promise<{models, model, provider, modelId, label, degraded, reason}>}
 */
export async function resolveModel({ force = false } = {}) {
  const env = loadEnv();
  const order = priorityOrder(env);
  const now = Date.now();
  if (!force && cache && now < cache.expiresAt && cache.order === order.join(">")) {
    return cache.result;
  }

  const configured = order
    .map((name) => providerSpec(name, env))
    .filter((s) => s.key && s.baseUrl);
  if (!configured.length)
    throw new Error("缺少模型配置，请检查 .env（参考 .env.example）");

  let lastReason = null;
  for (let i = 0; i < configured.length; i++) {
    const spec = configured[i];
    // 首选 provider 探测失败时重试一次，避免偶发 timeout 误降级
    let res = await probe(spec);
    if (!res.ok && i === 0) res = await probe(spec);
    if (res.ok) {
      const result = {
        ...build(spec),
        degraded: i > 0, // 不是首选 → 处于降级
        reason: i > 0 ? lastReason : null,
      };
      // 首选可用缓存久；处于降级则短缓存，以便尽快重试首选
      cache = {
        result,
        expiresAt: now + (result.degraded ? FAIL_TTL : OK_TTL),
        order: order.join(">"),
      };
      return result;
    }
    lastReason = res.reason;
  }

  // 都探测失败：仍返回首选，让真实请求把错误暴露给用户
  const spec = configured[0];
  const result = { ...build(spec), degraded: false, reason: null, probeFailed: true };
  cache = { result, expiresAt: now + FAIL_TTL, order: order.join(">") };
  return result;
}

// 向后兼容：同步接口（不做探测，按首选返回）
export function getModel() {
  const env = loadEnv();
  const spec = providerSpec(priorityOrder(env)[0], env);
  if (!spec.key || !spec.baseUrl)
    throw new Error(`缺少 ${spec.id} 的 API 配置，请检查 .env`);
  return { ...build(spec), degraded: false, reason: null };
}
