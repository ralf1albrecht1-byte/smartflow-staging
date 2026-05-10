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

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        stripeSubscriptionId: true,
      },
    });

    if (!user?.stripeSubscriptionId) {
      return NextResponse.json(
        { error: 'Kein aktives Stripe-Abo gefunden.' },
        { status: 400 },
      );
    }

    const subscription = await stripe.subscriptions.update(user.stripeSubscriptionId, {
      cancel_at_period_end: true,
    });

    await prisma.user.update({
      where: { id: userId },
      data: {
        subscriptionStatus: subscription.status,
        currentPeriodEnd: subscription.current_period_end
          ? new Date(subscription.current_period_end * 1000)
          : null,
      },
    });

    return NextResponse.json({
      success: true,
      subscriptionStatus: subscription.status,
      cancelAtPeriodEnd: subscription.cancel_at_period_end,
      currentPeriodEnd: subscription.current_period_end
        ? new Date(subscription.current_period_end * 1000).toISOString()
        : null,
    });
  } catch (error: any) {
    console.error('Cancel subscription error:', error);

    return NextResponse.json(
      { error: error?.message || 'Kündigung fehlgeschlagen.' },
      { status: 500 },
    );
  }
}