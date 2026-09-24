const chat = document.getElementById("chat");
const input = document.getElementById("input");
const sendBtn = document.getElementById("send");
const sessionListEl = document.getElementById("sessionList");
const historyPanel = document.getElementById("historyPanel");

let sessionId = localStorage.getItem("invest_session") || null;
let busy = false;

// ============ markdown 渲染（先转义，防 XSS）============
function esc(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
// 行内：链接 / 粗体 / 代码
function inline(s) {
  return s
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, text, href) => {
      let url = href;
      if (!/^(https?:)?\/\//.test(href) && !href.startsWith("/")) url = "/files/" + href;
      return `<a href="${url}" target="_blank" rel="noopener noreferrer">${text} ↗</a>`;
    })
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+?)`/g, "<code>$1</code>");
}
// 表格
function tableHtml(rows) {
  const cells = (r) => r.replace(/^\s*\|/, "").replace(/\|\s*$/, "").split("|").map((c) => c.trim());
  const isSep = (r) => cells(r).every((c) => /^:?-{2,}:?$/.test(c));
  let head = null;
  let body;
  if (rows.length > 1 && isSep(rows[1])) { head = cells(rows[0]); body = rows.slice(2); }
  else body = rows;
  let h = "<table>";
  if (head) h += "<thead><tr>" + head.map((c) => "<th>" + inline(c) + "</th>").join("") + "</tr></thead>";
  h += "<tbody>";
  for (const r of body) h += "<tr>" + cells(r).map((c) => "<td>" + inline(c) + "</td>").join("") + "</tr>";
  return h + "</tbody></table>";
}
function md(src) {
  const normalized = String(src ?? "").replace(/([^\n])\s*(#{1,4}\s+)/g, "$1\n$2");
  const lines = esc(normalized).split("\n");
  const out = [];
  let inList = false;
  let tableRows = [];
  const closeList = () => { if (inList) { out.push("</ul>"); inList = false; } };
  const closeTable = () => { if (tableRows.length) { out.push(tableHtml(tableRows)); tableRows = []; } };
  const isTableRow = (l) => /^\s*\|.*\|\s*$/.test(l);

  for (const line of lines) {
    if (isTableRow(line)) { closeList(); tableRows.push(line); continue; }
    if (tableRows.length) closeTable();
    let m;
    if (/^\s*(---|\*\*\*|___)\s*$/.test(line)) { closeList(); out.push("<hr>"); }
    else if ((m = line.match(/^####\s+(.*)$/))) { closeList(); out.push("<h4>" + inline(m[1]) + "</h4>"); }
    else if ((m = line.match(/^#{1,3}\s+(.*)$/))) { closeList(); out.push("<h3>" + inline(m[1]) + "</h3>"); }
    else if ((m = line.match(/^\s*[-*]\s+(.*)$/))) {
      if (!inList) { out.push("<ul>"); inList = true; }
      out.push("<li>" + inline(m[1]) + "</li>");
    }
    else if (line.trim() === "") closeList();
    else { closeList(); out.push("<p>" + inline(line) + "</p>"); }
  }
  closeList();
  closeTable();
  return out.join("");
}
// 把回复里的产物文件名也变成链接（兜底，不破坏已有链接）
function linkifyArtifacts(html, artifacts) {
  if (!artifacts || !artifacts.length) return html;
  // 先保护已有 <a> 块，避免嵌套替换
  const links = [];
  let out = html.replace(/<a\b[^>]*>[\s\S]*?<\/a>/g, (m) => {
    links.push(m);
    return `\u0000${links.length - 1}\u0000`;
  });
  for (const a of artifacts) {
    const q = a.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out.replace(
      new RegExp(q, "g"),
      `<a href="/files/${a.name}" target="_blank" rel="noopener noreferrer">${a.name} ↗</a>`,
    );
  }
  return out.replace(/\u0000(\d+)\u0000/g, (m, i) => links[+i]);
}

// ============ 消息渲染 ============
// 关键：文本与产物用**独立容器**，避免流式文本覆盖产物链接
function addRow(kind) {
  const row = document.createElement("div");
  row.className = `row ${kind}`;
  const bubble = document.createElement("div");
  bubble.className = "bubble";
  const textEl = document.createElement("div");
  textEl.className = "msg-text";
  const artEl = document.createElement("div");
  artEl.className = "msg-artifacts";
  bubble.append(textEl, artEl);
  row.appendChild(bubble);
  chat.appendChild(row);
  return { textEl, artEl };
}
function artifactCards(artifacts) {
  if (!artifacts || !artifacts.length) return "";
  return artifacts
    .map(
      (a) =>
        `<a href="/files/${a.name}" target="_blank" rel="noopener noreferrer"><span class="file-ico">📄</span><span>${a.label || a.name}</span><span class="open">打开 ↗</span></a>`,
    )
    .join("");
}
function scrollDown() { chat.scrollTop = chat.scrollHeight; }

function renderHistoryMessage(m) {
  if (m.role === "user") {
    addRow("user").textEl.textContent = m.text;
  } else {
    const { textEl, artEl } = addRow("assistant");
    textEl.innerHTML = linkifyArtifacts(md(m.text), m.artifacts);
    artEl.innerHTML = artifactCards(m.artifacts);
  }
}

const TOOL_LABEL = {
  get_quote: "查询行情", get_indicators: "计算指标", analyze_events: "事件研究",
  search_news: "检索资讯", compare_assets: "资产对比", generate_report: "生成报告",
};

// ============ 发送 ============
async function send(message) {
  if (busy) return;
  busy = true;
  addRow("user").textEl.textContent = message;

  const { textEl, artEl } = addRow("assistant");
  textEl.innerHTML = '<span class="caret"></span>';

  sendBtn.disabled = true;
  let text = "";
  let activeStatus = null;
  let runArtifacts = [];

  const setStatus = (s) => {
    if (!activeStatus) {
      activeStatus = document.createElement("div");
      activeStatus.className = "status";
      textEl.appendChild(activeStatus);
    }
    activeStatus.innerHTML = s;
  };
  const clearStatus = () => { if (activeStatus) { activeStatus.remove(); activeStatus = null; } };

  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, sessionId }),
    });

    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      textEl.innerHTML = `<span class="err">${j.error || "请求失败"}</span>`;
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const chunks = buffer.split("\n\n");
      buffer = chunks.pop();

      for (const chunk of chunks) {
        for (const line of chunk.split("\n")) {
          if (!line.startsWith("data: ")) continue;
          let e;
          try { e = JSON.parse(line.slice(6)); } catch { continue; }

          if (e.type === "session") {
            if (e.id && e.id !== sessionId) {
              sessionId = e.id;
              localStorage.setItem("invest_session", sessionId);
            }
          } else if (e.type === "model") {
            const bar = document.getElementById("modelBar");
            bar.className = "model-bar show";
            bar.innerHTML =
              `当前模型：<b>${esc(e.label)}</b> · ${esc(e.modelId)}` +
              (e.degraded
                ? `<span class="degraded">已降级（${esc(e.reason || "首选不可用")}）</span>`
                : "");
          } else if (e.type === "text") {
            clearStatus();
            text += e.delta;
            textEl.innerHTML = md(text) + '<span class="caret"></span>';
          } else if (e.type === "tool_start") {
            setStatus(
              `<span class="spin"></span>${TOOL_LABEL[e.name] || e.name}${
                e.args && e.args.symbol ? " · " + e.args.symbol : ""
              }`,
            );
          } else if (e.type === "tool_end" && e.artifacts) {
            clearStatus();
            runArtifacts.push(...e.artifacts);
            artEl.insertAdjacentHTML("beforeend", artifactCards(e.artifacts));
          } else if (e.type === "error") {
            clearStatus();
            textEl.innerHTML += `<div class="err">${e.message}</div>`;
          } else if (e.type === "done") {
            clearStatus();
            if (e.artifacts) runArtifacts = e.artifacts;
          }
          scrollDown();
        }
      }
    }
    textEl.innerHTML = linkifyArtifacts(md(text), runArtifacts) || textEl.innerHTML;
  } catch (err) {
    textEl.innerHTML = '<span class="err">网络错误，请检查服务是否启动</span>';
  } finally {
    clearStatus();
    busy = false;
    sendBtn.disabled = false;
    scrollDown();
    input.focus();
    loadSessions();
  }
}

function doSend() {
  const message = input.value.trim();
  if (!message || busy) return;
  input.value = "";
  input.style.height = "auto";
  send(message);
}

// ============ 会话记忆 ============
async function loadSessions() {
  try {
    const r = await fetch("/api/sessions");
    const j = await r.json();
    sessionListEl.innerHTML = (j.sessions || [])
      .map(
        (s) =>
          `<li class="${s.id === sessionId ? "active" : ""}" data-id="${s.id}">
             <span class="s-title">${esc(s.title)}</span>
             <span class="s-meta">${s.count} 轮 · ${new Date(s.updatedAt).toLocaleDateString()}</span>
             <button class="s-del" data-del="${s.id}" title="删除">×</button>
           </li>`,
      )
      .join("") || '<li class="empty">暂无历史会话</li>';
  } catch { /* 忽略 */ }
}

async function openSession(id) {
  if (busy) return;
  try {
    const r = await fetch(`/api/sessions/${id}`);
    if (!r.ok) return;
    const j = await r.json();
    sessionId = id;
    localStorage.setItem("invest_session", id);
    chat.innerHTML = "";
    j.messages.forEach(renderHistoryMessage);
    if (!j.messages.length) chat.innerHTML = '<p class="hint-empty">这个会话还没有内容</p>';
    scrollDown();
    await loadSessions();
    closeHistory();
  } catch { /* 忽略 */ }
}

function newChat() {
  if (busy) return;
  sessionId = null;
  localStorage.removeItem("invest_session");
  chat.innerHTML = "";
  closeHistory();
  loadSessions();
  input.focus();
}

function openHistory() { historyPanel.classList.remove("hidden"); loadSessions(); }
function closeHistory() { historyPanel.classList.add("hidden"); }

// ============ 事件绑定 ============
sendBtn.addEventListener("click", doSend);
input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); doSend(); }
});
input.addEventListener("input", () => {
  input.style.height = "auto";
  input.style.height = Math.min(input.scrollHeight, 140) + "px";
});

document.querySelectorAll(".presets [data-q]").forEach((b) =>
  b.addEventListener("click", () => send(b.dataset.q)),
);
document.querySelectorAll(".presets [data-fill]").forEach((b) =>
  b.addEventListener("click", () => {
    input.value = b.dataset.fill;
    input.focus();
    const i = input.value.indexOf("[");
    const j = input.value.indexOf("]");
    if (i >= 0 && j > i) input.setSelectionRange(i, j + 1);
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 140) + "px";
  }),
);

document.getElementById("newChat").addEventListener("click", newChat);
document.getElementById("historyBtn").addEventListener("click", () => {
  historyPanel.classList.contains("hidden") ? openHistory() : closeHistory();
});
document.getElementById("closeHistory").addEventListener("click", closeHistory);
sessionListEl.addEventListener("click", (ev) => {
  const del = ev.target.closest("[data-del]");
  if (del) {
    ev.stopPropagation();
    const id = del.dataset.del;
    fetch(`/api/sessions/${id}`, { method: "DELETE" }).then(() => {
      if (id === sessionId) newChat();
      else loadSessions();
    });
    return;
  }
  const li = ev.target.closest("li[data-id]");
  if (li) openSession(li.dataset.id);
});

// ============ 初始化：恢复上次会话 ============
(async function init() {
  await loadSessions();
  if (sessionId) await openSession(sessionId);
})();
