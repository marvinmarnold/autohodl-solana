// Client-side React utilities for rendering Blinks inside a Telegram WebView.
// Depends on @dialectlabs/blinks and react (peer dependencies).

import { useState, useEffect, useCallback } from "react";
import { Blink, useAction, type BlinkAdapter, type BlinkSupportStrategy } from "@dialectlabs/blinks";
import { setProxyUrl } from "@dialectlabs/blinks-core";
import "@dialectlabs/blinks/index.css";

// Disable the dial.to proxy — we call first-party action URLs directly.
// Must run before any useAction hook fires.
setProxyUrl("");

// ── Auth ──────────────────────────────────────────────────────────────────────

export type AuthStatus = "pending" | "ready" | "error";

export type TelegramAuthResult = {
  status: AuthStatus;
  walletAddress: string | null;
  error: string | null;
};

/**
 * Authenticates the current Telegram WebView user by posting initData to
 * the given authApiPath, then returns the wallet address from the response.
 *
 * @example
 * const { status, walletAddress } = useTelegramAuth({ authApiPath: "/api/auth" });
 */
export function useTelegramAuth({
  authApiPath = "/api/auth",
  enabled = true,
}: {
  authApiPath?: string;
  /** Set to false to skip auth entirely (e.g. non-Telegram browser context). */
  enabled?: boolean;
} = {}): TelegramAuthResult {
  const [status, setStatus] = useState<AuthStatus>("pending");
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    window.Telegram?.WebApp.ready();

    async function auth() {
      try {
        const initData = window.Telegram?.WebApp.initData;

        if (initData) {
          const res = await fetch(authApiPath, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ initData }),
          });
          if (!res.ok) throw new Error("Auth failed. Try again from the bot.");
          const data = (await res.json()) as { walletAddress?: string };
          if (data.walletAddress) setWalletAddress(data.walletAddress);
        } else {
          // Dev mode: try existing session
          const res = await fetch("/api/me");
          if (!res.ok) throw new Error("Open this via the bot.");
          const data = (await res.json()) as { walletAddress?: string };
          if (data.walletAddress) setWalletAddress(data.walletAddress);
        }

        setStatus("ready");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unexpected error");
        setStatus("error");
      }
    }

    auth();
  }, [authApiPath, enabled]);

  return { status, walletAddress, error };
}

// ── TelegramBlink component ───────────────────────────────────────────────────

// A support strategy that always approves the action — appropriate for
// first-party WebViews where the Telegram bot has already established trust.
const alwaysSupported: BlinkSupportStrategy = async () => ({ isSupported: true });

export type TelegramBlinkProps = {
  /** Full URL to the Solana Action endpoint (GET + POST) */
  actionUrl: string;
  /** Wallet adapter that will sign the transaction */
  adapter: BlinkAdapter;
  /** Called with the transaction signature after successful signing */
  onSuccess?: (signature: string) => void;
  /** Called with an error message if signing fails */
  onError?: (reason: string) => void;
  /** Style preset forwarded to Dialect's Blink component */
  stylePreset?: "default" | "x-dark" | "x-light" | "custom";
  /**
   * Override the Dialect support strategy. Defaults to always-trusted,
   * which bypasses the Actions Registry check. Pass defaultBlinkSupportStrategy
   * if you want the standard registry check for external-facing components.
   */
  supportStrategy?: BlinkSupportStrategy;
};

/**
 * Renders a Solana Action as a Blink inside a Telegram WebView.
 * Fetches the action metadata, shows the Dialect Blink UI, and calls
 * onSuccess/onError when the user completes or cancels.
 *
 * @example
 * <TelegramBlink
 *   actionUrl="/api/actions/authorize/webview?freq=weekly&amount=20"
 *   adapter={privyServerAdapter}
 *   onSuccess={(sig) => router.push(`/success?sig=${sig}`)}
 * />
 */
export function TelegramBlink({
  actionUrl,
  adapter,
  onSuccess,
  onError,
  stylePreset = "default",
  supportStrategy = alwaysSupported,
}: TelegramBlinkProps) {
  const { blink } = useAction({ url: actionUrl, supportStrategy });

  const handleComplete = useCallback(
    (_action: unknown, _trigger: unknown, signature?: string) => {
      if (signature) onSuccess?.(signature);
    },
    [onSuccess],
  );

  const handleError = useCallback(
    (_action: unknown, _trigger: unknown, reason: string) => {
      onError?.(reason);
    },
    [onError],
  );

  if (!blink) {
    return (
      <div style={{ padding: "3rem 1.5rem", textAlign: "center" }}>
        <p style={{ fontSize: "2rem", marginBottom: "0.75rem" }}>⏳</p>
        <p style={{ fontWeight: 600 }}>Loading…</p>
      </div>
    );
  }

  return (
    <Blink
      blink={blink}
      adapter={adapter}
      stylePreset={stylePreset}
      securityLevel="all"
      callbacks={{
        onActionComplete: handleComplete,
        onActionError: handleError,
      }}
    />
  );
}
