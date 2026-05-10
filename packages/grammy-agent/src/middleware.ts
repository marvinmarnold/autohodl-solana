// grammY middleware that routes messages through an LLM with tool calling.
// Blink tool outputs are intercepted and emitted as web_app InlineKeyboard buttons.

import { type Context, InlineKeyboard, type Middleware } from "grammy";
import { generateText } from "ai";
import type { AgentMiddlewareOptions, BlinkToolOutput } from "./types.js";

/**
 * Creates a grammY middleware that passes incoming text messages to an LLM,
 * handles tool calls, and sends the final text response (plus any Blink
 * buttons) back to the user.
 *
 * @example
 * const agent = createAgentMiddleware({
 *   model: anthropic("claude-sonnet-4-6"),
 *   systemPrompt: "You are the autoHODL savings assistant.",
 *   tools: { authorize: blinkTool({ ... }) },
 * });
 *
 * bot.on("message:text", agent);
 */
export function createAgentMiddleware<C extends Context>(
  opts: AgentMiddlewareOptions<C>,
): Middleware<C> {
  const {
    model,
    systemPrompt,
    tools = {},
    filter,
    onToolResult,
    maxSteps = 5,
  } = opts;

  return async (ctx, next) => {
    const text = ctx.message?.text;
    if (!text) return next();
    if (filter && !filter(ctx)) return next();
    // Don't intercept bot commands — let explicit handlers take them.
    if (text.startsWith("/")) return next();

    const typing = ctx.replyWithChatAction("typing").catch(() => null);

    let result: Awaited<ReturnType<typeof generateText>>;
    try {
      const hasTools = Object.keys(tools).length > 0;
      result = await generateText(
        hasTools
          ? { model, system: systemPrompt, prompt: text, maxSteps, tools: tools as Parameters<typeof generateText>[0]["tools"] & object }
          : { model, system: systemPrompt, prompt: text, maxSteps },
      );
    } catch (err) {
      console.error("[grammy-agent] LLM error:", err);
      await ctx.reply("Sorry, something went wrong. Please try again.");
      return;
    } finally {
      await typing;
    }

    // Handle tool calls — emit Blink buttons for blink-type outputs.
    type AnyToolResult = { toolName: string; result: unknown };
    for (const step of result.steps) {
      const stepResults = step.toolResults as AnyToolResult[];
      for (const toolResult of stepResults) {
        const output = toolResult.result;
        if (
          typeof output === "object" &&
          output !== null &&
          "type" in output &&
          (output as BlinkToolOutput).type === "blink"
        ) {
          const blink = output as BlinkToolOutput;
          await onToolResult?.(ctx, toolResult.toolName, blink);

          const kb = new InlineKeyboard().add({
            text: blink.label,
            web_app: { url: blink.webViewUrl },
          });
          await ctx.reply(blink.message ?? blink.label, { reply_markup: kb });
        }
      }
    }

    // Send the final LLM text response if non-empty.
    if (result.text.trim()) {
      await ctx.reply(result.text.trim());
    }
  };
}
