import { getIronSession } from "iron-session";
import { cookies } from "next/headers";
import { type NextRequest, NextResponse } from "next/server";
import { Connection } from "@solana/web3.js";
import type { ActionGetResponse } from "@solana/actions";
import { env } from "@/lib/env";
import { signAndSendSolanaTransaction } from "@/lib/privy";
import { buildTokenApproveTransaction } from "@/lib/solana";
import { persistSettings } from "@/lib/settings";
import { type SessionData, sessionOptions } from "@/lib/session";
import { getTelegramIdByWalletAddress } from "@/lib/kv";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "X-Action-Version": "2.1.3",
  "X-Blockchain-Ids": "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
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
    icon: `${env.NEXT_PUBLIC_MINI_APP_URL}/icon.svg`,
    description: `Allow autoHODL to save $${amt} per ${freqLabel} with the highest earning yield provider.`,
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
  const url = req.nextUrl;
  const body = (await req.json().catch(() => ({}))) as {
    account?: string;
    freq?: string;
    amt?: number;
    amount?: number;
  };

  // Mode 1: iron-session (Privy-managed wallets, WebView flow)
  const session = await getIronSession<SessionData>(await cookies(), sessionOptions);
  const isSessionAuth = !!(session.telegramId && session.privyWalletId);

  // Mode 2: telegramId query param + account in body (external wallets, Action link / agent flow)
  const telegramIdParam = url.searchParams.get("telegramId");
  const isParamAuth = !!telegramIdParam && !isSessionAuth;

  // Mode 3: cold open from a Blinks-aware browser — look up telegramId by wallet address.
  // telegramId may be null if the wallet has never been linked via the bot; the confirm
  // route handles that case gracefully (saves settings, skips bot notification).
  const accountFromBody = body.account ?? "";
  const isColdOpen = !isSessionAuth && !isParamAuth && !!accountFromBody;
  const coldTelegramId = isColdOpen
    ? await getTelegramIdByWalletAddress(accountFromBody)
    : null;

  if (!isSessionAuth && !isParamAuth && !isColdOpen) {
    return corsJson({ error: "unauthenticated" }, 401);
  }

  const telegramId = isSessionAuth
    ? session.telegramId!
    : isParamAuth
      ? telegramIdParam!
      : coldTelegramId; // null = wallet-only cold open, no bot link yet
  const walletAddress = isSessionAuth ? session.walletAddress : accountFromBody;
  const vaultAddress = isSessionAuth ? (session.vaultAddress ?? walletAddress) : walletAddress;
  const privyWalletId = isSessionAuth ? session.privyWalletId : null;

  if (!walletAddress) {
    return corsJson({ error: "missing account" }, 400);
  }

  const freq = body.freq ?? url.searchParams.get("freq") ?? "weekly";
  const amt = Number(body.amount ?? body.amt ?? url.searchParams.get("amount") ?? url.searchParams.get("amt") ?? "20");
  const freqLabel = { daily: "day", weekly: "week", monthly: "month" }[freq] ?? "period";

  const connection = new Connection(env.NEXT_PUBLIC_SOLANA_RPC_URL, "confirmed");

  let txBase64: string;
  try {
    txBase64 = await buildTokenApproveTransaction(walletAddress, env.AUTOHODL_DELEGATE_PUBKEY, connection);
  } catch (err) {
    console.error("Failed to build approve tx:", err);
    return corsJson({ error: "tx_build_failed" }, 500);
  }

  if (isSessionAuth && privyWalletId) {
    // Privy mode: sign server-side, broadcast, persist, return result
    let txSignature: string;
    try {
      txSignature = await signAndSendSolanaTransaction(privyWalletId, txBase64, connection);
    } catch (err) {
      console.error("Privy signing failed:", err);
      return corsJson({ error: "signing_failed" }, 502);
    }

    await persistSettings(telegramId!, freq, amt, walletAddress, txSignature);

    return corsJson({
      type: "transaction",
      transaction: txBase64,
      message: `Authorized $${amt}/${freqLabel} savings. Tx: ${txSignature}`,
      moonpayUrl: buildMoonpayUrl(vaultAddress, freq, amt),
      walletAddress: vaultAddress,
    });
  }

  // External wallet mode: return unsigned tx — client signs + broadcasts.
  // Blockhash validity is ~60s; if client gets blockhash-expired, re-call POST.
  const confirmParams = new URLSearchParams({ freq, amount: String(amt), wallet: walletAddress });
  if (telegramId) confirmParams.set("telegramId", telegramId);
  return corsJson({
    type: "transaction",
    transaction: txBase64,
    message: `Authorize autoHODL to save $${amt}/${freqLabel}`,
    links: {
      next: { type: "post", href: `/api/actions/authorize/confirm?${confirmParams}` },
    },
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
  url.searchParams.set("currencyCode", apiKey.startsWith("pk_test_") ? "sol" : "usdc_sol");
  url.searchParams.set("walletAddress", walletAddress);
  url.searchParams.set("baseCurrencyCode", "usd");
  url.searchParams.set("baseCurrencyAmount", String(amt));
  url.searchParams.set("redirectUrl", successUrl.toString());
  return url.toString();
}
