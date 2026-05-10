import { type NextRequest, NextResponse } from "next/server";
import { Connection } from "@solana/web3.js";
import { env } from "@/lib/env";
import { getWallet, getUserSettings } from "@/lib/kv";
import { fetchUsdcBalance, buildMetricsMessage } from "@/lib/solana";
import { persistSettings } from "@/lib/settings";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function corsJson(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: CORS_HEADERS });
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

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
  const url = req.nextUrl;
  const body = (await req.json().catch(() => ({}))) as { signature?: string };

  const telegramId = url.searchParams.get("telegramId");
  const freq = url.searchParams.get("freq") ?? "weekly";
  const amount = Number(url.searchParams.get("amount") ?? "20");
  const wallet = url.searchParams.get("wallet");
  const signature = body.signature;

  if (!telegramId || !wallet || !signature) {
    return corsJson({ error: "missing required params" }, 400);
  }

  // Verify the signature exists on-chain before persisting settings.
  const connection = new Connection(env.NEXT_PUBLIC_SOLANA_RPC_URL, "confirmed");
  try {
    const tx = await connection.getTransaction(signature, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });
    if (!tx) {
      return corsJson({ error: "transaction not found on-chain" }, 400);
    }
  } catch (err) {
    console.error("On-chain tx verification failed:", err);
    return corsJson({ error: "transaction verification failed" }, 400);
  }

  await persistSettings(telegramId, freq, amount, wallet, signature);

  // Send bot confirmation to user
  const [walletRecord, settings] = await Promise.all([
    getWallet(telegramId),
    getUserSettings(telegramId),
  ]);
  const balance = walletRecord ? await fetchUsdcBalance(walletRecord.walletAddress) : null;

  await sendBotMessage(telegramId, "✅ Settings updated.");

  if (walletRecord) {
    await sendBotMessage(
      telegramId,
      buildMetricsMessage(balance, walletRecord.walletAddress, settings?.fundingAmountUsd != null),
      { parse_mode: "Markdown", link_preview_options: { is_disabled: true } },
    );
  }

  const hasBalance = balance !== null && balance > 0;
  await sendBotMessage(telegramId, "What would you like to do?", {
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

  return corsJson({ type: "completed", message: "✅ Savings authorized!" });
}
