import { getIronSession } from "iron-session";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { generatePrivyJWT } from "@/lib/privy-jwt";
import { type SessionData, sessionOptions } from "@/lib/session";

export async function GET() {
  const session = await getIronSession<SessionData>(await cookies(), sessionOptions);
  if (!session.telegramId) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const token = await generatePrivyJWT(session.telegramId);
  return NextResponse.json({ token });
}
