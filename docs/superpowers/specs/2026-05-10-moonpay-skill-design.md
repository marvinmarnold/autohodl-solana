# MoonPay Skill — Design Spec

**Date:** 2026-05-10  
**Status:** Approved

---

## Overview

Two packages ship as public goods for the Frontier hackathon:

- `packages/solana-action-client` — wallet-agnostic library for processing any Solana Action endpoint
- `packages/moonpay-skill` — MCP server that combines autoHODL lookup with generic Solana Action tooling, designed to run alongside MoonPay's own `mp mcp` server

The skill enables an AI agent (e.g. Claude Desktop, Cursor) to set up autoHODL savings for a user without any additional signing server. Signing is delegated to MoonPay's local CLI, which exposes its own MCP tools for `transaction_sign` and `transaction_send`.

---

## Architecture

Two MCP servers are configured side-by-side in the agent host:

```
Claude Desktop
├── moonpay MCP  (mp mcp)            — signing, wallet, market data
└── autohodl MCP (node dist/index.js) — Solana Actions protocol + lookup
```

The agent orchestrates across both. Our skill has zero knowledge of signing — it only speaks the Solana Actions protocol. MoonPay's CLI handles all key material locally.

---

## Package: `solana-action-client`

**Location:** `packages/solana-action-client/src/index.ts`

Exports three functions:

### `prepareAction(opts)`

```typescript
type PrepareActionOpts = {
  actionUrl: string;
  account: string;
  params?: Record<string, unknown>;
};

type PrepareActionResult = {
  txBase64: string;
  confirmUrl: string | null;  // resolved absolute URL from links.next.href
  message: string | null;
};
```

Steps:
1. `GET actionUrl` — validates response has `title` or `label` (real Action check)
2. `POST actionUrl` with `{ account, ...params }` — gets unsigned transaction
3. Resolves `links.next.href` to absolute URL (relative hrefs resolved against `actionUrl`)
4. Returns `{ txBase64, confirmUrl, message }`

### `confirmAction(confirmUrl, signature)`

```typescript
confirmAction(confirmUrl: string, signature: string): Promise<unknown>
```

Posts `{ signature }` to `confirmUrl`. Returns parsed JSON response. Non-2xx throws with status + body.

### `processAction(opts)` — unchanged

The existing monolithic function (GET → POST → sign → confirm) stays exported for non-MoonPay contexts where the caller injects their own `sign` callback. No breaking changes.

---

## Package: `moonpay-skill`

**Location:** `packages/moonpay-skill/src/`

### Tool list

| Tool | Description |
|------|-------------|
| `autohodl_lookup` | Check if a wallet has autoHODL configured. Returns settings + USDC balance, or null. |
| `autohodl_status` | Alias for `autohodl_lookup` (LLM discoverability). |
| `solana_action_prepare` | GET + POST a Solana Action endpoint. Returns unsigned tx base64, confirm URL, message. |
| `solana_action_confirm` | POST signature to a confirm URL. Returns server confirmation. |

### Removed

- `process_solana_action` — removed. Replaced by the prepare/confirm split.
- `moonpaySigner` — removed entirely. No `MOONPAY_SIGNER_URL`, no HTTP signing service.

### Environment variables

| Var | Required | Default |
|-----|----------|---------|
| `AUTOHODL_API_URL` | No | `https://autohodl.vercel.app` |

No signing-related env vars.

### Tool: `solana_action_prepare`

```
Input:
  actionUrl  string   — full URL to the Solana Action endpoint
  account    string   — signer's base58 public key
  params     object?  — merged into POST body (e.g. { freq, amount })

Output:
  { txBase64: string, confirmUrl: string | null, message: string | null }
```

### Tool: `solana_action_confirm`

```
Input:
  confirmUrl  string  — absolute URL from prepare step
  signature   string  — base58 transaction signature from MoonPay

Output: raw JSON from confirm endpoint
```

### `skill.json`

```json
{
  "name": "autohodl",
  "version": "0.1.0",
  "description": "Set up autoHODL scheduled USDC savings on Solana. Works alongside MoonPay CLI for signing.",
  "tools": ["autohodl_lookup", "autohodl_status", "solana_action_prepare", "solana_action_confirm"],
  "instructions": "To set up autoHODL savings: (1) call autohodl_lookup with the user's wallet address. If null, tell the user to send `/start <walletAddress>` to @autohodl_bot on Telegram and return once done. (2) Confirm savings frequency (daily/weekly/monthly) and amount in USD with the user. (3) call solana_action_prepare with the authorize URL, the wallet address as account, and { freq, amount } as params — this returns an unsigned transaction. (4) Use MoonPay tools to sign then send the transaction — pass the txBase64 to transaction_sign (wallet: main, chain: solana), then pass the signed result to transaction_send (chain: solana). (5) Call solana_action_confirm with the confirmUrl from step 3 and the signature from step 4. (6) Report success: savings are live."
}
```

---

## Agent flow (end-to-end)

```
User: "Set up autoHODL for my wallet 9xDef...abc"

1. autohodl_lookup("9xDef...abc")
   → null (not registered)
   → "Please send `/start 9xDef...abc` to @autohodl_bot, then come back"

[User registers via Telegram]

2. autohodl_lookup("9xDef...abc")
   → { telegramId: "123", settings: null, usdcBalance: 45.2 }

3. [Agent confirms: weekly, $20]

4. solana_action_prepare(
     actionUrl: "https://autohodl.vercel.app/api/actions/authorize",
     account: "9xDef...abc",
     params: { freq: "weekly", amount: 20 }
   )
   → { txBase64: "...", confirmUrl: "https://autohodl.vercel.app/api/actions/authorize/confirm?...", message: "Authorize autoHODL to save $20/week" }

5. moonpay.transaction_sign(wallet: "main", chain: "solana", transaction: txBase64)
   → signedTx

6. moonpay.transaction_send(chain: "solana", transaction: signedTx)
   → { signature: "5abc...xyz" }

7. solana_action_confirm(
     confirmUrl: "https://autohodl.vercel.app/api/actions/authorize/confirm?...",
     signature: "5abc...xyz"
   )
   → { type: "completed", message: "✅ Savings authorized!" }

"✅ autoHODL is live — $20/week will be saved starting your next MoonPay deposit."
```

---

## Setup instructions (README)

One-time setup:

```bash
npm install -g @moonpay/cli
mp login --email you@example.com
mp verify --email you@example.com --code 123456
mp wallet create --name main   # or: mp wallet import --name main
```

Add both MCPs to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "moonpay": { "command": "mp", "args": ["mcp"] },
    "autohodl": {
      "command": "npx",
      "args": ["-y", "@autohodl/moonpay-skill"],
      "env": { "AUTOHODL_API_URL": "https://autohodl.vercel.app" }
    }
  }
}
```

---

## Files changed

**Modified:**
- `packages/solana-action-client/src/index.ts` — add `prepareAction`, `confirmAction` exports
- `packages/moonpay-skill/src/index.ts` — remove `moonpaySigner`, replace `process_solana_action` with `solana_action_prepare` + `solana_action_confirm`
- `packages/moonpay-skill/src/tools.ts` — add `prepareAction`/`confirmAction` wrappers, remove `processSolanaAction`
- `packages/moonpay-skill/skill.json` — update tool list and instructions

**New:**
- `packages/moonpay-skill/README.md` — setup instructions
- `packages/solana-action-client/README.md` — library usage docs

---

## What is NOT in scope

- Publishing either package to npm (manual step post-hackathon)
- MoonPay REST API signing (not needed — `mp mcp` handles it)
- Handling Solana Actions with interactive `parameters` input fields
- Confirmation polling / finality waiting (signature returned immediately from `transaction_send`)
