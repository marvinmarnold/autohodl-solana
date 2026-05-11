"use client";

import { useMemo, useState, useEffect } from "react";
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

  // null = not yet determined (matches SSR output, avoids hydration mismatch).
  // Resolved once we know the Telegram script has executed:
  //   • immediately if already present (Telegram Mobile injects it natively)
  //   • via "telegram-ready" event if it loads afterInteractive (Telegram Desktop)
  const [isInTelegram, setIsInTelegram] = useState<boolean | null>(null);
  useEffect(() => {
    function resolve() {
      setIsInTelegram(!!window.Telegram?.WebApp?.initData);
    }
    if (window.Telegram?.WebApp !== undefined) {
      resolve();
    } else {
      window.addEventListener("telegram-ready", resolve, { once: true });
      return () => window.removeEventListener("telegram-ready", resolve);
    }
  }, []);

  const { status, walletAddress, error } = useTelegramAuth({ enabled: isInTelegram === true });
  const [navigating, setNavigating] = useState(false);
  const [copied, setCopied] = useState(false);

  const adapter = useMemo(() => {
    if (!walletAddress) return null;
    return new PrivyServerAdapter(walletAddress, freq, amt);
  }, [walletAddress, freq, amt]);

  // ── Context not yet determined (SSR / first paint) ─────────────────────────
  if (isInTelegram === null) {
    return (
      <main style={centeredStyle}>
        <p style={{ fontSize: "2rem", marginBottom: "0.75rem" }}>⏳</p>
        <p style={{ fontWeight: 600 }}>Loading…</p>
      </main>
    );
  }

  // ── Browser / non-Telegram mode ────────────────────────────────────────────
  // Show the correct Action URL to paste into Backpack or Phantom.
  if (!isInTelegram) {
    const actionUrl = typeof window !== "undefined"
      ? `${window.location.origin}/api/actions/authorize${window.location.search}`
      : "";
    return (
      <main style={{ padding: "2rem 1.5rem", maxWidth: 420, margin: "0 auto" }}>
        <p style={{ fontSize: "1.5rem", textAlign: "center", marginBottom: "0.75rem" }}>🔗</p>
        <p style={{ fontWeight: 700, fontSize: "1.05rem", marginBottom: "0.4rem" }}>
          Open in Backpack or Phantom
        </p>
        <p style={{ fontSize: "0.85rem", color: "var(--text-secondary, #666)", marginBottom: "1rem", lineHeight: 1.5 }}>
          This page requires Telegram. To sign with your own wallet, paste this Action URL into a Blinks-enabled browser:
        </p>
        <code style={{
          display: "block",
          fontSize: "0.7rem",
          wordBreak: "break-all",
          background: "var(--bg-code)",
          color: "var(--text)",
          padding: "0.75rem",
          borderRadius: "10px",
          marginBottom: "1rem",
          userSelect: "all",
          lineHeight: 1.6,
        }}>
          {actionUrl}
        </code>
        <button
          type="button"
          onClick={() => {
            navigator.clipboard.writeText(actionUrl).catch(() => {});
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          }}
          style={btnStyle}
        >
          {copied ? "Copied ✓" : "Copy URL"}
        </button>
      </main>
    );
  }

  // ── Telegram WebApp mode ────────────────────────────────────────────────────

  if (navigating) {
    return (
      <main style={centeredStyle}>
        <p style={{ fontSize: "2rem", marginBottom: "0.75rem" }}>✅</p>
        <p style={{ fontWeight: 600 }}>Authorized! Loading…</p>
      </main>
    );
  }

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
          setNavigating(true);
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

const btnStyle: React.CSSProperties = {
  display: "block",
  width: "100%",
  padding: "0.85rem",
  background: "#007AFF",
  color: "#fff",
  border: "none",
  borderRadius: "14px",
  fontSize: "1rem",
  fontWeight: 600,
  cursor: "pointer",
  textAlign: "center",
};
