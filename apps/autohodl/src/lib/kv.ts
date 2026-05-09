import Redis from "ioredis";

if (!process.env["REDIS_URL"]) throw new Error("Missing required environment variable: REDIS_URL");

export const redis = new Redis(process.env["REDIS_URL"]);

export type WalletRecord = {
  walletId: string;
  walletAddress: string;
  privyUserId: string;
};

export type UserSettings = {
  // What autoHODL withdraws from the wallet on each cycle.
  savingsFrequency: string;
  savingsAmountUsd: number;
  savingsStrategy: "reflect";
  delegationTxSignature: string;
  delegationSetAt: string;
  // What MoonPay sends into the wallet — populated after MoonPay is confirmed.
  // If absent, funding has never been configured.
  fundingFrequency?: string;
  fundingAmountUsd?: number;
  fundingConfiguredAt?: string;
};

export function settingsInSync(s: UserSettings): boolean {
  return (
    s.fundingFrequency === s.savingsFrequency &&
    s.fundingAmountUsd === s.savingsAmountUsd
  );
}

export async function getWallet(telegramId: string): Promise<WalletRecord | null> {
  const raw = await redis.get(`wallet:telegram:${telegramId}`);
  if (!raw) return null;
  return JSON.parse(raw) as WalletRecord;
}

export async function setWallet(telegramId: string, record: WalletRecord): Promise<void> {
  await redis.set(`wallet:telegram:${telegramId}`, JSON.stringify(record));
}

// Pending: written when Token.approve is signed. Funding fields are absent
// until the user confirms MoonPay is set up.
export async function setPendingSettings(telegramId: string, settings: UserSettings): Promise<void> {
  await redis.set(`settings:pending:telegram:${telegramId}`, JSON.stringify(settings));
}

export async function getPendingSettings(telegramId: string): Promise<UserSettings | null> {
  const raw = await redis.get(`settings:pending:telegram:${telegramId}`);
  if (!raw) return null;
  return JSON.parse(raw) as UserSettings;
}

// Confirmed: only written after MoonPay is confirmed. Absence = MoonPay never configured.
export async function getUserSettings(telegramId: string): Promise<UserSettings | null> {
  const raw = await redis.get(`settings:telegram:${telegramId}`);
  if (!raw) return null;
  return JSON.parse(raw) as UserSettings;
}

export async function setUserSettings(telegramId: string, settings: UserSettings): Promise<void> {
  await redis.set(`settings:telegram:${telegramId}`, JSON.stringify(settings));
}
