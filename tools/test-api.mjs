// 端到端测试 web API（UTF-8，避免 curl 在 Git Bash 的中文编码问题）
// 用法：node tools/test-api.mjs "你的投研需求" [sessionId]
const message = process.argv[2];
const sessionId = process.argv[3];
if (!message) { console.log("用法: node tools/test-api.mjs <需求> [sessionId]"); process.exit(1); }

const res = await fetch("http://127.0.0.1:8200/api/chat", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ message, sessionId }),
});

const raw = await res.text();
let reply = "", tools = [], artifacts = [], sid = null, modelInfo = null;
for (const block of raw.split("\n\n")) {
  for (const line of block.split("\n")) {
    if (!line.startsWith("data: ")) continue;
    const e = JSON.parse(line.slice(6));
    if (e.type === "text") reply += e.delta;
    if (e.type === "tool_start") tools.push(e.name);
    if (e.type === "tool_end" && e.artifacts)
      artifacts.push(...e.artifacts.map((a) => a.name));
    if (e.type === "session") sid = e.id;
    if (e.type === "model") modelInfo = e;
  }
}
console.log("HTTP:", res.status);
console.log("sessionId:", sid);
if (modelInfo)
  console.log(
    "model:",
    modelInfo.label,
    modelInfo.modelId,
    modelInfo.degraded ? `[降级: ${modelInfo.reason}]` : "[首选]",
  );
console.log("工具调用:", JSON.stringify(tools));
console.log("产物:", JSON.stringify(artifacts));
console.log("回复:\n" + reply);
