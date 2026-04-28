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
} as const;
