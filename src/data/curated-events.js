// news-events：预置 AI/NVDA 事件库（curated）
// 说明：Hacker News 检索无法完整覆盖五年前事件，故事件库以经核实的预置数据为准。
// 两类：① 20 个季度财报（earnings，方向看实际市场反应）；
//       ② 重大产品/公司/市场事件。日期与来源均经实际检索核实（见 DESIGN）。
// 字段：id, date, title, category, summary, sources[], valence, weight

const IR_QUARTERLY = "https://investor.nvidia.com/financial-info/quarterly-results/default.aspx";

// [报告日, 财季标签]
const EARNINGS = [
  ["2021-11-17", "Q3 FY2022"],
  ["2022-02-16", "Q4 FY2022"],
  ["2022-05-25", "Q1 FY2023"],
  ["2022-08-24", "Q2 FY2023"],
  ["2022-11-16", "Q3 FY2023"],
  ["2023-02-22", "Q4 FY2023"],
  ["2023-05-24", "Q1 FY2024"],
  ["2023-08-23", "Q2 FY2024"],
  ["2023-11-21", "Q3 FY2024"],
  ["2024-02-21", "Q4 FY2024"],
  ["2024-05-22", "Q1 FY2025"],
  ["2024-08-28", "Q2 FY2025"],
  ["2024-11-20", "Q3 FY2025"],
  ["2025-02-26", "Q4 FY2025"],
  ["2025-05-28", "Q1 FY2026"],
  ["2025-08-27", "Q2 FY2026"],
  ["2025-11-19", "Q3 FY2026"],
  ["2026-02-25", "Q4 FY2026"],
  ["2026-05-20", "Q1 FY2027"],
  ["2026-08-26", "Q2 FY2027"],
];

const earningsEvents = EARNINGS.map(([date, label], i) => ({
  id: `evt-earn-${i + 1}`,
  date,
  title: `${label} 季度财报`,
  category: "earnings",
  summary: `${label} 业绩于当日盘后披露；市场反应见事件后 1/5/20 日实际收益。`,
  sources: [IR_QUARTERLY],
  valence: "neutral",
  weight: 3,
}));

// 重大产品 / 公司 / 市场事件
const SPECIAL_EVENTS = [
  {
    id: "evt-h100",
    date: "2022-03-22",
    title: "NVIDIA 发布 Hopper 架构与 H100 GPU",
    category: "gpu",
    summary: "GTC 发布 Hopper 与 H100，号称 AI 数据中心数量级性能提升。",
    sources: [
      "https://nvidianews.nvidia.com/news/nvidia-announces-hopper-architecture-the-next-generation-of-accelerated-computing",
    ],
    valence: "bullish",
    weight: 3,
  },
  {
    id: "evt-chatgpt",
    date: "2022-11-30",
    title: "OpenAI 公开发布 ChatGPT",
    category: "product_release",
    summary: "ChatGPT 发布，生成式 AI 需求爆发，成为算力行情起点。",
    sources: ["https://openai.com/index/chatgpt/"],
    valence: "bullish",
    weight: 5,
  },
  {
    id: "evt-gpt4",
    date: "2023-03-14",
    title: "OpenAI 发布 GPT-4",
    category: "model",
    summary: "GPT-4 发布，进一步拉动训练与推理算力需求。",
    sources: [
      "https://web.archive.org/web/20230314174531/https:/openai.com/research/gpt-4",
    ],
    valence: "bullish",
    weight: 3,
  },
  {
    id: "evt-blackwell",
    date: "2024-03-18",
    title: "GTC 2024：发布 Blackwell 平台与 B200/GB200",
    category: "gpu",
    summary: "发布 Blackwell 及 B100/B200、GB200，面向万亿参数模型。",
    sources: [
      "https://nvidianews.nvidia.com/news/nvidia-blackwell-platform-arrives-to-power-a-new-era-of-computing",
    ],
    valence: "bullish",
    weight: 4,
  },
  {
    id: "evt-split",
    date: "2024-06-07",
    title: "NVIDIA 10 拆 1 股票拆分生效",
    category: "company",
    summary: "10:1 正向拆分收盘后生效；不改变公司价值，影响中性。",
    sources: ["https://www.sec.gov/Archives/edgar/data/1045810/000104581024000113/nvda-20240522.htm"],
    valence: "neutral",
    weight: 1,
  },
  {
    id: "evt-v3",
    date: "2024-12-26",
    title: "DeepSeek 发布并开源 V3 大模型",
    category: "model",
    summary: "DeepSeek-V3 开源，性能对标一线，据称算力成本远低。",
    sources: ["https://www.deepseek.com/en/news/deepseek-v3/"],
    valence: "bullish",
    weight: 2,
  },
  {
    id: "evt-r1",
    date: "2025-01-20",
    title: "DeepSeek 发布推理模型 R1",
    category: "model",
    summary: "R1 推理比肩 o1 而成本极低，引发算力需求担忧。",
    sources: [
      "https://theconversation.com/deepseek-how-a-small-chinese-ai-company-is-shaking-up-us-tech-heavyweights-248434",
    ],
    valence: "bearish",
    weight: 4,
  },
  {
    id: "evt-jan27-crash",
    date: "2025-01-27",
    title: "DeepSeek 冲击：NVDA 单日重挫约 17%",
    category: "market",
    summary: "担忧高效模型削减算力需求，NVDA 当日大跌约 17%，全球 AI 板块抛售。",
    sources: ["https://www.theverge.com/2025/1/27/4352801/deepseek-ai-chatbot-chatgpt-ios-app-store"],
    valence: "bearish",
    weight: 5,
  },
  {
    id: "evt-gb300",
    date: "2025-03-18",
    title: "GTC 2025：发布 Blackwell Ultra GB300，预告 Vera Rubin",
    category: "gpu",
    summary: "发布 GB300 平台并预告 Vera Rubin，缓解算力需求疑虑。",
    sources: [
      "https://nvidianews.nvidia.com/news/nvidia-blackwell-ultra-ai-factory-platform-paves-way-for-age-of-ai-reasoning",
    ],
    valence: "bullish",
    weight: 3,
  },
  {
    id: "evt-gtc2026",
    date: "2026-03-16",
    title: "GTC 2026：Vera Rubin 平台进入量产",
    category: "gpu",
    summary: "Vera Rubin 开启智能体 AI 前沿，七款新芯片全面量产。",
    sources: [
      "https://investor.nvidia.com/news/press-release-details/2026/NVIDIA-Vera-Rubin-Opens-Agentic-AI-Frontier/",
    ],
    valence: "bullish",
    weight: 3,
  },
];

export function getCuratedEvents() {
  return [...earningsEvents, ...SPECIAL_EVENTS]
    .map((e) => ({ ...e, sources: [...e.sources] }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}
