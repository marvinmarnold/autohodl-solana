import { getIronSession } from "iron-session";
import { cookies } from "next/headers";
import { type NextRequest, NextResponse } from "next/server";
import { ComputeBudgetProgram, Connection, Keypair, PublicKey, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  TokenAccountNotFoundError,
  TokenInvalidAccountOwnerError,
  createAssociatedTokenAccountInstruction,
  createTransferInstruction,
  getAccount,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { env } from "@/lib/env";
import { redis, getUserSettings } from "@/lib/kv";
import { assertFunderSolvent, getUsdcMint } from "@/lib/solana";
import { type SessionData, sessionOptions } from "@/lib/session";
import { getSquadsVaultAddress } from "@/lib/squads";

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
      // Send to the Squads vault, not the Privy signer wallet.
      const vaultAddress = session.vaultAddress ?? getSquadsVaultAddress(session.walletAddress);
      const recipient = new PublicKey(vaultAddress);
      const usdcMint = new PublicKey(getUsdcMint());

      const rpcHost = new URL(env.NEXT_PUBLIC_SOLANA_RPC_URL).hostname;
      console.log("Airdrop: mint =", usdcMint.toBase58(), "network =", env.SOLANA_NETWORK, "rpc =", rpcHost, "vault =", vaultAddress, "owner =", session.walletAddress);

      // Pre-flight: fail fast with a clear message if funder is low on SOL or USDC.
      await assertFunderSolvent(connection, funder, AIRDROP_AMOUNT);

      // Resolve funder's USDC token account for the transfer call below.
      const funderAccounts = await connection.getParsedTokenAccountsByOwner(
        funder.publicKey,
        { programId: TOKEN_PROGRAM_ID },
      );
      const usdcMintStr = usdcMint.toBase58();
      const funderTokenAccount = funderAccounts.value.find(
        (a) => (a.account.data as { parsed: { info: { mint: string } } }).parsed.info.mint === usdcMintStr,
      );
      if (!funderTokenAccount) {
        throw new Error(`Funder has no USDC token account for mint ${usdcMintStr}`);
      }
      const funderAccountPubkey = funderTokenAccount.pubkey;

      // Priority fee — required on mainnet for reliable transaction landing.
      const priorityFee = ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 100_000 });

      // Create recipient ATA with priority fee if it doesn't exist yet.
      // (allowOwnerOffCurve implicitly handled by getAssociatedTokenAddressSync with allowOwnerOffCurve=true)
      const recipientAtaAddress = getAssociatedTokenAddressSync(usdcMint, recipient, true);
      try {
        await getAccount(connection, recipientAtaAddress);
      } catch (err) {
        if (err instanceof TokenAccountNotFoundError || err instanceof TokenInvalidAccountOwnerError) {
          const { blockhash: createBlockhash } = await connection.getLatestBlockhash();
          const createAtaTx = new Transaction();
          createAtaTx.recentBlockhash = createBlockhash;
          createAtaTx.feePayer = funder.publicKey;
          createAtaTx.add(
            priorityFee,
            createAssociatedTokenAccountInstruction(
              funder.publicKey,
              recipientAtaAddress,
              recipient,
              usdcMint,
              TOKEN_PROGRAM_ID,
              ASSOCIATED_TOKEN_PROGRAM_ID,
            ),
          );
          await sendAndConfirmTransaction(connection, createAtaTx, [funder], { commitment: "confirmed" });
        } else {
          throw err;
        }
      }

      // Transfer USDC to recipient ATA with priority fee.
      const { blockhash } = await connection.getLatestBlockhash();
      const transferTx = new Transaction();
      transferTx.recentBlockhash = blockhash;
      transferTx.feePayer = funder.publicKey;
      transferTx.add(
        priorityFee,
        createTransferInstruction(funderAccountPubkey, recipientAtaAddress, funder.publicKey, AIRDROP_AMOUNT),
      );
      await sendAndConfirmTransaction(connection, transferTx, [funder], { commitment: "confirmed" });
      await redis.set(airdropKey, "1");
      airdropStatus = "sent";
      console.log("Airdrop: sent", AIRDROP_AMOUNT.toString(), "to vault", vaultAddress);
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
    walletAddress: session.vaultAddress ?? session.walletAddress,
    moonpayConfigured,
    fundingAmountUsd: confirmedSettings?.fundingAmountUsd ?? null,
    fundingFrequency: confirmedSettings?.fundingFrequency ?? null,
    airdropStatus,
    airdropError,
  });
}
