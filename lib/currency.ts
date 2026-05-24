export type SupportedCurrency = 'CHF' | 'EUR';

export const DEFAULT_CURRENCY: SupportedCurrency = 'CHF';

export function roundMoney(amount: number | null | undefined): number {
  const safeAmount = Number.isFinite(Number(amount)) ? Number(amount) : 0;
  return Math.round((safeAmount + Number.EPSILON) * 100) / 100;
}

export function formatCurrency(
  amount: number | null | undefined,
  currency: SupportedCurrency = DEFAULT_CURRENCY
): string {
  return `${currency} ${roundMoney(amount).toFixed(2)}`;
}
