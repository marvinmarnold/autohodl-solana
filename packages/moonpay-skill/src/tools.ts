import { processAction } from "@autohodl/solana-action-client";

// MoonPay CLI exposes a signing capability that agents can call.
// This is the interface we expect the host to inject.
export type MoonPaySigner = {
  signAndBroadcast: (txBase64: string, rpcUrl?: string) => Promise<string>;
};

type LookupResult = {
  telegramId: string;
  walletAddress: string;
  settings: {
    savingsFrequency: string;
    savingsAmountUsd: number;
    fundingFrequency?: string;
    fundingAmountUsd?: number;
  } | null;
  usdcBalance: number | null;
} | null;

export async function autohodlLookup(
  walletAddress: string,
  apiUrl: string,
): Promise<LookupResult> {
  const res = await fetch(`${apiUrl}/api/agent/lookup?wallet=${encodeURIComponent(walletAddress)}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`lookup failed: ${res.status}`);
  return res.json() as Promise<LookupResult>;
}

export async function autohodlStatus(
  walletAddress: string,
  apiUrl: string,
): Promise<LookupResult> {
  return autohodlLookup(walletAddress, apiUrl);
}

export type ProcessSolanaActionOpts = {
  actionUrl: string;
  account: string;
  params?: Record<string, unknown>;
  rpcUrl?: string;
  signer: MoonPaySigner;
};

export async function processSolanaAction(opts: ProcessSolanaActionOpts) {
  return processAction({
    actionUrl: opts.actionUrl,
    account: opts.account,
    params: opts.params,
    rpcUrl: opts.rpcUrl,
    sign: (txBase64) => opts.signer.signAndBroadcast(txBase64, opts.rpcUrl),
  });
}
