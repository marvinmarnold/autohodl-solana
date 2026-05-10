# autoHODL — Solana

Scheduled USDC savings on Solana, surfaced as Solana Actions/Blinks inside a Telegram Mini App.

See [CLAUDE.md](./CLAUDE.md) for full project context, milestone plan, architecture, and conventions.

## Workspaces

| Package | Description |
|---|---|
| `packages/blinks-telegram` | Public-goods library: render Solana Actions/Blinks inside Telegram Mini Apps |
| `packages/grammy-agent` | Public-goods library: grammY middleware with LLM tool calling and Blink-output support (M3) |
| `apps/autohodl` | Consumer product: Telegram bot, Mini App webview, Solana Actions API, on-chain program |

## Tooling

- **Runtime / package manager:** [Bun](https://bun.sh)
- **Language:** TypeScript (strict)
- **Lint / format:** [Biome](https://biomejs.dev)

## Getting started

```sh
bun install
```

## Local dev setup (first time)

### 1. Copy and fill env vars

```sh
cp apps/autohodl/.env.local.example apps/autohodl/.env.local
```

Fill in the values — see comments in the file. Two values need to be generated:

```sh
# SESSION_SECRET — 32+ random bytes
openssl rand -base64 32

# AUTOHODL_DELEGATE_PUBKEY — throwaway pubkey for M1 testing (replace with real PDA later)
bun -e "const {Keypair}=require('@solana/web3.js'); console.log(Keypair.generate().publicKey.toBase58())"
```

The wallet signing architecture uses **Privy server wallets** — wallets with no owner,
signed server-side using Basic auth (app ID + app secret). No client-side SDK or custom
JWT infrastructure needed.

### 2. Set the Telegram webhook

```sh
# Terminal 1 — tunnel
cloudflared tunnel --url http://localhost:3000

# Terminal 2 — point webhook at the tunnel URL and update .env.local
./dev.sh https://<url-from-cloudflared>
```

`dev.sh` updates `NEXT_PUBLIC_MINI_APP_URL` in `.env.local` and calls `setWebhook` on Telegram.
Run it every time your tunnel URL rotates, then restart the dev server.

## Per-session dev workflow

```sh
# Terminal 1 — tunnel
cloudflared tunnel --url http://localhost:3000

# Terminal 2 — dev server (restart after ./dev.sh to pick up new MINI_APP_URL)
bun run --cwd apps/autohodl dev

# Terminal 3 — when tunnel URL changes
./dev.sh https://<new-tunnel-url>
# then restart Terminal 2
```
