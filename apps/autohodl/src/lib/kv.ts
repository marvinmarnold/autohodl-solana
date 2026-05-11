import Redis from "ioredis";

if (!process.env["REDIS_URL"]) throw new Error("Missing required environment variable: REDIS_URL");

export const redis = new Redis(process.env["REDIS_URL"]);

export type WalletRecord = {
  walletAddress: string;
  walletType: "privy" | "external";
  // Privy-only (absent for external wallets):
  walletId?: string;
  privyUserId?: string;
  // Squads vault PDA derived from walletAddress (absent for records created before this field was added):
  vaultAddress?: string;
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
  await Promise.all([
    redis.set(`wallet:telegram:${telegramId}`, JSON.stringify(record)),
    redis.set(`index:wallet:address:${record.walletAddress}`, telegramId),
  ]);
}

export async function getTelegramIdByWalletAddress(walletAddress: string): Promise<string | null> {
  return redis.get(`index:wallet:address:${walletAddress}`);
}

// ── Pending state (Redis-backed — survives serverless cold starts) ────────────

export async function getPending<T>(type: string, telegramId: string): Promise<T | null> {
  const raw = await redis.get(`pending:${type}:${telegramId}`);
  if (!raw) return null;
  return JSON.parse(raw) as T;
}

export async function setPending<T>(type: string, telegramId: string, value: T, ttlSeconds: number): Promise<void> {
  await redis.set(`pending:${type}:${telegramId}`, JSON.stringify(value), "EX", ttlSeconds);
}

export async function deletePending(type: string, telegramId: string): Promise<void> {
  await redis.del(`pending:${type}:${telegramId}`);
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
