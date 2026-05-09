# MoonPay Seamless Redirect Design

**Date:** 2026-05-04  
**Status:** Draft

## Context

After the user signs the SPL Token.approve in the Authorize WebView, the current flow closes the WebView and sends a Telegram bot message with a MoonPay button the user must tap separately. This creates friction — the user has to context-switch back to the chat and tap again.

The desired UX: the WebView stays open and transitions seamlessly into the MoonPay onramp. After the purchase completes, MoonPay redirects to a branded confirmation page. The bot sends a congratulations message so it's waiting in the chat when the user returns.

---

## User Flow

```
[Authorize WebView opens]
  │
  ▼
User signs SPL Token.approve
  │ (server signs + broadcasts via Privy)
  ▼
WebView redirects → MoonPay onramp
  (pre-filled: amount, wallet, USDC on Solana)
  │ (user completes KYC + purchase)
  ▼
MoonPay redirects → /actions/authorize/success?freq=weekly&amt=20
  │
  ├─▶ Page loads → POST /api/actions/authorize/congrats
  │     Reads session (telegramId, walletAddress)
  │     Sends bot: 🎉 congratulations message
  │     KV flag prevents duplicate sends
  │
  ▼
Success page shows:
  "Your autoHODL savings account is active"
  "$20/week will be deposited and auto-earn yield"
  [Close — go back to bot]
  │
  ▼
window.Telegram.WebApp.close()
  │
  ▼
[Bot chat — congratulations message already waiting]
```

---

## Architecture

### What changes

| File | Change |
|---|---|
| `src/app/api/actions/authorize/route.ts` | Remove post-signing Telegram message + MoonPay button. Add `moonpayUrl` field to POST response. |
| `src/app/actions/authorize/page.tsx` | After signing success, `window.location.href = moonpayUrl` (from response) instead of close. |
| `src/app/actions/authorize/success/page.tsx` | **New.** Confirmation page. Calls congrats API on load. Shows savings summary. Close button. |
| `src/app/api/actions/authorize/congrats/route.ts` | **New.** POST endpoint. Reads session, sends bot message, sets KV dedup flag. |

---

## Detail

### MoonPay URL (built server-side, returned in authorize POST response)

```typescript
const moonpayUrl = new URL("https://buy.moonpay.com");
moonpayUrl.searchParams.set("apiKey", env.NEXT_PUBLIC_MOONPAY_API_KEY);
moonpayUrl.searchParams.set("currencyCode", "usdc_sol");
moonpayUrl.searchParams.set("walletAddress", session.walletAddress);
moonpayUrl.searchParams.set("baseCurrencyCode", "usd");
moonpayUrl.searchParams.set("baseCurrencyAmount", String(amt));
// Redirect back to our branded success page
const successUrl = new URL(`${env.NEXT_PUBLIC_MINI_APP_URL}/actions/authorize/success`);
successUrl.searchParams.set("freq", freq);
successUrl.searchParams.set("amt", String(amt));
moonpayUrl.searchParams.set("redirectUrl", successUrl.toString());
```

Returned in the authorize POST response as an extra field alongside `ActionPostResponse`:
```typescript
return corsJson({ type: "transaction", transaction: txBase64, message: "...", moonpayUrl: moonpayUrl.toString() });
```

### authorize/page.tsx change

```typescript
// After successful POST to /api/actions/authorize:
const data = await res.json();
window.location.href = data.moonpayUrl;  // seamless redirect, no close()
```

### Success page (`/actions/authorize/success`)

Client component. Reads `?freq` and `?amt` from URL params.

On mount:
1. Call `POST /api/actions/authorize/congrats` (no body needed — session carries identity)
2. Render confirmation content

Content:
```
🎉 Your savings account is active

You have a secure, on-chain savings account.
autoHODL will receive $[amt]/[period] from MoonPay and
automatically deposit it into Reflect, where it earns yield.

Wallet: [walletAddress shortened]    (from session via /api/me or returned by congrats endpoint)
Amount: $[amt]/[period]

[ ✓ Got it — back to bot ]   → window.Telegram.WebApp.close()
```

Styling: minimal, Telegram-native feel (white bg, dark text, single CTA).

### Congrats API (`POST /api/actions/authorize/congrats`)

```
1. Read session (telegramId, walletAddress)
2. If !telegramId → 401
3. Check KV: GET `congrats_sent:telegram:{telegramId}`
4. If already sent → 200 (no-op, idempotent)
5. Send Telegram message (see below)
6. SET `congrats_sent:telegram:{telegramId}` = "1"
7. Return 200 with { walletAddress } so success page can display it
```

Bot congratulations message:
```
🎉 You're all set!

Your autoHODL savings account is live. Here's what happens next:

• MoonPay will send $[amt]/[period] to your wallet
• autoHODL automatically deposits it into Reflect
• Your funds earn yield from day one — no action needed

Wallet: [walletAddress]
```

---

## Key Decisions

**Why build MoonPay URL server-side?** The server has all the data (wallet address from session, API key from env, mini app URL). Client doesn't need an extra call to get the wallet address.

**Why remove the post-signing Telegram message?** The user is inside the WebView heading to MoonPay. A message arriving in the background during that flow is noise. The congratulations after MoonPay is the meaningful signal.

**Why KV dedup on congrats?** MoonPay's `redirectUrl` fires on both success and cancellation. The user might land on the success page, go back, and reload. Dedup ensures exactly one congratulations per user.

**Why not use `WebApp.sendData()` for the congrats trigger?** `sendData` only works when the Mini App was opened via a `web_app` keyboard button — which this one is. But after the MoonPay redirect, the Telegram Mini App context is gone (we're in MoonPay's domain). When MoonPay redirects back, we're in a new page load. Session cookie carries identity; `sendData` is not available.

---

## Verification

1. Send `/start` → complete onboarding → tap "Authorize savings"
2. WebView signs → immediately navigates to MoonPay (no close, no gap)
3. Complete (or cancel) MoonPay → lands on `/actions/authorize/success`
4. Page shows savings summary with correct amount and period
5. Bot has received congratulations message
6. Tap "Got it — back to bot" → WebView closes → chat visible with message
7. Repeat step 3 (go back, reload success page) → bot does NOT send a second congrats
