import { env } from "./env";

export class WalletPregenerationError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
  ) {
    super(message);
    this.name = "WalletPregenerationError";
  }
}

type PrivyUserMetadata = {
  serverWalletId?: string;
  serverWalletAddress?: string;
};

type PrivyUserResponse = {
  id: string; // did:privy:...
  custom_metadata?: PrivyUserMetadata | null;
};

type PrivyWalletCreateResponse = {
  id: string;
  address: string;
};

type PrivySignResponse = {
  data: { hash: string };
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

// Returns the Privy user ID and any previously created server wallet from metadata.
async function getOrCreatePrivyUser(telegramId: string): Promise<{
  privyUserId: string;
  existingWalletAddress: string | null;
  existingWalletId: string | null;
}> {
  const headers = authHeaders();

  // Create a Privy user linked to the Telegram ID via custom_auth.
  // No `wallets` field — we create server wallets separately so the server
  // can sign without user interaction.
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
    return {
      privyUserId: data.id,
      existingWalletAddress: data.custom_metadata?.serverWalletAddress ?? null,
      existingWalletId: data.custom_metadata?.serverWalletId ?? null,
    };
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
    return {
      privyUserId: data.id,
      existingWalletAddress: data.custom_metadata?.serverWalletAddress ?? null,
      existingWalletId: data.custom_metadata?.serverWalletId ?? null,
    };
  }

  const body = await createRes.text().catch(() => "(unreadable)");
  console.error(`Privy user creation failed: ${createRes.status}`, body);
  throw new WalletPregenerationError(
    `Privy user creation failed: ${createRes.status}`,
    createRes.status,
  );
}

// Creates a Privy server wallet — no owner, so the server can sign directly.
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
  const { privyUserId, existingWalletAddress, existingWalletId } =
    await getOrCreatePrivyUser(telegramId);

  if (existingWalletAddress && existingWalletId) {
    return { privyUserId, walletAddress: existingWalletAddress, privyWalletId: existingWalletId };
  }

  const { address, walletId } = await createServerWallet();

  // Store wallet association in Privy user metadata so we can look it up on
  // subsequent calls without creating a new wallet each time.
  await updatePrivyUserMetadata(privyUserId, {
    serverWalletId: walletId,
    serverWalletAddress: address,
  });

  return { privyUserId, walletAddress: address, privyWalletId: walletId };
}

export async function updatePrivyUserMetadata(
  privyUserId: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  const res = await fetch(
    `https://auth.privy.io/api/v1/users/${privyUserId}`,
    {
      method: "PATCH",
      headers: authHeaders(),
      body: JSON.stringify({ custom_metadata: metadata }),
    },
  );

  if (!res.ok) {
    const body = await res.text().catch(() => "(unreadable)");
    console.error(`Privy metadata update failed: ${res.status}`, body);
    throw new WalletPregenerationError(
      `Privy metadata update failed: ${res.status}`,
      res.status,
    );
  }
}

export async function signAndSendSolanaTransaction(
  privyWalletId: string,
  serializedTxBase64: string,
): Promise<string> {
  const isDevnet = env.SOLANA_RPC_URL.includes("devnet");
  const caip2 = isDevnet
    ? "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1"
    : "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";

  const res = await fetch(
    `https://api.privy.io/v1/wallets/${privyWalletId}/rpc`,
    {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        method: "signAndSendTransaction",
        caip2,
        params: {
          transaction: serializedTxBase64,
          encoding: "base64",
        },
      }),
    },
  );

  if (!res.ok) {
    const body = await res.text().catch(() => "(unreadable)");
    console.error(`Privy sign+send failed: ${res.status}`, body);
    throw new WalletPregenerationError(
      `Privy sign+send failed: ${res.status}`,
      res.status,
    );
  }

  const data = (await res.json()) as PrivySignResponse;
  return data.data.hash;
}
