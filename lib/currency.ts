export type SupportedCurrency = 'CHF' | 'EUR';

export const DEFAULT_CURRENCY: SupportedCurrency = 'CHF';

export function formatCurrency(
  amount: number | null | undefined,
  currency: SupportedCurrency = DEFAULT_CURRENCY
): string {
  const safeAmount = Number.isFinite(Number(amount)) ? Number(amount) : 0;

  return `${currency} ${safeAmount.toFixed(2)}`;
}