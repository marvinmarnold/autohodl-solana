import type { SessionOptions } from "iron-session";

export type SessionData = {
  telegramId: string;
  privyUserId: string;
  walletAddress: string;
};

// sameSite: "none" is required because Telegram WebView opens the Mini App
// in a cross-site iframe context. Without it, browsers block the cookie.
// Requires secure: true in production (Chrome enforces this for sameSite=none).
export const sessionOptions: SessionOptions = {
  cookieName: "autohodl_session",
  // SESSION_SECRET must be 32+ characters — iron-session uses it as the
  // encryption key. Treat it with the same care as a private key.
  password: process.env["SESSION_SECRET"] ?? "",
  ttl: 60 * 60 * 24 * 30, // 30 days — long enough to avoid re-creating Privy users
  cookieOptions: {
    httpOnly: true,
    secure: process.env["NODE_ENV"] === "production",
    sameSite: "none" as const,
  },
};
