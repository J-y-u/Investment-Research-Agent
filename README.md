# 实时投研 Agent

一个**通用投研 agent**：覆盖 A股 / 美股 / 港股 / ETF / 商品 / 加密货币等任意标的的行情查询、风险收益指标、事件研究、双标的对比与研究报告生成。

提供两种形态：
- **Web 应用**（推荐）：打开网页输入投研需求 → 流式返回分析 + 可下载报告
- **CLI Agent**：基于 pi Agent SDK 的 tools / subagents / skills 多代理编排

> 数据全部来自免费公开数据源（Yahoo Finance、Hacker News）；所有数字由代码计算；不构成投资建议。

---

## 一、快速开始

环境要求：Node.js ≥ 20（实测 v24）。

```bash
# 1. 安装依赖（国内可加 --registry=https://registry.npmmirror.com）
npm install

# 2. 配置模型密钥：复制 .env.example 为 .env 并填入
cp .env.example .env

# 3a. 启动 Web 应用
node src/web/server.js
#     然后浏览器打开 http://127.0.0.1:8200

# 3b. 或走 CLI（纯代码管线，无需 LLM）
node src/run.js all --pipeline

# 4. 测试（离线可跑）
npm test
```

## 二、Web 应用

打开 `http://127.0.0.1:8200`，输入投研需求即可。页面提供快捷模板：

| 模板 | 用途 |
|---|---|
| 🔍 查行情 | 任意标的的行情与风险收益指标 |
| 📰 事件研究 | 某标的近五年事件对股价的影响 |
| ⚖️ 资产对比 | 两标的的收益/波动/回撤/Sharpe/相关性 |
| 📑 生成报告 | 任意标的的事件交互报告（HTML）或两标的对比三件套 |

**会话记忆**：
- 会话内**多轮上下文**：可以追问“刚才那个标的的 Sharpe 是多少”，模型会用历史对话与工具结果回答
- 会话**持久化**到 `.sessions/`，刷新页面自动恢复；顶栏「历史会话」可浏览/切换/删除，可一键「新对话」

**标的代码格式**：
`AAPL`（美股）｜`0700.HK`（港股）｜`600519.SS`（沪市）｜`000001.SZ`（深市）｜`GC=F`（商品）｜`BTC-USD`（加密）

**安全边界**（详见 `src/web/agent.js`）：
- 只处理投研类需求，无关请求礼貌拒绝且不调用工具
- 无可执行/文件系统权限；工具白名单仅 5 个投研工具
- 标的代码格式白名单校验（防注入）；输入长度与频率限制
- 模型密钥仅存后端 `.env`，不进前端产物；服务仅监听 127.0.0.1

## 三、CLI Agent

```bash
node src/run.js nvda            # 任务A：NVDA 行情×事件（深度样例，agent 编排）
node src/run.js hedge           # 任务B：黄金 vs BTC 三件套
node src/run.js all --pipeline  # 纯代码确定性管线（无 LLM、命中缓存可断网）
```

CLI 体现了 pi 的 **tools / subagents / skills** 协作：

```
编排者 Orchestrator（规划 / 分派 DAG，不做具体实现）
  ├ market-analyst   行情、ZigZag 拐点、指标
  ├ event-researcher 经核实事件库 + HN 资讯
  ├ quant-analyst    事件-拐点硬约束匹配与评级
  └ artifact-builder 生成 HTML / Office
```

- **tools**：`.pi/extensions/realtime-agent.mjs` 用 `pi.registerTool` 注册 8 个工具
- **subagents**：`.pi/agents/*.md` 4 个专职子代理（frontmatter 限定各自工具）
- **skills**：`.pi/skills/` 的 event-attribution（归因方法论）、traceability（溯源规范）

## 四、产物（`output/`）

| 产物 | 说明 |
|---|---|
| `<代码>-events.html` | 任意标的的行情×事件**交互报告**：K线 + 成交量 + 事件标记带、KPI、点击高亮影响窗口、事件卡（含来源链接）。Plotly 与数据内联，**单文件零外联、断网可开** |
| `<A>_vs_<B>.xlsx` | 双标的回测底稿：说明/指标汇总/年度收益/净值/日收益/滚动相关性/回撤/来源 |
| `<A>_vs_<B>-framework.pptx` | 对比决策框架：摘要/指标对比/年度收益/相关性与组合含义/风险来源 |
| `<A>_vs_<B>-strategy.docx` | 对比策略报告：背景/方法/结果/相关性/配置建议/风险/来源 |

### 内置深度样例结果

| 指标 | NVDA | 黄金 GC=F | 比特币 BTC-USD |
|---|---|---|---|
| 累计收益 | +929.8% | +147.7% | +99.9% |
| 年化收益 | +60.0% | +20.0% | +10.0% |
| 年化波动 | 52.1% | 19.0% | 42.8% |
| 最大回撤 | −66.4% | −24.9% | −76.6% |
| Sharpe | 1.16 | 1.05 | 0.44 |

## 五、配置 `.env`

```bash
# 首选 provider（不可用时自动降级到另一个）
MODEL_PROVIDER=ark              # ark（默认）| deepseek

# ============ 火山方舟 ARK（首选）============
ARK_API_KEY=...
ARK_OPENAI_BASE_URL=https://ark.cn-beijing.volces.com/api/coding/v3
ARK_MODEL=doubao-seed-evolving

# ============ DeepSeek（备用）============
DEEPSEEK_API_KEY=...
DEEPSEEK_OPENAI_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-chat

HTTPS_PROXY=http://127.0.0.1:7892   # 仅用于抓取 Yahoo / HN（被墙源）；模型 API 不走代理
```

**自动降级**：每次对话前会轻量探测首选 provider（结果缓存：可用 5 分钟 / 不可用 2 分钟）；
火山配额用完或连不上时，自动切到 DeepSeek 并在页面顶部标出“已降级（原因）”，
配额恢复后自动切回。

`.env` 不会入库（见 `.gitignore`）。

## 六、架构与目录

```
src/
  config.js             # 标的、时间窗、阈值、代理
  model/index.js        # 模型接入（DeepSeek / ARK，OpenAI 兼容）
  util/                 # http（代理/重试）、cache、format、load-env
  data/
    market.js           # market-data：Yahoo OHLCV
    news.js             # news-events：HN 检索
    curated-events.js   # news-events：经核实的深度事件库（NVDA）
    event-source.js     # 事件源路由：curated 深度库 or HN 动态检索
  analytics/
    pivots.js           # ZigZag 拐点
    indicators.js       # 收益/波动/回撤/Sharpe/相关性
    event-study.js      # 事件研究（事件后实际收益、邻近拐点、评级）
  artifacts/
    html.js             # 自包含交互 HTML（事件标记带范式）
    excel.js / ppt.js / word.js   # 通用双标的对比三件套
  web/
    server.js           # HTTP：静态 + SSE /api/chat + 受控 /files
    agent.js            # 受控投研 agent（工具白名单 + 强系统提示）
    public/             # 前端（聊天 UI、markdown 表格渲染、产物链接）
  pipeline.js           # 确定性管线（也被 CLI/Web 复用，保证数字一致）
  run.js                # CLI 入口
.pi/                    # pi 扩展 / 子代理 / 技能
tests/                  # node:test，离线
```

核心原则：**数字只由代码产生，LLM 负责规划、归因叙述与置信判断。**

## 七、AI 开发过程

本题要求使用 AI Coding 辅助完成。主要过程如下（设计细节见 [DESIGN.md](DESIGN.md)）。

**使用的 AI 工具：**

| 工具 | 用途 |
|---|---|
| **pi**（coding agent harness）+ 模型 **doubao-seed-evolving** | 读写代码、执行命令、联网检索、任务编排 |
| **agent-skills** | spec / planning / TDD / incremental / review 流程指引 |
| **opencli** | 驱动真实 Chrome，对 HTML 做渲染/交互/网络的运行级截图验收 |
| **pi-subagents** | 子代理运行时（spawn 交付代码中的专职子代理） |

**AI 参与环节：** 起草规格与架构、编写数据/分析/产物/编排各层、TDD 写测试、浏览器验收、撰写文档。

**关键人工判断与修改（人发现并纠正、最能体现判断力的部分）：**

1. **事件影响方向误判（核心 bug）**：初版用拐点类型推断方向（高点→利空），导致 ChatGPT 被标“利空”、DeepSeek 冲击被标“利好”。改为事件 **valence 定方向** + 事件后实际收益对照、冲突降置信。
2. **子代理加载不到工具**：内联 `customTools` 不被前台子代理继承 → 改为经 **pi 扩展** `registerTool` 注册。
3. **产物链接被流式文本覆盖**：文本每次 `innerHTML=…` 冲掉已追加的产物链接 → 文本与产物拆为独立容器。
4. **事件×拐点关联缺口**：14 个财报事件够不上 15% 大拐点、被误判无关联；实测均有可见反应 → 新增 **anchor 事件锚点层**，30/30 事件全部有行情关联。
5. **边界与成本决策**：Web 端收窄为单 agent + 工具白名单（面向不可信输入）；模型火山优先、不可用才自动降级 DeepSeek；黄金选 `GC=F`。

纪律：数字只由代码产生、LLM 不算数；配不上的拐点宁空不凑；密钥不入库、不进前端。

## 免责声明

本项目仅用于技术与研究方法演示，历史表现不代表未来，不构成投资建议。
