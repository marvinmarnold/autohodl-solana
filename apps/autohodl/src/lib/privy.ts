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

// Shape of a wallet entry inside Privy's linked_accounts array.
type PrivyWallet = {
  type: "wallet";
  chain_type: string;
  address: string;
  wallet_client_type: string;
};

type PrivyLinkedAccount = PrivyWallet | { type: string };

type PrivyUserResponse = {
  id: string;
  linked_accounts: PrivyLinkedAccount[];
};

// Idempotent: creates a Privy user with a Solana embedded wallet keyed on
// the Telegram user ID, or returns the existing wallet address if the user
// was already created. The "telegram:" namespace leaves room for other
// identity types in future without collision.
//
// NOTE: if the Privy API returns unexpected errors, verify the request body
// shape against Privy's current server-side docs:
// https://docs.privy.io and https://docs-legacy.privy.io/guide/server/wallets/new-user
export async function pregenerateWallet(telegramId: string): Promise<string> {
  const credentials = Buffer.from(
    `${env.PRIVY_APP_ID}:${env.PRIVY_APP_SECRET}`,
  ).toString("base64");

  const authHeaders = {
    Authorization: `Basic ${credentials}`,
    "privy-app-id": env.PRIVY_APP_ID,
    "Content-Type": "application/json",
  };

  const createResponse = await fetch("https://auth.privy.io/api/v1/users", {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({
      custom_id: `telegram:${telegramId}`,
      create_embedded_wallet: true,
    }),
  });

  if (createResponse.ok) {
    const data = (await createResponse.json()) as PrivyUserResponse;
    return extractSolanaAddress(data, telegramId);
  }

  if (createResponse.status === 409) {
    // User already exists — fetch by custom ID.
    const getResponse = await fetch(
      `https://auth.privy.io/api/v1/users/custom_id/telegram:${encodeURIComponent(telegramId)}`,
      { headers: authHeaders },
    );
    if (!getResponse.ok) {
      throw new WalletPregenerationError(
        `Privy lookup failed after 409: ${getResponse.status}`,
        getResponse.status,
      );
    }
    const data = (await getResponse.json()) as PrivyUserResponse;
    return extractSolanaAddress(data, telegramId);
  }

  throw new WalletPregenerationError(
    `Privy user creation failed: ${createResponse.status}`,
    createResponse.status,
  );
}

function extractSolanaAddress(
  data: PrivyUserResponse,
  telegramId: string,
): string {
  const wallet = data.linked_accounts.find(
    (a): a is PrivyWallet =>
      a.type === "wallet" &&
      "chain_type" in a &&
      (a as PrivyWallet).chain_type === "solana",
  );
  if (!wallet) {
    throw new WalletPregenerationError(
      `No Solana wallet found in Privy response for telegram:${telegramId}`,
      0,
    );
  }
  return wallet.address;
}
