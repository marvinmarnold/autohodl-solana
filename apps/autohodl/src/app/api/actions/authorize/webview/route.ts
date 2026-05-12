import { getIronSession } from "iron-session";
import { cookies } from "next/headers";
import { type NextRequest, NextResponse } from "next/server";
import { Connection } from "@solana/web3.js";
import type { ActionGetResponse } from "@solana/actions";
import { env } from "@/lib/env";
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
  const amt = Number(req.nextUrl.searchParams.get("amount") ?? "20");
  const freqLabel = { daily: "day", weekly: "week", monthly: "month" }[freq] ?? "period";

  const response: ActionGetResponse = {
    title: "Authorize autoHODL savings",
    icon: `${env.NEXT_PUBLIC_MINI_APP_URL}/autohodl-solana.jpg`,
    description: `Allow autoHODL to save $${amt} per ${freqLabel} with the highest earning yield provider.`,
    label: "Authorize",
    links: {
      actions: [
        {
          label: "Confirm",
          href: `/api/actions/authorize/webview?freq=${freq}&amount=${amt}`,
          type: "transaction",
        },
      ],
    },
  };

  return corsJson(response);
}

// Returns an UNSIGNED transaction for the PrivyServerAdapter to sign.
// Signing and broadcasting are handled by /api/actions/sign.
export async function POST(req: NextRequest) {
  const session = await getIronSession<SessionData>(await cookies(), sessionOptions);
  if (!session.telegramId || !session.walletAddress) {
    return corsJson({ error: "unauthenticated" }, 401);
  }

  const freq = req.nextUrl.searchParams.get("freq") ?? "weekly";
  const amt = Number(req.nextUrl.searchParams.get("amount") ?? "20");
  const freqLabel = { daily: "day", weekly: "week", monthly: "month" }[freq] ?? "period";

  const connection = new Connection(env.NEXT_PUBLIC_SOLANA_RPC_URL, "confirmed");

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

  return corsJson({
    type: "transaction",
    transaction: txBase64,
    message: `Authorize autoHODL to save $${amt}/${freqLabel}`,
  });
}
