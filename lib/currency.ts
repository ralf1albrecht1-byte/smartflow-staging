export type SupportedCurrency = 'CHF' | 'EUR';

export function normalizeCurrency(value?: string | null): SupportedCurrency {
  return value === 'EUR' ? 'EUR' : 'CHF';
}

export function formatCurrency(value: number | null | undefined, currency: string = 'CHF') {
  const normalized = normalizeCurrency(currency);

  return `${normalized} ${Number(value ?? 0).toFixed(2)}`;
}

export function currencyLabel(currency: string = 'CHF') {
  return normalizeCurrency(currency);
}