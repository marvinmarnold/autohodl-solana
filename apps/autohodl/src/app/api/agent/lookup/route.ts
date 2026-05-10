import { type NextRequest, NextResponse } from "next/server";
import { getTelegramIdByWalletAddress, getUserSettings } from "@/lib/kv";
import { fetchUsdcBalance } from "@/lib/solana";

export async function GET(req: NextRequest) {
  const wallet = req.nextUrl.searchParams.get("wallet");
  if (!wallet) {
    return NextResponse.json({ error: "missing wallet param" }, { status: 400 });
  }

  const telegramId = await getTelegramIdByWalletAddress(wallet);
  if (!telegramId) {
    return NextResponse.json({ error: "wallet not found" }, { status: 404 });
  }

  const [settings, usdcBalance] = await Promise.all([
    getUserSettings(telegramId),
    fetchUsdcBalance(wallet),
  ]);

  return NextResponse.json({ telegramId, walletAddress: wallet, settings, usdcBalance });
}
