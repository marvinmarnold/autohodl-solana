"use client";

import Script from "next/script";

// Wraps the Telegram WebApp script so we can fire a custom event on load.
// The script loads afterInteractive (after React hydration), which races with
// useEffect. Pages that need to know when it's ready listen for "telegram-ready".
export function TelegramScript() {
  return (
    <Script
      src="https://telegram.org/js/telegram-web-app.js"
      strategy="afterInteractive"
      onLoad={() => window.dispatchEvent(new Event("telegram-ready"))}
    />
  );
}
