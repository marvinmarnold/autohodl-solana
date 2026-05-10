import { Connection, PublicKey, Transaction } from "@solana/web3.js";
import { createApproveInstruction, createTransferCheckedInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { env } from "./env";

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
