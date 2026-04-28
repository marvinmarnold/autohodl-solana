function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

// Validated at module load time. App crashes immediately if any var is missing.
export const env = {
  TELEGRAM_BOT_TOKEN: requireEnv("TELEGRAM_BOT_TOKEN"),
  PRIVY_APP_ID: requireEnv("PRIVY_APP_ID"),
  PRIVY_APP_SECRET: requireEnv("PRIVY_APP_SECRET"),
  SESSION_SECRET: requireEnv("SESSION_SECRET"),
  // NEXT_PUBLIC_ vars are inlined at build time for the client bundle,
  // but are also accessible via process.env in server code.
  NEXT_PUBLIC_MINI_APP_URL: requireEnv("NEXT_PUBLIC_MINI_APP_URL"),
} as const;
