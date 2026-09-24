// 会话记忆：把多轮对话持久化到磁盘（.sessions/<id>.json），支持列表/恢复/删除。
// 参考 pi 的 session 设计（按会话文件持久化、可 list / resume），此处简化为线性会话列表。
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { ROOT } from "../config.js";

const DIR = path.join(ROOT, ".sessions");
const MAX_SESSIONS = 60;
const TOOL_RESULT_LIMIT = 1200; // 截断过大的工具结果，避免会话文件膨胀

const ensureDir = () => fs.mkdirSync(DIR, { recursive: true });
const fileOf = (id) => path.join(DIR, `${id}.json`);
const validId = (id) => typeof id === "string" && /^[a-f0-9-]{6,40}$/.test(id);

export function createSession(title = "新对话") {
  ensureDir();
  const id = crypto.randomUUID().slice(0, 12);
  const now = Date.now();
  const session = { id, title, createdAt: now, updatedAt: now, messages: [] };
  fs.writeFileSync(fileOf(id), JSON.stringify(session, null, 1));
  return session;
}

export function getSession(id) {
  if (!validId(id)) return null;
  try {
    return JSON.parse(fs.readFileSync(fileOf(id), "utf-8"));
  } catch {
    return null;
  }
}

function save(session) {
  session.updatedAt = Date.now();
  fs.writeFileSync(fileOf(session.id), JSON.stringify(session, null, 1));
  return session;
}

// 存储时截断大字段（工具结果可能很大）
function shrink(msg) {
  if (msg.role === "toolResult" && Array.isArray(msg.content)) {
    return {
      ...msg,
      content: msg.content.map((c) =>
        c.type === "text" ? { ...c, text: String(c.text ?? "").slice(0, TOOL_RESULT_LIMIT) } : c,
      ),
    };
  }
  return msg;
}

export function appendMessages(id, messages) {
  const session = getSession(id) || createSession();
  session.messages.push(...messages.map(shrink));
  // 首条用户消息作为标题
  if (session.title === "新对话") {
    const firstUser = session.messages.find((m) => m.role === "user");
    if (firstUser) session.title = String(firstUser.content).slice(0, 24);
  }
  return save(session);
}

export function listSessions() {
  ensureDir();
  return fs
    .readdirSync(DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      try {
        const s = JSON.parse(fs.readFileSync(path.join(DIR, f), "utf-8"));
        return {
          id: s.id,
          title: s.title,
          createdAt: s.createdAt,
          updatedAt: s.updatedAt,
          count: s.messages.filter((m) => m.role === "user").length,
        };
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, MAX_SESSIONS);
}

export function deleteSession(id) {
  if (!validId(id)) return false;
  try {
    fs.unlinkSync(fileOf(id));
    return true;
  } catch {
    return false;
  }
}

/**
 * 把历史消息转成可安全送入模型的多轮上下文。
 * 保留存储的原始消息形态（assistant 的 content 必须是块数组，不能改成字符串），
 * 仅清理配对不完整的 toolCall，避免部分 provider 报错。
 */
export function historyForContext(messages = []) {
  const resultIds = new Set(
    messages.filter((m) => m.role === "toolResult").map((m) => m.toolCallId),
  );
  const out = [];
  for (const m of messages) {
    if (m.role === "user" && typeof m.content === "string") {
      out.push({ role: "user", content: m.content, timestamp: m.timestamp || Date.now() });
    } else if (m.role === "assistant" && Array.isArray(m.content)) {
      // 丢弃没有对应 toolResult 的 toolCall（中断/失败遗留）
      const content = m.content.filter((b) => b.type !== "toolCall" || resultIds.has(b.id));
      if (content.length) out.push({ ...m, content });
    } else if (m.role === "toolResult") {
      out.push(m);
    }
  }
  return out;
}

/** 取用于前端展示的消息（user 文本 + assistant 文本 + 产物） */
export function messagesForUi(messages = []) {
  const ui = [];
  const lastAssistant = () => [...ui].reverse().find((x) => x.role === "assistant");
  for (const m of messages) {
    if (m.role === "user" && typeof m.content === "string") {
      ui.push({ role: "user", text: m.content });
    } else if (m.role === "assistant") {
      const text =
        typeof m.content === "string"
          ? m.content
          : (m.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
      if (text.trim()) ui.push({ role: "assistant", text, artifacts: [] });
    } else if (m.role === "artifacts") {
      const target = lastAssistant();
      if (target) target.artifacts = m.artifacts || [];
    }
  }
  return ui;
}
