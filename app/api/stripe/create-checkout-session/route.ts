export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import Stripe from 'stripe';
import { prisma } from '@/lib/prisma';
import { requireUserId, handleAuthError } from '@/lib/get-session';

function getStripeClient() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error('STRIPE_SECRET_KEY_MISSING');
  }
  return new Stripe(key);
}

export async function POST(request: Request) {
  try {
    const userId = await requireUserId();

    const priceId = process.env.STRIPE_PRICE_ID_MONTHLY;
    if (!priceId) {
      return NextResponse.json({ error: 'STRIPE_PRICE_ID_MONTHLY fehlt' }, { status: 500 });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
        stripeCustomerId: true,
      },
    });

    if (!user) {
      return NextResponse.json({ error: 'Benutzer nicht gefunden' }, { status: 404 });
    }

    const stripe = getStripeClient();

    let customerId = user.stripeCustomerId || null;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        name: user.name || undefined,
        metadata: {
          userId: user.id,
        },
      });
      customerId = customer.id;
      await prisma.user.update({
        where: { id: user.id },
        data: { stripeCustomerId: customerId },
      });
    }

    const origin = request.headers.get('origin') || process.env.NEXTAUTH_URL || 'http://localhost:3000';

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      success_url: `${origin}/dashboard?checkout=success`,
      cancel_url: `${origin}/dashboard?checkout=cancelled`,
      metadata: {
        userId: user.id,
      },
      allow_promotion_codes: true,
    });

    return NextResponse.json({ url: session.url });
  } catch (error: any) {
    if (error?.message === 'UNAUTHORIZED' || error?.code === 'ACCOUNT_INACTIVE') {
      return handleAuthError(error);
    }
    if (error?.message === 'STRIPE_SECRET_KEY_MISSING') {
      return NextResponse.json({ error: 'STRIPE_SECRET_KEY fehlt' }, { status: 500 });
    }

    console.error('[stripe/create-checkout-session] error:', error);
    return NextResponse.json({ error: 'Checkout Session konnte nicht erstellt werden' }, { status: 500 });
  }
}
