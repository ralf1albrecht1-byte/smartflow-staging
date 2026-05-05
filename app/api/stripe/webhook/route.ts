import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', {
  apiVersion: '2025-02-24.acacia',
});

function toDate(timestamp?: number | null) {
  return timestamp ? new Date(timestamp * 1000) : null;
}

async function activateUserFromSubscription(subscription: Stripe.Subscription) {
  const userId = subscription.metadata?.userId;
  const stripeCustomerId =
    typeof subscription.customer === 'string'
      ? subscription.customer
      : subscription.customer?.id;

  if (!userId) {
    console.error('Stripe webhook: Missing userId in subscription metadata');
    return;
  }

  await prisma.user.update({
    where: { id: userId },
    data: {
      stripeCustomerId: stripeCustomerId || null,
      stripeSubscriptionId: subscription.id,
      subscriptionStatus: subscription.status,
      currentPeriodEnd: toDate(subscription.current_period_end),
      accountStatus: subscription.status === 'active' ? 'active' : undefined,
    },
  });
}

export async function POST(req: NextRequest) {
  try {
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

    if (!webhookSecret) {
      return NextResponse.json(
        { error: 'STRIPE_WEBHOOK_SECRET fehlt.' },
        { status: 500 }
      );
    }

    const body = await req.text();
    const signature = req.headers.get('stripe-signature');

    if (!signature) {
      return NextResponse.json(
        { error: 'Stripe signature fehlt.' },
        { status: 400 }
      );
    }

    const event = stripe.webhooks.constructEvent(
      body,
      signature,
      webhookSecret
    );

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as Stripe.Checkout.Session;

      if (session.mode === 'subscription' && session.subscription) {
        const subscriptionId =
          typeof session.subscription === 'string'
            ? session.subscription
            : session.subscription.id;

        const subscription = await stripe.subscriptions.retrieve(subscriptionId);

        await prisma.user.update({
          where: { id: session.client_reference_id || session.metadata?.userId || '' },
          data: {
            stripeCustomerId:
              typeof session.customer === 'string'
                ? session.customer
                : session.customer?.id || null,
            stripeSubscriptionId: subscription.id,
            subscriptionStatus: subscription.status,
            currentPeriodEnd: toDate(subscription.current_period_end),
            accountStatus: 'active',
          },
        });
      }
    }

    if (event.type === 'customer.subscription.updated') {
      const subscription = event.data.object as Stripe.Subscription;
      await activateUserFromSubscription(subscription);
    }

    if (event.type === 'customer.subscription.deleted') {
      const subscription = event.data.object as Stripe.Subscription;

      await prisma.user.updateMany({
        where: { stripeSubscriptionId: subscription.id },
        data: {
          subscriptionStatus: subscription.status,
          currentPeriodEnd: toDate(subscription.current_period_end),
          accountStatus: 'cancelled',
        },
      });
    }

    if (event.type === 'invoice.payment_failed') {
      const invoice = event.data.object as Stripe.Invoice;
      const subscriptionId =
        typeof invoice.subscription === 'string'
          ? invoice.subscription
          : invoice.subscription?.id;

      if (subscriptionId) {
        await prisma.user.updateMany({
          where: { stripeSubscriptionId: subscriptionId },
          data: {
            subscriptionStatus: 'past_due',
          },
        });
      }
    }

    return NextResponse.json({ received: true });
  } catch (error: any) {
    console.error('Stripe webhook error:', error);

    return NextResponse.json(
      { error: error?.message || 'Stripe Webhook Fehler.' },
      { status: 400 }
    );
  }
}