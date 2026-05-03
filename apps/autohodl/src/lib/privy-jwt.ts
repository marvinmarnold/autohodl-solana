import { importPKCS8, exportJWK, SignJWT, type JWK } from "jose";

const KEY_ID = "k1";

async function getPrivateKey() {
  const pem = Buffer.from(
    process.env["PRIVY_CUSTOM_AUTH_PRIVATE_KEY"] ?? "",
    "base64",
  ).toString();
  return importPKCS8(pem, "ES256");
}

export async function generatePrivyJWT(telegramId: string): Promise<string> {
  const privateKey = await getPrivateKey();
  return new SignJWT({ sub: `telegram:${telegramId}` })
    .setProtectedHeader({ alg: "ES256", kid: KEY_ID })
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(privateKey);
}

export async function getPublicJWKS(): Promise<{ keys: JWK[] }> {
  const privateKey = await getPrivateKey();
  const fullJwk = await exportJWK(privateKey);
  // Strip private key component, keep public params only
  const { d: _d, ...publicJwk } = fullJwk;
  return {
    keys: [{ ...publicJwk, kid: KEY_ID, use: "sig", alg: "ES256" }],
  };
}
