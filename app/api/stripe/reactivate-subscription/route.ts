export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import Stripe from 'stripe';
import { prisma } from '@/lib/prisma';
import { requireUserId } from '@/lib/get-session';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', {
  apiVersion: '2025-02-24.acacia',
});

export async function POST(request: Request) {
  try {
    const userId = await requireUserId();

    if (!process.env.STRIPE_SECRET_KEY) {
      return NextResponse.json(
        { error: 'Stripe ist nicht konfiguriert.' },
        { status: 500 }
      );
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        stripeSubscriptionId: true,
        subscriptionStatus: true,
      },
    });

    if (!user?.stripeSubscriptionId) {
      return NextResponse.json(
        { error: 'Kein aktives Abo gefunden.' },
        { status: 404 }
      );
    }

    const subscription = await stripe.subscriptions.retrieve(user.stripeSubscriptionId);

    if (subscription.status === 'canceled') {
      return NextResponse.json(
        { error: 'Dieses Abo ist bereits beendet und kann nicht fortgesetzt werden.' },
        { status: 400 }
      );
    }

    if (!subscription.cancel_at_period_end) {
      return NextResponse.json({
        success: true,
        message: 'Abo läuft bereits weiter.',
        subscriptionStatus: subscription.status,
        cancelAtPeriodEnd: false,
      });
    }

    const updated = await stripe.subscriptions.update(user.stripeSubscriptionId, {
      cancel_at_period_end: false,
    });

    await prisma.user.update({
      where: { id: user.id },
      data: {
        subscriptionStatus: updated.status,
        accountStatus: 'active',
        blockedAt: null,
        blockedReason: null,
        accessEndsAt: updated.current_period_end
          ? new Date(updated.current_period_end * 1000)
          : null,
      },
    });

    return NextResponse.json({
      success: true,
      message: 'Abo wurde fortgesetzt.',
      subscriptionStatus: updated.status,
      cancelAtPeriodEnd: updated.cancel_at_period_end,
      currentPeriodEnd: updated.current_period_end
        ? new Date(updated.current_period_end * 1000).toISOString()
        : null,
    });
  } catch (error: any) {
    console.error('[stripe/reactivate-subscription] error:', error);

    return NextResponse.json(
      { error: error?.message || 'Abo konnte nicht fortgesetzt werden.' },
      { status: 500 }
    );
  }
}