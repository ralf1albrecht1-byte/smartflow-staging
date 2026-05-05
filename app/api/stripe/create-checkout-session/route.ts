import { NextResponse } from 'next/server';
import Stripe from 'stripe';
import { requireUserId } from '@/lib/get-session';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', {
apiVersion: '2025-02-24.acacia',
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

const user = await prisma.user.findUnique({
  where: { id: userId },
  select: {
    id: true,
    email: true,
  },
});

if (!user?.email) {
  return NextResponse.json(
    { error: 'User-E-Mail konnte nicht geladen werden.' },
    { status: 400 }
  );
}

const normalizedEmail = user.email.trim().toLowerCase();

const appUrl =
  process.env.NEXT_PUBLIC_APP_URL ||
  process.env.NEXTAUTH_URL ||
  'http://localhost:3000';

const session = await stripe.checkout.sessions.create({
  mode: 'subscription',
  customer_email: normalizedEmail,
  line_items: [
    {
      price: process.env.STRIPE_PRICE_ID_MONTHLY,
      quantity: 1,
    },
  ],
  success_url: `${appUrl}/dashboard?stripe=success`,
  cancel_url: `${appUrl}/dashboard?stripe=cancelled`,
  client_reference_id: user.id,
  metadata: {
    userId: user.id,
    plan: 'standard',
    source: 'checkout',
  },
  subscription_data: {
    metadata: {
      userId: user.id,
      plan: 'standard',
      source: 'checkout',
    },
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
