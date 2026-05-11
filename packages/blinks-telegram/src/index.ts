// @autohodl/blinks-telegram
// Render Solana Actions/Blinks inside Telegram.
// The Telegram-native equivalent of @dialectlabs/blinks for the web.

export { validateInitData, InvalidInitDataError, type TelegramUser } from "./server.js";
export { actionButton, webAppDataMiddleware, type WebAppDataPayload } from "./bot.js";
export {
  useTelegramAuth,
  TelegramBlink,
  type AuthStatus,
  type TelegramAuthResult,
  type TelegramBlinkProps,
} from "./webview.js";
