# autoHODL

> Scheduled USDC savings on Solana — signed once, runs forever.
> Built for the [Colosseum Frontier Hackathon](https://colosseum.com/frontier).

---

## What we built

**autoHODL** lets anyone save a fixed amount of USDC on a schedule (daily / weekly / monthly) entirely from Telegram. The user signs a single SPL `Token.approve` at setup — after that, the protocol handles every deposit automatically. Yield accrues via Reflect. When the user wants to spend, one transaction atomically redeems yield + transfers USDC (the Spendable Yield Token primitive).

The product is built on three open-source libraries that any Solana developer can drop into their own project.

---

## Public-goods libraries

### `@autohodl/blinks-telegram`

**The Telegram-native equivalent of `@dialectlabs/blinks` for the web.**

Render any Solana Action as a native Telegram interaction — no custom UX code required. Works with any grammY bot.

```ts
import { actionButton, TelegramBlink, useTelegramAuth, validateInitData } from "@autohodl/blinks-telegram";

// Bot side — one line to send a web_app button for any Action URL
await ctx.reply("Authorize savings:", { reply_markup: actionButton("Complete setup", actionUrl) });

// WebView side — authenticate the user and render the Action
const { walletAddress } = useTelegramAuth();
<TelegramBlink actionUrl="/api/actions/authorize" adapter={adapter} onSuccess={handleDone} />

// Server side — validate Telegram initData (Edge Runtime safe, zero external deps)
const user = await validateInitData(initData, botToken);
```

Three surfaces, one package: server validation · bot keyboards · React WebView component.

---

### `@autohodl/grammy-agent`

**grammY middleware that routes messages through an LLM with tool calling.**

First-class support for emitting Solana Action buttons as tool-call outputs — the LLM decides when to surface a Blink, the middleware handles the rest.

```ts
import { createAgentMiddleware, blinkTool } from "@autohodl/grammy-agent";
import { anthropic } from "@ai-sdk/anthropic";

bot.on("message:text", createAgentMiddleware({
  model: anthropic("claude-sonnet-4-6"),
  systemPrompt: "You are the autoHODL savings assistant.",
  tools: {
    authorize_savings: blinkTool({
      description: "Send the user a button to authorize autoHODL savings",
      parameters: z.object({ freq: z.enum(["daily", "weekly", "monthly"]), amount: z.number() }),
      buildUrl: ({ freq, amount }) => `${APP_URL}/api/actions/authorize?freq=${freq}&amount=${amount}`,
    }),
  },
}));
```

Works with any Vercel AI SDK–compatible model. Bot commands are automatically skipped so explicit handlers coexist cleanly.

---

### `@autohodl/solana-action-client`

**Process any Solana Action from an AI agent or backend — wallet-agnostic.**

Fetch → sign → broadcast → follow `links.next` chaining. The signing function is injected, so it works with any wallet: Phantom, Privy, MoonPay CLI, a hardware key.

```ts
import { processAction } from "@autohodl/solana-action-client";

const { signature } = await processAction({
  actionUrl: "https://autohodl.app/api/actions/authorize",
  account: walletAddress,
  params: { telegramId, freq: "weekly", amount: 20 },
  sign: async (txBase64) => myWallet.signAndSend(txBase64),
});
```

Designed for AI agents that need to sign Solana Actions on behalf of users — no browser, no wallet extension required.

---

## The app — autoHODL

`apps/autohodl` dogfoods all three libraries. It is the complete demonstration of what you can build with them.

**User flow:**

1. `/start` in Telegram → bot asks "create a wallet or bring your own?"
2. Pick frequency + amount → bot sends an Action button
3. User taps → thin WebView opens, Privy signs `Token.approve` silently → modal closes
4. MoonPay recurring buys land in the wallet; protocol auto-deposits into Reflect
5. To spend: one transaction unwinds yield + transfers USDC atomically

**External wallets and AI agents are first-class.** `/start <WALLET_ADDRESS>` skips wallet creation. The Action endpoint supports unsigned-tx mode so any Blinks-aware wallet (Phantom, Dialect extension, agent using `solana-action-client`) can authorize without touching the WebView.

---

## Tracks and sponsors

| Track | Fit |
|---|---|
| **Blinks + Actions** | `blinks-telegram` brings Actions to 950M Telegram users. `grammy-agent` makes any LLM a Blinks-aware agent. `solana-action-client` makes Actions callable from any backend or agent. |
| **DeFi + Stablecoins** | Interest-bearing USDC via Reflect, automated by a single SPL delegation. |
| **Payments + Commerce** | Spendable Yield Token primitive: atomic redeem + transfer in one transaction. |
| **Agents + Tokenization** | `grammy-agent` + `solana-action-client` are the building blocks for Solana-native AI agents that can sign Actions autonomously. |
| **Public Goods** | Three MIT-licensed packages designed to be used by anyone building on Solana Actions — independently useful outside of autoHODL. |

| Sponsor | Integration |
|---|---|
| **Privy** | Server wallet creation and silent server-side signing. No user OAuth, no browser extension — works inside Telegram's sandboxed WebView. |
| **MoonPay** | Recurring buy CTA for fiat onramp. `@autohodl/solana-action-client` is wrapped as a MoonPay Skill so AI agents can trigger onramp + authorization in one flow. |
| **Reflect** | USDC+ yield engine — deposits auto-execute via SPL delegation, no user action after setup. |
| **Dialect** | `blinks-telegram` extends Dialect's Blinks ecosystem to Telegram. Consumes `@dialectlabs/blinks` React library directly. |
| **Solana Foundation** | Public Goods target: three independently useful, MIT-licensed libraries purpose-built for the Solana Actions ecosystem. |

---

## Repo layout

```
apps/
  autohodl/             Next.js — bot webhook, Action API, WebView pages, Redis KV

packages/
  blinks-telegram/      @autohodl/blinks-telegram     — Telegram ↔ Solana Actions bridge
  grammy-agent/         @autohodl/grammy-agent         — LLM middleware with Blink tool outputs
  solana-action-client/ @autohodl/solana-action-client — wallet-agnostic Action runner
  moonpay-skill/        @autohodl/moonpay-skill        — MCP skill wrapping the above for AI agents
```

---

## Getting started

```sh
bun install

# Copy env template and fill in values
cp apps/autohodl/.env.local.example apps/autohodl/.env.local

# Generate required secrets
openssl rand -base64 32   # → SESSION_SECRET

# Local tunnel (run every time the URL rotates) + dev server
cloudflared tunnel --url http://localhost:3000
./dev.sh https://<tunnel-url>
bun run --cwd apps/autohodl dev
```

See [CLAUDE.md](./CLAUDE.md) for full architecture, milestone breakdown, and coding conventions.
