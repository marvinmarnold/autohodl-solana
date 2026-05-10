import { getIronSession } from "iron-session";
import { cookies } from "next/headers";
import { type NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/env";
import { redis } from "@/lib/kv";
import { type SessionData, sessionOptions } from "@/lib/session";

export async function POST(req: NextRequest) {
  const session = await getIronSession<SessionData>(await cookies(), sessionOptions);
  if (!session.telegramId || !session.walletAddress) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const dedupKey = `congrats_sent:telegram:${session.telegramId}`;
  const alreadySent = await redis.get(dedupKey);
  if (alreadySent) {
    return NextResponse.json({ walletAddress: session.walletAddress });
  }

  const body = (await req.json().catch(() => ({}))) as { freq?: string; amt?: number };
  const freq = body.freq ?? "weekly";
  const amt = body.amt ?? 0;
  const period = { daily: "day", weekly: "week", monthly: "month" }[freq] ?? "period";
  const short = (addr: string) => `${addr.slice(0, 4)}…${addr.slice(-4)}`;

  await sendTelegramMessage(session.telegramId, {
    text: [
      "🎉 You're all set!",
      "",
      "Your autoHODL savings account is live. Here's what happens next:",
      "",
      `• MoonPay will send $${amt}/${period} to your wallet`,
      "• autoHODL automatically deposits it into Reflect",
      "• Your funds earn yield from day one — no action needed",
      "",
      `Wallet: \`${short(session.walletAddress)}\``,
    ].join("\n"),
    parse_mode: "Markdown",
  });

  await redis.set(dedupKey, "1");

  return NextResponse.json({ walletAddress: session.walletAddress });
}

async function sendTelegramMessage(chatId: string, message: Record<string, unknown>): Promise<void> {
  const res = await fetch(
    `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, ...message }),
    },
  );
  if (!res.ok) {
    const body = await res.text().catch(() => "(unreadable)");
    console.error(`Telegram sendMessage failed: ${res.status}`, body);
  }
}
