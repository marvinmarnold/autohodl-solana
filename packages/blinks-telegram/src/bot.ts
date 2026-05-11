// grammY bot-side utilities.
// actionButton()         — InlineKeyboard with a web_app button for any Action URL.
// webAppDataMiddleware() — fires when the WebView calls Telegram.WebApp.sendData().

import { InlineKeyboard, type Context, type Middleware } from "grammy";

/**
 * Returns an InlineKeyboard containing a single web_app button.
 * The webViewUrl should point to a page that renders the Action and signs it
 * (e.g. via TelegramBlink from @autohodl/blinks-telegram/webview).
 *
 * @example
 * await ctx.reply("Authorize savings:", {
 *   reply_markup: actionButton("Complete setup", `${APP_URL}/actions/authorize?freq=weekly&amount=20`),
 * });
 */
export function actionButton(label: string, webViewUrl: string): InlineKeyboard {
  return new InlineKeyboard().add({ text: label, web_app: { url: webViewUrl } });
}

export type WebAppDataPayload = {
  type: string;
  [key: string]: unknown;
};

/**
 * grammY middleware that handles web_app_data events — fired when the WebView
 * calls window.Telegram.WebApp.sendData(JSON.stringify(payload)).
 *
 * @example
 * bot.on("message:web_app_data", webAppDataMiddleware(async (ctx, data) => {
 *   if (data.type === "blink:success") {
 *     await ctx.reply("✅ Authorization complete!");
 *   }
 * }));
 */
export function webAppDataMiddleware<C extends Context>(
  handler: (ctx: C, data: WebAppDataPayload) => Promise<void>,
): Middleware<C> {
  return async (ctx, next) => {
    const raw = ctx.message?.web_app_data?.data;
    if (!raw) return next();

    let data: WebAppDataPayload;
    try {
      data = JSON.parse(raw) as WebAppDataPayload;
    } catch {
      return next();
    }

    await handler(ctx, data);
  };
}
