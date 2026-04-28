"use client";

import { useEffect, useState } from "react";

type WalletState =
  | { status: "loading" }
  | { status: "ready"; walletAddress: string }
  | { status: "no-telegram" }
  | { status: "error"; message: string };

export default function Page() {
  const [state, setState] = useState<WalletState>({ status: "loading" });

  useEffect(() => {
    // Signal to Telegram that the Mini App is ready (hides the loading spinner).
    window.Telegram?.WebApp.ready();

    async function init() {
      // Fast path: existing session cookie — no need to hit Privy again.
      const meRes = await fetch("/api/me");
      if (meRes.ok) {
        const data = (await meRes.json()) as { walletAddress: string };
        setState({ status: "ready", walletAddress: data.walletAddress });
        return;
      }

      // No session — authenticate via initData from Telegram.
      const initData = window.Telegram?.WebApp.initData;
      if (!initData) {
        // Not inside Telegram — show a helpful message instead of an error.
        setState({ status: "no-telegram" });
        return;
      }

      const authRes = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ initData }),
      });

      if (authRes.ok) {
        const data = (await authRes.json()) as { walletAddress: string };
        setState({ status: "ready", walletAddress: data.walletAddress });
      } else {
        const err = (await authRes.json().catch(() => ({}))) as {
          error?: string;
        };
        setState({ status: "error", message: err.error ?? "unknown_error" });
      }
    }

    init().catch(() =>
      setState({ status: "error", message: "unexpected_error" }),
    );
  }, []);

  if (state.status === "loading") return <p>Loading...</p>;
  if (state.status === "no-telegram") return <p>Open this app inside Telegram.</p>;
  if (state.status === "error") return <p>Error: {state.message}</p>;
  return (
    <main>
      <h1>autoHODL</h1>
      <p>Your Solana wallet:</p>
      <code>{state.walletAddress}</code>
    </main>
  );
}
