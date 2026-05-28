export type SupportedCurrency = 'CHF' | 'EUR';

export const DEFAULT_CURRENCY: SupportedCurrency = 'CHF';

const MONEY_DECIMALS = 2;
const MONEY_FACTOR = 100;
const MONEY_ROUNDING_TOLERANCE = 1e-8;

const toFiniteNumber = (amount: number | string | null | undefined): number => {
  const value = Number(amount);
  return Number.isFinite(value) ? value : 0;
};

/**
 * Rounds monetary values to cents with stable commercial rounding.
 *
 * Why not only Number.EPSILON?
 * JavaScript may produce values like 565.424999999999 instead of 565.425.
 * That must still become 565.43, not 565.42.
 */
export function roundMoney(amount: number | string | null | undefined): number {
  const safeAmount = toFiniteNumber(amount);
  const scaled = safeAmount * MONEY_FACTOR;

  const roundedCents =
    safeAmount >= 0
      ? Math.floor(scaled + 0.5 + MONEY_ROUNDING_TOLERANCE)
      : Math.ceil(scaled - 0.5 - MONEY_ROUNDING_TOLERANCE);

  return Number((roundedCents / MONEY_FACTOR).toFixed(MONEY_DECIMALS));
}

export function calculateLineTotal(
  quantity: number | string | null | undefined,
  unitPrice: number | string | null | undefined,
): number {
  return roundMoney(toFiniteNumber(quantity) * toFiniteNumber(unitPrice));
}

export function calculateVatAmount(
  subtotal: number | string | null | undefined,
  vatRate: number | string | null | undefined,
): number {
  return roundMoney(roundMoney(subtotal) * (toFiniteNumber(vatRate) / 100));
}

export function calculateGrossTotal(
  subtotal: number | string | null | undefined,
  vatRate: number | string | null | undefined,
): number {
  const net = roundMoney(subtotal);
  const vat = calculateVatAmount(net, vatRate);
  return roundMoney(net + vat);
}

export function calculateDocumentTotals(
  items: Array<{ quantity?: number | string | null; unitPrice?: number | string | null }>,
  vatRate: number | string | null | undefined,
): { subtotal: number; vatAmount: number; total: number } {
  const subtotal = roundMoney(
    items.reduce(
      (sum, item) => sum + calculateLineTotal(item?.quantity ?? 0, item?.unitPrice ?? 0),
      0,
    ),
  );
  const vatAmount = calculateVatAmount(subtotal, vatRate);
  const total = roundMoney(subtotal + vatAmount);

  return { subtotal, vatAmount, total };
}

export function formatCurrency(
  amount: number | string | null | undefined,
  currency: SupportedCurrency = DEFAULT_CURRENCY
): string {
  return `${currency} ${roundMoney(amount).toFixed(MONEY_DECIMALS)}`;
}
