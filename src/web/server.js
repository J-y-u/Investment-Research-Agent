// Web 服务器：静态前端 + POST /api/chat（SSE 流式）+ /files 受控产物访问
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { runInvestAgent } from "./agent.js";
import {
  listSessions, getSession, deleteSession, messagesForUi,
} from "./session-store.js";
import { ROOT, OUTPUT_DIR } from "../config.js";

const PUBLIC_DIR = path.join(ROOT, "src/web/public");
const PORT = Number(process.env.PORT) || 8200;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".xlsx":
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".pptx":
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".docx":
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

// 简单速率限制：每 IP 每 60s 最多 8 次
const hits = new Map();
function rateLimit(ip) {
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter((t) => now - t < 60000);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length <= 8;
}
setInterval(() => {
  const now = Date.now();
  for (const [ip, arr] of hits) if (!arr.some((t) => now - t < 60000)) hits.delete(ip);
}, 60000).unref();

const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Permissions-Policy": "geolocation=(), camera=(), microphone=()",
};

function sendJson(res, status, obj) {
  res.writeHead(status, { "Content-Type": "application/json", ...SECURITY_HEADERS });
  res.end(JSON.stringify(obj));
}

function serveStatic(req, res, urlPath) {
  let rel = decodeURIComponent(urlPath.split("?")[0]);
  if (rel === "/") rel = "/index.html";
  const safe = path.normalize(rel).replace(/^([/\\])*(\.\.[/\\])+/, "");
  const file = path.join(PUBLIC_DIR, safe);
  fs.readFile(file, (err, data) => {
    if (err) return sendJson(res, 404, { error: "not found" });
    res.writeHead(200, {
      "Content-Type": MIME[path.extname(file)] || "application/octet-stream",
      ...SECURITY_HEADERS,
    });
    res.end(data);
  });
}

// 受控产物：仅白名单文件名与扩展名
function serveFile(req, res, urlPath) {
  const name = decodeURIComponent(urlPath.split("/files/")[1].split("?")[0]);
  if (!/^[A-Za-z0-9._-]+$/.test(name)) return sendJson(res, 400, { error: "bad file" });
  const ext = path.extname(name);
  if (![".html", ".xlsx", ".pptx", ".docx"].includes(ext))
    return sendJson(res, 403, { error: "forbidden" });
  const file = path.join(OUTPUT_DIR, name);
  fs.readFile(file, (err, data) => {
    if (err) return sendJson(res, 404, { error: "not found" });
    res.writeHead(200, {
      "Content-Type": MIME[ext],
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'self' 'unsafe-inline';",
    });
    res.end(data);
  });
}

async function handleChat(req, res) {
  const ip = req.socket.remoteAddress || "local";
  if (!rateLimit(ip)) return sendJson(res, 429, { error: "请求过于频繁，请稍后再试" });

  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 8000) return sendJson(res, 413, { error: "输入过长" });
  }
  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    return sendJson(res, 400, { error: "invalid json" });
  }
  const message = typeof body.message === "string" ? body.message.trim() : "";
  const sessionId = typeof body.sessionId === "string" ? body.sessionId : undefined;
  if (message.length < 2) return sendJson(res, 400, { error: "请描述你的投研需求" });
  if (message.length > 1500) return sendJson(res, 400, { error: "输入过长（上限 1500 字）" });

  // SSE
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    ...SECURITY_HEADERS,
  });
  const emit = (e) => res.write(`data: ${JSON.stringify(e)}\n\n`);
  const keepalive = setInterval(() => res.write(": ka\n\n"), 15000);
  keepalive.unref();

  req.on("close", () => clearInterval(keepalive));

  try {
    await runInvestAgent({ message, sessionId, onEvent: emit });
  } catch (err) {
    emit({ type: "error", message: "处理失败，请稍后重试" });
  } finally {
    clearInterval(keepalive);
    res.end();
  }
}

export function startServer(port = PORT) {
  const server = http.createServer((req, res) => {
    const urlPath = req.url.split("?")[0];
    if (req.method === "POST" && urlPath === "/api/chat") return handleChat(req, res);
    if (req.method === "GET" && urlPath === "/api/sessions")
      return sendJson(res, 200, { sessions: listSessions() });
    if (req.method === "GET" && urlPath.startsWith("/api/sessions/")) {
      const id = urlPath.slice("/api/sessions/".length);
      const s = getSession(id);
      if (!s) return sendJson(res, 404, { error: "session not found" });
      return sendJson(res, 200, { id: s.id, title: s.title, messages: messagesForUi(s.messages) });
    }
    if (req.method === "DELETE" && urlPath.startsWith("/api/sessions/")) {
      const ok = deleteSession(urlPath.slice("/api/sessions/".length));
      return sendJson(res, ok ? 200 : 404, { ok });
    }
    if (req.method === "GET" && urlPath.startsWith("/files/")) return serveFile(req, res, urlPath);
    if (req.method === "GET") return serveStatic(req, res, urlPath);
    sendJson(res, 405, { error: "method not allowed" });
  });
  server.listen(port, "127.0.0.1", () => {
    console.log(`投研助手已启动：打开 http://127.0.0.1:${port}`);
  });
  return server;
}

startServer();
