import { Bot, InlineKeyboard, webhookCallback } from "grammy";
import { type NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/env";
import { WalletPregenerationError, pregenerateWallet } from "@/lib/privy";

const bot = new Bot(env.TELEGRAM_BOT_TOKEN);

bot.command("start", async (ctx) => {
  const telegramId = String(ctx.from?.id);
  if (!telegramId) {
    await ctx.reply("Could not identify your Telegram account. Please try again.");
    return;
  }

  try {
    await pregenerateWallet(telegramId);
  } catch (err) {
    if (err instanceof WalletPregenerationError) {
      console.error("Wallet pregeneration failed:", err);
      await ctx.reply("Something went wrong setting up your wallet. Please try again in a moment.");
      return;
    }
    throw err;
  }

  await ctx.reply(
    "Welcome to autoHODL — scheduled secure on-chain yield.\n\nHow often do you want to save?",
    {
      reply_markup: new InlineKeyboard()
        .text("Daily", "freq:daily")
        .text("Weekly", "freq:weekly")
        .text("Monthly", "freq:monthly"),
    },
  );
});

const handleUpdate = webhookCallback(bot, "std/http");

export async function POST(req: NextRequest) {
  try {
    return await handleUpdate(req);
  } catch (err) {
    console.error("Bot handler error:", err);
    return new NextResponse("OK", { status: 200 });
  }
}
