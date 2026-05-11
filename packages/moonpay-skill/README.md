# @autohodl/moonpay-skill

MCP skill for setting up [autoHODL](https://autohodl.vercel.app) scheduled USDC savings on Solana. Designed to run alongside [MoonPay CLI](https://support.moonpay.com/en/articles/586583-moonpay-cli-for-ai-agents) (`mp mcp`), which handles transaction signing locally — no additional server required.

## One-time setup

**Install MoonPay CLI and authenticate:**

```bash
npm install -g @moonpay/cli
mp login --email you@example.com
mp verify --email you@example.com --code 123456
mp wallet create --name main   # or: mp wallet import --name main
```

**Add both MCP servers to your agent config** (e.g. `claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "moonpay": { "command": "mp", "args": ["mcp"] },
    "autohodl": {
      "command": "npx",
      "args": ["-y", "@autohodl/moonpay-skill"],
      "env": {
        "AUTOHODL_API_URL": "https://autohodl.vercel.app"
      }
    }
  }
}
```

## Tools

| Tool | Description |
|------|-------------|
| `autohodl_lookup` | Check if a wallet has autoHODL configured. Returns settings + USDC balance, or null. |
| `autohodl_status` | Alias for `autohodl_lookup`. |
| `solana_action_prepare` | Fetch a Solana Action and return the unsigned transaction + confirm URL. |
| `solana_action_confirm` | Post the transaction signature to complete the action. |

## Agent flow

The agent orchestrates across both MCP servers — autoHODL handles the Solana Actions protocol, MoonPay handles signing:

```
1. autohodl_lookup(wallet)
   → null? → "Send /start <wallet> to @autohodl_bot on Telegram"

2. [User confirms: weekly, $20]

3. solana_action_prepare(
     actionUrl: "https://autohodl.vercel.app/api/actions/authorize",
     account: wallet,
     params: { freq: "weekly", amount: 20 }
   )
   → { txBase64, confirmUrl, message }

4. moonpay.transaction_sign(wallet: "main", chain: "solana", transaction: txBase64)
   → signedTx

5. moonpay.transaction_send(chain: "solana", transaction: signedTx)
   → { signature }

6. solana_action_confirm(confirmUrl, signature)   ← only if confirmUrl is non-null
   → { type: "completed", message: "✅ Savings authorized!" }
```

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `AUTOHODL_API_URL` | `https://autohodl.vercel.app` | autoHODL backend URL |
