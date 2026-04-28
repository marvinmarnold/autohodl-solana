import type { Metadata } from "next";
import Script from "next/script";

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
    <html lang="en">
      <head />
      <body>
        <Script
          src="https://telegram.org/js/telegram-web-app.js"
          strategy="afterInteractive"
        />
        {children}
      </body>
    </html>
  );
}
