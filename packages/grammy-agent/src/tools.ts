// Built-in tool factories for grammy-agent.
// Use these to give the LLM the ability to emit Solana Action buttons in chat.

import { tool } from "ai";
import { z } from "zod";
import type { BlinkToolOutput } from "./types.js";

/**
 * A tool that, when called by the LLM, instructs the middleware to send a
 * Telegram web_app button pointing to a Solana Action WebView.
 *
 * The LLM decides WHEN to call it and with what URL. The middleware intercepts
 * the tool call and emits the appropriate InlineKeyboard button.
 *
 * @example
 * tools: {
 *   authorize_savings: blinkTool({
 *     description: "Send the user a button to authorize autoHODL savings",
 *     buildUrl: ({ freq, amount }) =>
 *       `${process.env.APP_URL}/actions/authorize/webview?freq=${freq}&amount=${amount}`,
 *     parameters: z.object({
 *       freq: z.enum(["daily", "weekly", "monthly"]),
 *       amount: z.number().positive(),
 *     }),
 *   }),
 * }
 */
export function blinkTool<TParams extends z.ZodTypeAny>({
  description,
  parameters,
  buildUrl,
  label = "Open",
}: {
  description: string;
  parameters: TParams;
  buildUrl: (params: z.infer<TParams>) => string;
  label?: string;
}) {
  return tool({
    description,
    parameters,
    execute: async (params): Promise<BlinkToolOutput> => ({
      type: "blink",
      label,
      webViewUrl: buildUrl(params as z.infer<TParams>),
    }),
  });
}
