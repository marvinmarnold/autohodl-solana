# MoonPay Skill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `prepareAction`/`confirmAction` to `solana-action-client`, replace `process_solana_action` with a prepare/confirm split in `moonpay-skill`, remove all signing code, and ship READMEs for both packages.

**Architecture:** Two MCP servers run side-by-side in the agent host — MoonPay's `mp mcp` handles signing, our skill handles Solana Actions protocol + autoHODL lookup. `solana-action-client` exports three functions: `prepareAction`, `confirmAction`, and the unchanged `processAction`. `moonpay-skill` wraps the new two as MCP tools, removing all `moonpaySigner`/`MOONPAY_SIGNER_URL` code.

**Tech Stack:** TypeScript (strict), Bun (build + test), `@modelcontextprotocol/sdk`, `@solana/web3.js`, `bun:test` for unit tests.

---

## File map

| File | Action | Responsibility |
|------|--------|----------------|
| `packages/solana-action-client/src/index.ts` | Modify | Add `prepareAction`, `confirmAction` exports alongside existing `processAction` |
| `packages/solana-action-client/src/index.test.ts` | Create | Unit tests for `prepareAction` and `confirmAction` |
| `packages/solana-action-client/tsconfig.json` | Modify | Exclude test files from compilation output |
| `packages/solana-action-client/package.json` | Modify | Add `@types/bun` devDependency, add `test` script |
| `packages/moonpay-skill/src/tools.ts` | Modify | Remove `processSolanaAction`, add `prepareActionTool`/`confirmActionTool` wrappers |
| `packages/moonpay-skill/src/index.ts` | Modify | Remove `moonpaySigner`/`MOONPAY_SIGNER_URL`, swap tool definitions and handlers |
| `packages/moonpay-skill/skill.json` | Modify | Update tool list and instructions |
| `packages/solana-action-client/README.md` | Create | Library usage docs |
| `packages/moonpay-skill/README.md` | Create | MCP setup + agent flow docs |

---

### Task 1: Add `prepareAction` + `confirmAction` to `solana-action-client`

**Files:**
- Modify: `packages/solana-action-client/src/index.ts`
- Modify: `packages/solana-action-client/tsconfig.json`
- Modify: `packages/solana-action-client/package.json`
- Create: `packages/solana-action-client/src/index.test.ts`

- [ ] **Step 1: Add `@types/bun` and test script to `package.json`**

Open `packages/solana-action-client/package.json` and add the devDependency and test script:

```json
{
  "name": "@autohodl/solana-action-client",
  "version": "0.1.0",
  "description": "Wallet-agnostic Solana Actions client library",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "scripts": {
    "build": "tsc --project tsconfig.json",
    "dev": "tsc --project tsconfig.json --watch",
    "test": "bun test"
  },
  "dependencies": {
    "@solana/web3.js": "^1.95.8"
  },
  "devDependencies": {
    "@types/bun": "latest",
    "typescript": "^5.7.3"
  }
}
```

- [ ] **Step 2: Exclude test files from `tsconfig.json`**

Open `packages/solana-action-client/tsconfig.json` and add an `exclude` field so test files don't end up in `dist/`:

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  },
  "include": ["src"],
  "exclude": ["src/**/*.test.ts"]
}
```

- [ ] **Step 3: Write the failing tests**

Create `packages/solana-action-client/src/index.test.ts`:

```typescript
import { describe, it, expect, beforeEach, mock } from "bun:test";
import { prepareAction, confirmAction } from "./index.js";

// Mock fetch globally for all tests in this file
const fetchMock = mock();
global.fetch = fetchMock as unknown as typeof fetch;

beforeEach(() => {
  fetchMock.mockReset();
});

// ── prepareAction ─────────────────────────────────────────────────────────────

describe("prepareAction", () => {
  it("returns txBase64, confirmUrl, and message on success", async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ title: "Test Action", description: "desc" }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          transaction: "base64tx==",
          message: "Sign to authorize",
          links: { next: { type: "post", href: "https://api.example.com/confirm?foo=1" } },
        }),
      } as Response);

    const result = await prepareAction({
      actionUrl: "https://api.example.com/actions/save",
      account: "9xDefABCabc123",
      params: { freq: "weekly", amount: 20 },
    });

    expect(result.txBase64).toBe("base64tx==");
    expect(result.confirmUrl).toBe("https://api.example.com/confirm?foo=1");
    expect(result.message).toBe("Sign to authorize");
  });

  it("resolves relative confirmUrl against actionUrl", async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ label: "Act" }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          transaction: "tx",
          links: { next: { type: "post", href: "/confirm?a=1" } },
        }),
      } as Response);

    const result = await prepareAction({
      actionUrl: "https://api.example.com/actions/save",
      account: "wallet",
    });

    expect(result.confirmUrl).toBe("https://api.example.com/confirm?a=1");
  });

  it("returns null confirmUrl when links.next is absent", async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ title: "Act" }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ transaction: "tx" }),
      } as Response);

    const result = await prepareAction({
      actionUrl: "https://api.example.com/actions/save",
      account: "wallet",
    });

    expect(result.confirmUrl).toBeNull();
    expect(result.message).toBeNull();
  });

  it("throws when GET returns non-2xx", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 404 } as Response);

    expect(
      prepareAction({ actionUrl: "https://api.example.com/actions/save", account: "wallet" }),
    ).rejects.toThrow("Action GET failed: 404");
  });

  it("throws when GET response is not a valid Action", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ icon: "only-icon-no-label" }),
    } as Response);

    expect(
      prepareAction({ actionUrl: "https://api.example.com/actions/save", account: "wallet" }),
    ).rejects.toThrow("does not appear to be a Solana Action");
  });

  it("throws when POST returns non-2xx", async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ title: "Act" }),
      } as Response)
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => "internal error",
      } as Response);

    expect(
      prepareAction({ actionUrl: "https://api.example.com/actions/save", account: "wallet" }),
    ).rejects.toThrow("Action POST failed: 500");
  });

  it("merges params into POST body alongside account", async () => {
    let capturedBody: unknown;
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ title: "Act" }),
      } as Response)
      .mockImplementationOnce(async (_url: string, init?: RequestInit) => {
        capturedBody = JSON.parse(init?.body as string);
        return { ok: true, json: async () => ({ transaction: "tx" }) } as Response;
      });

    await prepareAction({
      actionUrl: "https://api.example.com/actions/save",
      account: "mywallet",
      params: { freq: "daily", amount: 5 },
    });

    expect(capturedBody).toEqual({ account: "mywallet", freq: "daily", amount: 5 });
  });
});

// ── confirmAction ─────────────────────────────────────────────────────────────

describe("confirmAction", () => {
  it("posts signature and returns parsed JSON", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ type: "completed", message: "✅ Done" }),
    } as Response);

    const result = await confirmAction("https://api.example.com/confirm", "sig123");

    expect(result).toEqual({ type: "completed", message: "✅ Done" });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.example.com/confirm");
    expect(JSON.parse(init.body as string)).toEqual({ signature: "sig123" });
  });

  it("throws on non-2xx with status and body in message", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 400,
      text: async () => "bad signature",
    } as Response);

    expect(confirmAction("https://api.example.com/confirm", "badsig")).rejects.toThrow(
      "Confirm POST failed: 400",
    );
  });
});
```

- [ ] **Step 4: Run the tests — expect failures**

```bash
cd /path/to/autohodl-solana
bun test packages/solana-action-client/src/index.test.ts
```

Expected: tests fail with `prepareAction is not a function` or similar (functions not yet exported).

- [ ] **Step 5: Add `prepareAction` and `confirmAction` to `index.ts`**

Open `packages/solana-action-client/src/index.ts` and add these two exports after the existing types and before `processAction`. Leave `processAction` completely unchanged.

Add these new types near the top (after the existing type definitions):

```typescript
export type PrepareActionOpts = {
  actionUrl: string;
  account: string;
  params?: Record<string, unknown>;
};

export type PrepareActionResult = {
  txBase64: string;
  confirmUrl: string | null;
  message: string | null;
};
```

Then add these two functions after the `ProcessActionResult` type and before `processAction`:

```typescript
/**
 * Fetches and validates a Solana Action, then POSTs to get an unsigned transaction.
 * Returns the base64 tx, the resolved confirm URL (from links.next), and the message.
 * Does NOT sign — caller is responsible for signing and broadcasting.
 */
export async function prepareAction(opts: PrepareActionOpts): Promise<PrepareActionResult> {
  const { actionUrl, account, params = {} } = opts;

  // Step 1: validate it's a real Action
  const getRes = await fetch(actionUrl, { headers: { Accept: "application/json" } });
  if (!getRes.ok) {
    throw new Error(`Action GET failed: ${getRes.status} ${actionUrl}`);
  }
  const actionMeta = (await getRes.json()) as ActionGetResponse;
  if (!actionMeta.label && !actionMeta.title) {
    throw new Error(
      `Response from ${actionUrl} does not appear to be a Solana Action (missing label/title)`,
    );
  }

  // Step 2: POST to get the unsigned transaction
  const postRes = await fetch(actionUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ account, ...params }),
  });
  if (!postRes.ok) {
    const body = await postRes.text().catch(() => "(unreadable)");
    throw new Error(`Action POST failed: ${postRes.status} — ${body}`);
  }
  const postData = (await postRes.json()) as ActionPostResponse;
  if (!postData.transaction) {
    throw new Error("Action POST response missing transaction field");
  }

  // Step 3: resolve links.next.href to an absolute URL
  const nextHref = postData.links?.next?.href ?? null;
  let confirmUrl: string | null = null;
  if (nextHref) {
    confirmUrl = nextHref.startsWith("http")
      ? nextHref
      : new URL(nextHref, actionUrl).toString();
  }

  return {
    txBase64: postData.transaction,
    confirmUrl,
    message: postData.message ?? null,
  };
}

/**
 * Posts a transaction signature to the confirm URL (links.next chain-call).
 * Returns the parsed JSON response from the server.
 * Throws on non-2xx responses.
 */
export async function confirmAction(confirmUrl: string, signature: string): Promise<unknown> {
  const res = await fetch(confirmUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ signature }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "(unreadable)");
    throw new Error(`Confirm POST failed: ${res.status} — ${body}`);
  }
  return res.json();
}
```

- [ ] **Step 6: Run tests — expect all to pass**

```bash
bun test packages/solana-action-client/src/index.test.ts
```

Expected: all tests pass (12 tests, 0 failures).

- [ ] **Step 7: Build the package**

```bash
bun run --filter @autohodl/solana-action-client build
```

Expected: exits 0, `dist/` updated with new exports.

- [ ] **Step 8: Install new devDependency**

```bash
bun install
```

Expected: `@types/bun` added to lockfile.

- [ ] **Step 9: Commit**

```bash
git add packages/solana-action-client/
git commit -m "feat(solana-action-client): add prepareAction and confirmAction exports"
```

---

### Task 2: Update `moonpay-skill` tools and server

**Files:**
- Modify: `packages/moonpay-skill/src/tools.ts`
- Modify: `packages/moonpay-skill/src/index.ts`

- [ ] **Step 1: Rewrite `tools.ts`**

Replace the entire contents of `packages/moonpay-skill/src/tools.ts` with:

```typescript
import { prepareAction, confirmAction } from "@autohodl/solana-action-client";

type LookupResult = {
  telegramId: string;
  walletAddress: string;
  settings: {
    savingsFrequency: string;
    savingsAmountUsd: number;
    fundingFrequency?: string;
    fundingAmountUsd?: number;
  } | null;
  usdcBalance: number | null;
} | null;

export async function autohodlLookup(
  walletAddress: string,
  apiUrl: string,
): Promise<LookupResult> {
  const res = await fetch(`${apiUrl}/api/agent/lookup?wallet=${encodeURIComponent(walletAddress)}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`lookup failed: ${res.status}`);
  return res.json() as Promise<LookupResult>;
}

export async function autohodlStatus(
  walletAddress: string,
  apiUrl: string,
): Promise<LookupResult> {
  return autohodlLookup(walletAddress, apiUrl);
}

export type PrepareToolInput = {
  actionUrl: string;
  account: string;
  params?: Record<string, unknown>;
};

export async function prepareActionTool(input: PrepareToolInput) {
  return prepareAction({
    actionUrl: input.actionUrl,
    account: input.account,
    params: input.params,
  });
}

export type ConfirmToolInput = {
  confirmUrl: string;
  signature: string;
};

export async function confirmActionTool(input: ConfirmToolInput) {
  return confirmAction(input.confirmUrl, input.signature);
}
```

- [ ] **Step 2: Rewrite `index.ts`**

Replace the entire contents of `packages/moonpay-skill/src/index.ts` with:

```typescript
#!/usr/bin/env node
/**
 * @autohodl/moonpay-skill — MCP server
 *
 * Exposes four tools:
 *   autohodl_lookup       — check if a wallet has autoHODL savings configured
 *   autohodl_status       — alias for lookup (LLM discoverability)
 *   solana_action_prepare — GET + POST a Solana Action, return unsigned tx + confirm URL
 *   solana_action_confirm — POST signature to confirm URL (links.next chain-call)
 *
 * Signing is delegated to MoonPay's `mp mcp` server running alongside this one.
 * This skill has no signing capability and requires no signing-related env vars.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import {
  autohodlLookup,
  autohodlStatus,
  prepareActionTool,
  confirmActionTool,
} from "./tools.js";

const AUTOHODL_API_URL = process.env["AUTOHODL_API_URL"] ?? "https://autohodl.vercel.app";

const server = new Server(
  { name: "autohodl-skill", version: "0.1.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, () => ({
  tools: [
    {
      name: "autohodl_lookup",
      description:
        "Check if a Solana wallet address has autoHODL savings configured. Returns current settings and USDC balance, or null if not registered. If null, tell the user to send `/start <walletAddress>` to the @autohodl_bot on Telegram.",
      inputSchema: {
        type: "object",
        properties: {
          walletAddress: { type: "string", description: "Base58 Solana wallet address" },
          apiUrl: {
            type: "string",
            description: "autoHODL API base URL (optional, defaults to production)",
          },
        },
        required: ["walletAddress"],
      },
    },
    {
      name: "autohodl_status",
      description:
        "Get current autoHODL savings status for a wallet — savings schedule, balance, and funding config.",
      inputSchema: {
        type: "object",
        properties: {
          walletAddress: { type: "string", description: "Base58 Solana wallet address" },
          apiUrl: { type: "string", description: "autoHODL API base URL (optional)" },
        },
        required: ["walletAddress"],
      },
    },
    {
      name: "solana_action_prepare",
      description:
        "Fetch a Solana Action endpoint and get an unsigned transaction. Returns the base64-encoded transaction, the confirm URL (to call after signing), and the action message. Pass the txBase64 to MoonPay's transaction_sign tool, then transaction_send, then call solana_action_confirm.",
      inputSchema: {
        type: "object",
        properties: {
          actionUrl: { type: "string", description: "Full URL to the Solana Action endpoint" },
          account: { type: "string", description: "Signer's base58 public key" },
          params: {
            type: "object",
            description:
              "Additional parameters merged into the POST body (e.g. { freq: 'weekly', amount: 20 })",
            additionalProperties: true,
          },
        },
        required: ["actionUrl", "account"],
      },
    },
    {
      name: "solana_action_confirm",
      description:
        "Complete a Solana Action by posting the transaction signature to the confirm URL returned by solana_action_prepare. Returns the server confirmation.",
      inputSchema: {
        type: "object",
        properties: {
          confirmUrl: {
            type: "string",
            description: "The confirmUrl returned by solana_action_prepare",
          },
          signature: {
            type: "string",
            description: "The base58 transaction signature returned by MoonPay's transaction_send",
          },
        },
        required: ["confirmUrl", "signature"],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params;

  try {
    if (name === "autohodl_lookup") {
      const { walletAddress, apiUrl } = args as { walletAddress: string; apiUrl?: string };
      const result = await autohodlLookup(walletAddress, apiUrl ?? AUTOHODL_API_URL);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }

    if (name === "autohodl_status") {
      const { walletAddress, apiUrl } = args as { walletAddress: string; apiUrl?: string };
      const result = await autohodlStatus(walletAddress, apiUrl ?? AUTOHODL_API_URL);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }

    if (name === "solana_action_prepare") {
      const { actionUrl, account, params } = args as {
        actionUrl: string;
        account: string;
        params?: Record<string, unknown>;
      };
      const result = await prepareActionTool({ actionUrl, account, params });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }

    if (name === "solana_action_confirm") {
      const { confirmUrl, signature } = args as { confirmUrl: string; signature: string };
      const result = await confirmActionTool({ confirmUrl, signature });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }

    return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("autoHODL MoonPay Skill running on stdio");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 3: Build `moonpay-skill`**

```bash
bun run --filter @autohodl/moonpay-skill build
```

Expected: exits 0, no TypeScript errors. `dist/index.js` updated.

- [ ] **Step 4: Commit**

```bash
git add packages/moonpay-skill/src/
git commit -m "feat(moonpay-skill): replace process_solana_action with prepare/confirm split, remove signing code"
```

---

### Task 3: Update `skill.json`

**Files:**
- Modify: `packages/moonpay-skill/skill.json`

- [ ] **Step 1: Replace `skill.json`**

Replace the entire contents of `packages/moonpay-skill/skill.json` with:

```json
{
  "name": "autohodl",
  "version": "0.1.0",
  "description": "Set up autoHODL scheduled USDC savings on Solana. Works alongside MoonPay CLI (mp mcp) for signing — no additional server required.",
  "tools": ["autohodl_lookup", "autohodl_status", "solana_action_prepare", "solana_action_confirm"],
  "instructions": "To set up autoHODL savings: (1) Call autohodl_lookup with the user's Solana wallet address. If the result is null, tell the user to send `/start <walletAddress>` to @autohodl_bot on Telegram and wait for them to confirm before continuing. (2) Confirm the savings frequency (daily/weekly/monthly) and amount in USD with the user. (3) Call solana_action_prepare with actionUrl='https://autohodl.vercel.app/api/actions/authorize', account=<walletAddress>, and params={ freq: <frequency>, amount: <usdAmount> }. This returns { txBase64, confirmUrl, message }. (4) Use MoonPay tools to sign and broadcast: call transaction_sign with wallet='main', chain='solana', transaction=<txBase64> to get the signed transaction; then call transaction_send with chain='solana', transaction=<signedTx> to get the signature. (5) Call solana_action_confirm with the confirmUrl from step 3 and the signature from step 4. (6) Report to the user: autoHODL is live and their savings schedule is active."
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/moonpay-skill/skill.json
git commit -m "feat(moonpay-skill): update skill.json with prepare/confirm tool list and agent instructions"
```

---

### Task 4: Write READMEs

**Files:**
- Create: `packages/solana-action-client/README.md`
- Create: `packages/moonpay-skill/README.md`

- [ ] **Step 1: Write `solana-action-client/README.md`**

Create `packages/solana-action-client/README.md`:

```markdown
# @autohodl/solana-action-client

Wallet-agnostic TypeScript library for processing [Solana Actions](https://solana.com/docs/advanced/actions) endpoints.

## Install

```bash
npm install @autohodl/solana-action-client
```

## API

### `prepareAction(opts)` — get an unsigned transaction

Fetches the Action metadata, POSTs to get an unsigned transaction, and resolves the confirm URL. Does not sign.

```typescript
import { prepareAction } from "@autohodl/solana-action-client";

const { txBase64, confirmUrl, message } = await prepareAction({
  actionUrl: "https://autohodl.vercel.app/api/actions/authorize",
  account: "9xDef...abc",          // signer's public key
  params: { freq: "weekly", amount: 20 },
});
// txBase64   — base64-encoded unsigned transaction
// confirmUrl — absolute URL to POST signature to (or null if no chain-call)
// message    — human-readable action message (or null)
```

### `confirmAction(confirmUrl, signature)` — complete the action

Posts the transaction signature to the confirm URL returned by `prepareAction`.

```typescript
import { confirmAction } from "@autohodl/solana-action-client";

const result = await confirmAction(confirmUrl, signature);
// result — parsed JSON from the server (e.g. { type: "completed", message: "✅ Done" })
```

### `processAction(opts)` — full round-trip with injected signer

For contexts where you control the signer. Fetches, POSTs, calls your `sign` callback, and follows `links.next`.

```typescript
import { processAction } from "@autohodl/solana-action-client";

const { signature } = await processAction({
  actionUrl: "https://...",
  account: "9xDef...abc",
  params: { freq: "weekly", amount: 20 },
  sign: async (txBase64) => {
    // sign and broadcast, return signature
    return myWallet.signAndSend(txBase64);
  },
});
```

## Notes

- Does not handle Solana Actions with interactive `parameters` input fields.
- Relative `links.next.href` values are resolved against `actionUrl` automatically.
- All functions throw on non-2xx HTTP responses with status + body in the error message.
```

- [ ] **Step 2: Write `moonpay-skill/README.md`**

Create `packages/moonpay-skill/README.md`:

```markdown
# @autohodl/moonpay-skill

MCP skill for setting up [autoHODL](https://autohodl.vercel.app) scheduled USDC savings on Solana. Designed to run alongside [MoonPay CLI](https://support.moonpay.com/en/articles/586583-moonpay-cli-for-ai-agents) (`mp mcp`), which handles transaction signing.

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

6. solana_action_confirm(confirmUrl, signature)
   → { type: "completed", message: "✅ Savings authorized!" }
```

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `AUTOHODL_API_URL` | `https://autohodl.vercel.app` | autoHODL backend URL |
```

- [ ] **Step 3: Commit**

```bash
git add packages/solana-action-client/README.md packages/moonpay-skill/README.md
git commit -m "docs: add READMEs for solana-action-client and moonpay-skill"
```

---

### Task 5: Final build verification

- [ ] **Step 1: Build both packages from the root**

```bash
bun run --filter "@autohodl/solana-action-client" build && bun run --filter "@autohodl/moonpay-skill" build
```

Expected: both exit 0, no TypeScript errors.

- [ ] **Step 2: Run the full test suite**

```bash
bun test packages/solana-action-client/src/index.test.ts
```

Expected: all 12 tests pass.

- [ ] **Step 3: Smoke-test the MCP server starts**

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' | node packages/moonpay-skill/dist/index.js
```

Expected: JSON response listing all four tools (`autohodl_lookup`, `autohodl_status`, `solana_action_prepare`, `solana_action_confirm`). Server prints `autoHODL MoonPay Skill running on stdio` to stderr.
