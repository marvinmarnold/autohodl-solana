import type { Metadata } from "next";
import { TelegramScript } from "@/components/TelegramScript";

export const metadata: Metadata = {
  title: "autoHODL",
  description: "Scheduled USDC savings on Solana",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta name="color-scheme" content="light dark" />
        <style>{`
          :root {
            --bg: #ffffff;
            --bg-card: #f2f2f7;
            --text: #000000;
            --text-secondary: #3c3c43;
            --text-hint: #8e8e93;
            --text-wallet: #6e6e73;
            --divider: #e5e5ea;
            --btn-secondary-bg: #e5e5ea;
            --btn-secondary-text: #1c1c1e;
            --bg-code: #f0f0f5;
          }
          @media (prefers-color-scheme: dark) {
            :root {
              --bg: #1c1c1e;
              --bg-card: #2c2c2e;
              --text: #ffffff;
              --text-secondary: #ebebf5;
              --text-hint: #8e8e93;
              --text-wallet: #8e8e93;
              --divider: #38383a;
              --btn-secondary-bg: #3a3a3c;
              --btn-secondary-text: #ffffff;
              --bg-code: #3a3a3c;
            }
          }
          * { box-sizing: border-box; margin: 0; padding: 0; }
          body {
            background-color: var(--bg);
            color: var(--text);
            font-family: system-ui, -apple-system, sans-serif;
          }
        `}</style>
      </head>
      <body>
        <TelegramScript />
        {children}
      </body>
    </html>
  );
}
