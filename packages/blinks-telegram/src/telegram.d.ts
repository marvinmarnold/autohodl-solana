// Minimal type declarations for the Telegram Mini App JS SDK.
// Only the fields used by @autohodl/blinks-telegram are declared here.
declare global {
  interface Window {
    Telegram?: {
      WebApp: {
        initData: string;
        ready: () => void;
        close: () => void;
      };
    };
  }
}

export {};
