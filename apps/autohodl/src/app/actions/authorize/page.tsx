"use client";

import { useMemo, useState } from "react";
import { useTelegramAuth, TelegramBlink } from "@autohodl/blinks-telegram/webview";
import { PrivyServerAdapter } from "@/lib/privy-blink-adapter";

export default function AuthorizePage() {
  const [freq] = useState(() => {
    if (typeof window === "undefined") return "weekly";
    return new URLSearchParams(window.location.search).get("freq") ?? "weekly";
  });
  const [amt] = useState(() => {
    if (typeof window === "undefined") return 20;
    const p = new URLSearchParams(window.location.search);
    return Number(p.get("amount") ?? p.get("amt") ?? "20");
  });

  const { status, walletAddress, error } = useTelegramAuth();

  const adapter = useMemo(() => {
    if (!walletAddress) return null;
    return new PrivyServerAdapter(walletAddress, freq, amt);
  }, [walletAddress, freq, amt]);

  if (status === "error") {
    return (
      <main style={centeredStyle}>
        <p style={{ fontSize: "2rem", marginBottom: "0.75rem" }}>❌</p>
        <p style={{ fontWeight: 600, marginBottom: "0.4rem" }}>{error}</p>
        <p style={{ fontSize: "0.85rem", opacity: 0.6 }}>Close this and try again from the bot.</p>
      </main>
    );
  }

  if (status === "pending" || !adapter) {
    return (
      <main style={centeredStyle}>
        <p style={{ fontSize: "2rem", marginBottom: "0.75rem" }}>⏳</p>
        <p style={{ fontWeight: 600 }}>Loading…</p>
      </main>
    );
  }

  const actionUrl = `${window.location.origin}/api/actions/authorize/webview?freq=${freq}&amount=${amt}`;

  return (
    <main style={{ padding: "1rem", maxWidth: 420, margin: "0 auto" }}>
      <TelegramBlink
        actionUrl={actionUrl}
        adapter={adapter}
        stylePreset="default"
        onSuccess={() => {
          const params = new URLSearchParams({ freq, amt: String(amt), wallet: walletAddress ?? "" });
          window.location.href = `/actions/authorize/success?${params}`;
        }}
        onError={(reason) => console.error("Blink action error:", reason)}
      />
    </main>
  );
}

const centeredStyle: React.CSSProperties = {
  padding: "3rem 1.5rem",
  textAlign: "center",
  maxWidth: 400,
  margin: "0 auto",
};
