import { env } from "@/lib/env";
import { getWallet, getUserSettings } from "@/lib/kv";
import { fetchUsdcBalance, buildMetricsMessage } from "@/lib/solana";
import { getSquadsVaultAddress } from "@/lib/squads";

type MessageOptions = {
  parse_mode?: "Markdown" | "HTML";
  link_preview_options?: { is_disabled?: boolean };
  reply_markup?: object;
};

export async function sendBotMessage(chatId: string, text: string, options: MessageOptions = {}): Promise<void> {
  const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, ...options }),
  });
  if (!res.ok) {
    console.error(`Telegram sendMessage failed: ${res.status}`, await res.text().catch(() => "(unreadable)"));
  }
}

export async function notifyBotAuthorizationComplete(telegramId: string): Promise<void> {
  const [walletRecord, settings] = await Promise.all([
    getWallet(telegramId),
    getUserSettings(telegramId),
  ]);
  const vault = walletRecord
    ? (walletRecord.vaultAddress ?? getSquadsVaultAddress(walletRecord.walletAddress))
    : null;
  const balance = vault
    ? await fetchUsdcBalance(vault, walletRecord?.walletAddress)
    : null;

  await sendBotMessage(telegramId, "✅ Savings authorized!");

  if (walletRecord && vault) {
    await sendBotMessage(
      telegramId,
      buildMetricsMessage(balance, vault, settings?.fundingAmountUsd != null, walletRecord.walletAddress),
      { parse_mode: "Markdown", link_preview_options: { is_disabled: true } },
    );
  }

  const hasBalance = balance !== null && balance > 0;
  await sendBotMessage(telegramId, "What would you like to do?", {
    reply_markup: {
      inline_keyboard: [
        [
          { text: "📊 Report", callback_data: "action:report" },
          { text: "⚙️ Settings", callback_data: "action:settings" },
        ],
        [
          { text: "💵 Deposit", callback_data: "action:deposit" },
          ...(hasBalance ? [{ text: "💸 Withdraw", callback_data: "action:withdraw" }] : []),
        ],
      ],
    },
  });
}
