// 通用模型连通性测试：node tools/test-model.mjs <ark|deepseek>
import { loadEnv } from "../src/util/load-env.js";

const which = process.argv[2] || "deepseek";
const env = loadEnv();

const cfg =
  which === "deepseek"
    ? {
        name: "DeepSeek",
        base: env.DEEPSEEK_OPENAI_BASE_URL,
        key: env.DEEPSEEK_API_KEY,
        model: env.DEEPSEEK_MODEL,
      }
    : {
        name: "ARK",
        base: env.ARK_OPENAI_BASE_URL,
        key: env.ARK_API_KEY,
        model: env.ARK_MODEL,
      };

console.log(`${cfg.name} | base=${cfg.base} | key=...${(cfg.key || "").slice(-6)} | model=${cfg.model}`);

let r = await fetch(`${cfg.base}/models`, { headers: { Authorization: `Bearer ${cfg.key}` } });
console.log("GET /models ->", r.status);
if (r.ok) {
  const j = await r.json();
  console.log("  models:", (j.data || []).map((m) => m.id).join(", ").slice(0, 400));
} else {
  console.log("  ", (await r.text()).slice(0, 200));
}

for (const m of [cfg.model, "deepseek-chat", "deepseek-reasoner"]) {
  if (!m) continue;
  r = await fetch(`${cfg.base}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${cfg.key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: m, messages: [{ role: "user", content: "只回复：连接成功" }], max_tokens: 20 }),
  });
  const t = await r.text();
  let out = t.slice(0, 150);
  if (r.ok) { try { out = JSON.stringify(JSON.parse(t).choices?.[0]?.message?.content); } catch {} }
  console.log(`chat[${m}] -> ${r.status} ${out}`);
}
