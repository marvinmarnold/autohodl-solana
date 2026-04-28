// Type declarations for the Telegram Mini App JavaScript SDK.
// https://core.telegram.org/bots/webapps#initializing-mini-apps
// Only the fields we actually use are typed here.
declare global {
  interface Window {
    Telegram?: {
      WebApp: {
        /** URL-encoded initData string, HMAC-signed by Telegram. Empty in browser. */
        initData: string;
        /** Signals to Telegram that the Mini App is ready to display. */
        ready: () => void;
      };
    };
  }
}

export {};
