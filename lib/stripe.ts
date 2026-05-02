import Stripe from 'stripe';

declare global {
  // eslint-disable-next-line no-var
  var __stripeClient: Stripe | undefined;
}

export function getStripeClient(): Stripe {
  if (globalThis.__stripeClient) {
    return globalThis.__stripeClient;
  }

  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    throw new Error('Missing STRIPE_SECRET_KEY');
  }

  const client = new Stripe(secretKey);

  if (process.env.NODE_ENV !== 'production') {
    globalThis.__stripeClient = client;
  }

  return client;
}
