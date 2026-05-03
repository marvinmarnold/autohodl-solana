import { type NextRequest, NextResponse } from "next/server";
import { Connection } from "@solana/web3.js";
import type { ActionGetResponse, ActionPostResponse } from "@solana/actions";
import { env } from "@/lib/env";
import { buildTokenApproveTransaction } from "@/lib/solana";

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

// Standard Blink POST: accepts { account } and returns unsigned transaction.
// Signing happens client-side (Telegram WebView via Privy React SDK, or any
// external Blink client).
export async function POST(req: NextRequest) {
  let account: string;
  try {
    const body = (await req.json().catch(() => ({}))) as { account?: string };
    const freq = req.nextUrl.searchParams.get("freq") ?? "weekly";
    const amt = Number(req.nextUrl.searchParams.get("amt") ?? req.nextUrl.searchParams.get("amount") ?? "20");

    if (!body.account) {
      return corsJson({ error: "account required" }, 400);
    }
    account = body.account;

    const connection = new Connection(env.SOLANA_RPC_URL, "confirmed");
    const txBase64 = await buildTokenApproveTransaction(
      account,
      env.AUTOHODL_DELEGATE_PUBKEY,
      connection,
    );

    const freqLabel = { daily: "day", weekly: "week", monthly: "month" }[freq] ?? "period";

    const response: ActionPostResponse = {
      type: "transaction",
      transaction: txBase64,
      message: `Authorize $${amt}/${freqLabel} autoHODL savings`,
    };
    return corsJson(response);
  } catch (err) {
    console.error("Failed to build authorize tx:", err);
    return corsJson({ error: "tx_build_failed" }, 500);
  }
}
