import { getIronSession } from "iron-session";
import { cookies } from "next/headers";
import { type NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/env";
import { getUserSettings, getWallet } from "@/lib/kv";
import { fetchUsdcBalance, buildMetricsMessage } from "@/lib/solana";
import { type SessionData, sessionOptions } from "@/lib/session";

type MessageOptions = {
  parse_mode?: "Markdown" | "HTML";
  link_preview_options?: { is_disabled?: boolean };
  reply_markup?: object;
};

async function sendBotMessage(chatId: string, text: string, options: MessageOptions = {}): Promise<void> {
  const res = await fetch(
    `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, ...options }),
    },
  );
  if (!res.ok) {
    const body = await res.text().catch(() => "(unreadable)");
    console.error(`Telegram sendMessage failed: ${res.status}`, body);
  }
}

export async function POST(req: NextRequest) {
  void req;
  const session = await getIronSession<SessionData>(await cookies(), sessionOptions);
  if (!session.telegramId) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const [settings, walletRecord] = await Promise.all([
    getUserSettings(session.telegramId),
    getWallet(session.telegramId),
  ]);

  if (!settings) {
    return NextResponse.json({ ok: true });
  }

  const balance = walletRecord ? await fetchUsdcBalance(walletRecord.walletAddress) : null;

  await sendBotMessage(session.telegramId, "✅ Settings updated.");

  if (walletRecord) {
    await sendBotMessage(
      session.telegramId,
      buildMetricsMessage(balance, walletRecord.walletAddress, settings.fundingAmountUsd != null),
      { parse_mode: "Markdown", link_preview_options: { is_disabled: true } },
    );
  }

  const hasBalance = balance !== null && balance > 0;
  await sendBotMessage(session.telegramId, "What would you like to do?", {
    reply_markup: {
      inline_keyboard: [
        [
          { text: "📊 Report", callback_data: "action:report" },
          { text: "⚙️ Settings", callback_data: "action:settings" },
        ],
        [
          { text: "💵 Deposit", callback_data: "action:deposit" },
          ...(hasBalance ? [{ text: "💸 Withdraw", callback_data: "action:withdraw" }] : []),
        ],
      ],
    },
  });

  return NextResponse.json({ ok: true });
}
