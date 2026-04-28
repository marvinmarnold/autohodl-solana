# autoHODL — Solana Frontier Hackathon

## What this is

A monorepo for autoHODL's Frontier hackathon submission (May 11, 2026 deadline).
Three workspaces:

- `packages/blinks-telegram` — public-goods library: render Solana
  Actions/Blinks inside Telegram Mini Apps.
- `packages/grammy-agent` — public-goods library: grammY middleware that
  routes configurable messages through an LLM with tool calling, including
  first-class support for Blink-output tools.
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
- **Telegram bot:** grammY (webhook mode, serverless-compatible).
- **Mini App webview:** Next.js, deployed to Vercel.
- **LLM:** Vercel AI SDK as the reference, with Anthropic Claude as default
  provider.

## Architecture

```
[User in Telegram Mini App or chat]
│
│ Action URL (Blink) or natural-language message
▼
[grammy-agent middleware] ──────▶ [LLM tool call] ──▶ [Blink URL]
│
▼
[blinks-telegram renders]
│
▼
[Action API endpoint] ── returns serialized tx ──▶ [Privy wallet signs]
│                                                   │
│                                                   ▼
│                                          [Solana network]
│                                                   │
▼                                                   ▼
[Backend scheduler]                              [autoHODL on-chain program]
(Mac for M2,                                        ├── deposit
Tuk Tuk for M3)                                     ├── withdraw
├── spend (atomic unwind)
└── CPIs into Reflect
```
## Milestones

### M1 — Wallet auto-creation + Reflect deposit
Mini App opens, Privy provisions a wallet silently from validated Telegram
`initData`, user manually funds with USDC, taps a Blink rendered by
`blinks-telegram` to deposit into Reflect via the autoHODL on-chain program,
yield accrues.

### M2 — MoonPay scheduling + SYTs + spending
User configures a recurring schedule. MoonPay deposits USDC to the user's
wallet on schedule. Local backend (running on Marvin's Mac) detects USDC
arrival and triggers a deposit-into-Reflect transaction signed via Privy
server-signing with a scoped policy. The on-chain program gains a
`spend_atomic` instruction that redeems USDC+ → USDC → transfers to recipient
in one transaction (the SYT primitive). User can spend via a Blink.

### M3 — Squads Smart Account + Tuk Tuk + grammy-agent
Replace Privy-EOA-with-server-signing with a Squads Smart Account where
autoHODL is a constrained delegate authority. Replace Mac scheduler with
on-chain cron via Tuk Tuk. Build `grammy-agent` library and use it to add
conversational round-up onboarding to the autoHODL bot.

## Cross-cutting design notes

- **Wallet abstraction.** M1/M2 use Privy. M3 may add Squads. Keep wallet
  operations contained to one module so swapping is feasible — but defer
  designing a formal interface until M2 when we know what actually varies.
  Don't over-abstract early.

- **On-chain framework choice.** Anchor is the default if Reflect exposes a
  clean IDL and CPI surface. Switch to raw `solana-program` if Reflect's
  account layouts make Anchor's macros fight us. Decide after M1 task 5.

- **Library dogfooding.** `apps/autohodl` should consume `blinks-telegram`
  and (in M3) `grammy-agent` exactly as an external user would, via the
  workspace dependency. If it ever needs to reach into library internals,
  that's a sign the library API is wrong and should be fixed.

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
   Telegram WebView.
2. Reflect's program is callable via CPI from our own program (vs SDK-only).
3. MoonPay scheduled buys can target an arbitrary Solana destination address.

These three unknowns gate the architecture. Don't write production code that
depends on any of them until the spike confirms them.

## Demo flow (record last)

1. User opens @autohodl bot in Telegram, taps "Open Mini App."
2. Mini App loads, wallet auto-provisioned silently.
3. User taps "Configure Savings" → Blink renders inline → picks $20/week →
   signs silently via Privy.
4. Cut to one cycle later: balance shows accumulated USDC+ earning yield.
5. User taps "Spend $5 to vendor" → Blink → recipient → signs.
6. Show Solscan: ONE transaction, multiple CPIs (Reflect redeem + transfer).

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