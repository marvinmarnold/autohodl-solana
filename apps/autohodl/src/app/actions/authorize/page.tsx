"use client";

import { useEffect, useState } from "react";

type Status = "idle" | "signing" | "done" | "error";

export default function AuthorizePage() {
  const [status, setStatus] = useState<Status>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [params, setParams] = useState({ freq: "weekly", amt: 20 });

  useEffect(() => {
    window.Telegram?.WebApp.ready();
    const p = new URLSearchParams(window.location.search);
    setParams({
      freq: p.get("freq") ?? "weekly",
      amt: Number(p.get("amount") ?? p.get("amt") ?? "20"),
    });
  }, []);

  const freqLabel = { daily: "day", weekly: "week", monthly: "month" }[params.freq] ?? "period";

  async function handleConfirm() {
    setStatus("signing");
    try {
      const meRes = await fetch("/api/me");
      if (!meRes.ok) {
        const initData = window.Telegram?.WebApp.initData;
        if (!initData) throw new Error("No Telegram initData — open via the bot.");
        const authRes = await fetch("/api/auth", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ initData }),
        });
        if (!authRes.ok) throw new Error("Auth failed. Try again from the bot.");
      }

      const res = await fetch(`/api/actions/authorize?freq=${params.freq}&amt=${params.amt}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ freq: params.freq, amt: params.amt }),
      });

      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error ?? `Server error ${res.status}`);
      }

      setStatus("done");
      setTimeout(() => window.Telegram?.WebApp.close(), 1200);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Unexpected error");
      setStatus("error");
    }
  }

  if (status === "done") {
    return (
      <main style={{ padding: "2rem", textAlign: "center" }}>
        <p style={{ fontSize: "2rem" }}>✅</p>
        <p>Done! Check your messages.</p>
      </main>
    );
  }

  if (status === "error") {
    return (
      <main style={{ padding: "2rem" }}>
        <p>❌ {errorMsg}</p>
        <button type="button" onClick={() => setStatus("idle")}>Try again</button>
      </main>
    );
  }

  if (status === "signing") {
    return (
      <main style={{ padding: "2rem", textAlign: "center" }}>
        <p>Signing authorization…</p>
        <p style={{ color: "#888", fontSize: "0.85rem" }}>This takes a few seconds.</p>
      </main>
    );
  }

  return (
    <main style={{ padding: "2rem" }}>
      <h2 style={{ marginBottom: "0.5rem" }}>Authorize autoHODL</h2>
      <p>
        Allow autoHODL to save <strong>${params.amt}</strong> per{" "}
        <strong>{freqLabel}</strong> into Reflect yield.
      </p>
      <p style={{ color: "#666", fontSize: "0.85rem" }}>
        This signs a one-time token approval. You stay in control — revoke anytime.
      </p>
      <button
        type="button"
        onClick={handleConfirm}
        style={{
          marginTop: "1.5rem",
          padding: "0.75rem 2rem",
          fontSize: "1rem",
          borderRadius: "8px",
          background: "#0088cc",
          color: "#fff",
          border: "none",
          cursor: "pointer",
          width: "100%",
        }}
      >
        Confirm
      </button>
    </main>
  );
}
