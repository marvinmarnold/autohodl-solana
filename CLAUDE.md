# autoHODL — Solana Frontier Hackathon

## What this is

A monorepo for autoHODL's Frontier hackathon submission (May 11, 2026 deadline).
Three workspaces:

- `packages/blinks-telegram` — public-goods library: convert any Solana
  Actions endpoint into a Telegram inline `web_app` button + thin signing
  WebView modal + bot confirmation middleware. The Telegram-native equivalent
  of `@dialectlabs/blinks` for the web. Works with any grammY bot.
- `packages/grammy-agent` — public-goods library: grammY middleware that
  routes configurable messages through an LLM with tool calling, including
  first-class support for emitting blinks-telegram action buttons as
  tool-call outputs.
- `apps/autohodl` — the consumer product. Scheduled USDC savings on Solana,
  surfaced via the two libraries above. Uses Privy for auth + embedded
  wallets, MoonPay for scheduled onramp, Reflect for yield, and an on-chain
  program implementing a Spendable Yield Token (SYT) primitive with atomic
  unwind on spend.

## Tooling

- **Runtime/build:** Bun. Use Bun workspaces (configured in root `package.json`).
- **TypeScript:** strict mode everywhere.
- **Lint/format:** Biome (preferred) or ESLint + Prettier — pick one and be
  consistent across the monorepo.
- **On-chain program:** framework choice (Anchor vs raw `solana-program` /
  pinocchio) is **deferred** until we examine Reflect's CPI surface in M1.
  Don't pick one preemptively.
- **Telegram bot:** grammY (webhook mode, serverless-compatible) + grammY
  Conversations plugin for multi-step onboarding dialogue.
- **Action WebViews:** Next.js pages served from Vercel, opened as transient
  `web_app` modals by the bot. No persistent Mini App.
- **LLM:** Vercel AI SDK as the reference, with Anthropic Claude as default
  provider.

## Architecture

Three surfaces share one Action API. No persistent Mini App — all UX is
chat-native.

```
[Telegram chat]                           [Twitter / Browser]
      │                                           │
  grammY bot messages                   dial.to/?action=solana-action:<url>
  inline web_app buttons                (or Phantom/Dialect extension unfurls)
      │                                           │
      ▼                                           ▼
[Thin Action WebView]              [Action API — apps/autohodl]
  (transient modal, ~5 sec)
  1. initData HMAC validation        GET  /api/actions/:id → ActionGetResponse
  2. iron-session auth               POST /api/actions/:id → { transaction: base64 }
  3. render action metadata          Headers: Access-Control-Allow-Origin: *
  4. sign via Privy embedded wallet  public/actions.json (Twitter extension trust)
  5. window.Telegram.WebApp.close()
      │
      ▼
[blinksConfirmation middleware]            [autoHODL on-chain program]
  └─▶ ✅ message in thread                    ├── deposit (Reflect via CPI)
                                              ├── withdraw
[Backend scheduler]                          └── spend_atomic (SYT unwind)
  (Mac for M2, Tuk Tuk for M3)
  └─▶ auto-deposit using SPL delegation
      (Token.approve signed once at onboarding)
```

**Bot chat auth:** uses `from.id` from incoming Telegram messages (validated
by webhook). Wallet lookup calls Privy custom_auth API (idempotent).

**WebView auth:** `initData` HMAC + iron-session cookie (same-origin, shared
across all thin WebViews on the same Vercel deployment).
## Milestones

### M1 — Wallet auto-creation + onboarding + Reflect deposit

User sends `/start`. Bot pregenerates Privy wallet server-side. Multi-step
onboarding conversation (grammY Conversations): picks frequency (Daily /
Weekly / Monthly) and amount. Bot sends "Authorize" `web_app` button.

**The key signing step:** thin Action WebView opens, user confirms, Privy
embedded wallet signs an SPL `Token.approve` that delegates authority over
the user's USDC token account to the autoHODL protocol PDA. Sign once — the
protocol can deposit into Reflect on the user's behalf from now on without
another signature.

Settings (frequency, amount) stored in Privy user metadata. Bot sends MoonPay
CTA to set up recurring buys. Backend triggers first Reflect deposit manually
(bot command) using the delegation. Yield accrues.

### M2 — Automated scheduling + SYTs + spending

Mac backend monitors user wallet for USDC arrival (from MoonPay recurring
buy). On detection, auto-executes Reflect deposit using the SPL delegation
from M1 — no user action required. The on-chain program gains `spend_atomic`:
redeems USDC+ → USDC → transfers to recipient atomically (the SYT primitive).
User can spend via a chat-native Blink button.

### M3 — Squads + Tuk Tuk + grammy-agent

Replace Privy server-signing with a Squads Smart Account where autoHODL is a
constrained delegate authority. Replace Mac scheduler with on-chain cron via
Tuk Tuk. Build `grammy-agent` library: the agent emits blinks-telegram action
buttons as tool-call outputs, enabling fully conversational onboarding where
the agent proposes a savings plan and the user taps once to authorize.

## Cross-cutting design notes

- **Wallet abstraction.** M1/M2 use Privy. M3 may add Squads. Keep wallet
  operations contained to one module so swapping is feasible — but defer
  designing a formal interface until M2 when we know what actually varies.
  Don't over-abstract early.

- **On-chain framework choice.** Anchor is the default if Reflect exposes a
  clean IDL and CPI surface. Switch to raw `solana-program` if Reflect's
  account layouts make Anchor's macros fight us. Decide after M1 task 5.

- **Library dogfooding.** `apps/autohodl` consumes `blinks-telegram` as its
  sole chat UX layer — not a demo, real dogfooding. In M3 it also consumes
  `grammy-agent`. Both via workspace dependency, exactly as an external user
  would. If `apps/autohodl` ever needs to reach into library internals,
  the library API is wrong and should be fixed.

## Track coverage (Frontier)

Primary fits:
- **Blinks + Actions** (primary) — both libraries, Actions API, Blinks-in-TG.
- **DeFi + Stablecoins** — interest-bearing USDC, SYT primitive.
- **Payments + Commerce** — atomic-unwind spend.

Secondary fits:
- **Agents + Tokenization** — `grammy-agent` library + autoHODL's
  conversational onboarding (M3).
- **Identity + Human Verification** — Telegram identity as wallet authority,
  documented in `blinks-telegram`.
- **Treasury + Security** — Squads delegated authorities (M3).

## Award targets

- Public Goods Award ($10K) — primary, via the two libraries.
- Sponsor side-prizes — Privy, MoonPay, Reflect likely.
- Top-20 standout teams ($10K) — achievable with clean execution.
- Grand Champion ($30K) — long shot.

## Sponsor coverage

| Sponsor | Use |
|---|---|
| Privy | Embedded wallet + Telegram auth + server-side signing policies |
| MoonPay | Scheduled recurring buys |
| Reflect | USDC+ as yield engine |
| Squads (via Altitude) | Smart Account architecture in M3 |
| Solana Foundation | Public Goods: both libraries |
| Dialect | `blinks-telegram` extends their tooling — DM upstream |

## Critical assumptions to validate FIRST

Before deep coding, confirm:
1. Privy embedded wallet + Telegram custom-token auth works silently inside
   Telegram WebView. ✅ **Confirmed** (spike complete, wallet address visible
   in Telegram).
2. Reflect's program is callable via CPI from our own program (vs SDK-only).
3. MoonPay scheduled buys can target an arbitrary Solana destination address.
4. SPL token `Token.approve` delegation allows the autoHODL backend to
   execute `transfer_checked` on the user's USDC account without the user's
   private key present — i.e., the Privy server-signing policy can act as
   the transaction fee payer and instruction invoker while the user's
   delegated authority covers the token transfer.

Items 2, 3, and 4 gate M1/M2. Don't write production code that depends on
any of them until confirmed.

## Demo flow (record last)

1. User sends `/start` to @autohodl bot.
2. Bot: "How often do you want to save?" → user taps **Weekly**.
3. Bot: "How much per week?" → user taps **$20**.
4. Bot: "Tap to authorize." → user taps → thin WebView modal → "Authorize
   autoHODL to save $20/week" → **Confirm** → signs SPL token delegation →
   modal closes.
5. Bot: "✅ Authorization set. Our agentic protocol will optimize your yield."
   + **[Setup automatic deposits]** → user taps → MoonPay opens for $20/week.
6. *(Cut to one cycle later)* Bot: "💰 $20 deposited into Reflect. Earning X% APY."
7. Bot: **[💸 Spend $5]** → user taps → signs → "✅ Sent."
8. Show Solscan: ONE transaction, multiple CPIs (Reflect redeem + transfer).

## Coding conventions

- Strict TypeScript. No `any` unless escaping a third-party type hole, and
  only with a comment explaining why.
- Prefer `type` over `interface` unless declaration merging is needed.
- Errors are values where reasonable. Wrap third-party throws at the boundary.
- No premature abstraction. Build the concrete thing first, abstract when a
  second consumer appears.
- Keep functions small. Prefer composition over class hierarchies.
- Tests for the on-chain program and for any non-trivial library logic.
  Don't bother unit-testing thin wrappers around third-party SDKs.
- Comments explain *why*, not *what*. The code already says what.

## When in doubt

- Ask before introducing a new dependency, framework, or major architectural
  pattern.
- Flag any time you're guessing about an external API's behavior — search
  for current docs or stop and ask.
- If a milestone task seems to need work outside its scope, surface it
  rather than silently expanding scope.

## Key resources

- Solana Actions: https://solana.com/docs/advanced/actions
- @solana/actions SDK: https://www.npmjs.com/package/@solana/actions
- Dialect Blinks: https://github.com/dialectlabs/blinks
- Dialect docs: https://docs.dialect.to/blinks
- Privy TMA blog: https://privy.io/blog/building-telegram-apps
- Privy auto-wallet: https://docs.privy.io/basics/react/advanced/automatic-wallet-creation
- Privy pregeneration: https://docs-legacy.privy.io/guide/server/wallets/new-user
- Privy server signing policies: https://docs.privy.io/wallets/wallets/policies-overview/quickstart
- Telegram Mini Apps: https://core.telegram.org/bots/webapps
- TG initData validation: https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
- TG seamless auth article: https://medium.com/@miralex13/seamless-authentication-in-telegram-mini-apps-building-a-secure-and-frictionless-user-experience-6249599e2693
- grammY: https://grammy.dev
- Vercel AI SDK: https://ai-sdk.dev
- MoonPay Recurring Buys: https://www.moonpay.com/business/onramp/recurring-buys
- Reflect: https://reflect.money
- Squads: https://docs.squads.so
- Tuk Tuk: https://github.com/helium/tuktuk
- Frontier resources: https://colosseum.com/frontier/resources