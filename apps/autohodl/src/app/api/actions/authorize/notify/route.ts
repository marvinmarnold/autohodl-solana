import { getIronSession } from "iron-session";
import { cookies } from "next/headers";
import { type NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/env";
import { getUserSettings } from "@/lib/kv";
import { type SessionData, sessionOptions } from "@/lib/session";

const PERIOD: Record<string, string> = { daily: "day", weekly: "week", monthly: "month" };

export async function POST(req: NextRequest) {
  void req;
  const session = await getIronSession<SessionData>(await cookies(), sessionOptions);
  if (!session.telegramId) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const settings = await getUserSettings(session.telegramId);
  if (!settings) {
    return NextResponse.json({ ok: true }); // nothing to confirm yet
  }

  const sp = PERIOD[settings.savingsFrequency] ?? settings.savingsFrequency;
  const hasFunding = settings.fundingAmountUsd != null;
  const fp = settings.fundingFrequency ? (PERIOD[settings.fundingFrequency] ?? settings.fundingFrequency) : null;

  const lines: string[] = [
    hasFunding ? "🎉 All set!" : "✅ Savings schedule saved",
    "",
    `📊 *Savings schedule*`,
    `$${settings.savingsAmountUsd} / ${sp} → Reflect yield`,
  ];

  if (hasFunding && fp) {
    lines.push(
      "",
      "💳 *Automatic funding*",
      `$${settings.fundingAmountUsd} / ${fp} via MoonPay`,
      "",
      "In sync ✓",
    );
  } else {
    lines.push("", "💳 *Automatic funding*", "Not configured yet");
  }

  await sendBotMessage(session.telegramId, lines.join("\n"));
  return NextResponse.json({ ok: true });
}

async function sendBotMessage(chatId: string, text: string): Promise<void> {
  const res = await fetch(
    `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: "Markdown" }),
    },
  );
  if (!res.ok) {
    const body = await res.text().catch(() => "(unreadable)");
    console.error(`Telegram sendMessage failed: ${res.status}`, body);
  }
}
