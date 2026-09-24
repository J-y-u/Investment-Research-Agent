// pi 扩展：注册实时投研 agent 的 8 个自定义工具。
// 通过扩展注册后，子代理可用 subagentOnlyExtensions 加载这些工具。
import { registerTools } from "../../src/agents/tools.js";

// 通过路径加载的扩展，默认导出必须是 factory 函数。
export default function realtimeAgent(pi) {
  registerTools(pi);
}
