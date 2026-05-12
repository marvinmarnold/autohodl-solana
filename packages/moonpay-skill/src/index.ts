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

const AUTOHODL_API_URL = process.env["AUTOHODL_API_URL"] ?? "https://autohodl-solana-autohodl-bzflgqp54-locker-money.vercel.app";

const server = new Server(
  { name: "autohodl-skill", version: "0.1.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, () => ({
  tools: [
    {
      name: "autohodl_lookup",
      description:
        "Check if a Solana wallet address has autoHODL savings configured. Returns { walletAddress, vaultAddress, walletUsdcBalance, vaultUsdcBalance, settings } or null if not registered. The vaultAddress is the Squads v4 PDA where production funds live; the wallet signs as Squads authority. If null, tell the user to send `/start <walletAddress>` to the @autohodl_bot on Telegram.",
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
        "Get current autoHODL savings status for a wallet — savings schedule, vault address, wallet USDC balance, and vault USDC balance. Returns null if the wallet is not registered; if null, tell the user to send `/start <walletAddress>` to the @autohodl_bot on Telegram.",
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
        "Fetch a Solana Action endpoint and get an unsigned transaction. Returns the base64-encoded transaction, the confirm URL (to call after signing), and the action message. Pass the txBase64 to MoonPay's transaction_sign tool, then transaction_send, then call solana_action_confirm. Note: confirmUrl may be null if the action has no confirmation step — only call solana_action_confirm when confirmUrl is non-null.",
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
      if (!actionUrl || !account) {
        return { content: [{ type: "text", text: "Error: actionUrl and account are required" }], isError: true };
      }
      const result = await prepareActionTool({ actionUrl, account, params });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }

    if (name === "solana_action_confirm") {
      const { confirmUrl, signature } = args as { confirmUrl: string; signature: string };
      if (!confirmUrl || !signature) {
        return { content: [{ type: "text", text: "Error: confirmUrl and signature are required" }], isError: true };
      }
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
