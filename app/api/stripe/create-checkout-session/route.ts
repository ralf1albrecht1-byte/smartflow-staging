import { NextResponse } from 'next/server';
import Stripe from 'stripe';
import { requireUserId } from '@/lib/get-session';

export const dynamic = 'force-dynamic';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', {
  apiVersion: '2023-10-16',
});

export async function POST() {
  try {
    const userId = await requireUserId();

    if (!process.env.STRIPE_SECRET_KEY) {
      return NextResponse.json(
        { error: 'STRIPE_SECRET_KEY fehlt.' },
        { status: 500 }
      );
    }

    if (!process.env.STRIPE_PRICE_ID_MONTHLY) {
      return NextResponse.json(
        { error: 'STRIPE_PRICE_ID_MONTHLY fehlt.' },
        { status: 500 }
      );
    }

    const appUrl =
      process.env.NEXT_PUBLIC_APP_URL ||
      process.env.NEXTAUTH_URL ||
      'http://localhost:3000';

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [
        {
          price: process.env.STRIPE_PRICE_ID_MONTHLY,
          quantity: 1,
        },
      ],
      success_url: `${appUrl}/dashboard?stripe=success`,
      cancel_url: `${appUrl}/dashboard?stripe=cancelled`,
      client_reference_id: userId,
      metadata: {
        userId,
        plan: 'standard',
      },
    });

    return NextResponse.json({ url: session.url });
  } catch (error: any) {
    console.error('Stripe checkout error:', error);

    return NextResponse.json(
      { error: error?.message || 'Stripe Checkout konnte nicht gestartet werden.' },
      { status: 500 }
    );
  }
}