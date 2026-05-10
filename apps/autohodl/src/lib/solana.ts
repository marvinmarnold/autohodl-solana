import { Connection, PublicKey, Transaction } from "@solana/web3.js";
import { createApproveInstruction, createTransferCheckedInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { env } from "./env";

export async function fetchUsdcBalance(walletAddress: string): Promise<number | null> {
  try {
    const connection = new Connection(env.NEXT_PUBLIC_SOLANA_RPC_URL, "confirmed");
    const mint  = new PublicKey(getUsdcMint());
    const owner = new PublicKey(walletAddress);
    const ata   = getAssociatedTokenAddressSync(mint, owner);
    const bal   = await connection.getTokenAccountBalance(ata);
    return bal.value.uiAmount ?? 0;
  } catch {
    return null;
  }
}

export function buildMetricsMessage(usdcBalance: number | null, walletAddress: string, hasFunding: boolean): string {
  const short = `${walletAddress.slice(0, 6)}…${walletAddress.slice(-6)}`;
  const cluster = env.SOLANA_NETWORK === "devnet" ? "?cluster=devnet" : "";
  const solscanUrl = `https://solscan.io/account/${walletAddress}${cluster}`;
  const balanceLine = usdcBalance !== null
    ? `💰 Saved: $${usdcBalance.toFixed(2)} USDC`
    : "💰 Saved: —";
  return [
    "📊 *Your savings*\n",
    balanceLine,
    "📈 Yield: ~5% APY via Reflect",
    hasFunding ? "✅ Automatic funding via MoonPay" : "❌ Automatic funding via MoonPay",
    `👛 [${short}](${solscanUrl})`,
  ].join("\n");
}

const USDC_MINT_BY_NETWORK: Record<"mainnet" | "devnet", string> = {
  mainnet: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  devnet: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
};

export function getUsdcMint(): string {
  return USDC_MINT_BY_NETWORK[env.SOLANA_NETWORK];
}

// Builds an unsigned SPL Token.approve transaction granting `delegate`
// authority over the user's USDC token account up to u64::MAX.
// Privy server-signing adds the user's signature before broadcast.
export async function buildTokenApproveTransaction(
  userWalletAddress: string,
  delegatePubkeyStr: string,
  connection: Connection,
): Promise<string> {
  const owner = new PublicKey(userWalletAddress);
  const delegate = new PublicKey(delegatePubkeyStr);
  const mint = new PublicKey(getUsdcMint());

  const tokenAccount = getAssociatedTokenAddressSync(mint, owner);

  const approveIx = createApproveInstruction(
    tokenAccount,
    delegate,
    owner,
    BigInt("18446744073709551615"), // u64::MAX — effectively unlimited
  );

  const { blockhash } = await connection.getLatestBlockhash();
  const tx = new Transaction();
  tx.recentBlockhash = blockhash;
  tx.feePayer = owner;
  tx.add(approveIx);

  const serialized = tx.serialize({ requireAllSignatures: false, verifySignatures: false });
  return serialized.toString("base64");
}

// Builds an unsigned SPL transfer_checked transaction moving USDC from the
// user's wallet to `toAddress`. The recipient ATA must already exist before
// this transaction is signed and broadcast.
export async function buildWithdrawTransaction(
  fromAddress: string,
  toAddress: string,
  amountUiUsdc: number,
  connection: Connection,
): Promise<string> {
  const USDC_DECIMALS = 6;
  const from = new PublicKey(fromAddress);
  const to = new PublicKey(toAddress);
  const mint = new PublicKey(getUsdcMint());
  const amountRaw = BigInt(Math.round(amountUiUsdc * 10 ** USDC_DECIMALS));

  const fromAta = getAssociatedTokenAddressSync(mint, from);
  const toAta = getAssociatedTokenAddressSync(mint, to);

  const ix = createTransferCheckedInstruction(
    fromAta,
    mint,
    toAta,
    from, // authority (owner of fromAta)
    amountRaw,
    USDC_DECIMALS,
  );

  const { blockhash } = await connection.getLatestBlockhash();
  const tx = new Transaction();
  tx.recentBlockhash = blockhash;
  tx.feePayer = from;
  tx.add(ix);

  return tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64");
}
