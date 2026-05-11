import { PublicKey } from "@solana/web3.js";
import { getMultisigPda, getVaultPda } from "@sqds/multisig";

/**
 * Derives the Squads v4 vault address for a given Privy embedded wallet.
 * We use the Privy wallet as the createKey so the vault is fully deterministic —
 * no extra storage needed.
 */
export function getSquadsVaultAddress(privyWalletAddress: string): string {
  const createKey = new PublicKey(privyWalletAddress);
  const [multisigPda] = getMultisigPda({ createKey });
  const [vaultPda] = getVaultPda({ multisigPda, index: 0 });
  return vaultPda.toBase58();
}
