import { NextResponse } from "next/server";
import { getPublicJWKS } from "@/lib/privy-jwt";

export function GET() {
  return NextResponse.json(getPublicJWKS());
}
