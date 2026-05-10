export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import Stripe from 'stripe';
import { prisma } from '@/lib/prisma';
import { requireUserId } from '@/lib/get-session';

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
        id: true,
        email: true,
        role: true,
        stripeSubscriptionId: true,
        subscriptionStatus: true,
      },
    });

    if (!user?.stripeSubscriptionId) {
      return NextResponse.json(
        { error: 'Kein aktives Abo gefunden.' },
        { status: 404 },
      );
    }

    const subscription = await stripe.subscriptions.retrieve(user.stripeSubscriptionId);

       if (subscription.status === 'canceled') {
      await prisma.user.update({
        where: { id: user.id },
        data: {
          subscriptionStatus: 'canceled',
          cancelAtPeriodEnd: false,
          currentPeriodEnd: null,
          accountStatus: 'inactive',
          accessEndsAt: null,
        },
      });

      return NextResponse.json(
        {
          error: 'Dieses Abo ist bereits beendet und kann nicht fortgesetzt werden. Bitte starte ein neues Abo.',
          subscriptionStatus: 'canceled',
          cancelAtPeriodEnd: false,
          currentPeriodEnd: null,
          requiresNewCheckout: true,
        },
        { status: 400 },
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

    const currentPeriodEnd = updated.current_period_end
      ? new Date(updated.current_period_end * 1000)
      : null;

    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: {
          subscriptionStatus: updated.status,
          cancelAtPeriodEnd: false,
          currentPeriodEnd,
          accountStatus: 'active',
          blockedAt: null,
          blockedReason: null,
          accessEndsAt: currentPeriodEnd,
          cancellationAcceptedAt: null,
        },
      });

      const openCancellationRequests = await tx.complianceRequest.findMany({
        where: {
          userId: user.id,
          type: 'account_cancellation',
          status: {
            in: ['open', 'in_progress'],
          },
        },
        select: {
          id: true,
          adminNotes: true,
        },
      });

      if (openCancellationRequests.length > 0) {
        const autoNote = [
          'Automatisch geschlossen:',
          'Der User hat das Stripe-Abo über „Abo fortsetzen“ reaktiviert.',
          `Stripe Subscription: ${user.stripeSubscriptionId}`,
          `Zeitpunkt: ${new Date().toISOString()}`,
        ].join('\n');

        for (const request of openCancellationRequests) {
          await tx.complianceRequest.update({
            where: { id: request.id },
            data: {
              status: 'completed',
              completedAt: new Date(),
              adminNotes: request.adminNotes
                ? `${request.adminNotes}\n\n${autoNote}`
                : autoNote,
            },
          });
        }
      }

      await tx.auditLog.create({
        data: {
          userId: user.id,
          userEmail: user.email,
          userRole: user.role || 'user',
          action: 'SUBSCRIPTION_REACTIVATED',
          area: 'ACCOUNT',
          targetType: 'User',
          targetId: user.id,
          success: true,
          source: 'web',
          details: JSON.stringify({
            stripeSubscriptionId: user.stripeSubscriptionId,
            subscriptionStatus: updated.status,
            cancelAtPeriodEnd: updated.cancel_at_period_end,
            currentPeriodEnd: currentPeriodEnd?.toISOString() || null,
            closedCancellationRequests: openCancellationRequests.length,
          }),
        },
      });
    });

    return NextResponse.json({
      success: true,
      message: 'Abo wurde fortgesetzt.',
      subscriptionStatus: updated.status,
      cancelAtPeriodEnd: updated.cancel_at_period_end,
      currentPeriodEnd: currentPeriodEnd?.toISOString() || null,
    });
  } catch (error: any) {
    console.error('[stripe/reactivate-subscription] error:', error);

    return NextResponse.json(
      { error: error?.message || 'Abo konnte nicht fortgesetzt werden.' },
      { status: 500 },
    );
  }
}