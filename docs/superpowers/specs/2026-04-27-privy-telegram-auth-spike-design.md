# Design: Privy + Telegram Auth Spike

**Date:** 2026-04-27  
**Scope:** Validate that Privy server-side wallet pregeneration works inside a Telegram Mini App, end-to-end, deployed to Vercel. This is Critical Assumption #1 from CLAUDE.md.  
**Milestone:** Pre-M1 spike. Output feeds directly into M1.

---

## Goal

Confirm that a user can open the autoHODL Mini App inside Telegram and see a Solana wallet address provisioned for them — with zero clicks, and with wallet creation gated entirely server-side behind validated Telegram `initData`.

Success = wallet address visible in the Mini App + user visible in Privy dashboard.

---

## Trust model

Privy custom auth is **operator-trusted**: autoHODL controls the bot token and the Privy app secret, so it can technically mint a session for any Telegram user. This is an acknowledged limitation, not a design flaw to solve in this spike. It will be documented in the `blinks-telegram` library and revisited with Squads constrained-delegate authority in M3. The Privy server-side pregeneration approach (vs client-side custom token login) is chosen specifically because it keeps wallet creation entirely server-side — a malicious client cannot trigger wallet creation while bypassing `initData` validation.

---

## Architecture

Single Next.js App Router app (`apps/autohodl`), deployed to Vercel. grammY runs in webhook mode via a Next.js API route. All backend logic is API routes — no separate long-running process.

```
apps/autohodl/
├── src/
│   ├── lib/
│   │   ├── telegram.ts       # initData HMAC validation, user ID extraction
│   │   ├── privy.ts          # thin wrapper: Privy REST pregeneration API
│   │   └── session.ts        # iron-session config + session type
│   └── app/
│       ├── page.tsx           # Mini App page: calls /api/auth on mount, shows wallet
│       └── api/
│           ├── auth/
│           │   └── route.ts  # POST: validate initData → pregen wallet → set cookie
│           ├── me/
│           │   └── route.ts  # GET: read session cookie → return wallet address
│           └── bot/
│               └── route.ts  # POST: grammY webhook — /start sends Mini App link
```

---

## Data flow

```
[Telegram WebApp]
  │  window.Telegram.WebApp.initData (HMAC-signed string)
  │
  ▼
[page.tsx]  ── on mount ──▶  POST /api/auth  { initData }
                                    │
                                    ├─ 1. Parse initData into key=value pairs
                                    ├─ 2. Validate HMAC-SHA-256
                                    │      key  = HMAC-SHA256("WebAppData", bot_token)
                                    │      data = sorted key=value pairs (excl. hash)
                                    ├─ 3. Extract telegramId from `user` JSON field
                                    ├─ 4. POST privy.io/v1/users  (idempotent)
                                    │      customUserId: "telegram:{telegramId}"
                                    │      createEmbeddedWallet: { chainType: "solana" }
                                    ├─ 5. Extract first Solana wallet address
                                    ├─ 6. Set iron-session cookie
                                    │      { telegramId, walletAddress }
                                    └─ 7. Return { walletAddress }

[page.tsx]  ── renders wallet address

[subsequent loads]  ──▶  GET /api/me  ──▶  read cookie ──▶  { telegramId, walletAddress }
```

---

## Component details

### `lib/telegram.ts`

Exports one function: `validateInitData(initData: string, botToken: string): Promise<TelegramUser>`.

Uses **Web Crypto API** (`crypto.subtle`) — not `node:crypto` — so it is Edge Runtime compatible. Algorithm follows the Telegram spec exactly: build the data-check-string from sorted key=value pairs (excluding `hash`), compute `HMAC-SHA256(dataCheckString, HMAC-SHA256("WebAppData", botToken))`, compare to the `hash` field. Throws a typed `InvalidInitDataError` on failure.

`TelegramUser` type covers the fields Telegram includes in the `user` JSON: `id`, `first_name`, `last_name?`, `username?`, `language_code?`.

### `lib/privy.ts`

Exports one function: `pregenerateWallet(telegramId: string): Promise<string>` (returns Solana address).

Calls `POST https://auth.privy.io/api/v1/users` with `Authorization: Basic base64(appId:appSecret)`. Custom user ID is `telegram:${telegramId}`. Requests a Solana embedded wallet on creation. The Privy API is idempotent — returns the existing user if already created, so this is safe to call on every auth even if the wallet already exists. Wraps Privy errors at the boundary; throws `WalletPregenerationError` with the upstream status code attached.

### `lib/session.ts`

`iron-session` config: cookie name `autohodl_session`, password from `SESSION_SECRET` env var (32+ chars). `httpOnly: true`, `secure: true` in production, `sameSite: "none"` — required because Telegram WebView embeds the Mini App in a cross-site iframe context.

Session shape:
```ts
type SessionData = {
  telegramId: string;
  walletAddress: string;
};
```

### `app/api/auth/route.ts`

`POST` only. Reads `initData` from request JSON body. Calls `validateInitData` → `pregenerateWallet` → sets session → returns `{ walletAddress }`. On any error, returns a typed JSON error response (never throws).

### `app/api/me/route.ts`

`GET` only. Reads session cookie. Returns `{ telegramId, walletAddress }` or `401 { error: "unauthenticated" }` if no session.

### `app/api/bot/route.ts`

grammY webhook handler. Handles one command: `/start` — replies with an inline keyboard button that opens the Mini App URL. Always returns `200` to Telegram regardless of internal errors (Telegram retries on non-200).

### `app/page.tsx`

Client component. On mount: first calls `GET /api/me` — if a session cookie already exists, renders the wallet address immediately without hitting Privy. If `/api/me` returns 401, reads `window.Telegram.WebApp.initData` and POSTs to `/api/auth`, then renders. If `initData` is absent (direct browser visit with no session), renders "Open this app inside Telegram" instead.

---

## Error handling

| Route | Condition | Response |
|---|---|---|
| `/api/auth` | Missing or malformed initData | `400 { error: "invalid_request" }` |
| `/api/auth` | HMAC validation fails | `401 { error: "invalid_initdata" }` |
| `/api/auth` | Privy API error | `502 { error: "wallet_creation_failed" }` |
| `/api/me` | No session cookie | `401 { error: "unauthenticated" }` |
| `/api/bot` | Any internal error | `200` (logged, not surfaced to Telegram) |

---

## Environment variables

```
TELEGRAM_BOT_TOKEN        # from BotFather
PRIVY_APP_ID              # from Privy dashboard
PRIVY_APP_SECRET          # from Privy dashboard
SESSION_SECRET            # 32+ char random string
NEXT_PUBLIC_MINI_APP_URL  # Vercel deployment URL (used in /start button)
```

All are required. The app should fail fast at startup if any are missing.

---

## Testing

**Unit test** (`lib/telegram.test.ts`): Feed a known-good `initData` string (constructed with the bot token) — must validate. Feed a tampered string — must reject. This is the only non-trivial logic in the spike; everything else is thin wrappers around third-party APIs.

**Manual end-to-end** (spike is considered validated when):
1. Open the Mini App via the Telegram bot on a real device.
2. Wallet address renders on screen.
3. Privy dashboard shows the user with a Solana wallet attached.
4. Close and reopen — same address returned (idempotency confirmed).
5. Direct browser visit to the Vercel URL shows the "Open inside Telegram" fallback.

No mocking of Privy or Telegram. The spike's purpose is to confirm the real integrations work.

---

## What this spike does NOT do

- No Privy React SDK on the client (added in M1 when we need transaction signing).
- No UI styling beyond readable output.
- No database — session cookie is the only persistence.
- No Reflect, MoonPay, or on-chain interaction.
- No production hardening (rate limiting, session refresh, etc.).

---

## Relationship to M1

The session pattern established here (`/api/auth` → iron-session cookie → `/api/me`) is the auth foundation M1 builds on. The Privy React SDK gets added in M1 for client-side transaction signing. The bot's `/start` handler expands in M1 to include onboarding copy. No throwaway code — everything in this spike ships into M1.
