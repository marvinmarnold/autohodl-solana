"use client";

import { useEffect, useState } from "react";

type Status = "signing" | "done" | "error";

export default function AuthorizePage() {
  const [status, setStatus] = useState<Status>("signing");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    window.Telegram?.WebApp.ready();

    const p = new URLSearchParams(window.location.search);
    const freq = p.get("freq") ?? "weekly";
    const amt = Number(p.get("amount") ?? p.get("amt") ?? "20");

    async function sign() {
      try {
        // Always re-auth when initData is present so the session reflects
        // the latest wallet from Redis (guards against stale cookies).
        const initData = window.Telegram?.WebApp.initData;
        if (initData) {
          const authRes = await fetch("/api/auth", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ initData }),
          });
          if (!authRes.ok) throw new Error("Auth failed. Try again from the bot.");
        } else {
          const meRes = await fetch("/api/me");
          if (!meRes.ok) throw new Error("Open this via the bot.");
        }

        const res = await fetch(`/api/actions/authorize?freq=${freq}&amt=${amt}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ freq, amt }),
        });

        if (!res.ok) {
          const err = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(err.error ?? `Server error ${res.status}`);
        }

        const data = (await res.json().catch(() => ({}))) as { walletAddress?: string };
        const params = new URLSearchParams({ freq, amt: String(amt) });
        if (data.walletAddress) params.set("wallet", data.walletAddress);
        window.location.href = `/actions/authorize/success?${params}`;
      } catch (err) {
        setErrorMsg(err instanceof Error ? err.message : "Unexpected error");
        setStatus("error");
      }
    }

    sign();
  }, []);

  if (status === "error") {
    return (
      <main style={centeredStyle}>
        <p style={{ fontSize: "2rem", marginBottom: "0.75rem" }}>❌</p>
        <p style={{ fontWeight: 600, marginBottom: "0.4rem", color: "var(--text)" }}>{errorMsg}</p>
        <p style={{ fontSize: "0.85rem", color: "var(--text-hint)" }}>Close this and try again from the bot.</p>
      </main>
    );
  }

  return (
    <main style={centeredStyle}>
      <p style={{ fontSize: "2rem", marginBottom: "0.75rem" }}>⏳</p>
      <p style={{ fontWeight: 600, marginBottom: "0.4rem", color: "var(--text)" }}>Authorizing your savings…</p>
      <p style={{ fontSize: "0.85rem", color: "var(--text-hint)" }}>This takes a few seconds.</p>
    </main>
  );
}

const centeredStyle: React.CSSProperties = {
  padding: "3rem 1.5rem",
  textAlign: "center",
  maxWidth: 400,
  margin: "0 auto",
};
