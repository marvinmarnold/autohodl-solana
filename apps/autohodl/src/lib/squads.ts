import {
  ComputeBudgetProgram,
  Connection,
  PublicKey,
  Transaction,
} from "@solana/web3.js";
import * as multisig from "@sqds/multisig";
import { env } from "./env";
import { getUsdcMint } from "./solana";

/**
 * Derives the Squads v4 vault address for a given wallet (Privy or external).
 * We use the wallet as the createKey so the vault is fully deterministic —
 * no extra storage needed.
 */
export function getSquadsVaultAddress(walletAddress: string): string {
  const createKey = new PublicKey(walletAddress);
  const [multisigPda] = multisig.getMultisigPda({ createKey });
  const [vaultPda] = multisig.getVaultPda({ multisigPda, index: 0 });
  return vaultPda.toBase58();
}

const PERIOD_BY_FREQUENCY: Record<string, multisig.generated.Period> = {
  daily: multisig.generated.Period.Day,
  weekly: multisig.generated.Period.Week,
  monthly: multisig.generated.Period.Month,
};

/**
 * Builds the autoHODL "authorize" transaction for the agent/MoonPay flow:
 *
 *   1. Initialize a Squads v4 multisig with the wallet as sole member + config authority.
 *   2. Register autoHODL's delegate pubkey as a constrained spending-limit on the vault's
 *      USDC mint, capped at `savingsAmountUsd` per `frequency` period.
 *
 * One signature (the wallet) handles both instructions. The wallet retains full control;
 * autoHODL can only pull up to the configured limit, on the configured cadence.
 */
export async function buildSquadsAuthorizeTransaction(
  walletAddress: string,
  savingsAmountUsd: number,
  frequency: string,
  connection: Connection,
): Promise<string> {
  const wallet = new PublicKey(walletAddress);
  const usdcMint = new PublicKey(getUsdcMint());
  const delegate = new PublicKey(env.AUTOHODL_DELEGATE_PUBKEY);

  const [multisigPda] = multisig.getMultisigPda({ createKey: wallet });
  const [spendingLimitPda] = multisig.getSpendingLimitPda({
    multisigPda,
    createKey: wallet,
  });

  // Treasury is stored in the Squads program-config account on chain.
  const [programConfigPda] = multisig.getProgramConfigPda({});
  const programConfig = await multisig.accounts.ProgramConfig.fromAccountAddress(
    connection,
    programConfigPda,
  );
  const treasury = programConfig.treasury;

  const createIx = multisig.instructions.multisigCreateV2({
    treasury,
    creator: wallet,
    multisigPda,
    // Wallet as configAuthority lets us add the spending limit in the same tx
    // without going through propose/approve/execute. The user retains full control.
    configAuthority: wallet,
    threshold: 1,
    members: [{ key: wallet, permissions: multisig.types.Permissions.all() }],
    timeLock: 0,
    createKey: wallet,
    rentCollector: null,
  });

  const period = PERIOD_BY_FREQUENCY[frequency] ?? multisig.generated.Period.Day;
  const amountRaw = BigInt(Math.round(savingsAmountUsd * 1_000_000)); // USDC has 6 decimals

  const spendingLimitIx = multisig.instructions.multisigAddSpendingLimit({
    multisigPda,
    configAuthority: wallet,
    spendingLimit: spendingLimitPda,
    rentPayer: wallet,
    createKey: wallet,
    vaultIndex: 0,
    mint: usdcMint,
    amount: amountRaw,
    period,
    members: [delegate],
    destinations: [], // empty = any destination allowed
  });

  // Priority fee — mainnet reliability.
  const priorityFee = ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 100_000 });

  const { blockhash } = await connection.getLatestBlockhash();
  const tx = new Transaction();
  tx.recentBlockhash = blockhash;
  tx.feePayer = wallet;
  tx.add(priorityFee, createIx, spendingLimitIx);

  const serialized = tx.serialize({ requireAllSignatures: false, verifySignatures: false });
  return serialized.toString("base64");
}
