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

Fill in the values — see comments in the file. For values you need to generate:

```sh
# SESSION_SECRET — 32+ random bytes
openssl rand -base64 32

# PRIVY_CUSTOM_AUTH_PRIVATE_KEY — EC keypair for custom-auth JWTs
openssl genpkey -algorithm EC -pkeyopt ec_paramgen_curve:P-256 -outform PEM 2>/dev/null \
  | base64 | tr -d '\n'

# AUTOHODL_DELEGATE_PUBKEY — throwaway pubkey for M1 testing (replace with real PDA later)
bun -e "const {Keypair}=require('@solana/web3.js'); console.log(Keypair.generate().publicKey.toBase58())"
```

Set `NEXT_PUBLIC_PRIVY_APP_ID` to the same value as `PRIVY_APP_ID`.
Set `NEXT_PUBLIC_SOLANA_RPC_URL` to the same value as `SOLANA_RPC_URL`.

### 2. Register the JWKS URL in Privy (one-time)

The JWKS URL tells Privy how to verify the custom-auth JWTs your server issues.
It is **stable** — you only do this once, not per tunnel rotation.

1. Start the dev server temporarily: `bun run --cwd apps/autohodl dev`
2. Privy dashboard → your app → **Authentication** → **Custom auth**
3. Set JWKS URL to `https://<your-tunnel-url>/jwks.json`
   - For production: use your Vercel URL — `https://<your-vercel-app>.vercel.app/jwks.json`
   - `public/jwks.json` is a static file baked from the private key at key-generation time

### 3. Set the Telegram webhook

```sh
# Start the cloudflared tunnel (Terminal 1)
cloudflared tunnel --url http://localhost:3000

# Point webhook at the tunnel URL and update .env.local (Terminal 2)
./dev.sh https://<url-from-cloudflared>
```

`dev.sh` updates `NEXT_PUBLIC_MINI_APP_URL` in `.env.local` and calls `setWebhook` on Telegram.
Run it every time your tunnel URL rotates.

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

## Updating public/jwks.json (if you rotate the EC keypair)

`public/jwks.json` contains the public half of `PRIVY_CUSTOM_AUTH_PRIVATE_KEY`.
If you ever regenerate the keypair, regenerate the file too:

```sh
bun -e "
const {createPrivateKey,createPublicKey}=require('crypto');
const pem=require('fs').readFileSync('/dev/stdin','utf8');
const pub=createPublicKey(createPrivateKey(pem));
const jwk=pub.export({format:'jwk'});
console.log(JSON.stringify({keys:[{...jwk,kid:'k1',use:'sig',alg:'ES256'}]},null,2));
" < <(echo "$PRIVY_CUSTOM_AUTH_PRIVATE_KEY" | base64 -d) > apps/autohodl/public/jwks.json
```

Then update the JWKS URL in Privy dashboard if the file content changed.
