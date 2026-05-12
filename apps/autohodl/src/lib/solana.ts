import { Connection, Keypair, PublicKey, Transaction } from "@solana/web3.js";
import { createApproveInstruction, createTransferCheckedInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { env } from "./env";

const JUPITER_USDC_MAINNET = "9BEcn9aPEmhSPbPQeFGjidRiEKki46fVQDyPpSQXPA2D";

export function getJupiterUsdcMint(): string {
  return process.env.JUPITER_USDC ?? JUPITER_USDC_MAINNET;
}

// ownerAddress is the wallet that owns the vault — checked as a second location
// for Jupiter USDC since yield tokens may land there rather than in the vault.
export async function fetchUsdcBalance(vaultOrWallet: string, ownerAddress?: string): Promise<number | null> {
  try {
    const connection = new Connection(env.NEXT_PUBLIC_SOLANA_RPC_URL, "confirmed");

    async function usdcAta(address: string): Promise<number> {
      try {
        const owner = new PublicKey(address);
        // allowOwnerOffCurve=true so Squads vault PDAs are handled correctly.
        const ata = getAssociatedTokenAddressSync(new PublicKey(getUsdcMint()), owner, true);
        const bal = await connection.getTokenAccountBalance(ata);
        return bal.value.uiAmount ?? 0;
      } catch {
        return 0;
      }
    }

    // getParsedTokenAccountsByOwner handles off-curve owners and non-ATA accounts,
    // making it more robust than ATA derivation for yield tokens.
    async function jupiterUsdc(address: string): Promise<number> {
      try {
        const pub = new PublicKey(address);
        const mint = new PublicKey(getJupiterUsdcMint());
        const accounts = await connection.getParsedTokenAccountsByOwner(pub, { mint });
        return accounts.value.reduce((sum, a) => {
          // .parsed is typed `any` in @solana/web3.js — no typed alternative available.
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const uiAmount = (a.account.data as any).parsed.info.tokenAmount.uiAmount as number | null;
          return sum + (uiAmount ?? 0);
        }, 0);
      } catch {
        return 0;
      }
    }

    const addresses = ownerAddress && ownerAddress !== vaultOrWallet
      ? [vaultOrWallet, ownerAddress]
      : [vaultOrWallet];

    const [usdc, ...jupBalances] = await Promise.all([
      usdcAta(vaultOrWallet),
      ...addresses.map(jupiterUsdc),
    ]);
    return usdc + jupBalances.reduce((s, b) => s + b, 0);
  } catch {
    return null;
  }
}

function shortAddress(address: string): string {
  return `${address.slice(0, 4)}..${address.slice(-4)}`;
}

export function buildMetricsMessage(
  usdcBalance: number | null,
  vaultAddress: string,
  hasFunding: boolean,
  ownerAddress?: string,
): string {
  const cluster = env.SOLANA_NETWORK === "devnet" ? "?cluster=devnet" : "";
  const vaultUrl = `https://solscan.io/account/${vaultAddress}${cluster}`;
  const balanceLine = usdcBalance !== null
    ? `💰 Saved: $${usdcBalance.toFixed(2)} USDC`
    : "💰 Saved: —";
  const lines = [
    "📊 *Your savings*\n",
    balanceLine,
    "📈 Yield: ~5% APY via Reflect",
    hasFunding ? "✅ Automatic funding via MoonPay" : "❌ Automatic funding via MoonPay",
    `🏦 Vault: [${shortAddress(vaultAddress)}](${vaultUrl})`,
  ];
  if (ownerAddress) {
    const ownerUrl = `https://solscan.io/account/${ownerAddress}${cluster}`;
    lines.push(`👛 Owner: [${shortAddress(ownerAddress)}](${ownerUrl})`);
  }
  return lines.join("\n");
}

const USDC_MINT_BY_NETWORK: Record<"mainnet" | "devnet", string> = {
  mainnet: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  devnet: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
};

export function getUsdcMint(): string {
  return USDC_MINT_BY_NETWORK[env.SOLANA_NETWORK];
}

// Lamports required to create an ATA (rent-exempt minimum for a token account).
const ATA_RENT_LAMPORTS = BigInt(2_039_280);
// Keep at least 3× ATA cost as a headroom buffer to cover fees + multiple ops.
const SOL_WARN_THRESHOLD = ATA_RENT_LAMPORTS * BigInt(3);

/**
 * Asserts the funder has enough SOL and (optionally) enough USDC.
 * Throws with a clear actionable message if either balance is too low,
 * so the error surfaces immediately in logs instead of as a cryptic
 * on-chain "insufficient lamports" failure.
 */
export async function assertFunderSolvent(
  connection: Connection,
  funder: Keypair,
  requiredUsdcRaw?: bigint,
): Promise<void> {
  const pubkey = funder.publicKey;
  const label = `[FUNDER ${pubkey.toBase58()}]`;

  const solBalance = BigInt(await connection.getBalance(pubkey));
  if (solBalance < SOL_WARN_THRESHOLD) {
    throw new Error(
      `${label} LOW SOL: ${solBalance} lamports available, need ≥${SOL_WARN_THRESHOLD} (${Number(SOL_WARN_THRESHOLD) / 1e9} SOL). ` +
      `Top up at https://faucet.solana.com or run: solana airdrop 1 ${pubkey.toBase58()} --url devnet`,
    );
  }

  if (requiredUsdcRaw !== undefined) {
    const mint = new PublicKey(getUsdcMint());
    const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
    const accounts = await connection.getParsedTokenAccountsByOwner(pubkey, { programId: TOKEN_PROGRAM_ID });
    const mintStr = mint.toBase58();
    const ata = accounts.value.find(
      (a) => (a.account.data as { parsed: { info: { mint: string } } }).parsed.info.mint === mintStr,
    );
    const usdcBalance = ata
      ? BigInt((ata.account.data as { parsed: { info: { tokenAmount: { amount: string } } } }).parsed.info.tokenAmount.amount)
      : BigInt(0);
    if (usdcBalance < requiredUsdcRaw) {
      throw new Error(
        `${label} LOW USDC: ${usdcBalance} raw units available, need ${requiredUsdcRaw} (${Number(requiredUsdcRaw) / 1e6} USDC). ` +
        `Fund the funder's USDC token account on ${env.SOLANA_NETWORK}.`,
      );
    }
  }
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
