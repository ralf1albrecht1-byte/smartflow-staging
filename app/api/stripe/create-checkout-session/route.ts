import { NextResponse } from 'next/server';
import Stripe from 'stripe';
import { prisma } from '@/lib/prisma';
import { requireUserId } from '@/lib/get-session';

export const dynamic = 'force-dynamic';

function getStripeClient() {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    throw new Error('STRIPE_SECRET_KEY not configured');
  }
  return new Stripe(secretKey, {
    apiVersion: '2025-02-24.acacia',
  });
}

export async function POST() {
try {
const userId = await requireUserId();
const stripe = getStripeClient();

    if (!user?.email) {
      return NextResponse.json(
        { error: 'Benutzer nicht gefunden' },
        { status: 404 },
      );
    }

    const appUrl =
      process.env.NEXT_PUBLIC_APP_URL ||
      process.env.NEXTAUTH_URL ||
      'http://localhost:3000';

    const stripe = getStripe();

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: user.stripeCustomerId || undefined,
      customer_email: user.stripeCustomerId ? undefined : user.email,
      payment_method_types: ['card'],
      line_items: [
        {
          price: process.env.STRIPE_PRICE_ID_MONTHLY,
          quantity: 1,
        },
      ],
      subscription_data: {
        trial_period_days: 7,
        metadata: {
          userId,
          plan: 'standard',
        },
      },
      client_reference_id: userId,
      metadata: {
        userId,
        plan: 'standard',
        source: 'dashboard',
      },
      success_url: `${appUrl}/dashboard?stripe=success`,
      cancel_url: `${appUrl}/dashboard?stripe=cancelled`,
    });

    return NextResponse.json({ url: session.url });
  } catch (error: any) {
    console.error('Stripe checkout error:', error);

    return NextResponse.json(
      { error: 'Abo konnte nicht gestartet werden' },
      { status: 500 },
    );
  }
}