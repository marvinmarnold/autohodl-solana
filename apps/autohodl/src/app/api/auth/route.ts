import { getIronSession } from "iron-session";
import { cookies } from "next/headers";
import { type NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/env";
import { WalletPregenerationError, pregenerateWallet } from "@/lib/privy";
import { type SessionData, sessionOptions } from "@/lib/session";
import { InvalidInitDataError, validateInitData } from "@/lib/telegram";

export async function POST(req: NextRequest) {
  // Parse body
  let initData: string;
  try {
    const body: unknown = await req.json();
    if (
      typeof body !== "object" ||
      body === null ||
      !("initData" in body) ||
      typeof (body as Record<string, unknown>)["initData"] !== "string"
    ) {
      return NextResponse.json({ error: "invalid_request" }, { status: 400 });
    }
    initData = (body as { initData: string }).initData;
    if (!initData) {
      return NextResponse.json({ error: "invalid_request" }, { status: 400 });
    }
  } catch {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  // Validate initData HMAC
  let telegramId: string;
  try {
    const user = await validateInitData(initData, env.TELEGRAM_BOT_TOKEN);
    telegramId = String(user.id);
  } catch (err) {
    if (err instanceof InvalidInitDataError) {
      return NextResponse.json({ error: "invalid_initdata" }, { status: 401 });
    }
    throw err;
  }

  // Pregen wallet (idempotent)
  let privyUserId: string;
  let walletAddress: string;
  try {
    ({ privyUserId, walletAddress } = await pregenerateWallet(telegramId));
  } catch (err) {
    if (err instanceof WalletPregenerationError) {
      console.error("Privy pregeneration error:", err);
      return NextResponse.json(
        { error: "wallet_creation_failed" },
        { status: 502 },
      );
    }
    throw err;
  }

  // Set session cookie
  const session = await getIronSession<SessionData>(await cookies(), sessionOptions);
  session.telegramId = telegramId;
  session.privyUserId = privyUserId;
  session.walletAddress = walletAddress;
  await session.save();

  return NextResponse.json({ walletAddress });
}
