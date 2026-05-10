#!/usr/bin/env node
/**
 * @autohodl/moonpay-skill — MCP server
 *
 * Exposes three tools:
 *   autohodl_lookup        — check if a wallet has autoHODL configured
 *   autohodl_status        — same as lookup (alias for LLM discoverability)
 *   process_solana_action  — sign + broadcast any Solana Action (public good)
 *
 * The signing capability is injected by the MoonPay CLI host via the
 * MOONPAY_SIGNER_URL env var, which points to a local signing service
 * the CLI spins up alongside this MCP server.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { autohodlLookup, autohodlStatus, processSolanaAction } from "./tools.js";

const AUTOHODL_API_URL = process.env["AUTOHODL_API_URL"] ?? "https://autohodl.vercel.app";
const MOONPAY_SIGNER_URL = process.env["MOONPAY_SIGNER_URL"] ?? "";
const DEFAULT_RPC = process.env["SOLANA_RPC_URL"] ?? "https://api.mainnet-beta.solana.com";

// Minimal signer that calls the MoonPay CLI's local signing service
const moonpaySigner = {
  async signAndBroadcast(txBase64: string, rpcUrl?: string): Promise<string> {
    if (!MOONPAY_SIGNER_URL) throw new Error("MOONPAY_SIGNER_URL not set — MoonPay CLI signing unavailable");
    const res = await fetch(`${MOONPAY_SIGNER_URL}/sign`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transaction: txBase64, rpcUrl: rpcUrl ?? DEFAULT_RPC }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "(unreadable)");
      throw new Error(`MoonPay signer failed: ${res.status} — ${body}`);
    }
    const data = (await res.json()) as { signature: string };
    return data.signature;
  },
};

const server = new Server(
  { name: "autohodl-skill", version: "0.1.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, () => ({
  tools: [
    {
      name: "autohodl_lookup",
      description: "Check if a Solana wallet address has autoHODL savings configured. Returns current settings and USDC balance, or null if not registered. If null, tell the user to send `/start <walletAddress>` to the @autohodl_bot on Telegram.",
      inputSchema: {
        type: "object",
        properties: {
          walletAddress: { type: "string", description: "Base58 Solana wallet address" },
          apiUrl: { type: "string", description: "autoHODL API base URL (optional, defaults to production)" },
        },
        required: ["walletAddress"],
      },
    },
    {
      name: "autohodl_status",
      description: "Get current autoHODL savings status for a wallet — savings schedule, balance, and funding config.",
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
      name: "process_solana_action",
      description: "Sign and broadcast any Solana Action. Fetches the Action, gets the unsigned transaction, signs with MoonPay CLI, broadcasts, and follows links.next chaining. Works with any standard Solana Actions endpoint.",
      inputSchema: {
        type: "object",
        properties: {
          actionUrl: { type: "string", description: "Full URL to the Solana Action endpoint" },
          account: { type: "string", description: "Signer's base58 public key" },
          params: {
            type: "object",
            description: "Additional parameters merged into the POST body (e.g. { telegramId, freq, amount })",
            additionalProperties: true,
          },
          rpcUrl: { type: "string", description: "Solana RPC URL (optional, defaults to mainnet-beta)" },
        },
        required: ["actionUrl", "account"],
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

    if (name === "process_solana_action") {
      const { actionUrl, account, params, rpcUrl } = args as {
        actionUrl: string;
        account: string;
        params?: Record<string, unknown>;
        rpcUrl?: string;
      };
      const result = await processSolanaAction({
        actionUrl,
        account,
        params,
        rpcUrl,
        signer: moonpaySigner,
      });
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
