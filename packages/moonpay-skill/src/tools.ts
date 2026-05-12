import { prepareAction, confirmAction } from "@autohodl/solana-action-client";

type LookupResult = {
  telegramId: string;
  walletAddress: string;
  vaultAddress: string;
  settings: {
    savingsFrequency: string;
    savingsAmountUsd: number;
    fundingFrequency?: string;
    fundingAmountUsd?: number;
  } | null;
  walletUsdcBalance: number | null;
  vaultUsdcBalance: number | null;
  /** @deprecated alias of vaultUsdcBalance — funds in production live in the vault. */
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

export type PrepareToolInput = {
  actionUrl: string;
  account: string;
  params?: Record<string, unknown>;
};

export async function prepareActionTool(input: PrepareToolInput) {
  return prepareAction({
    actionUrl: input.actionUrl,
    account: input.account,
    params: input.params,
  });
}

export type ConfirmToolInput = {
  confirmUrl: string;
  signature: string;
};

export async function confirmActionTool(input: ConfirmToolInput) {
  return confirmAction(input.confirmUrl, input.signature);
}
