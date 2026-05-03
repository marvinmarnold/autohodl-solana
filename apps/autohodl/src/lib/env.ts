function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

// Lazy getters: validation runs when each property is first accessed (at
// request time), not when this module is imported (at build time). This lets
// Next.js evaluate API route modules during the build without requiring env
// vars to be present, while still failing loud and fast on the first request
// if a var is missing.
export const env = {
  get TELEGRAM_BOT_TOKEN() { return requireEnv("TELEGRAM_BOT_TOKEN"); },
  get PRIVY_APP_ID() { return requireEnv("PRIVY_APP_ID"); },
  get PRIVY_APP_SECRET() { return requireEnv("PRIVY_APP_SECRET"); },
  get SESSION_SECRET() { return requireEnv("SESSION_SECRET"); },
  // NEXT_PUBLIC_ vars are inlined at build time for the client bundle,
  // but are also accessible via process.env in server code.
  get NEXT_PUBLIC_MINI_APP_URL() { return requireEnv("NEXT_PUBLIC_MINI_APP_URL"); },
  get NEXT_PUBLIC_MOONPAY_API_KEY() { return requireEnv("NEXT_PUBLIC_MOONPAY_API_KEY"); },
  get SOLANA_RPC_URL() { return requireEnv("SOLANA_RPC_URL"); },
  get SOLANA_NETWORK(): "devnet" | "mainnet" {
    const v = requireEnv("SOLANA_NETWORK");
    if (v !== "devnet" && v !== "mainnet") throw new Error(`SOLANA_NETWORK must be "devnet" or "mainnet", got: ${v}`);
    return v;
  },
  get AUTOHODL_DELEGATE_PUBKEY() { return requireEnv("AUTOHODL_DELEGATE_PUBKEY"); },
} as const;
