import { getIronSession } from "iron-session";
import { cookies } from "next/headers";
import { type NextRequest, NextResponse } from "next/server";
import { Connection, Keypair, PublicKey, Transaction } from "@solana/web3.js";
import {
  createApproveInstruction,
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { env } from "@/lib/env";
import { persistSettings } from "@/lib/settings";
import { type SessionData, sessionOptions } from "@/lib/session";
import { assertFunderSolvent, getUsdcMint } from "@/lib/solana";
import { notifyBotAuthorizationComplete } from "@/lib/bot-notify";

export async function POST(req: NextRequest) {
  const session = await getIronSession<SessionData>(await cookies(), sessionOptions);
  if (!session.telegramId || !session.privyWalletId || !session.walletAddress) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const freq = req.nextUrl.searchParams.get("freq") ?? "weekly";
  const amount = Number(req.nextUrl.searchParams.get("amount") ?? "20");

  const connection = new Connection(env.NEXT_PUBLIC_SOLANA_RPC_URL, "confirmed");
  const funder = Keypair.fromSecretKey(Buffer.from(env.FUNDER_PRIVATE_KEY, "base64"));

  try {
    await assertFunderSolvent(connection, funder);
  } catch (err) {
    console.error("Funder balance check failed:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "funder_insufficient_funds" }, { status: 503 });
  }

  const owner = new PublicKey(session.walletAddress);
  const delegate = new PublicKey(env.AUTOHODL_DELEGATE_PUBKEY);
  const mint = new PublicKey(getUsdcMint());
  const tokenAccount = getAssociatedTokenAddressSync(mint, owner);

  // Build tx with funder as fee payer — user wallet needs no SOL.
  const { blockhash } = await connection.getLatestBlockhash();
  const tx = new Transaction();
  tx.recentBlockhash = blockhash;
  tx.feePayer = funder.publicKey;

  // Create the USDC ATA for the user if it doesn't exist yet.
  const ataInfo = await connection.getAccountInfo(tokenAccount);
  if (!ataInfo) {
    tx.add(
      createAssociatedTokenAccountInstruction(
        funder.publicKey, // pays rent for the new account
        tokenAccount,
        owner,
        mint,
      ),
    );
  }

  tx.add(
    createApproveInstruction(
      tokenAccount,
      delegate,
      owner,
      BigInt("18446744073709551615"), // u64::MAX — unlimited delegation
    ),
  );

  const txBase64 = tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64");

  let signature: string;
  try {
    // Privy signs with the user wallet (authority on the approve instruction).
    // We then add the funder's signature (fee payer) before broadcasting.
    signature = await signWithPrivyThenFunder(session.privyWalletId, txBase64, funder, connection);
  } catch (err) {
    console.error("Signing failed:", err);
    return NextResponse.json({ error: "signing_failed" }, { status: 502 });
  }

  await persistSettings(session.telegramId, freq, amount, session.walletAddress, signature);
  await notifyBotAuthorizationComplete(session.telegramId);

  return NextResponse.json({ signature, walletAddress: session.walletAddress });
}

async function signWithPrivyThenFunder(
  privyWalletId: string,
  txBase64: string,
  funder: Keypair,
  connection: Connection,
): Promise<string> {
  const credentials = Buffer.from(`${env.PRIVY_APP_ID}:${env.PRIVY_APP_SECRET}`).toString("base64");
  const res = await fetch(`https://api.privy.io/v1/wallets/${privyWalletId}/rpc`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "privy-app-id": env.PRIVY_APP_ID,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      method: "signTransaction",
      params: { transaction: txBase64, encoding: "base64" },
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "(unreadable)");
    throw new Error(`Privy sign failed: ${res.status} — ${body}`);
  }

  const data = (await res.json()) as { data: { signed_transaction: string } };

  // Privy returns the tx signed by the user wallet. Add funder's signature
  // (fee payer + ATA creation payer) before broadcasting.
  const signedTx = Transaction.from(Buffer.from(data.data.signed_transaction, "base64"));
  signedTx.partialSign(funder);

  const signature = await connection.sendRawTransaction(signedTx.serialize(), {
    skipPreflight: true,
  });
  console.log("Transaction broadcast:", signature);
  return signature;
}
