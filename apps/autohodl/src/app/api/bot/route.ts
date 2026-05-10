import { Bot, InlineKeyboard, webhookCallback } from "grammy";
import { type NextRequest, NextResponse } from "next/server";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddressSync, getOrCreateAssociatedTokenAccount } from "@solana/spl-token";
import { env } from "@/lib/env";
import { WalletPregenerationError, pregenerateWallet, signAndSendSolanaTransaction } from "@/lib/privy";
import { getUserSettings, getWallet, setUserSettings, settingsInSync } from "@/lib/kv";
import { buildWithdrawTransaction, getUsdcMint } from "@/lib/solana";

const bot = new Bot(env.TELEGRAM_BOT_TOKEN);

const pendingCustomAmount = new Map<string, { freq: string; expiresAt: number }>();
const pendingWithdraw = new Map<string, { step: "amount" | "address"; amount?: number; expiresAt: number }>();

const PERIOD: Record<string, string> = { daily: "day", weekly: "week", monthly: "month" };

const FREQ_PRESETS: Record<string, number[]> = {
  daily:   [1, 5, 10, 20],
  weekly:  [5, 20, 50, 250],
  monthly: [10, 50, 100, 500],
};

function authorizeUrl(freq: string, amount: number): string {
  return `${env.NEXT_PUBLIC_MINI_APP_URL}/actions/authorize?freq=${freq}&amount=${amount}`;
}

// ── /start ─────────────────────────────────────────────────────────────────────

bot.command("start", async (ctx) => {
  const telegramId = String(ctx.from?.id);
  if (!telegramId) {
    await ctx.reply("Could not identify your Telegram account. Please try again.");
    return;
  }

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

  const existing = await getUserSettings(telegramId);

  if (existing) {
    // Fetch wallet address + on-chain balance in parallel with existing data reads.
    const walletRecord = await getWallet(telegramId);
    if (walletRecord) {
      const balance = await fetchUsdcBalance(walletRecord.walletAddress);
      await ctx.reply(buildMetricsMessage(balance, walletRecord.walletAddress, existing.fundingAmountUsd != null), {
        parse_mode: "Markdown",
        link_preview_options: { is_disabled: true },
      });
    }

    const sp = PERIOD[existing.savingsFrequency] ?? existing.savingsFrequency;
    const hasFunding = existing.fundingAmountUsd != null;
    const fp = existing.fundingFrequency ? (PERIOD[existing.fundingFrequency] ?? existing.fundingFrequency) : null;
    const inSync = hasFunding && settingsInSync(existing);

    if (inSync) {
      await ctx.reply("What would you like to do?", {
        reply_markup: new InlineKeyboard()
          .text("📊 Report", "action:report")
          .text("⚙️ Settings", "action:settings")
          .row()
          .text("💵 Deposit", "action:deposit")
          .text("💸 Withdraw", "action:withdraw"),
      });
    } else {
      const lines: string[] = [
        "Your current plan:\n",
        `✅ Savings schedule: $${existing.savingsAmountUsd} / ${sp}`,
        hasFunding && fp
          ? `⚠️ Funding schedule: $${existing.fundingAmountUsd} / ${fp}`
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
    await ctx.reply(
      "👋 Welcome to autoHODL!\n\nSave a fixed amount on a schedule and earn yield automatically — no bank, no middleman.\n\nHow often do you want to save?",
      {
        reply_markup: new InlineKeyboard()
          .text("📅 Daily", "freq:daily")
          .text("📆 Weekly", "freq:weekly")
          .text("🗓 Monthly", "freq:monthly"),
      },
    );
  }
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
  pendingWithdraw.set(telegramId, { step: "amount", expiresAt: Date.now() + 10 * 60 * 1000 });
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
  await handleAmountSelected(ctx.reply.bind(ctx), telegramId, freq, amount, existing);
});

// ── Custom amount ───────────────────────────────────────────────────────────────

bot.callbackQuery(/^custom:(daily|weekly|monthly)$/, async (ctx) => {
  const freq = ctx.match[1] as string;
  const telegramId = String(ctx.from?.id);
  await ctx.answerCallbackQuery();
  pendingCustomAmount.set(telegramId, { freq, expiresAt: Date.now() + 5 * 60 * 1000 });
  await ctx.reply("How much would you like to save?\n\nEnter a number in USD, e.g. 35");
});

bot.on("message:text", async (ctx) => {
  const telegramId = String(ctx.from?.id);
  const text = ctx.message.text.trim();

  // ── Withdraw conversation ───────────────────────────────────────────────────
  const wd = pendingWithdraw.get(telegramId);
  if (wd && Date.now() <= wd.expiresAt) {
    if (wd.step === "amount") {
      const amount = Number(text);
      if (!Number.isFinite(amount) || amount <= 0) {
        await ctx.reply("Enter a valid USDC amount, e.g. 5:");
        return;
      }
      pendingWithdraw.set(telegramId, { ...wd, step: "address", amount });
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

      pendingWithdraw.delete(telegramId);
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
  pendingWithdraw.delete(telegramId);

  // ── Custom savings amount ───────────────────────────────────────────────────
  const pending = pendingCustomAmount.get(telegramId);
  if (!pending || Date.now() > pending.expiresAt) {
    pendingCustomAmount.delete(telegramId);
    return;
  }

  const amount = Number(text);
  if (!Number.isFinite(amount) || amount <= 0) {
    await ctx.reply("That doesn't look right — enter a number, e.g. 35:");
    return;
  }

  pendingCustomAmount.delete(telegramId);
  const existing = await getUserSettings(telegramId);
  await handleAmountSelected(ctx.reply.bind(ctx), telegramId, pending.freq, amount, existing);
});

// Shared handler: saves immediately for returning users (delegation already in place),
// or shows the WebView CTA for first-time users who need to sign Token.approve.
async function handleAmountSelected(
  reply: (text: string, other?: Parameters<import("grammy").Context["reply"]>[1]) => Promise<unknown>,
  telegramId: string,
  freq: string,
  amount: number,
  existing: Awaited<ReturnType<typeof getUserSettings>>,
) {
  if (existing) {
    // Delegation already signed — update KV directly, no WebView needed.
    await setUserSettings(telegramId, {
      ...existing,
      savingsFrequency: freq,
      savingsAmountUsd: amount,
    });

    const p = PERIOD[freq] ?? freq;
    const hasFunding = existing.fundingAmountUsd != null;
    const nowInSync = hasFunding &&
      existing.fundingFrequency === freq && existing.fundingAmountUsd === amount;

    const lines = [
      `✅ Savings schedule: $${amount} / ${p}`,
      hasFunding
        ? (nowInSync
            ? "✅ Automatic funding"
            : `⚠️ Automatic funding (still $${existing.fundingAmountUsd} / ${PERIOD[existing.fundingFrequency ?? ""] ?? existing.fundingFrequency})`)
        : "❌ Automatic funding",
    ];

    const kb = new InlineKeyboard();
    if (!nowInSync) {
      kb.add({
        text: "Confirm changes",
        web_app: { url: authorizeUrl(freq, amount) },
      });
    }

    await reply(lines.join("\n"), {
      reply_markup: nowInSync ? undefined : kb,
    });
  } else {
    // First time — WebView needed to sign the initial Token.approve.
    await reply(buildConfirmMessage(freq, amount), {
      reply_markup: new InlineKeyboard().add({
        text: "Complete setup",
        web_app: { url: authorizeUrl(freq, amount) },
      }),
    });
  }
}

// ── Metrics ─────────────────────────────────────────────────────────────────────

async function fetchUsdcBalance(walletAddress: string): Promise<number | null> {
  try {
    const connection = new Connection(env.NEXT_PUBLIC_SOLANA_RPC_URL, "confirmed");
    const mint  = new PublicKey(getUsdcMint());
    const owner = new PublicKey(walletAddress);
    const ata   = getAssociatedTokenAddressSync(mint, owner);
    const bal   = await connection.getTokenAccountBalance(ata);
    return bal.value.uiAmount ?? 0;
  } catch {
    return null;
  }
}

function buildMetricsMessage(usdcBalance: number | null, walletAddress: string, hasFunding: boolean): string {
  const short = `${walletAddress.slice(0, 6)}…${walletAddress.slice(-6)}`;
  const cluster = env.SOLANA_NETWORK === "devnet" ? "?cluster=devnet" : "";
  const solscanUrl = `https://solscan.io/account/${walletAddress}${cluster}`;
  const balanceLine = usdcBalance !== null
    ? `💰 Saved: $${usdcBalance.toFixed(2)} USDC`
    : "💰 Saved: —";
  return [
    "📊 *Your savings*\n",
    balanceLine,
    // TODO: replace with live Reflect APY once program integration is wired up.
    "📈 Yield: ~5% APY via Reflect",
    hasFunding ? "✅ Automatic funding via MoonPay" : "❌ Automatic funding via MoonPay",
    `👛 [${short}](${solscanUrl})`,
  ].join("\n");
}

// ── Helpers ─────────────────────────────────────────────────────────────────────

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
