import { getIronSession } from "iron-session";
import { cookies } from "next/headers";
import { type NextRequest, NextResponse } from "next/server";
import { Connection } from "@solana/web3.js";
import type { ActionGetResponse, ActionPostResponse } from "@solana/actions";
import { env } from "@/lib/env";
import { signAndSendSolanaTransaction, updatePrivyUserMetadata } from "@/lib/privy";
import { buildTokenApproveTransaction } from "@/lib/solana";
import { type SessionData, sessionOptions } from "@/lib/session";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function corsJson(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: CORS_HEADERS });
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function GET(req: NextRequest) {
  const freq = req.nextUrl.searchParams.get("freq") ?? "weekly";
  const amt = Number(req.nextUrl.searchParams.get("amount") ?? req.nextUrl.searchParams.get("amt") ?? "20");
  const freqLabel = { daily: "day", weekly: "week", monthly: "month" }[freq] ?? "period";

  const response: ActionGetResponse = {
    title: "Authorize autoHODL savings",
    icon: `${env.NEXT_PUBLIC_MINI_APP_URL}/icon.png`,
    description: `Allow autoHODL to save $${amt} per ${freqLabel} into Reflect yield. Sign once — no further signatures needed.`,
    label: "Authorize",
    links: {
      actions: [
        {
          label: "Confirm",
          href: `/api/actions/authorize?freq=${freq}&amt=${amt}`,
          type: "transaction",
        },
      ],
    },
  };

  return corsJson(response);
}

export async function POST(req: NextRequest) {
  const session = await getIronSession<SessionData>(await cookies(), sessionOptions);
  if (!session.telegramId || !session.privyWalletId) {
    return corsJson({ error: "unauthenticated" }, 401);
  }

  const body = (await req.json().catch(() => ({}))) as { freq?: string; amt?: number; amount?: number };
  const freq = body.freq ?? req.nextUrl.searchParams.get("freq") ?? "weekly";
  const amt = body.amt ?? body.amount ?? Number(req.nextUrl.searchParams.get("amt") ?? req.nextUrl.searchParams.get("amount") ?? "20");
  const freqLabel = { daily: "day", weekly: "week", monthly: "month" }[freq] ?? "period";

  const connection = new Connection(env.SOLANA_RPC_URL, "confirmed");

  let txBase64: string;
  try {
    txBase64 = await buildTokenApproveTransaction(
      session.walletAddress,
      env.AUTOHODL_DELEGATE_PUBKEY,
      connection,
    );
  } catch (err) {
    console.error("Failed to build approve tx:", err);
    return corsJson({ error: "tx_build_failed" }, 500);
  }

  let txSignature: string;
  try {
    txSignature = await signAndSendSolanaTransaction(session.privyWalletId, txBase64);
  } catch (err) {
    console.error("Privy signing failed:", err);
    return corsJson({ error: "signing_failed" }, 502);
  }

  // Save settings to Privy metadata — non-blocking
  updatePrivyUserMetadata(session.privyUserId, {
    savingsFrequency: freq,
    savingsAmountUsd: amt,
    delegationTxSignature: txSignature,
    delegationSetAt: new Date().toISOString(),
  }).catch((err) => console.error("Metadata update failed (non-fatal):", err));

  // Send ✅ confirmation + MoonPay CTA to the Telegram chat
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

  const response: ActionPostResponse = {
    type: "transaction",
    transaction: txBase64,
    message: `Authorized $${amt}/${freqLabel} savings. Tx: ${txSignature}`,
  };
  return corsJson(response);
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
