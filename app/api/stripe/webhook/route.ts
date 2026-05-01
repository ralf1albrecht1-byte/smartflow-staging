export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import Stripe from 'stripe';
import { prisma } from '@/lib/prisma';

function getStripeClient() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('STRIPE_SECRET_KEY_MISSING');
  return new Stripe(key);
}

function toDateFromUnix(seconds?: number | null): Date | null {
  if (!seconds || !Number.isFinite(seconds)) return null;
  return new Date(seconds * 1000);
}

async function updateUserByStripeIds(params: {
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
  subscriptionStatus?: string | null;
  currentPeriodEnd?: Date | null;
  accountStatus?: string;
  fallbackUserId?: string | null;
}) {
  const {
    stripeCustomerId,
    stripeSubscriptionId,
    subscriptionStatus,
    currentPeriodEnd,
    accountStatus,
    fallbackUserId,
  } = params;

  const updateData: any = {
    stripeCustomerId: stripeCustomerId || undefined,
    stripeSubscriptionId: stripeSubscriptionId || undefined,
    subscriptionStatus: subscriptionStatus || undefined,
    currentPeriodEnd: currentPeriodEnd || null,
  };

  if (accountStatus) {
    updateData.accountStatus = accountStatus;
    if (accountStatus === 'active') {
      updateData.blockedAt = null;
      updateData.blockedReason = null;
    }
  }

  const whereCandidates: Array<any> = [];
  if (stripeSubscriptionId) whereCandidates.push({ stripeSubscriptionId });
  if (stripeCustomerId) whereCandidates.push({ stripeCustomerId });
  if (fallbackUserId) whereCandidates.push({ id: fallbackUserId });

  for (const where of whereCandidates) {
    const existing = await prisma.user.findFirst({ where, select: { id: true } });
    if (!existing) continue;
    await prisma.user.update({ where: { id: existing.id }, data: updateData });
    return existing.id;
  }

  return null;
}

export async function POST(request: Request) {
  try {
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!webhookSecret) {
      return NextResponse.json({ error: 'STRIPE_WEBHOOK_SECRET fehlt' }, { status: 500 });
    }

    const stripe = getStripeClient();
    const signature = request.headers.get('stripe-signature');
    if (!signature) {
      return NextResponse.json({ error: 'stripe-signature fehlt' }, { status: 400 });
    }

    const payload = await request.text();

    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(payload, signature, webhookSecret);
    } catch (err: any) {
      console.error('[stripe/webhook] signature verification failed:', err?.message || err);
      return NextResponse.json({ error: 'Ungültige Webhook-Signatur' }, { status: 400 });
    }

    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        const customerId = typeof session.customer === 'string' ? session.customer : null;
        const subscriptionId = typeof session.subscription === 'string' ? session.subscription : null;
        const userId = session.metadata?.userId || null;

        let subscriptionStatus: string | null = 'active';
        let currentPeriodEnd: Date | null = null;

        if (subscriptionId) {
          const sub = await stripe.subscriptions.retrieve(subscriptionId);
          subscriptionStatus = sub.status || 'active';
          currentPeriodEnd = toDateFromUnix((sub as any).current_period_end ?? null);
        }

        await updateUserByStripeIds({
          stripeCustomerId: customerId,
          stripeSubscriptionId: subscriptionId,
          subscriptionStatus,
          currentPeriodEnd,
          accountStatus: 'active',
          fallbackUserId: userId,
        });
        break;
      }

      case 'customer.subscription.updated': {
        const subscription = event.data.object as Stripe.Subscription;
        const customerId = typeof subscription.customer === 'string' ? subscription.customer : null;
        const status = subscription.status;
        const accountStatus = status === 'active' || status === 'trialing' ? 'active' : 'blocked';

        await updateUserByStripeIds({
          stripeCustomerId: customerId,
          stripeSubscriptionId: subscription.id,
          subscriptionStatus: status,
          currentPeriodEnd: toDateFromUnix((subscription as any).current_period_end ?? null),
          accountStatus,
        });
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription;
        const customerId = typeof subscription.customer === 'string' ? subscription.customer : null;

        await updateUserByStripeIds({
          stripeCustomerId: customerId,
          stripeSubscriptionId: subscription.id,
          subscriptionStatus: subscription.status || 'canceled',
          currentPeriodEnd: toDateFromUnix((subscription as any).current_period_end ?? null),
          accountStatus: 'blocked',
        });
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice;
        const customerId = typeof invoice.customer === 'string' ? invoice.customer : null;
        const rawSubscriptionId = (invoice as any).subscription;
        const subscriptionId = typeof rawSubscriptionId === 'string' ? rawSubscriptionId : null;

        await updateUserByStripeIds({
          stripeCustomerId: customerId,
          stripeSubscriptionId: subscriptionId,
          subscriptionStatus: 'past_due',
          accountStatus: 'blocked',
        });
        break;
      }

      default:
        break;
    }

    return NextResponse.json({ received: true });
  } catch (error: any) {
    if (error?.message === 'STRIPE_SECRET_KEY_MISSING') {
      return NextResponse.json({ error: 'STRIPE_SECRET_KEY fehlt' }, { status: 500 });
    }
    console.error('[stripe/webhook] error:', error);
    return NextResponse.json({ error: 'Webhook-Verarbeitung fehlgeschlagen' }, { status: 500 });
  }
}
