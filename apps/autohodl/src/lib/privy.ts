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
};

type PrivyLinkedAccount = PrivyWallet | { type: string };

type PrivyUserResponse = {
  id: string; // did:privy:...
  linked_accounts: PrivyLinkedAccount[];
};

type PrivyWalletResponse = {
  id: string;
  address: string;
  chain_type: string;
};

function findSolanaWallet(data: PrivyUserResponse): PrivyWallet | undefined {
  return data.linked_accounts.find(
    (a): a is PrivyWallet =>
      a.type === "wallet" &&
      "chain_type" in a &&
      (a as PrivyWallet).chain_type === "solana",
  );
}

// Step 1: Create a new Privy user keyed on the Telegram ID, or fetch the
// existing one. Returns the Privy user ID and any existing Solana wallet address.
async function getOrCreatePrivyUser(
  telegramId: string,
  headers: Record<string, string>,
): Promise<{ privyUserId: string; existingWalletAddress: string | null }> {
  const createRes = await fetch("https://auth.privy.io/api/v1/users", {
    method: "POST",
    headers,
    body: JSON.stringify({ custom_id: `telegram:${telegramId}` }),
  });

  if (createRes.ok) {
    const data = (await createRes.json()) as PrivyUserResponse;
    return {
      privyUserId: data.id,
      existingWalletAddress: findSolanaWallet(data)?.address ?? null,
    };
  }

  if (createRes.status === 409) {
    // User already exists — look up by custom ID.
    const getRes = await fetch(
      `https://auth.privy.io/api/v1/users/custom_id/telegram:${encodeURIComponent(telegramId)}`,
      { headers },
    );
    if (!getRes.ok) {
      throw new WalletPregenerationError(
        `Privy user lookup failed: ${getRes.status}`,
        getRes.status,
      );
    }
    const data = (await getRes.json()) as PrivyUserResponse;
    return {
      privyUserId: data.id,
      existingWalletAddress: findSolanaWallet(data)?.address ?? null,
    };
  }

  throw new WalletPregenerationError(
    `Privy user creation failed: ${createRes.status}`,
    createRes.status,
  );
}

// Step 2: Create a Solana embedded wallet for the given Privy user ID.
// Wallet creation lives on api.privy.io (separate from auth.privy.io).
async function createSolanaWallet(
  privyUserId: string,
  headers: Record<string, string>,
): Promise<string> {
  const res = await fetch("https://api.privy.io/v1/wallets", {
    method: "POST",
    headers,
    body: JSON.stringify({
      chain_type: "solana",
      owner: { user_id: privyUserId },
    }),
  });

  if (!res.ok) {
    throw new WalletPregenerationError(
      `Privy wallet creation failed: ${res.status}`,
      res.status,
    );
  }

  const data = (await res.json()) as PrivyWalletResponse;
  return data.address;
}

// Idempotent: creates a Privy user + Solana wallet for the given Telegram user
// ID, or returns the existing wallet address if already provisioned.
export async function pregenerateWallet(telegramId: string): Promise<string> {
  const credentials = Buffer.from(
    `${env.PRIVY_APP_ID}:${env.PRIVY_APP_SECRET}`,
  ).toString("base64");

  const headers = {
    Authorization: `Basic ${credentials}`,
    "privy-app-id": env.PRIVY_APP_ID,
    "Content-Type": "application/json",
  };

  const { privyUserId, existingWalletAddress } = await getOrCreatePrivyUser(
    telegramId,
    headers,
  );

  if (existingWalletAddress) return existingWalletAddress;

  return createSolanaWallet(privyUserId, headers);
}
