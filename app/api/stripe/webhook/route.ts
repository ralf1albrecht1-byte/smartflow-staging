import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import Stripe from 'stripe';
import { prisma } from '@/lib/prisma';
import { getStripeClient } from '@/lib/stripe';
import { mapPriceIdToPlan, mapSubscriptionStatusToAccountStatus, validateStripeEnv } from '@/lib/stripe-helpers';

export const dynamic = 'force-dynamic';
// Requested for Stripe raw-body signature validation compatibility.
export const config = { api: { bodyParser: false } };

type Tx = Prisma.TransactionClient;

function toDate(unixSeconds?: number | null): Date | null {
  if (!unixSeconds) return null;
  return new Date(unixSeconds * 1000);
}

function getSubscriptionPriceId(subscription: Stripe.Subscription): string | null {
  const item = subscription.items?.data?.[0];
  const priceId = item?.price?.id;
  return priceId || null;
}

async function findUserIdForEvent(tx: Tx, params: {
  userId?: string | null;
  customerId?: string | null;
  subscriptionId?: string | null;
}): Promise<string | null> {
  if (params.userId) {
    return params.userId;
  }

  if (params.subscriptionId) {
    const bySubscription = await tx.user.findFirst({
      where: { stripeSubscriptionId: params.subscriptionId },
      select: { id: true },
    });
    if (bySubscription?.id) return bySubscription.id;
  }

  if (params.customerId) {
    const byCustomer = await tx.user.findFirst({
      where: { stripeCustomerId: params.customerId },
      select: { id: true },
    });
    if (byCustomer?.id) return byCustomer.id;
  }

  return null;
}

async function applySubscriptionToUser(tx: Tx, userId: string, subscription: Stripe.Subscription) {
  const customerId = typeof subscription.customer === 'string'
    ? subscription.customer
    : subscription.customer?.id || null;

  const priceId = getSubscriptionPriceId(subscription);
  const mappedPlan = priceId ? mapPriceIdToPlan(priceId) : null;
  const subscriptionStatus = subscription.status;
  const accountStatus = mapSubscriptionStatusToAccountStatus(subscriptionStatus);

  await tx.user.update({
    where: { id: userId },
    data: {
      stripeCustomerId: customerId || undefined,
      stripeSubscriptionId: subscription.id,
      subscriptionStatus,
      subscriptionPlan: mappedPlan || undefined,
      currentPeriodEnd: toDate(subscription.current_period_end) || undefined,
      trialEnd: toDate(subscription.trial_end) || undefined,
      accountStatus,
    },
  });
}

async function processEvent(tx: Tx, stripe: Stripe, event: Stripe.Event) {
  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session;
      const userIdFromSession = session.metadata?.userId || session.client_reference_id || null;
      const customerId = typeof session.customer === 'string' ? session.customer : session.customer?.id || null;
      const subscriptionId = typeof session.subscription === 'string'
        ? session.subscription
        : session.subscription?.id || null;

      const userId = await findUserIdForEvent(tx, {
        userId: userIdFromSession,
        customerId,
        subscriptionId,
      });

      if (!userId) {
        console.warn('[stripe][webhook] checkout.session.completed: user not found', {
          eventId: event.id,
          userIdFromSession,
          customerId,
          subscriptionId,
        });
        return;
      }

      if (subscriptionId) {
        const subscription = await stripe.subscriptions.retrieve(subscriptionId);
        await applySubscriptionToUser(tx, userId, subscription);
        return;
      }

      await tx.user.update({
        where: { id: userId },
        data: {
          stripeCustomerId: customerId || undefined,
          accountStatus: 'active',
        },
      });
      return;
    }

    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted': {
      const subscription = event.data.object as Stripe.Subscription;
      const customerId = typeof subscription.customer === 'string'
        ? subscription.customer
        : subscription.customer?.id || null;

      const userId = await findUserIdForEvent(tx, {
        customerId,
        subscriptionId: subscription.id,
      });

      if (!userId) {
        console.warn('[stripe][webhook] subscription event: user not found', {
          eventId: event.id,
          eventType: event.type,
          subscriptionId: subscription.id,
          customerId,
        });
        return;
      }

      await applySubscriptionToUser(tx, userId, subscription);
      return;
    }

    case 'invoice.payment_succeeded': {
      const invoice = event.data.object as Stripe.Invoice;
      const customerId = typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id || null;
      const subscriptionId = typeof invoice.subscription === 'string'
        ? invoice.subscription
        : invoice.subscription?.id || null;

      const userId = await findUserIdForEvent(tx, {
        customerId,
        subscriptionId,
      });

      if (!userId) {
        console.warn('[stripe][webhook] invoice.payment_succeeded: user not found', {
          eventId: event.id,
          customerId,
          subscriptionId,
        });
        return;
      }

      const updateData: Prisma.UserUpdateInput = {
        accountStatus: 'active',
      };

      if (subscriptionId) {
        const subscription = await stripe.subscriptions.retrieve(subscriptionId);
        const priceId = getSubscriptionPriceId(subscription);
        updateData.stripeSubscriptionId = subscription.id;
        updateData.subscriptionStatus = subscription.status;
        updateData.subscriptionPlan = priceId ? mapPriceIdToPlan(priceId) || undefined : undefined;
        updateData.currentPeriodEnd = toDate(subscription.current_period_end) || undefined;
        updateData.trialEnd = toDate(subscription.trial_end) || undefined;
      } else {
        updateData.subscriptionStatus = 'active';
      }

      await tx.user.update({
        where: { id: userId },
        data: updateData,
      });
      return;
    }

    case 'invoice.payment_failed': {
      const invoice = event.data.object as Stripe.Invoice;
      const customerId = typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id || null;
      const subscriptionId = typeof invoice.subscription === 'string'
        ? invoice.subscription
        : invoice.subscription?.id || null;

      const userId = await findUserIdForEvent(tx, {
        customerId,
        subscriptionId,
      });

      if (!userId) {
        console.warn('[stripe][webhook] invoice.payment_failed: user not found', {
          eventId: event.id,
          customerId,
          subscriptionId,
        });
        return;
      }

      await tx.user.update({
        where: { id: userId },
        data: {
          subscriptionStatus: 'past_due',
          accountStatus: 'active',
        },
      });
      return;
    }

    default:
      console.log('[stripe][webhook] Unhandled event type', event.type);
      return;
  }
}

export async function POST(request: Request) {
  try {
    validateStripeEnv();

    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET as string;
    const stripe = getStripeClient();

    const body = await request.text();
    const signature = request.headers.get('stripe-signature');

    if (!signature) {
      console.error('[stripe][webhook] Missing stripe-signature header');
      return NextResponse.json({ error: 'Ungültige Signatur.' }, { status: 400 });
    }

    let event: Stripe.Event;

    try {
      event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
    } catch (signatureError: any) {
      console.error('[stripe][webhook] Signature verification failed', {
        message: signatureError?.message,
      });
      return NextResponse.json({ error: 'Signaturprüfung fehlgeschlagen.' }, { status: 400 });
    }

    console.log('[stripe][webhook] Received event', {
      eventId: event.id,
      type: event.type,
    });

    const payload = (() => {
      try {
        return JSON.parse(body);
      } catch {
        return null;
      }
    })();

    const result = await prisma.$transaction(async (tx) => {
      try {
        await tx.stripeWebhookEvent.create({
          data: {
            stripeEventId: event.id,
            eventType: event.type,
            payload: payload || undefined,
            processed: false,
          },
        });
      } catch (error: any) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          const existing = await tx.stripeWebhookEvent.findUnique({
            where: { stripeEventId: event.id },
            select: { processed: true },
          });

          if (existing?.processed) {
            console.log('[stripe][webhook] Event already processed (idempotent)', { eventId: event.id });
            return { alreadyProcessed: true };
          }

          console.log('[stripe][webhook] Event currently being processed by another worker', { eventId: event.id });
          return { alreadyProcessed: true };
        }
        throw error;
      }

      try {
        await processEvent(tx, stripe, event);

        await tx.stripeWebhookEvent.update({
          where: { stripeEventId: event.id },
          data: {
            processed: true,
            processedAt: new Date(),
            error: null,
          },
        });

        return { alreadyProcessed: false };
      } catch (processingError: any) {
        await tx.stripeWebhookEvent.update({
          where: { stripeEventId: event.id },
          data: {
            processed: false,
            error: processingError?.message?.slice(0, 1000) || 'Unknown processing error',
          },
        });
        throw processingError;
      }
    });

    return NextResponse.json({ received: true, alreadyProcessed: result.alreadyProcessed });
  } catch (error: any) {
    console.error('[stripe][webhook] Processing failed', {
      message: error?.message,
      type: error?.type,
      code: error?.code,
    });

    return NextResponse.json({ error: 'Webhook-Verarbeitung fehlgeschlagen.' }, { status: 500 });
  }
}
