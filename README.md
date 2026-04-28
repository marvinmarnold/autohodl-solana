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
bun lint
bun fmt
```
