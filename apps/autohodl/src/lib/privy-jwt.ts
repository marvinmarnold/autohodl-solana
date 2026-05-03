import { createPrivateKey, createPublicKey } from "crypto";
import { SignJWT, type JWK } from "jose";

const KEY_ID = "k1";

function getPrivatePem(): string {
  return Buffer.from(
    process.env["PRIVY_CUSTOM_AUTH_PRIVATE_KEY"] ?? "",
    "base64",
  ).toString();
}

export async function generatePrivyJWT(telegramId: string): Promise<string> {
  const privateKey = createPrivateKey(getPrivatePem());
  return new SignJWT({ sub: `telegram:${telegramId}` })
    .setProtectedHeader({ alg: "ES256", kid: KEY_ID })
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(privateKey);
}

// Returns the public JWKS. jose accepts Node.js KeyObjects, avoiding the
// non-extractable CryptoKey issue from importPKCS8's default key format.
export function getPublicJWKS(): { keys: JWK[] } {
  const privateKey = createPrivateKey(getPrivatePem());
  const publicKey = createPublicKey(privateKey);
  const jwk = publicKey.export({ format: "jwk" }) as JWK;
  return {
    keys: [{ ...jwk, kid: KEY_ID, use: "sig", alg: "ES256" }],
  };
}
