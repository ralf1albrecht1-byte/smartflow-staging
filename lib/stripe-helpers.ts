function normalize(input: string): string {
  return input.trim().toLowerCase();
}

export function resolvePriceId(inputPriceId: string): string | null {
  const value = normalize(inputPriceId);

  if (value === 'basic') {
    return process.env.STRIPE_PRICE_ID_BASIC || null;
  }

  if (value === 'pro') {
    return process.env.STRIPE_PRICE_ID_PRO || null;
  }

  return inputPriceId;
}

export function mapPriceIdToPlan(priceId: string): string | null {
  if (!priceId) return null;

  const normalized = normalize(priceId);
  const basicPriceId = process.env.STRIPE_PRICE_ID_BASIC;
  const proPriceId = process.env.STRIPE_PRICE_ID_PRO;

  if (normalized === 'basic' || (basicPriceId && priceId === basicPriceId)) {
    return 'basic';
  }

  if (normalized === 'pro' || (proPriceId && priceId === proPriceId)) {
    return 'pro';
  }

  return null;
}

export function mapSubscriptionStatusToAccountStatus(status: string): string {
  switch (status) {
    case 'trialing':
    case 'active':
    case 'past_due':
      return 'active';
    case 'canceled':
    case 'unpaid':
    case 'incomplete':
    case 'incomplete_expired':
    default:
      return 'inactive';
  }
}

export function validateStripeEnv(): void {
  const requiredVars = [
    'STRIPE_SECRET_KEY',
    'STRIPE_WEBHOOK_SECRET',
    'STRIPE_PRICE_ID_BASIC',
    'STRIPE_PRICE_ID_PRO',
  ];

  const missing = requiredVars.filter((name) => !process.env[name]);

  if (missing.length > 0) {
    throw new Error(`Missing Stripe env vars: ${missing.join(', ')}`);
  }
}
