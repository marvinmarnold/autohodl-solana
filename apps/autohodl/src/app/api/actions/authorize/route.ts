import { getIronSession } from "iron-session";
import { cookies } from "next/headers";
import { type NextRequest, NextResponse } from "next/server";
import { Connection } from "@solana/web3.js";
import type { ActionGetResponse } from "@solana/actions";
import { env } from "@/lib/env";
import { signAndSendSolanaTransaction } from "@/lib/privy";
import { getPendingSettings, getUserSettings, setPendingSettings, setUserSettings } from "@/lib/kv";
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

  let txSignature: string;
  try {
    txSignature = await signAndSendSolanaTransaction(session.privyWalletId, txBase64, connection);
  } catch (err) {
    console.error("Privy signing failed:", err);
    return corsJson({ error: "signing_failed" }, 502);
  }

  const savingsFields = {
    savingsFrequency: freq,
    savingsAmountUsd: amt,
    savingsStrategy: "reflect" as const,
    delegationTxSignature: txSignature,
    delegationSetAt: new Date().toISOString(),
  };

  // Write pending for the MoonPay confirmation flow.
  setPendingSettings(session.telegramId, savingsFields).catch(
    (err) => console.error("Pending settings save failed (non-fatal):", err),
  );

  // Immediately persist savings schedule to confirmed settings so /start
  // reflects the new values even if the user never completes MoonPay.
  // Preserve any existing funding config.
  Promise.all([getUserSettings(session.telegramId), getPendingSettings(session.telegramId)])
    .then(([confirmed]) => {
      return setUserSettings(session.telegramId, {
        ...savingsFields,
        fundingFrequency: confirmed?.fundingFrequency,
        fundingAmountUsd: confirmed?.fundingAmountUsd,
        fundingConfiguredAt: confirmed?.fundingConfiguredAt,
      });
    })
    .catch((err) => console.error("Confirmed settings update failed (non-fatal):", err));

  // Build MoonPay URL — client will redirect to this after signing
  const moonpayUrl = buildMoonpayUrl(session.walletAddress, freq, amt);

  return corsJson({
    type: "transaction",
    transaction: txBase64,
    message: `Authorized $${amt}/${freqLabel} savings. Tx: ${txSignature}`,
    moonpayUrl,
    walletAddress: session.walletAddress,
  });
}

function buildMoonpayUrl(walletAddress: string, freq: string, amt: number): string | null {
  const apiKey = process.env["NEXT_PUBLIC_MOONPAY_API_KEY"];
  if (!apiKey) return null;

  const successUrl = new URL(`${env.NEXT_PUBLIC_MINI_APP_URL}/actions/authorize/success`);
  successUrl.searchParams.set("freq", freq);
  successUrl.searchParams.set("amt", String(amt));

  const url = new URL("https://buy.moonpay.com");
  url.searchParams.set("apiKey", apiKey);
  // usdc_sol has supportsTestMode:false — use sol for sandbox, usdc_sol for live
  url.searchParams.set("currencyCode", apiKey.startsWith("pk_test_") ? "sol" : "usdc_sol");
  url.searchParams.set("walletAddress", walletAddress);
  url.searchParams.set("baseCurrencyCode", "usd");
  url.searchParams.set("baseCurrencyAmount", String(amt));
  url.searchParams.set("redirectUrl", successUrl.toString());
  return url.toString();
}
