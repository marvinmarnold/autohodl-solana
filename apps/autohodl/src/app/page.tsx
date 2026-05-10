"use client";

import { useEffect, useState } from "react";

type WalletState =
  | { status: "loading" }
  | { status: "ready"; walletAddress: string }
  | { status: "no-telegram" }
  | { status: "error"; message: string };

function buildMoonpayUrl(walletAddress: string, amountUsd: number): string {
  const params = new URLSearchParams({
    apiKey: process.env.NEXT_PUBLIC_MOONPAY_API_KEY ?? "",
    currencyCode: "usdc_sol",
    walletAddress,
    baseCurrencyCode: "usd",
    baseCurrencyAmount: String(amountUsd),
  });
  return `https://buy.moonpay.com?${params.toString()}`;
}

export default function Page() {
  const [state, setState] = useState<WalletState>({ status: "loading" });
  const [amount, setAmount] = useState(20);

  useEffect(() => {
    window.Telegram?.WebApp.ready();

    async function init() {
      const meRes = await fetch("/api/me");
      if (meRes.ok) {
        const data = (await meRes.json()) as { walletAddress: string };
        setState({ status: "ready", walletAddress: data.walletAddress });
        return;
      }

      const initData = window.Telegram?.WebApp.initData;
      if (!initData) {
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

  const { walletAddress } = state;

  function openMoonpay() {
    const url = buildMoonpayUrl(walletAddress, amount);
    if (window.Telegram?.WebApp) {
      window.Telegram.WebApp.openLink(url);
    } else {
      window.open(url, "_blank");
    }
  }

  return (
    <main>
      <h1>autoHODL</h1>
      <p>Your Solana wallet:</p>
      <code>{walletAddress}</code>

      <section>
        <label htmlFor="amount">How much do you want to save?</label>
        <div>
          <input
            id="amount"
            type="number"
            min={1}
            value={amount}
            onChange={(e) => setAmount(Math.max(1, Number(e.target.value)))}
          />
          <span>/ month</span>
        </div>
        <button type="button" onClick={openMoonpay}>
          Set up monthly savings
        </button>
      </section>
    </main>
  );
}
