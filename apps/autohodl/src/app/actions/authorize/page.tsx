"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  PrivyProvider,
  usePrivy,
  useSubscribeToJwtAuthWithFlag,
} from "@privy-io/react-auth";
import {
  useWallets,
  useSignAndSendTransaction,
} from "@privy-io/react-auth/solana";

// ─── Inner component — runs inside PrivyProvider ───────────────────────────

type SignStatus = "waiting" | "signing" | "done" | "error";

function AuthorizeContent({ freq, amt }: { freq: string; amt: number }) {
  const { ready, authenticated } = usePrivy();
  const { wallets } = useWallets();
  const { signAndSendTransaction } = useSignAndSendTransaction();
  const [status, setStatus] = useState<SignStatus>("waiting");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const triggered = useRef(false);

  // Immediately sync our server-session JWT with Privy so the user is
  // authenticated and their pre-generated embedded wallet is accessible.
  const getExternalJwt = useCallback(async () => {
    const res = await fetch("/api/privy-jwt");
    if (!res.ok) return undefined;
    const { token } = (await res.json()) as { token: string };
    return token;
  }, []);

  useSubscribeToJwtAuthWithFlag({
    isAuthenticated: true,
    isLoading: false,
    getExternalJwt,
  });

  useEffect(() => {
    if (!ready || !authenticated) return;
    if (wallets.length === 0) return;
    if (triggered.current) return;
    triggered.current = true;

    const wallet = wallets[0]!;
    setStatus("signing");

    async function doSign() {
      try {
        // Fetch unsigned SPL Token.approve tx from server
        const buildRes = await fetch(
          `/api/actions/authorize?freq=${freq}&amt=${amt}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ account: wallet.address }),
          },
        );
        if (!buildRes.ok) {
          const err = (await buildRes.json().catch(() => ({}))) as { error?: string };
          throw new Error(err.error ?? `Server error ${buildRes.status}`);
        }
        const { transaction: txBase64 } = (await buildRes.json()) as { transaction: string };

        // Decode base64 → raw bytes (browser-safe, no Buffer polyfill needed)
        const txBytes = Uint8Array.from(atob(txBase64), (c) => c.charCodeAt(0));

        // Sign and send via Privy embedded wallet (silent for embedded wallets)
        const result = await signAndSendTransaction({ transaction: txBytes, wallet });
        const signatureB64 = btoa(String.fromCharCode(...result.signature));

        // Notify server: save metadata + send TG ✅ message
        await fetch("/api/actions/authorize/complete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ txSignature: signatureB64, freq, amt }),
        });

        setStatus("done");
        setTimeout(() => window.Telegram?.WebApp.close(), 1500);
      } catch (err) {
        setErrorMsg(err instanceof Error ? err.message : "Unexpected error");
        setStatus("error");
      }
    }

    doSign();
  }, [ready, authenticated, wallets, freq, amt, signAndSendTransaction]);

  if (status === "done") {
    return (
      <main style={{ padding: "2rem", textAlign: "center" }}>
        <p style={{ fontSize: "2rem" }}>✅</p>
        <p>Authorized. Check your messages.</p>
      </main>
    );
  }
  if (status === "error") {
    return (
      <main style={{ padding: "2rem", textAlign: "center" }}>
        <p style={{ fontSize: "1.5rem" }}>❌</p>
        <p>{errorMsg}</p>
        <p style={{ color: "#888", fontSize: "0.8rem" }}>
          Close this and try again from the bot.
        </p>
      </main>
    );
  }
  return (
    <main style={{ padding: "2rem", textAlign: "center" }}>
      <p style={{ fontSize: "1.5rem" }}>⏳</p>
      <p>{status === "signing" ? "Signing transaction…" : "Preparing wallet…"}</p>
      <p style={{ color: "#888", fontSize: "0.85rem" }}>This takes a few seconds.</p>
    </main>
  );
}

// ─── Outer component — establishes session before mounting PrivyProvider ───

export default function AuthorizePage() {
  const [sessionReady, setSessionReady] = useState(false);
  const [initError, setInitError] = useState<string | null>(null);
  const [freq, setFreq] = useState("weekly");
  const [amt, setAmt] = useState(20);

  useEffect(() => {
    window.Telegram?.WebApp.ready();

    const p = new URLSearchParams(window.location.search);
    setFreq(p.get("freq") ?? "weekly");
    setAmt(Number(p.get("amount") ?? p.get("amt") ?? "20"));

    async function initSession() {
      try {
        const meRes = await fetch("/api/me");
        if (!meRes.ok) {
          const initData = window.Telegram?.WebApp.initData;
          if (!initData) throw new Error("Open this via the bot.");
          const authRes = await fetch("/api/auth", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ initData }),
          });
          if (!authRes.ok) throw new Error("Auth failed. Try again from the bot.");
        }
        setSessionReady(true);
      } catch (err) {
        setInitError(err instanceof Error ? err.message : "Unexpected error");
      }
    }

    initSession();
  }, []);

  if (initError) {
    return (
      <main style={{ padding: "2rem", textAlign: "center" }}>
        <p style={{ fontSize: "1.5rem" }}>❌</p>
        <p>{initError}</p>
      </main>
    );
  }
  if (!sessionReady) {
    return (
      <main style={{ padding: "2rem", textAlign: "center" }}>
        <p style={{ fontSize: "1.5rem" }}>⏳</p>
        <p>Authenticating…</p>
      </main>
    );
  }

  // Session confirmed — mount Privy. useSubscribeToJwtAuthWithFlag inside
  // AuthorizeContent will fetch the JWT and authenticate immediately.
  return (
    <PrivyProvider
      appId={process.env["NEXT_PUBLIC_PRIVY_APP_ID"] ?? ""}
      config={{}}
    >
      <AuthorizeContent freq={freq} amt={amt} />
    </PrivyProvider>
  );
}
