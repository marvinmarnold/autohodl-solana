import type { SessionOptions } from "iron-session";

export type SessionData = {
  telegramId: string;
  privyUserId: string;
  walletAddress: string;
  privyWalletId: string;
};

// sameSite: "none" is required for Telegram WebView (cross-site iframe context).
// secure: true is required whenever sameSite is "none" — mobile browsers (iOS
// WebKit, Android Chrome) strictly drop SameSite=None cookies without Secure.
// This is safe in dev because we always run behind an HTTPS cloudflare tunnel.
export const sessionOptions: SessionOptions = {
  cookieName: "autohodl_session",
  password: process.env["SESSION_SECRET"] ?? "",
  ttl: 60 * 60 * 24 * 30,
  cookieOptions: {
    httpOnly: true,
    secure: true,
    sameSite: "none" as const,
  },
};
