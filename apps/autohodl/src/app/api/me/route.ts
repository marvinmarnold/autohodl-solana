import { getIronSession } from "iron-session";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { type SessionData, sessionOptions } from "@/lib/session";
import { getSquadsVaultAddress } from "@/lib/squads";

export async function GET() {
  const session = await getIronSession<SessionData>(
    await cookies(),
    sessionOptions,
  );

  if (!session.telegramId || !session.walletAddress) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  // Re-derive vault address for existing sessions created before this change.
  const vaultAddress = session.vaultAddress ?? getSquadsVaultAddress(session.walletAddress);

  return NextResponse.json({
    telegramId: session.telegramId,
    walletAddress: vaultAddress,
  });
}
