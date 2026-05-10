import { Connection, Transaction } from "@solana/web3.js";
import { env } from "./env";
import { getWallet, setWallet } from "./kv";

export class WalletPregenerationError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
  ) {
    super(message);
    this.name = "WalletPregenerationError";
  }
}

type PrivyUserResponse = {
  id: string; // did:privy:...
};

type PrivyWalletCreateResponse = {
  id: string;
  address: string;
};

type PrivySignResponse = {
  data: { signed_transaction: string };
};

function authHeaders() {
  const credentials = Buffer.from(
    `${env.PRIVY_APP_ID}:${env.PRIVY_APP_SECRET}`,
  ).toString("base64");
  return {
    Authorization: `Basic ${credentials}`,
    "privy-app-id": env.PRIVY_APP_ID,
    "Content-Type": "application/json",
  };
}

// Creates or retrieves the Privy user linked to the given Telegram ID.
async function getOrCreatePrivyUser(telegramId: string): Promise<string> {
  const headers = authHeaders();

  const createRes = await fetch("https://auth.privy.io/api/v1/users", {
    method: "POST",
    headers,
    body: JSON.stringify({
      linked_accounts: [
        { type: "custom_auth", custom_user_id: `telegram:${telegramId}` },
      ],
    }),
  });

  if (createRes.ok) {
    const data = (await createRes.json()) as PrivyUserResponse;
    console.log("Privy user created:", data.id);
    return data.id;
  }

  if (createRes.status === 409) {
    const lookupRes = await fetch(
      "https://auth.privy.io/api/v1/users/custom_auth/id",
      {
        method: "POST",
        headers,
        body: JSON.stringify({ custom_auth_id: `telegram:${telegramId}` }),
      },
    );
    if (!lookupRes.ok) {
      const body = await lookupRes.text().catch(() => "(unreadable)");
      console.error(`Privy custom_auth lookup failed: ${lookupRes.status}`, body);
      throw new WalletPregenerationError(
        `Privy user lookup failed: ${lookupRes.status}`,
        lookupRes.status,
      );
    }
    const data = (await lookupRes.json()) as PrivyUserResponse;
    console.log("Privy user found:", data.id);
    return data.id;
  }

  const body = await createRes.text().catch(() => "(unreadable)");
  console.error(`Privy user creation failed: ${createRes.status}`, body);
  throw new WalletPregenerationError(
    `Privy user creation failed: ${createRes.status}`,
    createRes.status,
  );
}

// Creates a Privy server wallet — no owner, so the server can sign directly
// using Basic auth without requiring client-side interaction.
async function createServerWallet(): Promise<{ address: string; walletId: string }> {
  const res = await fetch("https://api.privy.io/v1/wallets", {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ chain_type: "solana" }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "(unreadable)");
    console.error(`Privy server wallet creation failed: ${res.status}`, body);
    throw new WalletPregenerationError(
      `Privy server wallet creation failed: ${res.status}`,
      res.status,
    );
  }

  const data = (await res.json()) as PrivyWalletCreateResponse;
  console.log("Privy server wallet created:", data.address, "id:", data.id);
  return { address: data.address, walletId: data.id };
}

export async function pregenerateWallet(telegramId: string): Promise<{
  privyUserId: string;
  walletAddress: string;
  privyWalletId: string;
}> {
  // KV is the source of truth for wallet idempotency — Privy's free tier
  // doesn't support custom_metadata writes, so we store the mapping here.
  const stored = await getWallet(telegramId);
  if (stored) {
    console.log("Wallet found in KV for telegram:", telegramId);
    return {
      privyUserId: stored.privyUserId,
      walletAddress: stored.walletAddress,
      privyWalletId: stored.walletId,
    };
  }

  const privyUserId = await getOrCreatePrivyUser(telegramId);
  const { address, walletId } = await createServerWallet();

  await setWallet(telegramId, { walletId, walletAddress: address, privyUserId });

  return { privyUserId, walletAddress: address, privyWalletId: walletId };
}

// Signs the transaction with the Privy server wallet, then broadcasts using
// our own RPC. Using signTransaction + manual broadcast avoids Privy's
// internal simulation node, which can reject valid blockhashes from external RPCs.
export async function signAndSendSolanaTransaction(
  privyWalletId: string,
  serializedTxBase64: string,
  connection: Connection,
): Promise<string> {
  const res = await fetch(
    `https://api.privy.io/v1/wallets/${privyWalletId}/rpc`,
    {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        method: "signTransaction",
        params: {
          transaction: serializedTxBase64,
          encoding: "base64",
        },
      }),
    },
  );

  if (!res.ok) {
    const body = await res.text().catch(() => "(unreadable)");
    console.error(`Privy sign failed: ${res.status}`, body);
    throw new WalletPregenerationError(
      `Privy sign failed: ${res.status}`,
      res.status,
    );
  }

  const data = (await res.json()) as PrivySignResponse;
  const signedTx = Transaction.from(Buffer.from(data.data.signed_transaction, "base64"));
  const signature = await connection.sendRawTransaction(signedTx.serialize(), {
    skipPreflight: true, // we already simulated during build; skip double-simulation
  });
  console.log("Transaction broadcast:", signature);
  return signature;
}
