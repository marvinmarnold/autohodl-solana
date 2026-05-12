import { type NextRequest, NextResponse } from "next/server";
import { getTelegramIdByWalletAddress, getUserSettings } from "@/lib/kv";
import { fetchUsdcBalance } from "@/lib/solana";
import { getSquadsVaultAddress } from "@/lib/squads";

export async function GET(req: NextRequest) {
  const wallet = req.nextUrl.searchParams.get("wallet");
  if (!wallet) {
    return NextResponse.json({ error: "missing wallet param" }, { status: 400 });
  }

  const telegramId = await getTelegramIdByWalletAddress(wallet);
  if (!telegramId) {
    return NextResponse.json({ error: "wallet not found" }, { status: 404 });
  }

  const vaultAddress = getSquadsVaultAddress(wallet);
  const [settings, walletUsdcBalance, vaultUsdcBalance] = await Promise.all([
    getUserSettings(telegramId),
    fetchUsdcBalance(wallet),
    fetchUsdcBalance(vaultAddress),
  ]);

  return NextResponse.json({
    telegramId,
    walletAddress: wallet,
    vaultAddress,
    settings,
    walletUsdcBalance,
    vaultUsdcBalance,
    // Back-compat: keep the original `usdcBalance` field pointed at the vault,
    // since that's where production funds actually live.
    usdcBalance: vaultUsdcBalance,
  });
}
