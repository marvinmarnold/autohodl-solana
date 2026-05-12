// Set MIN_SAVINGS_AMOUNT_USD to override all per-period minimums at once (useful for testing).
const envMin = process.env.MIN_SAVINGS_AMOUNT_USD
  ? Number(process.env.MIN_SAVINGS_AMOUNT_USD)
  : null;

export const MIN_SAVINGS_AMOUNTS = {
  daily:   envMin ?? 1,
  weekly:  envMin ?? 5,
  monthly: envMin ?? 10,
};
