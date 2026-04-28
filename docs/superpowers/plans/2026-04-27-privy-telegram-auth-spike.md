# Privy + Telegram Auth Spike Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up a minimal Next.js app in `apps/autohodl` that validates Telegram `initData` server-side, pregenerates a Solana embedded wallet via Privy's REST API, stores the result in an encrypted session cookie, and renders the wallet address inside the Telegram Mini App.

**Architecture:** Next.js App Router deployed to Vercel. Bot (grammY, webhook mode) and all backend logic live as API routes — no separate process. Page calls `/api/me` on load (existing session) or `/api/auth` (new session). Wallet creation is entirely server-side; the client never touches Privy's SDK.

**Tech Stack:** Next.js 15 (App Router), grammY, iron-session v3, Bun (runtime + test runner), TypeScript strict, Web Crypto API (Edge-compatible HMAC), Privy REST API, Vercel.

---

## File Map

Files created or significantly modified in this plan:

```
apps/autohodl/
├── .env.local.example              # env var template (committed)
├── next.config.ts                  # minimal Next.js config
├── package.json                    # updated: add next, react, grammy, iron-session
├── tsconfig.json                   # replaced: Next.js-compatible settings
└── src/
    ├── types/
    │   └── telegram.d.ts           # global Window.Telegram type declaration
    ├── lib/
    │   ├── env.ts                  # validated env vars — fail fast if missing
    │   ├── telegram.ts             # initData HMAC validation → TelegramUser
    │   ├── telegram.test.ts        # unit tests for HMAC logic
    │   ├── privy.ts                # Privy REST: pregen wallet → Solana address
    │   └── session.ts              # iron-session config + SessionData type
    └── app/
        ├── layout.tsx              # loads Telegram WebApp SDK script
        ├── page.tsx                # Mini App: auth flow + wallet display
        └── api/
            ├── auth/route.ts       # POST: initData → pregen → set cookie
            ├── me/route.ts         # GET: read cookie → return wallet
            └── bot/route.ts        # POST: grammY webhook (/start)
```

---

## Task 1: Bootstrap Next.js in `apps/autohodl`

**Files:**
- Modify: `apps/autohodl/package.json`
- Replace: `apps/autohodl/tsconfig.json`
- Create: `apps/autohodl/next.config.ts`
- Create: `apps/autohodl/.env.local.example`
- Create: `apps/autohodl/src/app/layout.tsx`
- Create: `apps/autohodl/src/app/page.tsx` (placeholder only)

- [ ] **Step 1: Install dependencies**

Run from the repo root:

```bash
bun add --cwd apps/autohodl next react react-dom grammy iron-session
bun add --cwd apps/autohodl -D @types/react @types/react-dom
```

Expected: packages resolve and `apps/autohodl/node_modules` is populated (or hoisted to root).

- [ ] **Step 2: Replace `apps/autohodl/tsconfig.json`**

Next.js uses its own bundler — the base `tsconfig.base.json` (NodeNext module resolution) conflicts with it. This tsconfig does NOT extend the base; it preserves the same strictness settings but switches to bundler resolution:

```json
{
  "compilerOptions": {
    "target": "ES2017",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "exactOptionalPropertyTypes": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 3: Update `apps/autohodl/package.json` scripts**

```json
{
  "name": "autohodl",
  "version": "0.0.0",
  "private": true,
  "description": "autoHODL consumer product: Telegram bot, Mini App webview, Solana Actions API, and on-chain program.",
  "scripts": {
    "dev": "next dev --turbopack",
    "build": "next build",
    "start": "next start",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "grammy": "latest",
    "iron-session": "^8.0.0",
    "next": "^15.0.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  },
  "devDependencies": {
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "typescript": "*"
  }
}
```

- [ ] **Step 4: Create `apps/autohodl/next.config.ts`**

```typescript
import type { NextConfig } from "next";

const config: NextConfig = {};

export default config;
```

- [ ] **Step 5: Create `apps/autohodl/.env.local.example`**

```bash
# Copy to .env.local and fill in real values before running dev or deploying.

TELEGRAM_BOT_TOKEN=          # from BotFather — format: 1234567890:ABCDEFabcdef...
PRIVY_APP_ID=                # from Privy dashboard → Settings → API keys
PRIVY_APP_SECRET=            # from Privy dashboard → Settings → API keys
SESSION_SECRET=              # random 32+ char string — run: openssl rand -base64 32
NEXT_PUBLIC_MINI_APP_URL=    # your Vercel deployment URL, e.g. https://autohodl.vercel.app
```

- [ ] **Step 6: Create `apps/autohodl/src/app/layout.tsx`**

The Telegram WebApp SDK must load before any page JS runs, otherwise `window.Telegram` is undefined. `beforeInteractive` forces it into the initial HTML.

```tsx
import type { Metadata } from "next";
import Script from "next/script";

export const metadata: Metadata = {
  title: "autoHODL",
  description: "Scheduled USDC savings on Solana",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head />
      <body>
        <Script
          src="https://telegram.org/js/telegram-web-app.js"
          strategy="beforeInteractive"
        />
        {children}
      </body>
    </html>
  );
}
```

- [ ] **Step 7: Create placeholder `apps/autohodl/src/app/page.tsx`**

```tsx
export default function Page() {
  return <p>Loading...</p>;
}
```

- [ ] **Step 8: Verify Next.js starts**

```bash
cp apps/autohodl/.env.local.example apps/autohodl/.env.local
# Fill in real values in .env.local before proceeding — the app will crash without them.
bun --cwd apps/autohodl dev
```

Expected: Next.js starts on `http://localhost:3000`, page shows "Loading..."

- [ ] **Step 9: Commit**

```bash
git add apps/autohodl/
git commit -m "feat(autohodl): bootstrap Next.js App Router app"
```

---

## Task 2: Environment validation

**Files:**
- Create: `apps/autohodl/src/lib/env.ts`

- [ ] **Step 1: Create `apps/autohodl/src/lib/env.ts`**

Imported by server-side modules. Throws at import time if any required env var is absent — loud failure beats silent `undefined`.

```typescript
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
```

- [ ] **Step 2: Verify it fails fast**

Temporarily rename `.env.local` to `.env.local.bak`, start the dev server, hit any API route, confirm it logs `Missing required environment variable: TELEGRAM_BOT_TOKEN`. Restore the file.

- [ ] **Step 3: Commit**

```bash
git add apps/autohodl/src/lib/env.ts
git commit -m "feat(autohodl): add env var validation — fail fast on missing config"
```

---

## Task 3: Telegram initData validation (TDD)

**Files:**
- Create: `apps/autohodl/src/lib/telegram.ts`
- Create: `apps/autohodl/src/lib/telegram.test.ts`

This is the only non-trivial pure logic in the spike. We test it with Bun's built-in test runner before writing the implementation.

- [ ] **Step 1: Write the failing tests in `apps/autohodl/src/lib/telegram.test.ts`**

The test helper constructs a valid `initData` string using the same algorithm that Telegram uses, so we're testing against a real reference value.

```typescript
import { expect, test } from "bun:test";
import { InvalidInitDataError, validateInitData } from "./telegram";

// A fake bot token for unit tests only — never a real one.
const TEST_BOT_TOKEN = "1234567890:AABBCCDDEEFFaabbccddeeff_TestToken";

// Constructs a valid initData string signed with the given bot token.
// Mirrors Telegram's server-side signing algorithm exactly.
async function makeValidInitData(
  telegramId: number,
  botToken: string,
): Promise<string> {
  const user = JSON.stringify({ id: telegramId, first_name: "Test" });
  const authDate = String(Math.floor(Date.now() / 1000));
  const params = new URLSearchParams({ auth_date: authDate, user });

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");

  const enc = new TextEncoder();

  const secretKeyMaterial = await crypto.subtle.importKey(
    "raw",
    enc.encode("WebAppData"),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const secretKeyBuffer = await crypto.subtle.sign(
    "HMAC",
    secretKeyMaterial,
    enc.encode(botToken),
  );
  const hmacKey = await crypto.subtle.importKey(
    "raw",
    secretKeyBuffer,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const hashBuffer = await crypto.subtle.sign(
    "HMAC",
    hmacKey,
    enc.encode(dataCheckString),
  );
  const hash = Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  params.set("hash", hash);
  return params.toString();
}

test("returns TelegramUser for valid initData", async () => {
  const initData = await makeValidInitData(42, TEST_BOT_TOKEN);
  const user = await validateInitData(initData, TEST_BOT_TOKEN);
  expect(user.id).toBe(42);
  expect(user.first_name).toBe("Test");
});

test("rejects initData with tampered hash", async () => {
  const initData = await makeValidInitData(42, TEST_BOT_TOKEN);
  const tampered = initData.replace(/hash=[^&]+/, "hash=deadbeefdeadbeef");
  await expect(validateInitData(tampered, TEST_BOT_TOKEN)).rejects.toBeInstanceOf(
    InvalidInitDataError,
  );
});

test("rejects initData signed with wrong bot token", async () => {
  const initData = await makeValidInitData(42, "wrong_token");
  await expect(validateInitData(initData, TEST_BOT_TOKEN)).rejects.toBeInstanceOf(
    InvalidInitDataError,
  );
});

test("rejects initData with missing hash field", async () => {
  const params = new URLSearchParams({
    auth_date: "1700000000",
    user: JSON.stringify({ id: 1, first_name: "x" }),
  });
  await expect(validateInitData(params.toString(), TEST_BOT_TOKEN)).rejects.toBeInstanceOf(
    InvalidInitDataError,
  );
});
```

- [ ] **Step 2: Run tests — confirm they fail**

```bash
bun test apps/autohodl/src/lib/telegram.test.ts
```

Expected: Error like `Cannot find module './telegram'` — the file doesn't exist yet.

- [ ] **Step 3: Implement `apps/autohodl/src/lib/telegram.ts`**

```typescript
export type TelegramUser = {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
};

export class InvalidInitDataError extends Error {
  constructor(reason: string) {
    super(`Invalid Telegram initData: ${reason}`);
    this.name = "InvalidInitDataError";
  }
}

// Validates Telegram Mini App initData per the spec:
// https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
//
// Uses Web Crypto API (crypto.subtle) rather than node:crypto so this
// function is safe to call from Edge Runtime (Next.js middleware / edge routes).
export async function validateInitData(
  initData: string,
  botToken: string,
): Promise<TelegramUser> {
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) throw new InvalidInitDataError("missing hash field");

  params.delete("hash");

  // data_check_string = key=value pairs sorted by key, joined by \n
  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");

  const enc = new TextEncoder();

  // secret_key = HMAC-SHA256(key="WebAppData", data=bot_token)
  const secretKeyMaterial = await crypto.subtle.importKey(
    "raw",
    enc.encode("WebAppData"),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const secretKeyBuffer = await crypto.subtle.sign(
    "HMAC",
    secretKeyMaterial,
    enc.encode(botToken),
  );

  // computed_hash = HMAC-SHA256(key=secret_key, data=data_check_string)
  const hmacKey = await crypto.subtle.importKey(
    "raw",
    secretKeyBuffer,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const hashBuffer = await crypto.subtle.sign(
    "HMAC",
    hmacKey,
    enc.encode(dataCheckString),
  );
  const computedHash = Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  // Constant-time comparison — prevent timing attacks on the hash check.
  if (computedHash.length !== hash.length) {
    throw new InvalidInitDataError("hash mismatch");
  }
  let diff = 0;
  for (let i = 0; i < computedHash.length; i++) {
    // charCodeAt is always defined for indices within string length
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    diff |= computedHash.charCodeAt(i) ^ hash.charCodeAt(i)!;
  }
  if (diff !== 0) throw new InvalidInitDataError("hash mismatch");

  const userStr = params.get("user");
  if (!userStr) throw new InvalidInitDataError("missing user field");

  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const user: unknown = JSON.parse(userStr);
  if (
    typeof user !== "object" ||
    user === null ||
    !("id" in user) ||
    typeof (user as Record<string, unknown>)["id"] !== "number"
  ) {
    throw new InvalidInitDataError("invalid user payload");
  }

  return user as TelegramUser;
}
```

- [ ] **Step 4: Run tests — confirm they pass**

```bash
bun test apps/autohodl/src/lib/telegram.test.ts
```

Expected output:
```
bun test v1.x.x
 ✓ returns TelegramUser for valid initData
 ✓ rejects initData with tampered hash
 ✓ rejects initData signed with wrong bot token
 ✓ rejects initData with missing hash field

 4 pass
 0 fail
```

- [ ] **Step 5: Commit**

```bash
git add apps/autohodl/src/lib/telegram.ts apps/autohodl/src/lib/telegram.test.ts
git commit -m "feat(autohodl): implement Telegram initData HMAC validation"
```

---

## Task 4: Privy wallet pregeneration

**Files:**
- Create: `apps/autohodl/src/lib/privy.ts`

> **Before implementing:** Open Privy's server-side docs and confirm two things:
> 1. The exact request body for `POST /api/v1/users` to create a user with a Solana embedded wallet.
> 2. How to look up an existing user by custom ID when a 409 is returned (what's the GET endpoint and parameter name?).
>
> Docs to check: https://docs.privy.io and the legacy reference at https://docs-legacy.privy.io/guide/server/wallets/new-user
>
> The implementation below uses the most likely API shape based on Privy's documented patterns. Adjust the request body and the 409 fetch URL if the actual API differs. The function signature, error types, and overall structure do not need to change.

- [ ] **Step 1: Create `apps/autohodl/src/lib/privy.ts`**

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

// Shape of a wallet entry inside Privy's linked_accounts array.
type PrivyWallet = {
  type: "wallet";
  chain_type: string;
  address: string;
  wallet_client_type: string;
};

type PrivyLinkedAccount = PrivyWallet | { type: string };

type PrivyUserResponse = {
  id: string;
  linked_accounts: PrivyLinkedAccount[];
};

// Idempotent: creates a Privy user with a Solana embedded wallet keyed on
// the Telegram user ID, or returns the existing wallet address if the user
// was already created. The custom_id namespacing ("telegram:") leaves room
// for other identity types in future without collision.
export async function pregenerateWallet(telegramId: string): Promise<string> {
  const credentials = Buffer.from(
    `${env.PRIVY_APP_ID}:${env.PRIVY_APP_SECRET}`,
  ).toString("base64");

  const authHeaders = {
    Authorization: `Basic ${credentials}`,
    "privy-app-id": env.PRIVY_APP_ID,
    "Content-Type": "application/json",
  };

  const createResponse = await fetch("https://auth.privy.io/api/v1/users", {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({
      // NOTE: verify this request body against Privy's current server-side docs.
      // If Privy uses a different field name for the custom identifier or wallet
      // creation flag, adjust here. The surrounding code does not change.
      custom_id: `telegram:${telegramId}`,
      create_embedded_wallet: true,
    }),
  });

  if (createResponse.ok) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const data: PrivyUserResponse = await createResponse.json();
    return extractSolanaAddress(data, telegramId);
  }

  if (createResponse.status === 409) {
    // User already exists — fetch them by custom ID.
    // NOTE: verify this GET endpoint against Privy's docs. The path may differ.
    const getResponse = await fetch(
      `https://auth.privy.io/api/v1/users/custom_id/telegram:${encodeURIComponent(telegramId)}`,
      { headers: authHeaders },
    );
    if (!getResponse.ok) {
      throw new WalletPregenerationError(
        `Privy lookup failed after 409: ${getResponse.status}`,
        getResponse.status,
      );
    }
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const data: PrivyUserResponse = await getResponse.json();
    return extractSolanaAddress(data, telegramId);
  }

  throw new WalletPregenerationError(
    `Privy user creation failed: ${createResponse.status}`,
    createResponse.status,
  );
}

function extractSolanaAddress(
  data: PrivyUserResponse,
  telegramId: string,
): string {
  const wallet = data.linked_accounts.find(
    (a): a is PrivyWallet =>
      a.type === "wallet" &&
      "chain_type" in a &&
      (a as PrivyWallet).chain_type === "solana",
  );
  if (!wallet) {
    throw new WalletPregenerationError(
      `No Solana wallet found in Privy response for telegram:${telegramId}`,
      0,
    );
  }
  return wallet.address;
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/autohodl/src/lib/privy.ts
git commit -m "feat(autohodl): add Privy server-side wallet pregeneration"
```

---

## Task 5: Session config

**Files:**
- Create: `apps/autohodl/src/lib/session.ts`

- [ ] **Step 1: Create `apps/autohodl/src/lib/session.ts`**

```typescript
import type { SessionOptions } from "iron-session";

export type SessionData = {
  telegramId: string;
  walletAddress: string;
};

// sameSite: "none" is required because Telegram WebView opens the Mini App
// in a cross-site iframe context. Without it, cookies are blocked by browsers.
// Requires secure: true in production (Chrome enforces this for sameSite=none).
export const sessionOptions: SessionOptions = {
  cookieName: "autohodl_session",
  // SESSION_SECRET must be 32+ characters. iron-session uses it as the
  // encryption key — treat it with the same care as a private key.
  password: process.env["SESSION_SECRET"] ?? "",
  ttl: 60 * 60 * 24 * 30, // 30 days — long enough to avoid re-creating Privy users
  cookieOptions: {
    httpOnly: true,
    secure: process.env["NODE_ENV"] === "production",
    sameSite: "none" as const,
  },
};
```

- [ ] **Step 2: Commit**

```bash
git add apps/autohodl/src/lib/session.ts
git commit -m "feat(autohodl): add iron-session config"
```

---

## Task 6: `/api/auth` route

**Files:**
- Create: `apps/autohodl/src/app/api/auth/route.ts`

- [ ] **Step 1: Create `apps/autohodl/src/app/api/auth/route.ts`**

```typescript
import { getIronSession } from "iron-session";
import { cookies } from "next/headers";
import { type NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/env";
import { WalletPregenerationError, pregenerateWallet } from "@/lib/privy";
import { type SessionData, sessionOptions } from "@/lib/session";
import { InvalidInitDataError, validateInitData } from "@/lib/telegram";

export async function POST(req: NextRequest) {
  // Parse body
  let initData: string;
  try {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const body: unknown = await req.json();
    if (
      typeof body !== "object" ||
      body === null ||
      !("initData" in body) ||
      typeof (body as Record<string, unknown>)["initData"] !== "string"
    ) {
      return NextResponse.json({ error: "invalid_request" }, { status: 400 });
    }
    initData = (body as { initData: string }).initData;
    if (!initData) {
      return NextResponse.json({ error: "invalid_request" }, { status: 400 });
    }
  } catch {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  // Validate initData HMAC
  let telegramId: string;
  try {
    const user = await validateInitData(initData, env.TELEGRAM_BOT_TOKEN);
    telegramId = String(user.id);
  } catch (err) {
    if (err instanceof InvalidInitDataError) {
      return NextResponse.json({ error: "invalid_initdata" }, { status: 401 });
    }
    throw err;
  }

  // Pregen wallet (idempotent)
  let walletAddress: string;
  try {
    walletAddress = await pregenerateWallet(telegramId);
  } catch (err) {
    if (err instanceof WalletPregenerationError) {
      console.error("Privy pregeneration error:", err);
      return NextResponse.json(
        { error: "wallet_creation_failed" },
        { status: 502 },
      );
    }
    throw err;
  }

  // Set session cookie
  const session = await getIronSession<SessionData>(await cookies(), sessionOptions);
  session.telegramId = telegramId;
  session.walletAddress = walletAddress;
  await session.save();

  return NextResponse.json({ walletAddress });
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/autohodl/src/app/api/auth/
git commit -m "feat(autohodl): add /api/auth — initData validation + Privy pregen + session"
```

---

## Task 7: `/api/me` route

**Files:**
- Create: `apps/autohodl/src/app/api/me/route.ts`

- [ ] **Step 1: Create `apps/autohodl/src/app/api/me/route.ts`**

```typescript
import { getIronSession } from "iron-session";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { type SessionData, sessionOptions } from "@/lib/session";

export async function GET() {
  const session = await getIronSession<SessionData>(await cookies(), sessionOptions);

  if (!session.telegramId || !session.walletAddress) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  return NextResponse.json({
    telegramId: session.telegramId,
    walletAddress: session.walletAddress,
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/autohodl/src/app/api/me/
git commit -m "feat(autohodl): add /api/me — session read endpoint"
```

---

## Task 8: `/api/bot` grammY webhook

**Files:**
- Create: `apps/autohodl/src/app/api/bot/route.ts`

- [ ] **Step 1: Create `apps/autohodl/src/app/api/bot/route.ts`**

grammY's `webhookCallback` adapter for `"std/http"` accepts and returns standard `Request`/`Response` objects, which is what Next.js App Router API routes use.

The handler always returns `200` to Telegram — Telegram retries any non-200, which would cause double-processing.

```typescript
import { Bot, webhookCallback } from "grammy";
import { type NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/env";

// Bot instance is module-level so it's reused across warm invocations.
const bot = new Bot(env.TELEGRAM_BOT_TOKEN);

bot.command("start", async (ctx) => {
  await ctx.reply("Welcome to autoHODL! Open your savings dashboard:", {
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: "Open autoHODL ↗",
            web_app: { url: env.NEXT_PUBLIC_MINI_APP_URL },
          },
        ],
      ],
    },
  });
});

const handleUpdate = webhookCallback(bot, "std/http");

export async function POST(req: NextRequest) {
  try {
    return await handleUpdate(req);
  } catch (err) {
    // Must return 200 — non-200 causes Telegram to retry the update.
    console.error("Bot handler error:", err);
    return new NextResponse("OK", { status: 200 });
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/autohodl/src/app/api/bot/
git commit -m "feat(autohodl): add /api/bot — grammY webhook with /start command"
```

---

## Task 9: Mini App page

**Files:**
- Create: `apps/autohodl/src/types/telegram.d.ts`
- Replace: `apps/autohodl/src/app/page.tsx`

- [ ] **Step 1: Create `apps/autohodl/src/types/telegram.d.ts`**

Provides TypeScript types for `window.Telegram.WebApp` so the page compiles cleanly.

```typescript
// Type declarations for the Telegram Mini App JavaScript SDK.
// https://core.telegram.org/bots/webapps#initializing-mini-apps
// Only the fields we actually use are typed here.
declare global {
  interface Window {
    Telegram?: {
      WebApp: {
        /** URL-encoded initData string, HMAC-signed by Telegram. Empty in browser. */
        initData: string;
        /** Signals to Telegram that the Mini App is ready to display. */
        ready: () => void;
      };
    };
  }
}

export {};
```

- [ ] **Step 2: Replace `apps/autohodl/src/app/page.tsx`**

```tsx
"use client";

import { useEffect, useState } from "react";

type WalletState =
  | { status: "loading" }
  | { status: "ready"; walletAddress: string }
  | { status: "no-telegram" }
  | { status: "error"; message: string };

export default function Page() {
  const [state, setState] = useState<WalletState>({ status: "loading" });

  useEffect(() => {
    // Tell Telegram the app is ready (hides the loading spinner in WebView).
    window.Telegram?.WebApp.ready();

    async function init() {
      // Fast path: existing session cookie — no need to hit Privy again.
      const meRes = await fetch("/api/me");
      if (meRes.ok) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const data: { walletAddress: string } = await meRes.json();
        setState({ status: "ready", walletAddress: data.walletAddress });
        return;
      }

      // No session — authenticate via initData.
      const initData = window.Telegram?.WebApp.initData;
      if (!initData) {
        // Not inside Telegram — show a helpful message instead of an error.
        setState({ status: "no-telegram" });
        return;
      }

      const authRes = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ initData }),
      });

      if (authRes.ok) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const data: { walletAddress: string } = await authRes.json();
        setState({ status: "ready", walletAddress: data.walletAddress });
      } else {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const err: { error?: string } = await authRes.json().catch(() => ({}));
        setState({ status: "error", message: err.error ?? "unknown_error" });
      }
    }

    init().catch(() => setState({ status: "error", message: "unexpected_error" }));
  }, []);

  if (state.status === "loading") {
    return <p>Loading...</p>;
  }
  if (state.status === "no-telegram") {
    return <p>Open this app inside Telegram.</p>;
  }
  if (state.status === "error") {
    return <p>Error: {state.message}</p>;
  }
  return (
    <main>
      <h1>autoHODL</h1>
      <p>Your Solana wallet:</p>
      <code>{state.walletAddress}</code>
    </main>
  );
}
```

- [ ] **Step 3: Run typecheck**

```bash
bun --cwd apps/autohodl run typecheck
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/autohodl/src/types/ apps/autohodl/src/app/page.tsx
git commit -m "feat(autohodl): add Mini App page — auth flow + wallet display"
```

---

## Task 10: Deploy to Vercel + wire Telegram bot

**Files:** None — operational steps only.

- [ ] **Step 1: Deploy to Vercel**

If you haven't already linked the repo to Vercel:
```bash
npx vercel --cwd apps/autohodl
```

Follow the prompts. When asked for the project root, set it to `apps/autohodl`. When asked for the build command, use `next build`. Output directory: `.next`.

If you're deploying via GitHub integration (push-to-deploy), make sure Vercel is configured with **Root Directory = `apps/autohodl`**.

- [ ] **Step 2: Set environment variables in Vercel**

In the Vercel dashboard → Project → Settings → Environment Variables, add:

```
TELEGRAM_BOT_TOKEN        = <your bot token>
PRIVY_APP_ID              = <from Privy dashboard>
PRIVY_APP_SECRET          = <from Privy dashboard>
SESSION_SECRET            = <32+ char random string>
NEXT_PUBLIC_MINI_APP_URL  = https://<your-project>.vercel.app
```

Then trigger a redeploy so the new vars take effect.

- [ ] **Step 3: Register the bot webhook with Telegram**

Replace `{TOKEN}` and `{VERCEL_URL}` with real values:

```bash
curl -X POST "https://api.telegram.org/bot{TOKEN}/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://{VERCEL_URL}/api/bot", "allowed_updates": ["message"]}'
```

Expected response:
```json
{"ok": true, "result": true, "description": "Webhook was set"}
```

Confirm the webhook is set:
```bash
curl "https://api.telegram.org/bot{TOKEN}/getWebhookInfo"
```

Expected: `"url"` matches your Vercel URL, `"pending_update_count"` is 0.

- [ ] **Step 4: Configure the Mini App URL in BotFather**

In Telegram, message `@BotFather`:
1. `/mybots` → select your bot
2. `Bot Settings` → `Menu Button` → `Configure menu button`
3. Set the URL to `https://<your-project>.vercel.app`

This makes the "Open" button appear in the bot chat.

- [ ] **Step 5: End-to-end validation**

Work through this checklist on a real device:

- [ ] Open the bot in Telegram and send `/start` — confirm the inline keyboard appears with "Open autoHODL ↗"
- [ ] Tap the button — Mini App opens, shows "Loading..." then a Solana wallet address
- [ ] Open Privy dashboard → Users — confirm the user appears with a Solana wallet attached
- [ ] Close the Mini App and reopen — confirm the **same** wallet address is shown (session cookie + idempotent Privy call)
- [ ] Visit the Vercel URL directly in a browser — confirm "Open this app inside Telegram." is shown (no-telegram fallback)

- [ ] **Step 6: Commit validation result**

```bash
git commit --allow-empty -m "chore: spike validated — Privy + Telegram auth confirmed working"
```

---

## Self-Review

**Spec coverage:**
- [x] initData HMAC validation → `lib/telegram.ts` + unit tests (Task 3)
- [x] Privy server-side pregeneration → `lib/privy.ts` (Task 4)
- [x] iron-session cookie with `sameSite: none` → `lib/session.ts` (Task 5)
- [x] `/api/auth` POST route → Task 6
- [x] `/api/me` GET route → Task 7
- [x] grammY `/start` webhook → Task 8
- [x] page: `/api/me` fast path + `/api/auth` fallback → Task 9
- [x] No-telegram browser fallback → Task 9
- [x] Env var fail-fast → Task 2
- [x] E2E manual validation checklist → Task 10
- [x] Privy API shape verification note → Task 4

**Type consistency:** `SessionData`, `TelegramUser`, `WalletPregenerationError`, `InvalidInitDataError` — all defined once, referenced by name in later tasks. `pregenerateWallet` takes `telegramId: string` and is called with `String(user.id)` in auth route — consistent.

**Known limitation (by design):** After 30 days (session expiry) a second Privy user may be created for the same Telegram user if the 409/lookup path doesn't work exactly as coded. This is acceptable for a spike. Revisit in M1 with a persistent store.
