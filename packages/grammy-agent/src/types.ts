import type { Context } from "grammy";
import type { LanguageModel, Tool } from "ai";

export type AgentTool = Tool;

export type BlinkToolOutput = {
  /** Discriminator so the middleware knows to emit a web_app button */
  type: "blink";
  label: string;
  webViewUrl: string;
  /** Human-readable message to send alongside the button */
  message?: string;
};

export type TextToolOutput = {
  type: "text";
  content: string;
};

export type AgentToolOutput = BlinkToolOutput | TextToolOutput;

export type AgentMiddlewareOptions<C extends Context> = {
  /** Vercel AI SDK LanguageModel — e.g. anthropic("claude-sonnet-4-6") */
  model: LanguageModel;
  /** System prompt prepended to every conversation turn */
  systemPrompt: string;
  /** Tools the LLM may call. Use blinkTool() for Action buttons. */
  tools?: Record<string, AgentTool>;
  /**
   * Filter: return true for messages the agent should handle.
   * Defaults to all non-command text messages.
   */
  filter?: (ctx: C) => boolean;
  /**
   * Called when the LLM returns a tool call result before the agent
   * assembles the final reply. Use this to perform side effects.
   */
  onToolResult?: (ctx: C, toolName: string, result: AgentToolOutput) => Promise<void>;
  /** Maximum tool-call iterations before returning the last response */
  maxSteps?: number;
};
