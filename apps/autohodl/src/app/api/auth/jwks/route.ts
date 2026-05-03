import { NextResponse } from "next/server";
import { getPublicJWKS } from "@/lib/privy-jwt";

export async function GET() {
  const jwks = await getPublicJWKS();
  return NextResponse.json(jwks);
}
