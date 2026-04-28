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

// Step 1: Create a Privy user linked to the Telegram ID, or fetch the existing
// one on 409. Returns the Privy user ID and any already-created Solana wallet.
async function getOrCreatePrivyUser(telegramId: string): Promise<{
  privyUserId: string;
  existingWalletAddress: string | null;
}> {
  const headers = authHeaders();

  const createRes = await fetch("https://auth.privy.io/api/v1/users", {
    method: "POST",
    headers,
    body: JSON.stringify({
      // linked_accounts is required. We use custom_auth to associate the
      // Telegram user ID so we can look up the user after session expiry.
      linked_accounts: [
        { type: "custom_auth", custom_user_id: `telegram:${telegramId}` },
      ],
      wallets: [{ chain_type: "solana" }],
    }),
  });

  if (createRes.ok) {
    const data = (await createRes.json()) as PrivyUserResponse;
    console.log("Privy user created:", data.id);
    return {
      privyUserId: data.id,
      existingWalletAddress: findSolanaWallet(data)?.address ?? null,
    };
  }

  if (createRes.status === 409) {
    // User already exists — look up by custom auth ID.
    // REST endpoint: POST /api/v1/users/custom_auth/id
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
      existingWalletAddress: findSolanaWallet(data)?.address ?? null,
    };
  }

  const body = await createRes.text().catch(() => "(unreadable)");
  console.error(`Privy user creation failed: ${createRes.status}`, body);
  throw new WalletPregenerationError(
    `Privy user creation failed: ${createRes.status}`,
    createRes.status,
  );
}

// Step 2: Create a Solana wallet for the Privy user if one doesn't exist yet.
// Wallet creation uses api.privy.io (separate base URL from auth.privy.io).
async function createSolanaWallet(privyUserId: string): Promise<string> {
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

  const data = (await res.json()) as { address: string };
  console.log("Privy Solana wallet created:", data.address);
  return data.address;
}

// Idempotent: creates or retrieves a Privy user + Solana wallet for the given
// Telegram user ID. Returns the Solana wallet address.
export async function pregenerateWallet(
  telegramId: string,
): Promise<{ privyUserId: string; walletAddress: string }> {
  const { privyUserId, existingWalletAddress } =
    await getOrCreatePrivyUser(telegramId);

  const walletAddress =
    existingWalletAddress ?? (await createSolanaWallet(privyUserId));

  return { privyUserId, walletAddress };
}
