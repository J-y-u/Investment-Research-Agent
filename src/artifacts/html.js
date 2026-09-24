// viz-html：自包含单文件（Plotly 内联，零自动外联）
// 范式：K线 + 成交量 + 底部"事件标记带"；默认无竖线，点击事件才高亮影响窗口。
import fs from "node:fs/promises";
import path from "node:path";
import { ROOT } from "../config.js";
import { pct } from "../util/format.js";

const BULL = "#2a9d8f";
const BEAR = "#e63946";
const BLUE = "#2563eb";
const GRAYC = "#9aa4b2";
const GOLD = "#c99a2e";

const escapeHtml = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
const safeForScript = (s) => String(s).replace(/<\/script/gi, "<\\/script");

let plotlyCache;
async function loadPlotly() {
  if (!plotlyCache)
    plotlyCache = await fs.readFile(
      path.join(ROOT, "node_modules/plotly.js-dist-min/plotly.min.js"),
      "utf-8",
    );
  return plotlyCache;
}

const SYMBOL = {
  earnings: "square", gpu: "diamond", model: "triangle-up",
  product_release: "star", market: "x", company: "circle-open",
};
const CAT_LABEL = {
  earnings: "财报", gpu: "GPU", model: "模型",
  product_release: "产品", market: "市场", company: "公司",
};
function eventColor(e) {
  if (e.category === "earnings") return GRAYC;
  if (e.category === "company") return "#aab3bf";
  if (e.category === "market") return BEAR;
  return e.valence === "bearish" ? "#e76f51" : BLUE;
}

function ribbonCustom(e) {
  return {
    id: e.id, title: e.title, cat: CAT_LABEL[e.category] || e.category,
    d1: pct(e.reaction.d1, 1), d5: pct(e.reaction.d5, 1), d20: pct(e.reaction.d20, 1),
    pivot: e.nearestPivot
      ? `${e.nearestPivot.type === "peak" ? "高点" : "低点"} ${Math.abs(e.nearestPivot.lag)}日`
      : "-",
  };
}

function buildTraces(bars, annotated) {
  const x = bars.map((b) => b.date);
  const candle = {
    type: "candlestick", x,
    open: bars.map((b) => b.open), high: bars.map((b) => b.high),
    low: bars.map((b) => b.low), close: bars.map((b) => b.close),
    name: "K线", yaxis: "y",
    increasing: { line: { color: BULL }, fillcolor: BULL },
    decreasing: { line: { color: BEAR }, fillcolor: BEAR },
    whiskerwidth: 0.4,
  };
  const vol = {
    type: "bar", x, y: bars.map((b) => b.volume),
    name: "成交量", yaxis: "y2", marker: { color: "rgba(141,153,174,0.4)" },
  };
  const ribbon = {
    type: "scatter", mode: "markers",
    x: annotated.map((e) => e.date), y: annotated.map(() => 0),
    name: "事件", yaxis: "y3",
    marker: {
      size: annotated.map((e) => (e.weight >= 5 ? 13 : e.weight >= 4 ? 11 : 8)),
      color: annotated.map(eventColor),
      symbol: annotated.map((e) => SYMBOL[e.category] || "circle"),
      line: { width: 1, color: "rgba(0,0,0,0.15)" },
    },
    customdata: annotated.map(ribbonCustom),
    hovertemplate:
      "<b>%{customdata.title}</b><br>%{x} · %{customdata.cat}<br>" +
      "后1日 %{customdata.d1} · 后5日 %{customdata.d5} · 后20日 %{customdata.d20}<br>" +
      "邻近拐点：%{customdata.pivot}<extra>点击查看影响窗口</extra>",
  };
  return [candle, vol, ribbon];
}

function buildLayout() {
  return {
    dragmode: "pan", margin: { l: 58, r: 18, t: 10, b: 26 },
    xaxis: {
      type: "date", rangeslider: { visible: false },
      rangeselector: {
        buttons: [
          { count: 1, label: "1月", step: "month", stepmode: "backward" },
          { count: 6, label: "6月", step: "month", stepmode: "backward" },
          { count: 1, label: "1年", step: "year", stepmode: "backward" },
          { step: "all", label: "全部" },
        ],
      },
    },
    yaxis: { title: "价格", domain: [0.32, 1], autorange: true },
    yaxis2: { title: "成交量", domain: [0.13, 0.27] },
    yaxis3: { domain: [0.02, 0.1], showticklabels: false, range: [-1.2, 1.2], fixedrange: true, zeroline: false },
    plot_bgcolor: "#fafbfc", paper_bgcolor: "#fff",
  };
}

function manifestTable(manifests) {
  return manifests
    .map(
      (m) => `<tr><td>${escapeHtml(m.ticker)}</td><td>${escapeHtml(m.source)}</td>
      <td>${escapeHtml(m.fetchedAt)}</td><td>${escapeHtml(m.adjust)}</td>
      <td><a href="${escapeHtml(m.sourceUrl)}" target="_blank" rel="noopener noreferrer">原始数据 ↗</a></td></tr>`,
    )
    .join("");
}
function kpiHtml(s) {
  const item = (label, val, cls = "") =>
    `<div class="kpi"><div class="kpi-v ${cls}">${val}</div><div class="kpi-l">${label}</div></div>`;
  return [
    item("累计收益", pct(s.totalReturn), s.totalReturn >= 0 ? "pos" : "neg"),
    item("年化收益", pct(s.annualizedReturn), s.annualizedReturn >= 0 ? "pos" : "neg"),
    item("年化波动", pct(s.annualizedVolatility)),
    item("最大回撤", pct(s.maxDrawdown), "neg"),
    item("Sharpe", Number(s.sharpe).toFixed(2)),
  ].join("");
}

export async function renderHtml(input) {
  const {
    title, subtitle = "", bars, summary, annotated, manifests = [],
    generatedAt = new Date().toISOString(), windowDays = 10,
  } = input;

  const traces = buildTraces(bars, annotated);
  const layout = buildLayout();
  const plotlyJs = safeForScript(await loadPlotly());
  const payload = safeForScript(
    JSON.stringify({ bars, annotated, manifests, summary, windowDays }),
  );

  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  :root{--ink:#1f2933;--muted:#8b95a3;--line:#e6e8ee}
  *{box-sizing:border-box}
  body{margin:0;font-family:"Segoe UI","Microsoft YaHei",system-ui,sans-serif;color:var(--ink);background:#f3f5f8}
  header{background:#fff;border-bottom:1px solid var(--line);padding:18px 28px}
  header h1{margin:0 0 4px;font-size:21px}
  header .sub{color:var(--muted);font-size:12.5px}
  main{max-width:1200px;margin:18px auto;padding:0 20px}
  .panel{background:#fff;border:1px solid var(--line);border-radius:10px;padding:16px;margin-bottom:18px}
  #chart{width:100%;height:560px}
  .kpis{display:grid;grid-template-columns:repeat(5,1fr);gap:12px;margin-bottom:18px}
  .kpi{background:#fff;border:1px solid var(--line);border-radius:10px;padding:12px 14px;text-align:center}
  .kpi-v{font-size:20px;font-weight:700}.kpi-l{font-size:12px;color:var(--muted);margin-top:2px}
  .pos{color:${BULL}}.neg{color:${BEAR}}.muted{color:var(--muted)}
  .toolbar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:14px}
  .toolbar h2{font-size:15px;margin:0 6px 0 0}
  .fbtn{border:1px solid var(--line);background:#fff;border-radius:16px;padding:5px 14px;font-size:13px;cursor:pointer;color:#465}
  .fbtn.active{background:${BLUE};color:#fff;border-color:${BLUE}}
  .hint{font-size:12px;color:var(--muted);margin-left:auto}
  .cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(330px,1fr));gap:13px}
  .card{border:1px solid var(--line);border-left:4px solid;border-radius:8px;padding:12px 14px;background:#fff;cursor:pointer;transition:box-shadow .12s}
  .card:hover{box-shadow:0 4px 14px rgba(30,50,80,.08)}
  .card.selected{outline:2px solid ${BLUE};outline-offset:-1px}
  .card-top{display:flex;align-items:center;justify-content:space-between}
  .dot{font-size:11px;color:#fff;padding:2px 8px;border-radius:9px}
  .stars{font-size:12px;color:${GOLD};letter-spacing:1px}.stars .empty{color:#dfe3ea}
  .card h3{margin:7px 0 3px;font-size:14.5px;line-height:1.35}
  .meta{font-size:11.5px;color:var(--muted)}
  .reacts{display:flex;gap:14px;font-size:12.5px;margin:7px 0}.reacts span{color:var(--muted)}
  .tags{margin:6px 0}.tag{font-size:11px;padding:2px 8px;border-radius:6px;background:#eef2f7;color:#566}
  .tag.peak{background:#fdeaea;color:${BEAR}}.tag.trough{background:#e6f5f2;color:#1b7f73}
.tag.react{background:#eef0fb;color:#3b4bb0}
  .tag.muted{background:#eef1f5;color:var(--muted)}
  .summary{font-size:12px;line-height:1.5;color:#4b5563;margin:8px 0}
  .src a{font-size:12px;color:${BLUE};text-decoration:none;margin-right:12px}
  table{width:100%;border-collapse:collapse;font-size:12.5px}
  th,td{border:1px solid var(--line);padding:6px 8px;text-align:left}
  th{background:#f8fafc}a{color:${BLUE}}
  footer{color:var(--muted);font-size:12px;text-align:center;padding:16px}
</style></head>
<body>
<header>
  <h1>${escapeHtml(title)}</h1>
  <div class="sub">${escapeHtml(subtitle)} ｜ 生成于 ${escapeHtml(generatedAt)} ｜ 底部事件标记带：形状区分类别、颜色区分方向</div>
</header>
<main>
  <div class="kpis">${kpiHtml(summary)}</div>
  <section class="panel"><div id="chart"></div></section>
  <section class="panel">
    <div class="toolbar">
      <h2>事件时间线（${annotated.length}）</h2>
      <button class="fbtn active" data-f="all">全部</button>
      <button class="fbtn" data-f="major">重大影响 ≥4★</button>
      <button class="fbtn" data-f="earnings">仅财报</button>
      <button class="fbtn" data-f="non-earnings">产品 / 市场</button>
      <span class="hint">点击事件或卡片 → 图表高亮 ±窗口</span>
    </div>
    <div class="cards" id="cards"></div>
  </section>
  <section class="panel">
    <h2 style="font-size:15px;margin:0 0 12px">数据来源与口径</h2>
    <table><thead><tr><th>标的</th><th>来源</th><th>抓取时间</th><th>口径</th><th>链接</th></tr></thead>
    <tbody>${manifestTable(manifests)}</tbody></table>
  </section>
</main>
<footer>自包含单文件：Plotly 与数据内联，页面加载零外部请求；来源链接需点击后由浏览器主动访问。历史表现不代表未来。</footer>
<script>${plotlyJs}</script>
<script id="payload" type="application/json">${payload}</script>
<script>
const P = JSON.parse(document.getElementById('payload').textContent);
const W = P.windowDays;
let filtered = P.annotated;
let selectedId = null;

Plotly.newPlot('chart', ${safeForScript(JSON.stringify(traces))}, ${safeForScript(JSON.stringify(layout))}, {
  responsive:true, displaylogo:false, modeBarButtonsToRemove:['select2d','lasso2d']
});

function esc(s){return String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
function fpct(x,d){ if(x===null||x===undefined||Number.isNaN(x))return '-'; return (x*100).toFixed(d||1)+'%'; }
function eColor(e){
  if(e.category==='earnings')return '${GRAYC}';
  if(e.category==='company')return '#aab3bf';
  if(e.category==='market')return '${BEAR}';
  return e.valence==='bearish'?'#e76f51':'${BLUE}';
}
const CAT=${safeForScript(JSON.stringify(CAT_LABEL))};
const SYM=${safeForScript(JSON.stringify(SYMBOL))};
function ribCustom(e){return {id:e.id,title:e.title,cat:CAT[e.category]||e.category,
 d1:fpct(e.reaction.d1),d5:fpct(e.reaction.d5),d20:fpct(e.reaction.d20),
 pivot:e.nearestPivot?((e.nearestPivot.type==='peak'?'高点':'低点')+' '+Math.abs(e.nearestPivot.lag)+'日'):'-'};}

function reactCell(v){ if(v===null)return '<span class="muted">-</span>';
 const c=v>0?'pos':v<0?'neg':'muted'; return '<span class="'+c+'">'+fpct(v)+'</span>'; }
function anchorTag(e){
 const a=e.anchor;
 if(a.kind==='pivot'){ const p=e.nearestPivot, before=p.lag<=0;
   return '<span class="tag '+(p.type==='peak'?'peak':'trough')+'">贴合拐点·'+(before?'事件前':'事件后')+' '+Math.abs(p.lag)+'日·'+(p.type==='peak'?'高点':'低点')+(p.confirmed?'':'·未确认')+'</span>'; }
 if(a.kind==='reaction')
   return '<span class="tag react">可见反应·'+(e.reactionDir==='up'?'上行':e.reactionDir==='down'?'下行':'震荡')+'·未形成大拐点</span>';
 return '<span class="tag muted">反应微弱</span>';
}
function cardHtml(e){ const c=eColor(e);
 const stars='★'.repeat(e.impactScore)+'<span class="empty">'+'★'.repeat(5-e.impactScore)+'</span>';
 const srcs=e.sources.map((u,i)=>'<a href="'+esc(u)+'" target="_blank" rel="noopener noreferrer">来源'+(i+1)+' ↗</a>').join('');
 return '<article class="card" data-id="'+e.id+'" style="border-left-color:'+c+'">'
 +'<div class="card-top"><span class="dot" style="background:'+c+'">'+(CAT[e.category]||e.category)+'</span><span class="stars">'+stars+'</span></div>'
 +'<h3>'+esc(e.title)+'</h3><div class="meta">'+e.date+' ｜ 事件后实际收益</div>'
 +'<div class="reacts"><span>1日 '+reactCell(e.reaction.d1)+'</span><span>5日 '+reactCell(e.reaction.d5)+'</span><span>20日 '+reactCell(e.reaction.d20)+'</span></div>'
 +'<div class="tags">'+anchorTag(e)+'</div><p class="summary">'+esc(e.summary)+'</p><div class="src">'+srcs+'</div></article>'; }
function cardsHtml(ev){ return ev.map(cardHtml).join(''); }

const cardsEl=document.getElementById('cards');
function renderCardList(){ cardsEl.innerHTML=cardsHtml(filtered); bindCards(); syncSelected(); }

function ribbonFrom(events){ return {
 x:[events.map(e=>e.date)], y:[events.map(()=>0)],
 marker:{ size:[events.map(e=>e.weight>=5?13:e.weight>=4?11:8)], color:[events.map(eColor)],
  symbol:[events.map(e=>SYM[e.category]||'circle')] },
 customdata:[events.map(ribCustom)] }; }
function applyFilter(f){
 if(f==='all')filtered=P.annotated;
 else if(f==='major')filtered=P.annotated.filter(e=>e.impactScore>=4);
 else if(f==='earnings')filtered=P.annotated.filter(e=>e.category==='earnings');
 else filtered=P.annotated.filter(e=>e.category!=='earnings');
 Plotly.restyle('chart', ribbonFrom(filtered), [2]);
 renderCardList();
}

function shiftDate(date,days){ const d=new Date(date+'T00:00:00Z'); d.setUTCDate(d.getUTCDate()+days); return d.toISOString().slice(0,10); }
function highlight(e){ const c=eColor(e);
 Plotly.relayout('chart',{shapes:[
  {type:'rect',xref:'x',yref:'paper',x0:shiftDate(e.date,-W),x1:shiftDate(e.date,W),y0:0,y1:1,fillcolor:c,opacity:0.09,line:{width:0}},
  {type:'line',xref:'x',yref:'paper',x0:e.date,x1:e.date,y0:0,y1:1,line:{color:c,width:1.4}}]}); }
function clearHighlight(){ Plotly.relayout('chart',{shapes:[]}); }
function syncSelected(){ document.querySelectorAll('.card').forEach(c=>c.classList.toggle('selected',c.dataset.id===selectedId)); }
function selectEvent(id){
 if(selectedId===id){selectedId=null;clearHighlight();syncSelected();return;}
 selectedId=id; highlight(P.annotated.find(x=>x.id===id)); syncSelected();
 const el=document.querySelector('.card[data-id="'+id+'"]');
 if(el)el.scrollIntoView({behavior:'smooth',block:'nearest'});
}
function bindCards(){ document.querySelectorAll('.card').forEach(el=>{
 el.addEventListener('click',ev=>{if(ev.target.closest('a'))return;selectEvent(el.dataset.id);});}); }

document.getElementById('chart').on('plotly_click',d=>{
 if(!d.points||!d.points.length)return; const p=d.points[0];
 if(p.data.name!=='事件')return;
 const id=filtered[p.pointNumber]?.id; if(id)selectEvent(id);
});
document.querySelectorAll('.fbtn').forEach(b=>b.addEventListener('click',()=>{
 document.querySelectorAll('.fbtn').forEach(x=>x.classList.remove('active')); b.classList.add('active');
 applyFilter(b.dataset.f);
 if(selectedId&&!filtered.find(e=>e.id===selectedId)){selectedId=null;clearHighlight();}
}));

renderCardList();
</script></body></html>`;
}

export async function writeHtml(input, file) {
  const html = await renderHtml(input);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, html, "utf-8");
  return file;
}
