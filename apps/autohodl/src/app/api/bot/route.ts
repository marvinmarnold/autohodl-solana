import { Bot, webhookCallback } from "grammy";
import { type NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/env";

// Bot instance is module-level so it's reused across warm invocations.
const bot = new Bot(env.TELEGRAM_BOT_TOKEN);

bot.command("start", async (ctx) => {
  await ctx.reply("Welcome to autoHODL! Open your savings dashboard:", {
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: "Open autoHODL ↗",
            web_app: { url: env.NEXT_PUBLIC_MINI_APP_URL },
          },
        ],
      ],
    },
  });
});

const handleUpdate = webhookCallback(bot, "std/http");

export async function POST(req: NextRequest) {
  try {
    return await handleUpdate(req);
  } catch (err) {
    // Must return 200 — non-200 causes Telegram to retry the update indefinitely.
    console.error("Bot handler error:", err);
    return new NextResponse("OK", { status: 200 });
  }
}
