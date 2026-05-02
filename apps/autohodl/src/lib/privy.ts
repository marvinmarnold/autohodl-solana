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

type PrivyWallet = {
  type: "wallet";
  chain_type: string;
  address: string;
  id: string;
};

type PrivyLinkedAccount = PrivyWallet | { type: string };

type PrivyUserResponse = {
  id: string; // did:privy:...
  linked_accounts: PrivyLinkedAccount[];
};

type PrivyWalletCreateResponse = {
  id: string;
  address: string;
};

// ⚠️ VERIFY: Privy server-signing response shape — check docs before using
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

function findSolanaWallet(data: PrivyUserResponse): PrivyWallet | undefined {
  return data.linked_accounts.find(
    (a): a is PrivyWallet =>
      a.type === "wallet" &&
      "chain_type" in a &&
      (a as PrivyWallet).chain_type === "solana",
  );
}

async function getOrCreatePrivyUser(telegramId: string): Promise<{
  privyUserId: string;
  existingWalletAddress: string | null;
  existingWalletId: string | null;
}> {
  const headers = authHeaders();

  const createRes = await fetch("https://auth.privy.io/api/v1/users", {
    method: "POST",
    headers,
    body: JSON.stringify({
      linked_accounts: [
        { type: "custom_auth", custom_user_id: `telegram:${telegramId}` },
      ],
      wallets: [{ chain_type: "solana" }],
    }),
  });

  if (createRes.ok) {
    const data = (await createRes.json()) as PrivyUserResponse;
    console.log("Privy user created:", data.id);
    const wallet = findSolanaWallet(data);
    return {
      privyUserId: data.id,
      existingWalletAddress: wallet?.address ?? null,
      existingWalletId: wallet?.id ?? null,
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
    const wallet = findSolanaWallet(data);
    return {
      privyUserId: data.id,
      existingWalletAddress: wallet?.address ?? null,
      existingWalletId: wallet?.id ?? null,
    };
  }

  const body = await createRes.text().catch(() => "(unreadable)");
  console.error(`Privy user creation failed: ${createRes.status}`, body);
  throw new WalletPregenerationError(
    `Privy user creation failed: ${createRes.status}`,
    createRes.status,
  );
}

async function createSolanaWallet(
  privyUserId: string,
): Promise<{ address: string; walletId: string }> {
  const res = await fetch("https://api.privy.io/v1/wallets", {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      chain_type: "solana",
      owner: { user_id: privyUserId },
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "(unreadable)");
    console.error(`Privy wallet creation failed: ${res.status}`, body);
    throw new WalletPregenerationError(
      `Privy wallet creation failed: ${res.status}`,
      res.status,
    );
  }

  const data = (await res.json()) as PrivyWalletCreateResponse;
  console.log("Privy Solana wallet created:", data.address);
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

  const { address, walletId } = await createSolanaWallet(privyUserId);
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

// ⚠️ VERIFY before using: confirm caip2, request body shape, and response
// shape against https://docs.privy.io/wallets/wallets/policies-overview/quickstart
export async function signAndSendSolanaTransaction(
  privyWalletId: string,
  serializedTxBase64: string,
): Promise<string> {
  const res = await fetch(
    `https://api.privy.io/v1/wallets/${privyWalletId}/rpc`,
    {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        method: "signAndSendTransaction",
        caip2: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp", // mainnet
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
