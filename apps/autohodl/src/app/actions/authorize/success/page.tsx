"use client";

import { useEffect, useState } from "react";

// cta       — auth done; prompting user to activate MoonPay
// confirmed — settings saved, MoonPay opened
type Phase = "cta" | "confirmed";

export default function SuccessPage() {
  const [phase, setPhase] = useState<Phase>("cta");
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [moonpayUrl, setMoonpayUrl] = useState<string | null>(null);
  // null = MoonPay never configured (first time)
  // object = prior funding values (may differ from new savings)
  const [priorFunding, setPriorFunding] = useState<{ amt: number; freq: string } | null | undefined>(undefined);
  const [confirming, setConfirming] = useState(false);
  const [freq, setFreq] = useState("weekly");
  const [amt, setAmt] = useState(0);

  useEffect(() => {
    window.Telegram?.WebApp.ready();

    const p = new URLSearchParams(window.location.search);
    const f = p.get("freq") ?? "weekly";
    const a = Number(p.get("amt") ?? "0");
    const wallet = p.get("wallet") ?? "";
    setFreq(f);
    setAmt(a);
    if (wallet) setWalletAddress(wallet);

    fetch("/api/actions/authorize/airdrop", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ freq: f, amt: a }),
    })
      .then((r) => r.json())
      .then((data: { walletAddress?: string; moonpayConfigured?: boolean; fundingAmountUsd?: number; fundingFrequency?: string }) => {
        if (data.walletAddress) setWalletAddress(data.walletAddress);
        if (!data.moonpayConfigured) {
          setPriorFunding(null); // first time
        } else {
          setPriorFunding(
            data.fundingAmountUsd != null && data.fundingFrequency
              ? { amt: data.fundingAmountUsd, freq: data.fundingFrequency }
              : null,
          );
        }
      })
      .catch(() => setPriorFunding(null));

    const apiKey = process.env.NEXT_PUBLIC_MOONPAY_API_KEY;
    if (apiKey && wallet) {
      const currencyCode = apiKey.startsWith("pk_test_") ? "sol" : "usdc_sol";
      const url = new URL("https://buy.moonpay.com");
      url.searchParams.set("apiKey", apiKey);
      url.searchParams.set("currencyCode", currencyCode);
      url.searchParams.set("walletAddress", wallet);
      url.searchParams.set("baseCurrencyCode", "usd");
      url.searchParams.set("baseCurrencyAmount", String(a > 0 ? a : 20));
      setMoonpayUrl(url.toString());
    }
  }, []);

  function closeAndNotify() {
    // Fire notify without blocking — bot message arrives shortly after WebView closes.
    fetch("/api/actions/authorize/notify", { method: "POST" }).catch(() => {});
    window.Telegram?.WebApp.close();
  }

  async function activateMoonpay() {
    setConfirming(true);
    try {
      await fetch("/api/actions/authorize/confirm-moonpay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
    } catch {/* non-fatal */}
    setConfirming(false);
    if (moonpayUrl) window.Telegram?.WebApp.openLink(moonpayUrl);
    setPhase("confirmed");
  }

  const period = PERIOD_LABEL[freq] ?? freq;
  const scheduleLabel = amt > 0 ? `$${amt} / ${period}` : "—";

  // Funding row state
  const isFirstTime = priorFunding === null;
  const fundingOutOfSync =
    priorFunding != null &&
    (priorFunding.amt !== amt || priorFunding.freq !== freq);
  const fundingInSync = priorFunding != null && !fundingOutOfSync;

  const fundingValue =
    phase === "confirmed"
      ? `${scheduleLabel} via MoonPay`
      : isFirstTime
      ? "Not configured"
      : fundingOutOfSync && priorFunding
      ? `$${priorFunding.amt} / ${PERIOD_LABEL[priorFunding.freq] ?? priorFunding.freq} via MoonPay`
      : `${scheduleLabel} via MoonPay`;

  const fundingColor =
    phase === "confirmed" || fundingInSync
      ? "#34C759"
      : "#FF9500";

  // CTA logic
  const isLoading = priorFunding === undefined; // still fetching

  return (
    <main style={mainStyle}>
      <p style={{ fontSize: "2rem", textAlign: "center", marginBottom: "0.25rem" }}>
        {phase === "confirmed" ? "🎉" : isFirstTime ? "💳" : fundingOutOfSync ? "💳" : "✅"}
      </p>
      <h1 style={headingStyle}>
        {phase === "confirmed"
          ? "All set!"
          : isFirstTime
          ? "Enable auto-funding"
          : fundingOutOfSync
          ? "Update auto-funding"
          : "Savings authorized"}
      </h1>

      {/* ── Summary card ─────────────────────────────── */}
      <div style={summaryCard}>
        <Row label="Savings schedule" value={scheduleLabel} valueColor="#34C759" />
        <Row
          label="Funding schedule"
          value={isLoading ? "…" : fundingValue}
          valueColor={fundingColor}
          warning={fundingOutOfSync && phase !== "confirmed"}
        />
        {walletAddress && (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
            <span style={labelStyle}>Wallet</span>
            <code style={walletCodeStyle}>{walletAddress}</code>
          </div>
        )}
        <Row label="Yield via"   value="Reflect" valueColor="#34C759" />
        <Row label="Funding via" value="MoonPay" valueColor="#34C759" />
        <Row label="Wallet via"  value="Privy"   valueColor="#34C759" />
      </div>

      {/* ── Loading: airdrop + MoonPay state pending ─── */}
      {phase === "cta" && isLoading && (
        <div style={{ textAlign: "center", padding: "1rem 0" }}>
          <p style={{ fontSize: "1.5rem", marginBottom: "0.5rem" }}>⏳</p>
          <p style={{ fontSize: "0.875rem", color: "var(--text-secondary)", margin: 0 }}>Setting up your account…</p>
        </div>
      )}

      {/* ── Phase: cta ───────────────────────────────── */}
      {phase === "cta" && !isLoading && (
        <>
          {/* First time: save + open MoonPay in one tap */}
          {isFirstTime && moonpayUrl && (
            <>
              <p style={bodyTextStyle}>
                Enable auto-funding to make sure you never miss out on yield.
              </p>
              <button
                type="button"
                onClick={activateMoonpay}
                disabled={confirming}
                style={{ ...btnStyle, opacity: confirming ? 0.6 : 1 }}
              >
                {confirming ? "Saving…" : "Set up recurring deposits →"}
              </button>
            </>
          )}

          {/* Out of sync: update funding to match new savings */}
          {fundingOutOfSync && moonpayUrl && (
            <>
              <p style={{ ...bodyTextStyle, color: "#FF9500" }}>
                Your current funding schedule ({priorFunding ? `$${priorFunding.amt} / ${PERIOD_LABEL[priorFunding.freq] ?? priorFunding.freq}` : "—"}) does not match your savings schedule ({scheduleLabel}).
              </p>
              <button
                type="button"
                onClick={activateMoonpay}
                disabled={confirming}
                style={{ ...btnStyle, marginBottom: "0.75rem", opacity: confirming ? 0.6 : 1 }}
              >
                {confirming ? "Saving…" : "Update recurring deposits →"}
              </button>
              <button
                type="button"
                onClick={closeAndNotify}
                style={btnSecondaryStyle}
              >
                Do this later
              </button>
            </>
          )}

          {/* In sync or no MoonPay key: just done */}
          {(fundingInSync || !moonpayUrl) && (
            <button
              type="button"
              onClick={closeAndNotify}
              style={btnStyle}
            >
              Done
            </button>
          )}
        </>
      )}

      {/* ── Phase: confirmed ─────────────────────────── */}
      {phase === "confirmed" && (
        <>
          <p style={bodyTextStyle}>
            MoonPay is opening to complete your recurring deposit setup.
          </p>
          {moonpayUrl && (
            <button
              type="button"
              onClick={() => window.Telegram?.WebApp.openLink(moonpayUrl)}
              style={{ ...btnStyle, marginBottom: "0.75rem" }}
            >
              Open MoonPay →
            </button>
          )}
          <button
            type="button"
            onClick={closeAndNotify}
            style={btnSecondaryStyle}
          >
            Back to bot
          </button>
        </>
      )}
    </main>
  );
}

const PERIOD_LABEL: Record<string, string> = { daily: "day", weekly: "week", monthly: "month" };

function Row({
  label,
  value,
  valueColor,
  warning,
}: {
  label: string;
  value: string;
  valueColor?: string;
  warning?: boolean;
}) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "0.5rem" }}>
      <span style={labelStyle}>{label}</span>
      <span style={{ ...valueStyle, color: valueColor ?? "var(--text)" }}>
        {warning ? "⚠️ " : ""}{value}
      </span>
    </div>
  );
}

const mainStyle: React.CSSProperties        = { padding: "2rem 1.5rem", maxWidth: 400, margin: "0 auto" };
const headingStyle: React.CSSProperties     = { fontSize: "1.25rem", fontWeight: 700, textAlign: "center", marginBottom: "1.25rem", color: "var(--text)" };
const summaryCard: React.CSSProperties      = { background: "var(--bg-card)", borderRadius: "14px", padding: "1rem 1.25rem", display: "flex", flexDirection: "column", gap: "0.75rem", marginBottom: "1.25rem" };
const labelStyle: React.CSSProperties       = { fontSize: "0.72rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-hint)", flexShrink: 0 };
const valueStyle: React.CSSProperties       = { fontSize: "0.95rem", fontWeight: 600, textAlign: "right" };
const walletCodeStyle: React.CSSProperties  = { fontSize: "0.72rem", color: "var(--text-wallet)", wordBreak: "break-all", lineHeight: 1.6, fontFamily: "monospace" };
const bodyTextStyle: React.CSSProperties    = { fontSize: "0.875rem", color: "var(--text-secondary)", lineHeight: 1.55, marginBottom: "1rem" };
const btnStyle: React.CSSProperties         = { display: "block", width: "100%", padding: "0.9rem", background: "#007AFF", color: "#fff", border: "none", borderRadius: "14px", fontSize: "1rem", fontWeight: 600, cursor: "pointer", textAlign: "center" };
const btnSecondaryStyle: React.CSSProperties = { display: "block", width: "100%", padding: "0.9rem", background: "var(--btn-secondary-bg)", color: "var(--btn-secondary-text)", border: "none", borderRadius: "14px", fontSize: "1rem", fontWeight: 600, cursor: "pointer", textAlign: "center" };
