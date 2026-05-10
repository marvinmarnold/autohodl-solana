import { Bot, InlineKeyboard, webhookCallback } from "grammy";
import { actionButton } from "@autohodl/blinks-telegram/bot";
import { type NextRequest, NextResponse } from "next/server";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { getOrCreateAssociatedTokenAccount } from "@solana/spl-token";
import { env } from "@/lib/env";
import { WalletPregenerationError, pregenerateWallet, signAndSendSolanaTransaction } from "@/lib/privy";
import {
  deletePending,
  getPending,
  getUserSettings,
  getWallet,
  setUserSettings,
  setWallet,
  setPending,
  settingsInSync,
} from "@/lib/kv";
import { buildWithdrawTransaction, fetchUsdcBalance, buildMetricsMessage, getUsdcMint } from "@/lib/solana";

const bot = new Bot(env.TELEGRAM_BOT_TOKEN);

const PERIOD: Record<string, string> = { daily: "day", weekly: "week", monthly: "month" };

const FREQ_PRESETS: Record<string, number[]> = {
  daily:   [1, 5, 10, 20],
  weekly:  [5, 20, 50, 250],
  monthly: [10, 50, 100, 500],
};

// Pending state types stored in Redis
type PendingCustomAmount = { freq: string };
type PendingWithdraw = { step: "amount" | "address"; amount?: number };
type PendingWalletSetup = { waiting: true };

function buildActionKeyboard(balance: number | null): InlineKeyboard {
  const kb = new InlineKeyboard()
    .text("📊 Report", "action:report")
    .text("⚙️ Settings", "action:settings")
    .row()
    .text("💵 Deposit", "action:deposit");
  if (balance !== null && balance > 0) {
    kb.text("💸 Withdraw", "action:withdraw");
  }
  return kb;
}

function authorizeActionUrl(telegramId: string, freq: string, amount: number): string {
  return `${env.NEXT_PUBLIC_MINI_APP_URL}/api/actions/authorize?telegramId=${telegramId}&freq=${freq}&amount=${amount}`;
}

// ── /start ─────────────────────────────────────────────────────────────────────

bot.command("start", async (ctx) => {
  const telegramId = String(ctx.from?.id);
  if (!telegramId) {
    await ctx.reply("Could not identify your Telegram account. Please try again.");
    return;
  }

  // Check for /start <WALLET_ADDRESS> shortcut (agent / power-user flow)
  const parts = ctx.message?.text?.split(" ") ?? [];
  const walletArg = parts[1];
  if (walletArg) {
    let pubkey: PublicKey;
    try {
      pubkey = new PublicKey(walletArg);
    } catch {
      await ctx.reply("That doesn't look like a valid Solana address. Send /start to begin.");
      return;
    }
    const existing = await getWallet(telegramId);
    if (!existing) {
      await setWallet(telegramId, { walletAddress: pubkey.toBase58(), walletType: "external" });
    }
    await startSavingsSetup(ctx.reply.bind(ctx), telegramId);
    return;
  }

  // Returning user — wallet already in KV
  const existing = await getWallet(telegramId);
  if (existing) {
    const settings = await getUserSettings(telegramId);
    let balance: number | null = null;
    balance = await fetchUsdcBalance(existing.walletAddress);
    await ctx.reply(buildMetricsMessage(balance, existing.walletAddress, settings?.fundingAmountUsd != null), {
      parse_mode: "Markdown",
      link_preview_options: { is_disabled: true },
    });

    if (settings) {
      const sp = PERIOD[settings.savingsFrequency] ?? settings.savingsFrequency;
      const hasFunding = settings.fundingAmountUsd != null;
      const fp = settings.fundingFrequency ? (PERIOD[settings.fundingFrequency] ?? settings.fundingFrequency) : null;
      const inSync = hasFunding && settingsInSync(settings);

      if (inSync) {
        await ctx.reply("What would you like to do?", {
          reply_markup: buildActionKeyboard(balance),
        });
      } else {
        const lines: string[] = [
          "Your current plan:\n",
          `✅ Savings schedule: $${settings.savingsAmountUsd} / ${sp}`,
          hasFunding && fp
            ? `⚠️ Funding schedule: $${settings.fundingAmountUsd} / ${fp}`
            : "❌ Funding schedule: Not configured",
          "\nUpdate savings schedule:",
        ];
        await ctx.reply(lines.join("\n"), {
          reply_markup: new InlineKeyboard()
            .text("📅 Daily", "freq:daily")
            .text("📆 Weekly", "freq:weekly")
            .text("🗓 Monthly", "freq:monthly"),
        });
      }
    } else {
      await startSavingsSetup(ctx.reply.bind(ctx), telegramId);
    }
    return;
  }

  // First-time user — ask create or BYO
  await ctx.reply(
    "👋 Welcome to autoHODL!\n\nSave a fixed amount on a schedule and earn yield automatically — no bank, no middleman.\n\nDo you have a Solana wallet you'd like to use, or should I create one for you?",
    {
      reply_markup: new InlineKeyboard()
        .text("🔑 Create a wallet for me", "wallet:create")
        .text("💼 I have my own wallet", "wallet:own"),
    },
  );
});

// ── Wallet choice callbacks ────────────────────────────────────────────────────

bot.callbackQuery("wallet:create", async (ctx) => {
  const telegramId = String(ctx.from?.id);
  await ctx.answerCallbackQuery();

  try {
    await pregenerateWallet(telegramId);
  } catch (err) {
    if (err instanceof WalletPregenerationError) {
      console.error("Wallet pregeneration failed:", err);
      await ctx.reply("Something went wrong setting up your wallet. Please try again in a moment.");
      return;
    }
    throw err;
  }

  await startSavingsSetup(ctx.reply.bind(ctx), telegramId);
});

bot.callbackQuery("wallet:own", async (ctx) => {
  const telegramId = String(ctx.from?.id);
  await ctx.answerCallbackQuery();
  await setPending<PendingWalletSetup>("wallet_setup", telegramId, { waiting: true }, 300);
  await ctx.reply("Please send your Solana wallet address (base58).");
});

// ── Report / Settings actions ───────────────────────────────────────────────────

bot.callbackQuery("action:report", async (ctx) => {
  const telegramId = String(ctx.from?.id);
  await ctx.answerCallbackQuery();
  const [walletRecord, settings] = await Promise.all([getWallet(telegramId), getUserSettings(telegramId)]);
  if (walletRecord) {
    const balance = await fetchUsdcBalance(walletRecord.walletAddress);
    await ctx.reply(buildMetricsMessage(balance, walletRecord.walletAddress, settings?.fundingAmountUsd != null), {
      parse_mode: "Markdown",
      link_preview_options: { is_disabled: true },
    });
  }
});

bot.callbackQuery("action:settings", async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.reply("How often do you want to save?", {
    reply_markup: new InlineKeyboard()
      .text("📅 Daily", "freq:daily")
      .text("📆 Weekly", "freq:weekly")
      .text("🗓 Monthly", "freq:monthly"),
  });
});

bot.callbackQuery("action:deposit", async (ctx) => {
  const telegramId = String(ctx.from?.id);
  await ctx.answerCallbackQuery();
  const walletRecord = await getWallet(telegramId);
  if (!walletRecord) { await ctx.reply("Wallet not found."); return; }
  await ctx.reply(
    `💵 *Deposit address*\n\n\`${walletRecord.walletAddress}\`\n\nSend USDC to this address to fund your savings account.`,
    { parse_mode: "Markdown" },
  );
});

bot.callbackQuery("action:withdraw", async (ctx) => {
  const telegramId = String(ctx.from?.id);
  await ctx.answerCallbackQuery();
  const walletRecord = await getWallet(telegramId);
  const balance = walletRecord ? await fetchUsdcBalance(walletRecord.walletAddress) : null;
  const balanceLine = balance !== null ? `Available: $${balance.toFixed(2)} USDC\n\n` : "";
  await setPending<PendingWithdraw>("withdraw", telegramId, { step: "amount" }, 600);
  await ctx.reply(`${balanceLine}How much USDC would you like to withdraw?`);
});

// ── Frequency selected ──────────────────────────────────────────────────────────

bot.callbackQuery(/^freq:(daily|weekly|monthly)$/, async (ctx) => {
  const freq = ctx.match[1] as string;
  await ctx.answerCallbackQuery();
  const p = PERIOD[freq] ?? freq;
  const presets = FREQ_PRESETS[freq] ?? [];
  const kb = new InlineKeyboard();
  for (const amt of presets) kb.text(`$${amt}`, `amount:${freq}:${amt}`);
  kb.row().text("Custom amount", `custom:${freq}`);
  await ctx.reply(`How much per ${p}?`, { reply_markup: kb });
});

// ── Amount selected ─────────────────────────────────────────────────────────────

bot.callbackQuery(/^amount:(daily|weekly|monthly):(\d+)$/, async (ctx) => {
  const freq = ctx.match[1] as string;
  const amount = Number(ctx.match[2]);
  const telegramId = String(ctx.from?.id);
  await ctx.answerCallbackQuery();
  const existing = await getUserSettings(telegramId);
  const walletRecord = await getWallet(telegramId);
  await handleAmountSelected(ctx.reply.bind(ctx), telegramId, freq, amount, existing, walletRecord?.walletType);
});

// ── Custom amount ───────────────────────────────────────────────────────────────

bot.callbackQuery(/^custom:(daily|weekly|monthly)$/, async (ctx) => {
  const freq = ctx.match[1] as string;
  const telegramId = String(ctx.from?.id);
  await ctx.answerCallbackQuery();
  await setPending<PendingCustomAmount>("custom_amount", telegramId, { freq }, 300);
  await ctx.reply("How much would you like to save?\n\nEnter a number in USD, e.g. 35");
});

bot.on("message:text", async (ctx) => {
  const telegramId = String(ctx.from?.id);
  const text = ctx.message.text.trim();

  // ── BYO wallet address input ────────────────────────────────────────────────
  const walletSetup = await getPending<PendingWalletSetup>("wallet_setup", telegramId);
  if (walletSetup) {
    await deletePending("wallet_setup", telegramId);
    let pubkey: PublicKey;
    try {
      pubkey = new PublicKey(text);
    } catch {
      await ctx.reply("That doesn't look like a valid Solana address. Try again or send /start to restart.");
      return;
    }
    await setWallet(telegramId, { walletAddress: pubkey.toBase58(), walletType: "external" });
    await ctx.reply(`✅ Got it — using wallet \`${pubkey.toBase58().slice(0, 6)}…${pubkey.toBase58().slice(-4)}\``, {
      parse_mode: "Markdown",
    });
    await startSavingsSetup(ctx.reply.bind(ctx), telegramId);
    return;
  }

  // ── Withdraw conversation ───────────────────────────────────────────────────
  const wd = await getPending<PendingWithdraw>("withdraw", telegramId);
  if (wd) {
    if (wd.step === "amount") {
      const amount = Number(text);
      if (!Number.isFinite(amount) || amount <= 0) {
        await ctx.reply("Enter a valid USDC amount, e.g. 5:");
        return;
      }
      await setPending<PendingWithdraw>("withdraw", telegramId, { step: "address", amount }, 600);
      await ctx.reply("Which Solana address should I send to?");
      return;
    }

    if (wd.step === "address" && wd.amount !== undefined) {
      let toPubkey: PublicKey;
      try {
        toPubkey = new PublicKey(text);
      } catch {
        await ctx.reply("That doesn't look like a valid Solana address. Try again:");
        return;
      }

      await deletePending("withdraw", telegramId);
      const walletRecord = await getWallet(telegramId);
      if (!walletRecord) { await ctx.reply("Wallet not found."); return; }

      const short = `${text.slice(0, 6)}…${text.slice(-4)}`;
      await ctx.reply(`Sending $${wd.amount} USDC to ${short}…`);

      try {
        const connection = new Connection(env.NEXT_PUBLIC_SOLANA_RPC_URL, "confirmed");
        const funder = Keypair.fromSecretKey(Buffer.from(env.FUNDER_PRIVATE_KEY, "base64"));
        const usdcMint = new PublicKey(getUsdcMint());

        // Ensure recipient ATA exists — funder pays for creation if needed.
        await getOrCreateAssociatedTokenAccount(connection, funder, usdcMint, toPubkey);

        const txBase64 = await buildWithdrawTransaction(
          walletRecord.walletAddress,
          text,
          wd.amount,
          connection,
        );

        if (!walletRecord.walletId) {
          await ctx.reply("❌ Withdraw is only supported for Privy-managed wallets.");
          return;
        }

        const sig = await signAndSendSolanaTransaction(walletRecord.walletId, txBase64, connection);
        const cluster = env.SOLANA_NETWORK === "devnet" ? "?cluster=devnet" : "";
        await ctx.reply(
          `✅ Sent $${wd.amount} USDC to ${short}\n\n[View transaction](https://solscan.io/tx/${sig}${cluster})`,
          { parse_mode: "Markdown", link_preview_options: { is_disabled: true } },
        );
      } catch (err) {
        console.error("Withdraw failed:", err);
        await ctx.reply("❌ Transfer failed. Make sure your wallet has enough USDC and SOL for fees.");
      }
      return;
    }
  }

  // ── Custom savings amount ───────────────────────────────────────────────────
  const pending = await getPending<PendingCustomAmount>("custom_amount", telegramId);
  if (!pending) return;

  const amount = Number(text);
  if (!Number.isFinite(amount) || amount <= 0) {
    await ctx.reply("That doesn't look right — enter a number, e.g. 35:");
    return;
  }

  await deletePending("custom_amount", telegramId);
  const existing = await getUserSettings(telegramId);
  const walletRecord = await getWallet(telegramId);
  await handleAmountSelected(ctx.reply.bind(ctx), telegramId, pending.freq, amount, existing, walletRecord?.walletType);
});

// ── Helpers ─────────────────────────────────────────────────────────────────────

async function startSavingsSetup(
  reply: (text: string, other?: Parameters<import("grammy").Context["reply"]>[1]) => Promise<unknown>,
  _telegramId: string,
): Promise<void> {
  await reply("How often do you want to save?", {
    reply_markup: new InlineKeyboard()
      .text("📅 Daily", "freq:daily")
      .text("📆 Weekly", "freq:weekly")
      .text("🗓 Monthly", "freq:monthly"),
  });
}

// Shared handler: saves immediately for returning users (delegation already in place),
// or shows the appropriate signing CTA for first-time users.
async function handleAmountSelected(
  reply: (text: string, other?: Parameters<import("grammy").Context["reply"]>[1]) => Promise<unknown>,
  telegramId: string,
  freq: string,
  amount: number,
  existing: Awaited<ReturnType<typeof getUserSettings>>,
  walletType: "privy" | "external" | undefined,
) {
  if (existing) {
    // Delegation already signed — update KV directly, no re-signing needed.
    await setUserSettings(telegramId, {
      ...existing,
      savingsFrequency: freq,
      savingsAmountUsd: amount,
    });

    await reply("✅ Settings updated.");

    const walletRecord = await getWallet(telegramId);
    if (walletRecord) {
      const balance = await fetchUsdcBalance(walletRecord.walletAddress);
      await reply(buildMetricsMessage(balance, walletRecord.walletAddress, existing.fundingAmountUsd != null), {
        parse_mode: "Markdown",
        link_preview_options: { is_disabled: true },
      });
      await reply("What would you like to do?", {
        reply_markup: buildActionKeyboard(balance),
      });
    }
    return;
  }

  if (walletType === "external") {
    // External wallet: send Action links — user signs in their own wallet app.
    const actionUrl = authorizeActionUrl(telegramId, freq, amount);
    const phantomUrl = `https://phantom.app/ul/v1/browse/${encodeURIComponent(actionUrl)}`;
    const p = PERIOD[freq] ?? freq;
    await reply(
      `Ready to authorize $${amount}/${p} savings.\n\nSign with your wallet to activate:`,
      {
        reply_markup: new InlineKeyboard()
          .url("Sign with Phantom →", phantomUrl)
          .row()
          .url("Other wallet / browser", actionUrl),
      },
    );
    return;
  }

  // Privy wallet first-time — WebView needed to sign the initial Token.approve.
  await reply(buildConfirmMessage(freq, amount), {
    reply_markup: actionButton(
      "Complete setup",
      `${env.NEXT_PUBLIC_MINI_APP_URL}/actions/authorize?freq=${freq}&amount=${amount}`,
    ),
  });
}

function buildConfirmMessage(freq: string, amount: number): string {
  const p = PERIOD[freq] ?? freq;
  return [
    `✅ Savings schedule: $${amount} / ${p}`,
    `✏️ Funding schedule: $${amount} / ${p}`,
    "❌ Automatic funding via MoonPay",
    "",
    "Authorize autoHODL, then connect MoonPay to activate funding.",
  ].join("\n");
}

const handleUpdate = webhookCallback(bot, "std/http");

export async function POST(req: NextRequest) {
  try {
    return await handleUpdate(req);
  } catch (err) {
    console.error("Bot handler error:", err);
    return new NextResponse("OK", { status: 200 });
  }
}
