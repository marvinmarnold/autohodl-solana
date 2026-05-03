import Redis from "ioredis";

if (!process.env["REDIS_URL"]) throw new Error("Missing required environment variable: REDIS_URL");

// Module-level singleton — reused across requests within the same serverless instance.
const redis = new Redis(process.env["REDIS_URL"]);

export type WalletRecord = {
  walletId: string;
  walletAddress: string;
  privyUserId: string;
};

export type UserSettings = {
  savingsFrequency: string;
  savingsAmountUsd: number;
  delegationTxSignature: string;
  delegationSetAt: string;
};

export async function getWallet(telegramId: string): Promise<WalletRecord | null> {
  const raw = await redis.get(`wallet:telegram:${telegramId}`);
  if (!raw) return null;
  return JSON.parse(raw) as WalletRecord;
}

export async function setWallet(telegramId: string, record: WalletRecord): Promise<void> {
  await redis.set(`wallet:telegram:${telegramId}`, JSON.stringify(record));
}

export async function setUserSettings(telegramId: string, settings: UserSettings): Promise<void> {
  await redis.set(`settings:telegram:${telegramId}`, JSON.stringify(settings));
}
