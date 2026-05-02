import { Connection, PublicKey, Transaction } from "@solana/web3.js";
import { createApproveInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";

const USDC_MINT: Record<"mainnet" | "devnet", string> = {
  mainnet: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  devnet: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
};

function getUsdcMint(rpcEndpoint: string): PublicKey {
  const network = rpcEndpoint.includes("devnet") ? "devnet" : "mainnet";
  return new PublicKey(USDC_MINT[network]);
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
  const mint = getUsdcMint(connection.rpcEndpoint);

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
