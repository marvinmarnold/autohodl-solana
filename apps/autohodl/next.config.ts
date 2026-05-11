import type { NextConfig } from "next";

const config: NextConfig = {
  allowedDevOrigins: ["*.trycloudflare.com"],
  async headers() {
    return [
      {
        // actions.json must be CORS-accessible so the Dialect browser extension
        // (running in the X.com page context) can verify domain trust.
        source: "/actions.json",
        headers: [
          { key: "Access-Control-Allow-Origin", value: "*" },
          { key: "Content-Type", value: "application/json" },
        ],
      },
    ];
  },
};

export default config;
