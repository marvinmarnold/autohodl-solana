# Chat-Native M1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the persistent Mini App with a fully chat-native onboarding flow — bot conversation captures savings preferences, a thin Action WebView signs an SPL token delegation via Privy server-signing, the server confirms directly in the Telegram chat.

**Architecture:** grammY bot handles a 3-step onboarding conversation (frequency → amount → authorize). A Next.js page at `/actions/authorize` serves as the signing WebView — shows a confirmation screen, POSTs to `/api/actions/authorize`, which builds the SPL `Token.approve` tx, signs it server-side via Privy, broadcasts it, and sends a ✅ Telegram message directly to the chat. Settings saved to Privy user metadata. The Action endpoint is CORS-enabled and listed in `actions.json` for Twitter/dial.to compatibility.

**Tech stack:** Next.js 16, grammY 1.42, @solana/web3.js, @solana/spl-token, @solana/actions, @vercel/kv (custom amount state), iron-session, Privy REST API

**Branch:** `feat/chat-native-m1` — all work on this branch, no commits to main until milestone is ready.

**Execution model:** Claude auto-approves. At each 🛑 CHECKPOINT, Claude stops — test manually, then continue.

**Commits:** No `Co-Authored-By` lines. Marvin's name only.

---

## File Map

| File | Status | Purpose |
|---|---|---|
| `apps/autohodl/src/lib/privy.ts` | Modify | Add wallet ID to return value; add `updatePrivyUserMetadata`; add `signAndSendSolanaTransaction` |
| `apps/autohodl/src/lib/session.ts` | Modify | Add `privyWalletId` to `SessionData` |
| `apps/autohodl/src/lib/env.ts` | Modify | Add `SOLANA_RPC_URL`, `AUTOHODL_DELEGATE_PUBKEY` |
| `apps/autohodl/src/lib/solana.ts` | Create | `buildTokenApproveTransaction` — constructs unsigned SPL approve tx |
| `apps/autohodl/src/app/api/bot/route.ts` | Modify | Full onboarding conversation: `/start` → frequency → amount → Authorize button |
| `apps/autohodl/src/app/api/actions/authorize/route.ts` | Create | Action API: GET metadata + POST sign + CORS + send TG confirmation |
| `apps/autohodl/src/app/actions/authorize/page.tsx` | Create | Thin WebView confirmation UI |
| `apps/autohodl/public/actions.json` | Create | Twitter extension domain trust |
| `apps/autohodl/src/app/page.tsx` | Delete | Legacy persistent Mini App — replaced by chat |
| `apps/autohodl/.env.local` | Modify | Add new env vars |
| `apps/autohodl/.env.local.example` | Modify | Document new env vars |

---

## Task 0: Create branch and install dependencies

**Files:** `apps/autohodl/package.json`

- [ ] **Create the feature branch**

```bash
git checkout -b feat/chat-native-m1
```

- [ ] **Install Solana and Actions dependencies**

```bash
cd apps/autohodl && bun add @solana/web3.js @solana/spl-token @solana/actions @vercel/kv
```

- [ ] **Verify typecheck still passes**

```bash
bun run typecheck
```

Expected: no errors (new packages have their own types bundled).

- [ ] **Commit**

```bash
git add apps/autohodl/package.json apps/autohodl/bun.lockb
git commit -m "feat(autohodl): add solana, spl-token, actions, vercel-kv deps"
```

---

## Task 1: Extend privy.ts — wallet ID + metadata + server signing

**Files:** `apps/autohodl/src/lib/privy.ts`

The Privy wallet creation response includes an `id` field (e.g. `"wr:abc123"`). We need it for server-side signing. We also add two new exported functions: `updatePrivyUserMetadata` and `signAndSendSolanaTransaction`.

> ⚠️ **VERIFY BEFORE RUNNING:** The Privy server-signing endpoint and body shape must be confirmed against:
> https://docs.privy.io/wallets/wallets/server-wallets/api-reference
> The skeleton below uses the most likely shape based on Privy docs — read the actual docs and adjust before the Task 7 test runs.

- [ ] **Replace `apps/autohodl/src/lib/privy.ts` with the updated version**

```typescript
import { env } from "./env";

export class WalletPregenerationError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
  ) {
    super(message);
    this.name = "WalletPregenerationError";
  }
}

type PrivyWallet = {
  type: "wallet";
  chain_type: string;
  address: string;
  id: string; // e.g. "wr:abc123" — needed for server-side signing
};

type PrivyLinkedAccount = PrivyWallet | { type: string };

type PrivyUserResponse = {
  id: string; // did:privy:...
  linked_accounts: PrivyLinkedAccount[];
};

function authHeaders() {
  const credentials = Buffer.from(
    `${env.PRIVY_APP_ID}:${env.PRIVY_APP_SECRET}`,
  ).toString("base64");
  return {
    Authorization: `Basic ${credentials}`,
    "privy-app-id": env.PRIVY_APP_ID,
    "Content-Type": "application/json",
  };
}

function findSolanaWallet(data: PrivyUserResponse): PrivyWallet | undefined {
  return data.linked_accounts.find(
    (a): a is PrivyWallet =>
      a.type === "wallet" &&
      "chain_type" in a &&
      (a as PrivyWallet).chain_type === "solana",
  );
}

async function getOrCreatePrivyUser(telegramId: string): Promise<{
  privyUserId: string;
  existingWalletAddress: string | null;
  existingWalletId: string | null;
}> {
  const headers = authHeaders();

  const createRes = await fetch("https://auth.privy.io/api/v1/users", {
    method: "POST",
    headers,
    body: JSON.stringify({
      linked_accounts: [
        { type: "custom_auth", custom_user_id: `telegram:${telegramId}` },
      ],
      wallets: [{ chain_type: "solana" }],
    }),
  });

  if (createRes.ok) {
    const data = (await createRes.json()) as PrivyUserResponse;
    console.log("Privy user created:", data.id);
    const wallet = findSolanaWallet(data);
    return {
      privyUserId: data.id,
      existingWalletAddress: wallet?.address ?? null,
      existingWalletId: wallet?.id ?? null,
    };
  }

  if (createRes.status === 409) {
    const lookupRes = await fetch(
      "https://auth.privy.io/api/v1/users/custom_auth/id",
      {
        method: "POST",
        headers,
        body: JSON.stringify({ custom_auth_id: `telegram:${telegramId}` }),
      },
    );
    if (!lookupRes.ok) {
      const body = await lookupRes.text().catch(() => "(unreadable)");
      console.error(`Privy custom_auth lookup failed: ${lookupRes.status}`, body);
      throw new WalletPregenerationError(
        `Privy user lookup failed: ${lookupRes.status}`,
        lookupRes.status,
      );
    }
    const data = (await lookupRes.json()) as PrivyUserResponse;
    console.log("Privy user found:", data.id);
    const wallet = findSolanaWallet(data);
    return {
      privyUserId: data.id,
      existingWalletAddress: wallet?.address ?? null,
      existingWalletId: wallet?.id ?? null,
    };
  }

  const body = await createRes.text().catch(() => "(unreadable)");
  console.error(`Privy user creation failed: ${createRes.status}`, body);
  throw new WalletPregenerationError(
    `Privy user creation failed: ${createRes.status}`,
    createRes.status,
  );
}

async function createSolanaWallet(
  privyUserId: string,
): Promise<{ address: string; walletId: string }> {
  const res = await fetch("https://api.privy.io/v1/wallets", {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      chain_type: "solana",
      owner: { user_id: privyUserId },
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "(unreadable)");
    console.error(`Privy wallet creation failed: ${res.status}`, body);
    throw new WalletPregenerationError(
      `Privy wallet creation failed: ${res.status}`,
      res.status,
    );
  }

  const data = (await res.json()) as { address: string; id: string };
  console.log("Privy Solana wallet created:", data.address, "id:", data.id);
  return { address: data.address, walletId: data.id };
}

export async function pregenerateWallet(telegramId: string): Promise<{
  privyUserId: string;
  walletAddress: string;
  privyWalletId: string;
}> {
  const { privyUserId, existingWalletAddress, existingWalletId } =
    await getOrCreatePrivyUser(telegramId);

  if (existingWalletAddress && existingWalletId) {
    return { privyUserId, walletAddress: existingWalletAddress, privyWalletId: existingWalletId };
  }

  const { address, walletId } = await createSolanaWallet(privyUserId);
  return { privyUserId, walletAddress: address, privyWalletId: walletId };
}

export async function updatePrivyUserMetadata(
  privyUserId: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  // VERIFY: confirm PATCH vs PUT and field name at Privy docs
  // https://docs.privy.io/api-reference/introduction
  const res = await fetch(
    `https://auth.privy.io/api/v1/users/${privyUserId}`,
    {
      method: "PATCH",
      headers: authHeaders(),
      body: JSON.stringify({ custom_metadata: metadata }),
    },
  );
  if (!res.ok) {
    const body = await res.text().catch(() => "(unreadable)");
    console.error(`Privy metadata update failed: ${res.status}`, body);
    throw new Error(`Privy metadata update failed: ${res.status} — ${body}`);
  }
}

// Signs and broadcasts a base64-encoded Solana transaction using Privy's
// server-side signing API. The transaction must be unsigned (feePayer set,
// recentBlockhash set, instructions added — but no signatures).
//
// VERIFY endpoint + body shape at:
// https://docs.privy.io/wallets/wallets/server-wallets/api-reference
export async function signAndSendSolanaTransaction(
  privyWalletId: string,
  serializedTxBase64: string,
): Promise<string> {
  const isDevnet = env.SOLANA_RPC_URL.includes("devnet");
  // CAIP-2 chain IDs — verify these at https://chainagnostic.org/CAIPs/caip-2
  const caip2 = isDevnet
    ? "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1"
    : "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";

  const res = await fetch(
    `https://api.privy.io/v1/wallets/${privyWalletId}/rpc`,
    {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        method: "signAndSendTransaction",
        caip2,
        params: {
          transaction: serializedTxBase64,
          encoding: "base64",
        },
      }),
    },
  );

  if (!res.ok) {
    const body = await res.text().catch(() => "(unreadable)");
    console.error(`Privy signing failed: ${res.status}`, body);
    throw new Error(`Privy signing failed: ${res.status} — ${body}`);
  }

  // VERIFY: confirm response shape at Privy docs
  const data = (await res.json()) as { data: { hash: string } };
  console.log("Privy tx signed and sent:", data.data.hash);
  return data.data.hash; // Solana transaction signature
}
```

- [ ] **Run typecheck**

```bash
cd apps/autohodl && bun run typecheck
```

Expected: no errors.

- [ ] **Commit**

```bash
git add apps/autohodl/src/lib/privy.ts
git commit -m "feat(autohodl): extend privy — wallet ID, metadata update, server signing"
```

---

## Task 2: Update session schema and auth route

**Files:** `apps/autohodl/src/lib/session.ts`, `apps/autohodl/src/app/api/auth/route.ts`

- [ ] **Update `apps/autohodl/src/lib/session.ts`**

```typescript
import type { SessionOptions } from "iron-session";

export type SessionData = {
  telegramId: string;
  privyUserId: string;
  walletAddress: string;
  privyWalletId: string; // Privy wallet ID needed for server-side signing
};

export const sessionOptions: SessionOptions = {
  cookieName: "autohodl_session",
  password: process.env["SESSION_SECRET"] ?? "",
  ttl: 60 * 60 * 24 * 30,
  cookieOptions: {
    httpOnly: true,
    secure: process.env["NODE_ENV"] === "production",
    sameSite: "none" as const,
  },
};
```

- [ ] **Update `apps/autohodl/src/app/api/auth/route.ts` to store `privyWalletId`**

Replace the session-setting block (lines 59–63) with:

```typescript
  const session = await getIronSession<SessionData>(await cookies(), sessionOptions);
  session.telegramId = telegramId;
  session.privyUserId = privyUserId;
  session.walletAddress = walletAddress;
  session.privyWalletId = privyWalletId;
  await session.save();
```

And update the destructure on line 46 to:

```typescript
    ({ privyUserId, walletAddress, privyWalletId } = await pregenerateWallet(telegramId));
```

And declare `privyWalletId` with the other variables (line 43):

```typescript
  let privyUserId: string;
  let walletAddress: string;
  let privyWalletId: string;
```

- [ ] **Run typecheck**

```bash
cd apps/autohodl && bun run typecheck
```

- [ ] **Commit**

```bash
git add apps/autohodl/src/lib/session.ts apps/autohodl/src/app/api/auth/route.ts
git commit -m "feat(autohodl): add privyWalletId to session schema"
```

---

## Task 3: New env vars

**Files:** `apps/autohodl/src/lib/env.ts`, `apps/autohodl/.env.local`, `apps/autohodl/.env.local.example`

- [ ] **Add to `apps/autohodl/src/lib/env.ts`**

```typescript
  get SOLANA_RPC_URL() { return requireEnv("SOLANA_RPC_URL"); },
  get AUTOHODL_DELEGATE_PUBKEY() { return requireEnv("AUTOHODL_DELEGATE_PUBKEY"); },
```

- [ ] **Add to `.env.local`**

```
# Solana devnet RPC — use your own Helius/QuickNode URL if you have one
SOLANA_RPC_URL=https://api.devnet.solana.com

# The autoHODL protocol's delegate public key — the address that Token.approve
# grants authority to. For M1 this is a server-controlled keypair; generate with:
#   node -e "const k=require('@solana/web3.js').Keypair.generate();console.log(k.publicKey.toString())"
AUTOHODL_DELEGATE_PUBKEY=
```

- [ ] **Add the same block to `.env.local.example`**

```
# Solana RPC URL — devnet for testing, mainnet for production
SOLANA_RPC_URL=https://api.devnet.solana.com

# autoHODL protocol delegate public key — Token.approve grants it authority
# over the user's USDC token account. Generate a keypair and paste public key here.
AUTOHODL_DELEGATE_PUBKEY=
```

- [ ] **Generate a delegate keypair and add the pubkey to `.env.local`**

```bash
node -e "
const { Keypair } = require('@solana/web3.js');
const k = Keypair.generate();
console.log('Public key:', k.publicKey.toString());
console.log('Secret key (base58 — keep safe):', Buffer.from(k.secretKey).toString('hex'));
"
```

Copy the public key into `AUTOHODL_DELEGATE_PUBKEY` in `.env.local`. Save the secret key somewhere safe (you'll need it for M2 when the server signs with this keypair to execute deposits).

- [ ] **Run typecheck**

```bash
cd apps/autohodl && bun run typecheck
```

- [ ] **Commit**

```bash
git add apps/autohodl/src/lib/env.ts apps/autohodl/.env.local.example
git commit -m "feat(autohodl): add SOLANA_RPC_URL and AUTOHODL_DELEGATE_PUBKEY env vars"
```

---

## Task 4: Replace bot /start — wallet pregeneration from from.id

**Files:** `apps/autohodl/src/app/api/bot/route.ts`

The bot now pregenerates the wallet using `ctx.from.id` directly (no browser, no initData). Then asks the frequency question.

- [ ] **Replace `apps/autohodl/src/app/api/bot/route.ts`**

```typescript
import { Bot, InlineKeyboard, webhookCallback } from "grammy";
import { type NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/env";
import { pregenerateWallet, WalletPregenerationError } from "@/lib/privy";

const bot = new Bot(env.TELEGRAM_BOT_TOKEN);

bot.command("start", async (ctx) => {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  let walletAddress: string;
  try {
    ({ walletAddress } = await pregenerateWallet(String(telegramId)));
  } catch (err) {
    if (err instanceof WalletPregenerationError) {
      await ctx.reply("Sorry, we couldn't set up your wallet right now. Please try again in a moment.");
      return;
    }
    throw err;
  }

  const short = `${walletAddress.slice(0, 4)}…${walletAddress.slice(-4)}`;

  await ctx.reply(
    `Welcome to autoHODL — scheduled secure on-chain yield.\n\nYour wallet is ready: \`${short}\`\n\nGet started with scheduled secure on-chain yield. How often do you want to save?`,
    {
      parse_mode: "Markdown",
      reply_markup: new InlineKeyboard()
        .text("Daily", "freq:daily")
        .text("Weekly", "freq:weekly")
        .text("Monthly", "freq:monthly"),
    },
  );
});

const handleUpdate = webhookCallback(bot, "std/http");

export async function POST(req: NextRequest) {
  try {
    return await handleUpdate(req);
  } catch (err) {
    console.error("Bot handler error:", err);
    return new NextResponse("OK", { status: 200 });
  }
}
```

- [ ] **Run typecheck**

```bash
cd apps/autohodl && bun run typecheck
```

- [ ] **Deploy to Vercel (triggers automatic deployment on push if connected, or push manually)**

```bash
git add apps/autohodl/src/app/api/bot/route.ts
git commit -m "feat(autohodl): bot /start pregenerates wallet from from.id, asks frequency"
git push -u origin feat/chat-native-m1
```

---

## 🛑 CHECKPOINT 1

**Send `/start` to your bot in Telegram.**

Verify:
- Bot replies with welcome message + truncated wallet address
- Three buttons appear: Daily / Weekly / Monthly
- Tapping them does nothing yet (that's Task 5)

**Do not continue until this passes.**

---

## Task 5: Onboarding conversation — frequency → amount → Authorize button

**Files:** `apps/autohodl/src/app/api/bot/route.ts`

Frequency is encoded in callback_data for amount buttons, keeping the preset path stateless. Vercel KV is used only for the custom amount path (stores frequency for 5 minutes while waiting for a text reply).

Add to `.env.local` (Vercel KV — set up in Vercel dashboard under Storage → Create KV, then copy the env vars):

```
KV_REST_API_URL=
KV_REST_API_TOKEN=
```

Add the same keys to `.env.local.example`:

```
# Vercel KV — needed only for the "Custom amount" path in onboarding
# Create at: Vercel dashboard → Storage → KV → Create
KV_REST_API_URL=
KV_REST_API_TOKEN=
```

- [ ] **Set up Vercel KV in the dashboard**

Go to vercel.com → your project → Storage tab → Create Database → KV. Copy the env vars (`KV_REST_API_URL`, `KV_REST_API_TOKEN`) into `.env.local` and into the Vercel project env vars.

- [ ] **Replace `apps/autohodl/src/app/api/bot/route.ts` with the full conversation version**

```typescript
import { Bot, InlineKeyboard, webhookCallback } from "grammy";
import { kv } from "@vercel/kv";
import { type NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/env";
import { pregenerateWallet, WalletPregenerationError } from "@/lib/privy";

const bot = new Bot(env.TELEGRAM_BOT_TOKEN);

// ── /start ──────────────────────────────────────────────────────────────────

bot.command("start", async (ctx) => {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  let walletAddress: string;
  try {
    ({ walletAddress } = await pregenerateWallet(String(telegramId)));
  } catch (err) {
    if (err instanceof WalletPregenerationError) {
      await ctx.reply("Sorry, we couldn't set up your wallet. Please try again.");
      return;
    }
    throw err;
  }

  const short = `${walletAddress.slice(0, 4)}…${walletAddress.slice(-4)}`;

  await ctx.reply(
    `Welcome to autoHODL — scheduled secure on-chain yield.\n\nYour wallet is ready: \`${short}\`\n\nGet started with scheduled secure on-chain yield. How often do you want to save?`,
    {
      parse_mode: "Markdown",
      reply_markup: new InlineKeyboard()
        .text("Daily", "freq:daily")
        .text("Weekly", "freq:weekly")
        .text("Monthly", "freq:monthly"),
    },
  );
});

// ── Frequency selected → ask amount ─────────────────────────────────────────

bot.callbackQuery(/^freq:(.+)$/, async (ctx) => {
  const freq = ctx.match[1] as "daily" | "weekly" | "monthly";
  const freqLabel = { daily: "day", weekly: "week", monthly: "month" }[freq];

  await ctx.editMessageText(`How much per ${freqLabel}?`, {
    reply_markup: new InlineKeyboard()
      .text("$5",  `amt:${freq}:5`)
      .text("$10", `amt:${freq}:10`)
      .text("$20", `amt:${freq}:20`)
      .row()
      .text("$50",  `amt:${freq}:50`)
      .text("$100", `amt:${freq}:100`)
      .text("Custom…", `custom:${freq}`),
  });
  await ctx.answerCallbackQuery();
});

// ── Preset amount selected → send Authorize button ───────────────────────────

bot.callbackQuery(/^amt:(.+):(\d+)$/, async (ctx) => {
  const freq = ctx.match[1] as string;
  const amt  = Number(ctx.match[2]);
  await ctx.answerCallbackQuery();
  await sendAuthorizeMessage(ctx, freq, amt);
});

// ── Custom amount: store freq in KV, ask user to type ───────────────────────

bot.callbackQuery(/^custom:(.+)$/, async (ctx) => {
  const freq   = ctx.match[1];
  const chatId = ctx.chat?.id;
  if (!chatId) return;

  // 5-minute TTL — if user doesn't type within 5 min, they restart /start
  await kv.set(`onboarding:${chatId}:freq`, freq, { ex: 300 });

  await ctx.editMessageText("Type your savings amount in USD (e.g. 35):");
  await ctx.answerCallbackQuery();
});

// ── Text message: custom amount reply ───────────────────────────────────────

bot.on("message:text", async (ctx) => {
  const chatId = ctx.chat.id;
  const freq = await kv.get<string>(`onboarding:${chatId}:freq`);
  if (!freq) return; // not in onboarding — ignore

  const amt = Number(ctx.message.text.trim().replace(/^\$/, ""));
  if (!Number.isFinite(amt) || amt <= 0) {
    await ctx.reply("Please enter a valid amount, e.g. 35:");
    return;
  }

  await kv.del(`onboarding:${chatId}:freq`);
  await sendAuthorizeMessage(ctx, freq, amt);
});

// ── Shared: send the Authorize web_app button ────────────────────────────────

async function sendAuthorizeMessage(
  ctx: Parameters<typeof bot.command>[1] extends (ctx: infer C) => unknown ? C : never,
  freq: string,
  amt: number,
) {
  const freqLabel = { daily: "day", weekly: "week", monthly: "month" }[freq] ?? "period";
  const actionUrl = `${env.NEXT_PUBLIC_MINI_APP_URL}/actions/authorize?freq=${freq}&amt=${amt}`;

  await ctx.reply(
    `Got it — saving $${amt} per ${freqLabel}.\n\nTap below to authorize autoHODL to save on your behalf:`,
    {
      reply_markup: new InlineKeyboard().add({
        text: "Authorize savings ✍️",
        web_app: { url: actionUrl },
      }),
    },
  );
}

const handleUpdate = webhookCallback(bot, "std/http");

export async function POST(req: NextRequest) {
  try {
    return await handleUpdate(req);
  } catch (err) {
    console.error("Bot handler error:", err);
    return new NextResponse("OK", { status: 200 });
  }
}
```

- [ ] **Fix the `sendAuthorizeMessage` ctx type — replace the type with grammY's `Context`**

The type annotation for `ctx` in `sendAuthorizeMessage` needs to be `import type { Context } from "grammy"`. Update the import line and the function signature:

```typescript
import { Bot, Context, InlineKeyboard, webhookCallback } from "grammy";

async function sendAuthorizeMessage(ctx: Context, freq: string, amt: number) {
```

- [ ] **Run typecheck**

```bash
cd apps/autohodl && bun run typecheck
```

- [ ] **Commit and push**

```bash
git add apps/autohodl/src/app/api/bot/route.ts apps/autohodl/.env.local.example
git commit -m "feat(autohodl): full onboarding conversation — frequency, amount, Authorize button"
git push
```

---

## 🛑 CHECKPOINT 2

**Walk through the full conversation flow:**

1. `/start` → wallet address + frequency buttons
2. Tap "Weekly" → amount buttons appear
3. Tap "$20" → "Got it — saving $20 per week." + **[Authorize savings ✍️]** button
4. Tap "Custom…" → "Type your savings amount:" → type `35` → Authorize button appears
5. Tapping the Authorize button should open a WebView (may show a 404 for now — that's expected)

**Do not continue until the conversation flow works end-to-end.**

---

## Task 6: Solana tx construction

**Files:** Create `apps/autohodl/src/lib/solana.ts`

- [ ] **Create `apps/autohodl/src/lib/solana.ts`**

```typescript
import {
  Connection,
  PublicKey,
  Transaction,
} from "@solana/web3.js";
import {
  createApproveInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";

// USDC mint addresses
const USDC_MINT: Record<"mainnet" | "devnet", string> = {
  mainnet: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  devnet:  "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
};

function getUsdcMint(rpcUrl: string): PublicKey {
  const network = rpcUrl.includes("devnet") ? "devnet" : "mainnet";
  return new PublicKey(USDC_MINT[network]);
}

// Builds an unsigned SPL Token.approve transaction that grants `delegate`
// authority over the user's USDC token account up to u64::MAX.
// The transaction must be signed by the user's wallet (via Privy server signing).
export async function buildTokenApproveTransaction(
  userWalletAddress: string,
  delegatePubkeyStr: string,
  connection: Connection,
): Promise<string> { // base64-encoded serialized transaction
  const owner    = new PublicKey(userWalletAddress);
  const delegate = new PublicKey(delegatePubkeyStr);
  const mint     = getUsdcMint(connection.rpcEndpoint);

  const tokenAccount = getAssociatedTokenAddressSync(mint, owner);

  const approveIx = createApproveInstruction(
    tokenAccount,
    delegate,
    owner,
    BigInt("18446744073709551615"), // u64::MAX — effectively unlimited
  );

  const { blockhash } = await connection.getLatestBlockhash();
  const tx = new Transaction();
  tx.recentBlockhash = blockhash;
  tx.feePayer = owner; // user's Privy wallet pays fees
  tx.add(approveIx);

  // Serialize without requiring all signatures — Privy will add the user's sig
  const serialized = tx.serialize({ requireAllSignatures: false, verifySignatures: false });
  return serialized.toString("base64");
}
```

- [ ] **Write a unit test for `buildTokenApproveTransaction`**

Create `apps/autohodl/src/lib/solana.test.ts`:

```typescript
import { expect, test, mock } from "bun:test";
import { Connection, PublicKey, Transaction } from "@solana/web3.js";
import { buildTokenApproveTransaction } from "./solana";

// A real devnet-format address for testing
const USER_WALLET   = "7nE9GvcwsqzYxmJLSrXmSKFtREvGQPsRsBFe3YWKmkn2";
const DELEGATE      = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin";
const DEVNET_RPC    = "https://api.devnet.solana.com";

test("buildTokenApproveTransaction returns a base64 tx with one instruction", async () => {
  // Mock connection.getLatestBlockhash
  const connection = new Connection(DEVNET_RPC);
  const mockBlockhash = mock(async () => ({
    blockhash: "EkSnNWid2cvwEVnVx9aBqawnmiCNiDgp3gUdkDPTKN1N",
    lastValidBlockHeight: 1234,
  }));
  connection.getLatestBlockhash = mockBlockhash;

  const base64Tx = await buildTokenApproveTransaction(USER_WALLET, DELEGATE, connection);

  // Must be a non-empty base64 string
  expect(typeof base64Tx).toBe("string");
  expect(base64Tx.length).toBeGreaterThan(0);

  // Decode and verify it parses as a valid Transaction
  const buf = Buffer.from(base64Tx, "base64");
  const tx = Transaction.from(buf);
  expect(tx.instructions).toHaveLength(1);
  expect(tx.feePayer?.toString()).toBe(USER_WALLET);
});
```

- [ ] **Run the test**

```bash
cd apps/autohodl && bun test src/lib/solana.test.ts
```

Expected: PASS.

- [ ] **Run typecheck**

```bash
bun run typecheck
```

- [ ] **Commit**

```bash
git add apps/autohodl/src/lib/solana.ts apps/autohodl/src/lib/solana.test.ts
git commit -m "feat(autohodl): solana tx construction — buildTokenApproveTransaction"
```

---

## Task 7: Action API endpoint — GET + POST + server signing + TG confirmation

**Files:** Create `apps/autohodl/src/app/api/actions/authorize/route.ts`

> ⚠️ **Before running this task end-to-end:** Read the Privy server-signing docs at
> https://docs.privy.io/wallets/wallets/server-wallets/api-reference
> and verify that `signAndSendSolanaTransaction` in `privy.ts` uses the correct
> endpoint, caip2, and response shape. Log every error response body.

- [ ] **Create `apps/autohodl/src/app/api/actions/authorize/route.ts`**

```typescript
import { getIronSession } from "iron-session";
import { cookies } from "next/headers";
import { type NextRequest, NextResponse } from "next/server";
import { Connection } from "@solana/web3.js";
import type { ActionGetResponse, ActionPostResponse } from "@solana/actions";
import { env } from "@/lib/env";
import {
  signAndSendSolanaTransaction,
  updatePrivyUserMetadata,
} from "@/lib/privy";
import { buildTokenApproveTransaction } from "@/lib/solana";
import { type SessionData, sessionOptions } from "@/lib/session";

// ── CORS helpers ─────────────────────────────────────────────────────────────

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function corsJson(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: CORS_HEADERS });
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

// ── GET — Action metadata ────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const freq = req.nextUrl.searchParams.get("freq") ?? "weekly";
  const amt  = Number(req.nextUrl.searchParams.get("amt") ?? "20");
  const freqLabel = { daily: "day", weekly: "week", monthly: "month" }[freq] ?? "period";

  const response: ActionGetResponse = {
    title: "Authorize autoHODL savings",
    icon: `${env.NEXT_PUBLIC_MINI_APP_URL}/icon.png`,
    description: `Allow autoHODL to save $${amt} per ${freqLabel} into Reflect yield. Sign once — no further signatures needed.`,
    label: "Authorize",
    links: {
      actions: [
        {
          label: "Confirm",
          href: `/api/actions/authorize?freq=${freq}&amt=${amt}`,
        },
      ],
    },
  };

  return corsJson(response);
}

// ── POST — Build tx, sign via Privy, broadcast, confirm in TG ────────────────

export async function POST(req: NextRequest) {
  const session = await getIronSession<SessionData>(await cookies(), sessionOptions);
  if (!session.telegramId || !session.privyWalletId) {
    return corsJson({ error: "unauthenticated" }, 401);
  }

  let freq: string;
  let amt: number;
  try {
    const body = (await req.json()) as { freq?: string; amt?: number };
    freq = body.freq ?? req.nextUrl.searchParams.get("freq") ?? "weekly";
    amt  = body.amt  ?? Number(req.nextUrl.searchParams.get("amt") ?? "20");
  } catch {
    return corsJson({ error: "invalid_request" }, 400);
  }

  // 1. Build unsigned SPL Token.approve tx
  const connection = new Connection(env.SOLANA_RPC_URL, "confirmed");
  let txBase64: string;
  try {
    txBase64 = await buildTokenApproveTransaction(
      session.walletAddress,
      env.AUTOHODL_DELEGATE_PUBKEY,
      connection,
    );
  } catch (err) {
    console.error("Failed to build approve tx:", err);
    return corsJson({ error: "tx_build_failed" }, 500);
  }

  // 2. Sign + broadcast via Privy server signing
  let txSignature: string;
  try {
    txSignature = await signAndSendSolanaTransaction(session.privyWalletId, txBase64);
  } catch (err) {
    console.error("Privy signing failed:", err);
    return corsJson({ error: "signing_failed" }, 502);
  }

  // 3. Save settings to Privy user metadata (non-blocking — don't fail the tx on metadata error)
  const freqLabel = { daily: "day", weekly: "week", monthly: "month" }[freq] ?? "period";
  updatePrivyUserMetadata(session.privyUserId, {
    savingsFrequency: freq,
    savingsAmountUsd: amt,
    delegationTxSignature: txSignature,
    delegationSetAt: new Date().toISOString(),
  }).catch((err) => console.error("Metadata update failed (non-fatal):", err));

  // 4. Send ✅ confirmation + MoonPay CTA to Telegram chat
  const moonpayUrl = buildMoonpayUrl(session.walletAddress, amt);
  await sendTelegramMessage(session.telegramId, {
    text: `✅ Authorization set.\n\nWe'll send you a reminder to deposit into this wallet. Our agentic protocol will optimize your yield.`,
    reply_markup: {
      inline_keyboard: [
        [{ text: "Never forget — setup automatic deposits 🔁", url: moonpayUrl }],
      ],
    },
  });

  const response: ActionPostResponse = {
    transaction: txBase64, // return the tx for standard Blink clients that want to sign client-side
    message: `Authorized $${amt}/${freqLabel} savings. Tx: ${txSignature}`,
  };
  return corsJson(response);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function buildMoonpayUrl(walletAddress: string, amountUsd: number): string {
  const params = new URLSearchParams({
    apiKey: env.NEXT_PUBLIC_MOONPAY_API_KEY,
    currencyCode: "usdc_sol",
    walletAddress,
    baseCurrencyCode: "usd",
    baseCurrencyAmount: String(amountUsd),
  });
  return `https://buy.moonpay.com?${params.toString()}`;
}

async function sendTelegramMessage(
  chatId: string,
  message: Record<string, unknown>,
): Promise<void> {
  const res = await fetch(
    `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, ...message }),
    },
  );
  if (!res.ok) {
    const body = await res.text().catch(() => "(unreadable)");
    console.error(`Telegram sendMessage failed: ${res.status}`, body);
  }
}
```

- [ ] **Run typecheck**

```bash
cd apps/autohodl && bun run typecheck
```

- [ ] **Commit**

```bash
git add apps/autohodl/src/app/api/actions/authorize/
git commit -m "feat(autohodl): Action API — GET metadata, POST sign via Privy, TG confirmation"
```

---

## Task 8: Thin WebView confirmation page

**Files:** Create `apps/autohodl/src/app/actions/authorize/page.tsx`

- [ ] **Create `apps/autohodl/src/app/actions/authorize/page.tsx`**

```tsx
"use client";

import { useEffect, useState } from "react";

type Status = "idle" | "signing" | "done" | "error";

export default function AuthorizePage() {
  const [status, setStatus] = useState<Status>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Read freq + amt from URL — set during build so no window access issues
  const params =
    typeof window !== "undefined"
      ? new URLSearchParams(window.location.search)
      : new URLSearchParams();
  const freq = params.get("freq") ?? "weekly";
  const amt  = Number(params.get("amt") ?? "20");
  const freqLabel = { daily: "day", weekly: "week", monthly: "month" }[freq] ?? "period";

  useEffect(() => {
    window.Telegram?.WebApp.ready();
  }, []);

  async function handleConfirm() {
    setStatus("signing");
    try {
      // Ensure iron-session exists — auth if not
      const meRes = await fetch("/api/me");
      if (!meRes.ok) {
        const initData = window.Telegram?.WebApp.initData;
        if (!initData) throw new Error("No Telegram initData — open via the bot.");
        const authRes = await fetch("/api/auth", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ initData }),
        });
        if (!authRes.ok) throw new Error("Auth failed. Try again from the bot.");
      }

      // Call action POST — server signs + broadcasts + sends TG message
      const res = await fetch(`/api/actions/authorize?freq=${freq}&amt=${amt}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ freq, amt }),
      });

      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error ?? `Server error ${res.status}`);
      }

      setStatus("done");
      // Give the user a moment to read "Done!" before the modal closes
      setTimeout(() => window.Telegram?.WebApp.close(), 1200);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Unexpected error");
      setStatus("error");
    }
  }

  if (status === "done") {
    return (
      <main style={{ padding: "2rem", textAlign: "center" }}>
        <p style={{ fontSize: "2rem" }}>✅</p>
        <p>Done! Check your messages.</p>
      </main>
    );
  }

  if (status === "error") {
    return (
      <main style={{ padding: "2rem" }}>
        <p>❌ {errorMsg}</p>
        <button type="button" onClick={() => setStatus("idle")}>
          Try again
        </button>
      </main>
    );
  }

  if (status === "signing") {
    return (
      <main style={{ padding: "2rem", textAlign: "center" }}>
        <p>Signing authorization…</p>
        <p style={{ color: "#888", fontSize: "0.85rem" }}>This takes a few seconds.</p>
      </main>
    );
  }

  return (
    <main style={{ padding: "2rem" }}>
      <h2 style={{ marginBottom: "0.5rem" }}>Authorize autoHODL</h2>
      <p>
        Allow autoHODL to save <strong>${amt}</strong> per{" "}
        <strong>{freqLabel}</strong> into Reflect yield.
      </p>
      <p style={{ color: "#666", fontSize: "0.85rem" }}>
        This signs a one-time token approval. You stay in control — revoke anytime.
      </p>
      <button
        type="button"
        onClick={handleConfirm}
        style={{
          marginTop: "1.5rem",
          padding: "0.75rem 2rem",
          fontSize: "1rem",
          borderRadius: "8px",
          background: "#0088cc",
          color: "#fff",
          border: "none",
          cursor: "pointer",
          width: "100%",
        }}
      >
        Confirm
      </button>
    </main>
  );
}
```

- [ ] **Run typecheck**

```bash
cd apps/autohodl && bun run typecheck
```

- [ ] **Commit and push**

```bash
git add apps/autohodl/src/app/actions/
git commit -m "feat(autohodl): thin Action WebView — authorize page"
git push
```

---

## 🛑 CHECKPOINT 3

**Run the full onboarding flow end-to-end:**

1. `/start` → pick Weekly → pick $20 → tap **[Authorize savings ✍️]**
2. WebView opens — verify it shows "$20 per week" and a Confirm button
3. Tap Confirm — "Signing authorization…" appears
4. WebView closes automatically
5. **✅ message appears in the Telegram chat** with the MoonPay button

**Also verify:**
- Privy dashboard shows the user with a Solana wallet
- Solana explorer (devnet) shows the Token.approve transaction for the wallet address

**Common failure modes:**
- `signing_failed 502` → Privy server signing endpoint or caip2 is wrong — check logs in Vercel, then re-read Privy docs and fix `signAndSendSolanaTransaction` in `privy.ts`
- `tx_build_failed 500` → User has no USDC token account on devnet — airdrop some devnet USDC or create the account first
- WebView shows 401 → Session cookie issue — check `sameSite: "none"` is set and Vercel is serving HTTPS

**Do not continue until the ✅ message appears in Telegram.**

---

## Task 9: CORS + actions.json for Twitter/dial.to

**Files:** `apps/autohodl/public/actions.json`

CORS headers are already on the action route (Task 7). This task only adds `actions.json`.

- [ ] **Create `apps/autohodl/public/actions.json`**

```json
{
  "rules": [
    {
      "pathPattern": "/api/actions/**",
      "apiPath": "/api/actions/**"
    }
  ]
}
```

- [ ] **Commit and push**

```bash
git add apps/autohodl/public/actions.json
git commit -m "feat(autohodl): add actions.json for Blinks domain trust"
git push
```

---

## 🛑 CHECKPOINT 4

**Test via dial.to:**

1. Construct this URL (replace `<your-vercel-domain>`):
   ```
   https://dial.to/?action=solana-action:https://<your-vercel-domain>/api/actions/authorize?freq=weekly&amt=20
   ```
2. Open it in a browser
3. Verify: dial.to renders the action card with title "Authorize autoHODL savings" and a Confirm button

**Do not continue until the action renders in dial.to.**

---

## Task 10: Cleanup — remove legacy Mini App page

**Files:** Delete `apps/autohodl/src/app/page.tsx`

- [ ] **Delete the persistent Mini App page**

```bash
rm apps/autohodl/src/app/page.tsx
```

- [ ] **Verify the build still passes**

```bash
cd apps/autohodl && bun run build
```

Expected: build succeeds. The root `/` path will now 404, which is correct — users enter via the bot.

- [ ] **Run typecheck**

```bash
bun run typecheck
```

- [ ] **Commit and push**

```bash
git add -A
git commit -m "chore(autohodl): remove legacy Mini App page — chat is the entry point"
git push
```

---

## Self-Review Checklist

**Spec coverage:**
- ✅ `/start` pregenerates wallet from `from.id` (Task 4)
- ✅ Multi-step onboarding: frequency → amount → Authorize button (Task 5)
- ✅ SPL Token.approve tx construction (Task 6)
- ✅ Privy server-side signing (Task 7)
- ✅ Settings saved to Privy user metadata (Task 7)
- ✅ ✅ message + MoonPay CTA sent directly to Telegram chat (Task 7)
- ✅ Thin WebView confirmation UI (Task 8)
- ✅ CORS headers on Action routes (Task 7)
- ✅ `actions.json` for Twitter extension (Task 9)
- ✅ Legacy `page.tsx` removed (Task 10)
- ✅ `privyWalletId` captured and stored in session (Tasks 1–2)
- ✅ Vercel KV for custom amount path (Task 5)

**Things that need manual verification before Task 7 runs:**
- Privy server-signing endpoint + body shape + response shape
- Privy `updatePrivyUserMetadata` — HTTP method and field name
- USDC devnet mint address (confirmed: `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`)

**Known gaps deferred to later milestones:**
- No UI styling (acceptable for M1 hackathon demo)
- USDC token account must exist on devnet — user needs to receive devnet USDC first
- MoonPay URL signing (required for production; test key works unsigned)
- Reflect deposit execution (uses the delegation — M1 backend work, separate from this plan)
