import { getIronSession } from "iron-session";
import { cookies } from "next/headers";
import { type NextRequest, NextResponse } from "next/server";
import { getPendingSettings, setUserSettings, getUserSettings } from "@/lib/kv";
import { type SessionData, sessionOptions } from "@/lib/session";

export async function POST(req: NextRequest) {
  void req;
  const session = await getIronSession<SessionData>(await cookies(), sessionOptions);
  if (!session.telegramId || !session.walletAddress) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  // Promote pending → confirmed, stamping funding schedule to match savings schedule.
  const confirmed = await getUserSettings(session.telegramId);
  const pending = await getPendingSettings(session.telegramId);
  if (pending) {
    await setUserSettings(session.telegramId, {
      ...(confirmed ?? pending),
      savingsFrequency: pending.savingsFrequency,
      savingsAmountUsd: pending.savingsAmountUsd,
      savingsStrategy: pending.savingsStrategy,
      delegationTxSignature: pending.delegationTxSignature,
      delegationSetAt: pending.delegationSetAt,
      fundingFrequency: pending.savingsFrequency,
      fundingAmountUsd: pending.savingsAmountUsd,
      fundingConfiguredAt: new Date().toISOString(),
    });
  }

  return NextResponse.json({ success: true });
}
