# Design: Chat-Native Architecture + Actions-Everywhere

**Date:** 2026-05-02
**Scope:** Replace the persistent Mini App with a fully chat-native architecture. All user-facing flows happen in the Telegram chat. Solana Actions serve the chat surface, Twitter/web, and any external Blink client from one API.
**Supersedes:** The "dual-surface" framing from earlier in the session. The persistent Mini App is dropped entirely.

---

## Core Insight

Solana Actions earn their place in the Telegram *chat*, not inside a persistent Mini App. Inside a Mini App you control everything and direct Privy SDK calls are enough — Actions add nothing. But for inline chat operations ("Save now," "Authorize protocol," "Spend $5"), the Action protocol is load-bearing: the WebView is short-lived and can't carry app state, so the serialized-tx-over-HTTP pattern is exactly right. And the same Action endpoint works on Twitter and anywhere else Blinks are rendered — for free.

`blinks-telegram` is only a public good because it implements the standard Solana Actions spec. Any project that already has an Actions endpoint gets Telegram chat buttons by installing the library. That's the Public Goods pitch.

---

## Architecture: Three Surfaces, One Action API

```
[Telegram chat]                           [Twitter / Browser]
      │                                           │
  grammY bot messages                   dial.to/?action=solana-action:<url>
  inline web_app buttons                          │
      │                                           │
      ▼                                           ▼
[Thin Action WebView]              [Action API — apps/autohodl]
  (transient modal, ~5 sec)
  1. Read window.Telegram.WebApp.initData    GET  /api/actions/:id
  2. Auth via /api/auth → iron-session            └─▶ ActionGetResponse
  3. GET /api/actions/:id → render metadata             { title, description, label }
  4. POST /api/actions/:id → { tx: base64 }
  5. Sign via Privy embedded wallet          POST /api/actions/:id
  6. Broadcast. Show loading.                     └─▶ { transaction: base64 }
  7. window.Telegram.WebApp.close()
      │                                    Headers: Access-Control-Allow-Origin: *
      ▼
[blinksConfirmation middleware]
  └─▶ ✅ message in originating thread
```

**No persistent Mini App.** The thin Action WebView is technically a `web_app` page (uses `window.Telegram.WebApp`) but is a transient modal, not a surface the user navigates to.

### Surface 1 — Telegram Chat (bot + thin WebViews)

The bot is the primary UX layer. Information arrives as bot messages. Actions arrive as inline `web_app` keyboard buttons that open thin signing WebViews. The WebView closes after ~5 seconds; the bot posts a confirmation message.

Auth in the bot uses `from.id` from the incoming Telegram message — already authenticated by the webhook HMAC. No browser, no cookie. Wallet lookup calls Privy's custom_auth API (idempotent, same code as pregeneration).

Auth in the thin WebView uses `initData` HMAC validation + iron-session cookie (same origin). `/api/auth` and `/api/me` routes remain for this purpose.

### Surface 2 — Twitter / External Browser

Share `https://dial.to/?action=solana-action:<action-url>` anywhere. Anyone can interact via browser with no extension. Users with the Phantom or Dialect Blinks browser extension get the Blink unfurled inline in their Twitter feed.

Requires two additions beyond the Action logic itself:
- `Access-Control-Allow-Origin: *` on all `/api/actions/*` routes.
- `public/actions.json` at the domain root (tells the Twitter extension which paths to trust).

### Surface 3 — Public Action URLs

Same endpoint, any Blink-compatible client (Phantom in-app browser, Backpack, third-party tools). Zero extra code beyond the two requirements above.

---

## Onboarding Flow (6 Steps)

### Step 1 — `/start`

Bot pregenerates a Privy wallet server-side using `from.id` (no browser, no initData needed). Replies:

> "Welcome to autoHODL — scheduled secure on-chain yield.
> Get started with scheduled secure on-chain yield. How often do you want to save?"
>
> `[ Daily ]  [ Weekly ]  [ Monthly ]`  ← `callback_data` buttons

### Step 2 — Frequency

User taps e.g. "Weekly." Bot stores choice in conversation state (grammY Conversations plugin) and asks:

> "How much per week?"
>
> `[ $5 ]  [ $10 ]  [ $20 ]  [ $50 ]  [ Custom… ]`  ← `callback_data` buttons

### Step 3 — Amount

User taps a preset or "Custom…":
- **Preset**: stored immediately, skip to step 4.
- **Custom…**: Bot replies "Type your amount:". grammY Conversations waits for the user's next text message, parses the number, stores it.

Bot confirms:

> "Got it — saving $35/week. Tap below to authorize autoHODL to save on your behalf."
>
> `[ Authorize savings ]`  ← `web_app` button → thin Action WebView

### Step 4 — Authorization WebView (the signing step)

WebView at `/api/actions/authorize` opens as a modal.

1. Reads `initData`, authenticates via iron-session.
2. Fetches action metadata: "Authorize autoHODL to deposit $35 weekly into Reflect."
3. User taps **Confirm**. Privy embedded wallet signs:

```
Token.approve(
  account:   user's USDC token account,
  delegate:  autoHODL protocol PDA,
  owner:     user's Privy wallet keypair,
  amount:    u64::MAX        // effectively unlimited; re-approve only if revoked
)
```

4. Broadcasts. Shows loading state until confirmed on-chain.
5. Calls `window.Telegram.WebApp.close()` with `{ success: true, txSignature }`.

After close, `blinksConfirmation` middleware receives the result, saves the schedule settings to Privy user metadata, and proceeds to step 5.

### Step 5 — Confirmation + MoonPay CTA

Bot posts to the thread:

> ✅ Authorization set.
> We'll send you a reminder to deposit into this wallet. Our agentic protocol will optimize your yield.
>
> **[ Never forget — setup automatic deposits ]**  ← opens MoonPay via `openLink()`

### Step 6 — MoonPay Setup

Tapping the CTA calls `window.Telegram.WebApp.openLink(moonpayUrl)`, opening MoonPay in the external browser (or Telegram's in-app browser):

```
https://buy.moonpay.com?
  apiKey=<NEXT_PUBLIC_MOONPAY_API_KEY>
  &currencyCode=usdc_sol
  &walletAddress=<user_wallet>
  &baseCurrencyAmount=<amount>
  &baseCurrencyCode=usd
```

User completes the MoonPay recurring buy setup there and returns to Telegram.

---

## The Delegation Mechanic

The `Token.approve` signed in step 4 is the architectural keystone:

| Milestone | What the delegation enables |
|---|---|
| M1 | Backend executes Reflect deposit manually (bot command) using delegated authority — no user signature per deposit |
| M2 | Mac backend monitors for USDC arrival from MoonPay → auto-executes Reflect deposit — fully automatic |
| M3 | Tuk Tuk on-chain cron replaces the Mac backend |

**"Sign once, save forever"** — this is the product promise, and the delegation is what makes it technically true.

The delegate is the autoHODL protocol PDA. When the backend needs to deposit USDC into Reflect, it constructs a transaction that calls `transfer_checked` on the user's USDC account (using the delegated authority), then CPIs into the Reflect program. The user's Privy private key is not needed for this.

---

## Settings Storage

Schedule settings live in Privy user metadata after step 4 confirms. No separate database for M1.

```ts
// Called inside blinksConfirmation's onConfirm hook after step 4:
await updatePrivyUserMetadata(privyUserId, {
  savingsFrequency: "weekly",    // "daily" | "weekly" | "monthly"
  savingsAmountUsd: 35,
  delegationTxSignature: txSig,
  delegationSetAt: new Date().toISOString(),
});
```

---

## blinks-telegram Library API

The library is the Telegram-native equivalent of `@dialectlabs/blinks` for the web. Any grammY bot + Solana Actions endpoint can use it.

### `createActionButton(actionUrl, label)`

```ts
import { createActionButton } from "blinks-telegram";

// In a grammY handler:
await ctx.reply("Ready to authorize?", {
  reply_markup: new InlineKeyboard().add(
    createActionButton("https://yourapp.com/api/actions/authorize", "Authorize savings")
  ),
});
```

Returns an `InlineKeyboardButton` with `web_app: { url: actionUrl }`.

### Thin WebView Client

A Next.js page at `app/actions/[id]/page.tsx` exported by the library (or implemented by the consumer following the library's pattern). Responsibilities:

- Mount: read `window.Telegram.WebApp.initData`, POST to `/api/auth` for iron-session.
- Fetch: `GET /api/actions/:id` → render title, description, label.
- Sign: `POST /api/actions/:id` with `{ account: userPubkey }` → `{ transaction: base64 }`.
- Wallet adapter: pluggable. autoHODL injects Privy. Other consumers inject their own.
- Loading: stays open until tx confirmation. Does not close on broadcast alone.
- Close: `window.Telegram.WebApp.close()` with `{ success, txSignature }`.

### `blinksConfirmation()` grammY middleware

```ts
import { blinksConfirmation } from "blinks-telegram";

bot.use(blinksConfirmation({
  onConfirm: async (result, ctx) => {
    await ctx.reply(`✅ Done! Tx: ${result.txSignature}`);
    // e.g., save settings, send next CTA
  },
}));
```

Listens for `web_app_data` updates (the payload from `WebApp.close()`). Parses the result. Calls `onConfirm`. Falls back to a generic "✅ Done." message if no hook is provided.

---

## Action API Shape

For each action (e.g., `authorize`, `deposit`, `spend`):

### `GET /api/actions/:id`

Returns `ActionGetResponse` from `@solana/actions`:

```json
{
  "title": "Authorize autoHODL savings",
  "icon": "https://autohodl.app/icon.png",
  "description": "Delegate USDC authority to autoHODL. Sign once, save forever.",
  "label": "Authorize",
  "links": {
    "actions": [{ "label": "Confirm", "href": "/api/actions/authorize" }]
  }
}
```

### `POST /api/actions/:id`

Body: `{ "account": "<user-pubkey-base58>" }`

Returns `ActionPostResponse`:

```json
{ "transaction": "<base64-encoded-serialized-transaction>" }
```

### Required headers on all `/api/actions/*` routes

```
Access-Control-Allow-Origin: *
Access-Control-Allow-Methods: GET, POST, OPTIONS
Access-Control-Allow-Headers: Content-Type
```

### `public/actions.json`

```json
{
  "rules": [
    { "pathPattern": "/api/actions/**", "apiPath": "/api/actions/**" }
  ]
}
```

---

## Dependencies

| Package | Why |
|---|---|
| `@solana/actions` | `ActionGetResponse`, `ActionPostResponse` types; response validation helpers |
| `@solana/spl-token` | `createApproveInstruction` for the delegation tx |
| `@solana/web3.js` or `@solana/kit` | Transaction construction and serialization |
| `grammy` + `@grammyjs/conversations` | Multi-step onboarding conversation state machine |
| `iron-session` | Session cookie for thin WebView auth (already in use) |
| `@dialectlabs/blinks` | Reference only — their React renderer is for web, not Telegram. DM Dialect for collaboration on Public Goods. |

---

## Security Notes

**Bot webhook auth**: grammY validates the Telegram webhook secret automatically. `from.id` in bot messages is trustworthy without additional HMAC.

**Thin WebView auth**: `initData` HMAC-SHA256 validation using the bot token (already implemented in `lib/telegram.ts`). Iron-session cookie prevents re-validation on subsequent WebView loads from the same origin.

**Privy session continuity**: Iron-session cookie is per-domain. All thin WebViews served from the same Vercel deployment share the session — the user authenticates once and all subsequent WebViews sign on their behalf without re-auth.

**Delegation safety**: The `Token.approve` delegates to the autoHODL protocol PDA, not a human keypair. The PDA is controlled by the on-chain program; its authority is constrained by the program logic. In M3, Squads adds an additional policy layer.

**Tx broadcast timing**: The thin WebView stays open until the tx confirms on-chain (not just broadcast). This avoids the user seeing a hanging modal or getting a confirmation before the tx actually lands.

---

## What Changes from the Previous Architecture

| Before | After |
|---|---|
| Persistent Mini App as primary surface | No persistent Mini App |
| `page.tsx` shows wallet address | Removed |
| Auth via Mini App initData + cookie | Bot auth via `from.id`; WebView auth via initData + cookie |
| `blinks-telegram` for "other teams" | `blinks-telegram` is autoHODL's own UX layer |
| Actions optional inside Mini App | Actions are the sole signing mechanism |

---

## Demo Flow (for recording)

1. User sends `/start` to @autohodl bot.
2. Bot: "How often do you want to save?" → user taps **Weekly**.
3. Bot: "How much per week?" → user taps **$20**.
4. Bot: "Tap to authorize." → user taps → WebView modal → "Authorize $20/week" → **Confirm** → signs SPL approval → closes.
5. Bot: "✅ Authorization set. Our agentic protocol will optimize your yield." + **[Setup automatic deposits]**.
6. User taps → MoonPay opens in browser for $20/week recurring buy.
7. *(Cut to one cycle later)* Bot: "💰 $20 deposited into Reflect. Earning X% APY."
8. Bot: "💸 Want to spend?" → **[Spend $5]** button → taps → signs → "✅ Sent." → Solscan: one tx, Reflect CPIs.

---

## Relationship to Milestones

**M1:** Wallet provisioning via `/start`. Multi-step onboarding (grammY Conversations). SPL token delegation tx via thin Action WebView. Settings in Privy metadata. MoonPay CTA. Reflect deposit triggerable by backend using the delegation.

**M2:** Mac backend monitors USDC arrival → auto-deposits into Reflect using delegation. `spend_atomic` on-chain instruction. Day-to-day ops (Spend, top-up) are chat-native buttons.

**M3:** grammy-agent emits blinks-telegram buttons as tool outputs. Tuk Tuk replaces Mac scheduler. Squads replaces Privy server-signing.
