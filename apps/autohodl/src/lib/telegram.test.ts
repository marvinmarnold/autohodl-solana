import { expect, test } from "bun:test";
import { InvalidInitDataError, validateInitData } from "./telegram";

// A fake bot token for unit tests only — never a real one.
const TEST_BOT_TOKEN = "1234567890:AABBCCDDEEFFaabbccddeeff_TestToken";

// Constructs a valid initData string signed with the given bot token.
// Mirrors Telegram's server-side signing algorithm exactly.
async function makeValidInitData(
  telegramId: number,
  botToken: string,
): Promise<string> {
  const user = JSON.stringify({ id: telegramId, first_name: "Test" });
  const authDate = String(Math.floor(Date.now() / 1000));
  const params = new URLSearchParams({ auth_date: authDate, user });

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
  const hash = Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  params.set("hash", hash);
  return params.toString();
}

test("returns TelegramUser for valid initData", async () => {
  const initData = await makeValidInitData(42, TEST_BOT_TOKEN);
  const user = await validateInitData(initData, TEST_BOT_TOKEN);
  expect(user.id).toBe(42);
  expect(user.first_name).toBe("Test");
});

test("rejects initData with tampered hash", async () => {
  const initData = await makeValidInitData(42, TEST_BOT_TOKEN);
  const tampered = initData.replace(/hash=[^&]+/, "hash=deadbeefdeadbeef");
  await expect(
    validateInitData(tampered, TEST_BOT_TOKEN),
  ).rejects.toBeInstanceOf(InvalidInitDataError);
});

test("rejects initData signed with wrong bot token", async () => {
  const initData = await makeValidInitData(42, "wrong_token");
  await expect(
    validateInitData(initData, TEST_BOT_TOKEN),
  ).rejects.toBeInstanceOf(InvalidInitDataError);
});

test("rejects initData with missing hash field", async () => {
  const params = new URLSearchParams({
    auth_date: "1700000000",
    user: JSON.stringify({ id: 1, first_name: "x" }),
  });
  await expect(
    validateInitData(params.toString(), TEST_BOT_TOKEN),
  ).rejects.toBeInstanceOf(InvalidInitDataError);
});
