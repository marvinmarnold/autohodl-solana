import { Bot, InlineKeyboard, webhookCallback } from "grammy";
import { type NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/env";
import { WalletPregenerationError, pregenerateWallet } from "@/lib/privy";

const bot = new Bot(env.TELEGRAM_BOT_TOKEN);

// Temporary in-memory store for the custom-amount step.
// Works in single-process local dev. Replace with Vercel KV for multi-instance prod.
const pendingCustomAmount = new Map<string, { freq: string; expiresAt: number }>();

const PERIOD_LABEL: Record<string, string> = {
  daily: "day",
  weekly: "week",
  monthly: "month",
};

function authorizeUrl(freq: string, amount: number): string {
  return `${env.NEXT_PUBLIC_MINI_APP_URL}/actions/authorize?freq=${freq}&amount=${amount}`;
}

function confirmMessage(freq: string, amount: number): string {
  const period = PERIOD_LABEL[freq] ?? freq;
  return `Got it — saving $${amount}/${period}. Tap below to authorize autoHODL to save on your behalf.`;
}

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

const FREQ_PRESETS: Record<string, number[]> = {
  daily: [1, 5, 10, 20],
  weekly: [5, 20, 50, 250],
  monthly: [10, 20, 100, 300],
};

bot.callbackQuery(/^freq:(daily|weekly|monthly)$/, async (ctx) => {
  const freq = ctx.match[1] as string;
  await ctx.answerCallbackQuery();
  const period = PERIOD_LABEL[freq] ?? freq;
  const presets = FREQ_PRESETS[freq] ?? [];
  const keyboard = new InlineKeyboard();
  for (const amt of presets) {
    keyboard.text(`$${amt}`, `amount:${freq}:${amt}`);
  }
  keyboard.row().text("Custom…", `custom:${freq}`);
  await ctx.reply(`How much per ${period}?`, { reply_markup: keyboard });
});

bot.callbackQuery(/^amount:(daily|weekly|monthly):(\d+)$/, async (ctx) => {
  const freq = ctx.match[1] as string;
  const amount = Number(ctx.match[2]);
  await ctx.answerCallbackQuery();
  await ctx.reply(confirmMessage(freq, amount), {
    reply_markup: new InlineKeyboard().add({
      text: "Authorize savings",
      web_app: { url: authorizeUrl(freq, amount) },
    }),
  });
});

bot.callbackQuery(/^custom:(daily|weekly|monthly)$/, async (ctx) => {
  const freq = ctx.match[1] as string;
  const telegramId = String(ctx.from?.id);
  await ctx.answerCallbackQuery();
  pendingCustomAmount.set(telegramId, {
    freq,
    expiresAt: Date.now() + 5 * 60 * 1000,
  });
  await ctx.reply("Type your amount (e.g. 35):");
});

bot.on("message:text", async (ctx) => {
  const telegramId = String(ctx.from?.id);
  const pending = pendingCustomAmount.get(telegramId);
  if (!pending || Date.now() > pending.expiresAt) {
    pendingCustomAmount.delete(telegramId);
    return;
  }

  const amount = Number(ctx.message.text.trim());
  if (!Number.isFinite(amount) || amount <= 0) {
    await ctx.reply("Please enter a valid amount (e.g. 35):");
    return;
  }

  pendingCustomAmount.delete(telegramId);
  const { freq } = pending;
  await ctx.reply(confirmMessage(freq, amount), {
    reply_markup: new InlineKeyboard().add({
      text: "Authorize savings",
      web_app: { url: authorizeUrl(freq, amount) },
    }),
  });
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
