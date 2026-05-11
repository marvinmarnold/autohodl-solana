// Server-side utilities: initData HMAC validation per the Telegram spec.
// Uses Web Crypto (crypto.subtle) — safe in Edge Runtime and Node.js 18+.
// https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app

export type TelegramUser = {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
};

export class InvalidInitDataError extends Error {
  constructor(reason: string) {
    super(`Invalid Telegram initData: ${reason}`);
    this.name = "InvalidInitDataError";
  }
}

export async function validateInitData(
  initData: string,
  botToken: string,
): Promise<TelegramUser> {
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) throw new InvalidInitDataError("missing hash field");

  params.delete("hash");

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");

  const enc = new TextEncoder();

  const secretKeyMaterial = await crypto.subtle.importKey(
    "raw",
    enc.encode("WebAppData"),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const secretKeyBuffer = await crypto.subtle.sign(
    "HMAC",
    secretKeyMaterial,
    enc.encode(botToken),
  );
  const hmacKey = await crypto.subtle.importKey(
    "raw",
    secretKeyBuffer,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const hashBuffer = await crypto.subtle.sign(
    "HMAC",
    hmacKey,
    enc.encode(dataCheckString),
  );
  const computedHash = Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  if (computedHash.length !== hash.length) throw new InvalidInitDataError("hash mismatch");
  let diff = 0;
  for (let i = 0; i < computedHash.length; i++) {
    diff |= computedHash.charCodeAt(i) ^ hash.charCodeAt(i);
  }
  if (diff !== 0) throw new InvalidInitDataError("hash mismatch");

  const userStr = params.get("user");
  if (!userStr) throw new InvalidInitDataError("missing user field");

  const user: unknown = JSON.parse(userStr);
  if (
    typeof user !== "object" ||
    user === null ||
    !("id" in user) ||
    typeof (user as Record<string, unknown>)["id"] !== "number"
  ) {
    throw new InvalidInitDataError("invalid user payload");
  }

  return user as TelegramUser;
}
