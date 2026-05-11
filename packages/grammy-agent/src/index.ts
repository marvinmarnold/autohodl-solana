// @autohodl/grammy-agent
// grammY middleware with LLM tool calling and Blink-output support.

export { createAgentMiddleware } from "./middleware.js";
export { blinkTool } from "./tools.js";
export type {
  AgentTool,
  AgentToolOutput,
  BlinkToolOutput,
  TextToolOutput,
  AgentMiddlewareOptions,
} from "./types.js";
