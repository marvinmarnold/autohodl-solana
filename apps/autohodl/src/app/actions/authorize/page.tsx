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

        const res = await fetch(`/api/actions/authorize?freq=${freq}&amt=${amt}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ freq, amt }),
        });

        if (!res.ok) {
          const err = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(err.error ?? `Server error ${res.status}`);
        }

        setStatus("done");
        setTimeout(() => window.Telegram?.WebApp.close(), 1500);
      } catch (err) {
        setErrorMsg(err instanceof Error ? err.message : "Unexpected error");
        setStatus("error");
      }
    }

    sign();
  }, []);

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
        <p style={{ color: "#888", fontSize: "0.8rem" }}>Close this and try again from the bot.</p>
      </main>
    );
  }

  return (
    <main style={{ padding: "2rem", textAlign: "center" }}>
      <p style={{ fontSize: "1.5rem" }}>⏳</p>
      <p>Authorizing savings…</p>
      <p style={{ color: "#888", fontSize: "0.85rem" }}>This takes a few seconds.</p>
    </main>
  );
}
