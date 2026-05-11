import { getPendingSettings, getUserSettings, setPendingSettings, setUserSettings } from "./kv";

export async function persistSettings(
  telegramId: string,
  freq: string,
  amt: number,
  _walletAddress: string,
  signature: string,
): Promise<void> {
  const savingsFields = {
    savingsFrequency: freq,
    savingsAmountUsd: amt,
    savingsStrategy: "reflect" as const,
    delegationTxSignature: signature,
    delegationSetAt: new Date().toISOString(),
  };

  // Write pending for the MoonPay confirmation flow.
  setPendingSettings(telegramId, savingsFields).catch(
    (err) => console.error("Pending settings save failed (non-fatal):", err),
  );

  // Immediately persist savings schedule, preserving any existing funding config.
  const [confirmed] = await Promise.all([getUserSettings(telegramId), getPendingSettings(telegramId)]);
  await setUserSettings(telegramId, {
    ...savingsFields,
    fundingFrequency: confirmed?.fundingFrequency,
    fundingAmountUsd: confirmed?.fundingAmountUsd,
    fundingConfiguredAt: confirmed?.fundingConfiguredAt,
  });
}
