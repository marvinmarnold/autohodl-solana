import { getIronSession } from "iron-session";
import { cookies } from "next/headers";
import { type NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/env";
import { updatePrivyUserMetadata } from "@/lib/privy";
import { type SessionData, sessionOptions } from "@/lib/session";

export async function POST(req: NextRequest) {
  const session = await getIronSession<SessionData>(await cookies(), sessionOptions);
  if (!session.telegramId || !session.privyUserId) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  let txSignature: string;
  let freq: string;
  let amt: number;
  try {
    const body = (await req.json()) as { txSignature?: string; freq?: string; amt?: number };
    txSignature = body.txSignature ?? "";
    freq = body.freq ?? "weekly";
    amt = body.amt ?? 20;
  } catch {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  // Save settings to Privy metadata — non-blocking
  updatePrivyUserMetadata(session.privyUserId, {
    savingsFrequency: freq,
    savingsAmountUsd: amt,
    delegationTxSignature: txSignature,
    delegationSetAt: new Date().toISOString(),
  }).catch((err) => console.error("Metadata update failed (non-fatal):", err));

  const moonpayApiKey = process.env["NEXT_PUBLIC_MOONPAY_API_KEY"] ?? "";
  const moonpayUrl = moonpayApiKey
    ? `https://buy.moonpay.com?${new URLSearchParams({ apiKey: moonpayApiKey, currencyCode: "usdc_sol", walletAddress: session.walletAddress, baseCurrencyCode: "usd", baseCurrencyAmount: String(amt) }).toString()}`
    : null;

  const replyMarkup = moonpayUrl
    ? { inline_keyboard: [[{ text: "Never forget — setup automatic deposits 🔁", url: moonpayUrl }]] }
    : undefined;

  await sendTelegramMessage(session.telegramId, {
    text: `✅ Authorization set.\n\nWe'll send you a reminder to deposit into this wallet. Our agentic protocol will optimize your yield.`,
    ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
  });

  return NextResponse.json({ ok: true });
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
