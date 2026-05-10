import { getIronSession } from "iron-session";
import { cookies } from "next/headers";
import { type NextRequest, NextResponse } from "next/server";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { getOrCreateAssociatedTokenAccount, transfer } from "@solana/spl-token";
import { env } from "@/lib/env";
import { redis, getUserSettings } from "@/lib/kv";
import { getUsdcMint } from "@/lib/solana";
import { type SessionData, sessionOptions } from "@/lib/session";

const AIRDROP_AMOUNT = BigInt(10_000); // 0.01 USDC (6 decimals)

export async function POST(req: NextRequest) {
  const session = await getIronSession<SessionData>(await cookies(), sessionOptions);
  if (!session.telegramId || !session.walletAddress) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  // Check MoonPay state — confirmed settings exist iff MoonPay has been set up before.
  const confirmedSettings = await getUserSettings(session.telegramId);
  const moonpayConfigured = confirmedSettings !== null;

  // Send the demo USDC once per user — deduped by telegramId.
  const airdropKey = `airdrop_sent:telegram:${session.telegramId}`;
  const alreadyAirdropped = await redis.get(airdropKey);
  let airdropStatus: "skipped" | "sent" | "failed" = "skipped";
  let airdropError: string | null = null;

  if (!alreadyAirdropped) {
    try {
      const connection = new Connection(env.NEXT_PUBLIC_SOLANA_RPC_URL, "confirmed");
      const funder = Keypair.fromSecretKey(Buffer.from(env.FUNDER_PRIVATE_KEY, "base64"));
      const recipient = new PublicKey(session.walletAddress);
      const usdcMint = new PublicKey(getUsdcMint());

      const rpcHost = new URL(env.NEXT_PUBLIC_SOLANA_RPC_URL).hostname;
      console.log("Airdrop: mint =", usdcMint.toBase58(), "network =", env.SOLANA_NETWORK, "rpc =", rpcHost);
      // Find funder's USDC token account — filter by program then match mint in JS,
      // avoiding the RPC-side mint validation that fails on cross-network setups.
      const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
      const funderAccounts = await connection.getParsedTokenAccountsByOwner(
        funder.publicKey,
        { programId: TOKEN_PROGRAM_ID },
      );
      const usdcMintStr = usdcMint.toBase58();
      console.log("Airdrop: funder token accounts found =", funderAccounts.value.length, funderAccounts.value.map(a => (a.account.data as {parsed:{info:{mint:string}}}).parsed.info.mint));
      const funderTokenAccount = funderAccounts.value.find(
        (a) => (a.account.data as { parsed: { info: { mint: string } } }).parsed.info.mint === usdcMintStr,
      );
      if (!funderTokenAccount) {
        throw new Error(`Funder has no USDC token account for mint ${usdcMintStr}`);
      }
      const funderAccountPubkey = funderTokenAccount.pubkey;
      const funderRawBalance = BigInt(
        (funderTokenAccount.account.data as { parsed: { info: { tokenAmount: { amount: string } } } })
          .parsed.info.tokenAmount.amount,
      );
      console.log("Airdrop: funder =", funder.publicKey.toBase58(), "account =", funderAccountPubkey.toBase58(), "balance =", funderRawBalance.toString(), "recipient =", session.walletAddress);

      if (funderRawBalance < AIRDROP_AMOUNT) {
        throw new Error(`Funder has insufficient USDC: ${funderRawBalance}`);
      }

      // Create recipient ATA if needed — funder pays SOL for rent.
      const recipientAta = await getOrCreateAssociatedTokenAccount(
        connection,
        funder,
        usdcMint,
        recipient,
      );
      await transfer(
        connection,
        funder,
        funderAccountPubkey,
        recipientAta.address,
        funder,
        AIRDROP_AMOUNT,
      );
      await redis.set(airdropKey, "1");
      airdropStatus = "sent";
      console.log("Airdrop: sent", AIRDROP_AMOUNT.toString(), "to", session.walletAddress);
    } catch (err) {
      airdropStatus = "failed";
      const msg = err instanceof Error ? err.message : String(err);
      // SendTransactionError attaches simulation logs that explain the real failure.
      const logs = (err as { logs?: string[] }).logs;
      airdropError = logs ? `${msg}\nLogs: ${logs.join(" | ")}` : (msg || JSON.stringify(err));
      console.error("Airdrop failed:", airdropError);
    }
  }

  return NextResponse.json({
    walletAddress: session.walletAddress,
    moonpayConfigured,
    fundingAmountUsd: confirmedSettings?.fundingAmountUsd ?? null,
    fundingFrequency: confirmedSettings?.fundingFrequency ?? null,
    airdropStatus,
    airdropError,
  });
}
