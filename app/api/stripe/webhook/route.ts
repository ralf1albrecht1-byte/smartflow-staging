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

type PrefetchedStripeData = {
  checkoutSubscription?: Stripe.Subscription | null;
  invoiceSucceededSubscription?: Stripe.Subscription | null;
  invoiceFailedSubscription?: Stripe.Subscription | null;
};

function toDate(unixSeconds?: number | null): Date | null {
  if (!unixSeconds) return null;
  return new Date(unixSeconds * 1000);
}

function getSubscriptionPriceId(subscription: Stripe.Subscription): string | null {
  const item = subscription.items?.data?.[0];
  const priceId = item?.price?.id;
  return priceId || null;
}

function getCheckoutSessionSubscriptionId(session: Stripe.Checkout.Session): string | null {
  return typeof session.subscription === 'string'
    ? session.subscription
    : session.subscription?.id || null;
}

function getInvoiceSubscriptionId(invoice: Stripe.Invoice): string | null {
  return typeof invoice.subscription === 'string'
    ? invoice.subscription
    : invoice.subscription?.id || null;
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

async function findUserForSubscription(tx: Tx, subscription: Stripe.Subscription): Promise<string | null> {
  const customerId = typeof subscription.customer === 'string'
    ? subscription.customer
    : subscription.customer?.id || null;

  let user: { id: string } | null = null;

  // 1) metadata.userId is the most reliable source.
  if (subscription.metadata?.userId) {
    user = await tx.user.findUnique({
      where: { id: subscription.metadata.userId },
      select: { id: true },
    });
  }

  // 2) fallback by stripeCustomerId.
  if (!user && customerId) {
    user = await tx.user.findUnique({
      where: { stripeCustomerId: customerId },
      select: { id: true },
    });
  }

  // 3) fallback by stripeSubscriptionId.
  if (!user) {
    user = await tx.user.findUnique({
      where: { stripeSubscriptionId: subscription.id },
      select: { id: true },
    });
  }

  return user?.id || null;
}

async function findUserForInvoice(
  tx: Tx,
  invoice: Stripe.Invoice,
  subscription?: Stripe.Subscription | null,
): Promise<string | null> {
  const customerId = typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id || null;
  const subscriptionId = getInvoiceSubscriptionId(invoice);

  let user: { id: string } | null = null;

  // 1) metadata.userId from subscription is the most reliable source.
  const userIdFromMetadata = subscription?.metadata?.userId || null;
  if (userIdFromMetadata) {
    user = await tx.user.findUnique({
      where: { id: userIdFromMetadata },
      select: { id: true },
    });
  }

  // 2) fallback by stripeCustomerId.
  if (!user && customerId) {
    user = await tx.user.findUnique({
      where: { stripeCustomerId: customerId },
      select: { id: true },
    });
  }

  // 3) fallback by stripeSubscriptionId.
  if (!user && subscriptionId) {
    user = await tx.user.findUnique({
      where: { stripeSubscriptionId: subscriptionId },
      select: { id: true },
    });
  }

  return user?.id || null;
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
      cancelAtPeriodEnd: subscription.cancel_at_period_end || false,
      accountStatus,
    },
  });
}

async function handleCheckoutCompleted(
  tx: Tx,
  event: Stripe.Event,
  prefetchedSubscription?: Stripe.Subscription | null,
) {
  const session = event.data.object as Stripe.Checkout.Session;
  const userIdFromSession = session.metadata?.userId || session.client_reference_id || null;
  const customerId = typeof session.customer === 'string' ? session.customer : session.customer?.id || null;
  const subscriptionId = getCheckoutSessionSubscriptionId(session);

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

  if (subscriptionId && prefetchedSubscription) {
    await applySubscriptionToUser(tx, userId, prefetchedSubscription);
    return;
  }

  await tx.user.update({
    where: { id: userId },
    data: {
      stripeCustomerId: customerId || undefined,
      accountStatus: 'active',
    },
  });
}

async function handleSubscriptionUpdated(tx: Tx, event: Stripe.Event) {
  const subscription = event.data.object as Stripe.Subscription;
  const userIdFromMetadata = subscription.metadata?.userId || null;
  const userId = await findUserForSubscription(tx, subscription);

  if (!userId) {
    const customerId = typeof subscription.customer === 'string'
      ? subscription.customer
      : subscription.customer?.id || null;

    console.warn('[stripe][webhook] subscription.updated: user not found', {
      eventId: event.id,
      subscriptionId: subscription.id,
      customerId,
      metadataUserId: userIdFromMetadata,
    });
    return;
  }

  await applySubscriptionToUser(tx, userId, subscription);
}

async function handleSubscriptionDeleted(tx: Tx, event: Stripe.Event) {
  const subscription = event.data.object as Stripe.Subscription;
  const userIdFromMetadata = subscription.metadata?.userId || null;
  const userId = await findUserForSubscription(tx, subscription);

  if (!userId) {
    const customerId = typeof subscription.customer === 'string'
      ? subscription.customer
      : subscription.customer?.id || null;

    console.warn('[stripe][webhook] subscription.deleted: user not found', {
      eventId: event.id,
      subscriptionId: subscription.id,
      customerId,
      metadataUserId: userIdFromMetadata,
    });
    return;
  }

  await applySubscriptionToUser(tx, userId, subscription);
}

async function handleSubscriptionCreated(tx: Tx, event: Stripe.Event) {
  const subscription = event.data.object as Stripe.Subscription;
  const userIdFromMetadata = subscription.metadata?.userId || null;
  const userId = await findUserForSubscription(tx, subscription);

  if (!userId) {
    const customerId = typeof subscription.customer === 'string'
      ? subscription.customer
      : subscription.customer?.id || null;

    console.warn('[stripe][webhook] subscription.created: user not found', {
      eventId: event.id,
      subscriptionId: subscription.id,
      customerId,
      metadataUserId: userIdFromMetadata,
    });
    return;
  }

  await applySubscriptionToUser(tx, userId, subscription);
}

async function handleInvoicePaymentSucceeded(
  tx: Tx,
  event: Stripe.Event,
  prefetchedSubscription?: Stripe.Subscription | null,
) {
  const invoice = event.data.object as Stripe.Invoice;
  const customerId = typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id || null;
  const subscriptionId = getInvoiceSubscriptionId(invoice);

  const userId = await findUserForInvoice(tx, invoice, prefetchedSubscription);

  if (!userId) {
    console.warn('[stripe][webhook] invoice.payment_succeeded: user not found', {
      eventId: event.id,
      customerId,
      subscriptionId,
      metadataUserId: prefetchedSubscription?.metadata?.userId || null,
    });
    return;
  }

  const updateData: Prisma.UserUpdateInput = {
    accountStatus: 'active',
  };

  if (subscriptionId && prefetchedSubscription) {
    const priceId = getSubscriptionPriceId(prefetchedSubscription);
    updateData.stripeSubscriptionId = prefetchedSubscription.id;
    updateData.subscriptionStatus = prefetchedSubscription.status;
    updateData.subscriptionPlan = priceId ? mapPriceIdToPlan(priceId) || undefined : undefined;
    updateData.currentPeriodEnd = toDate(prefetchedSubscription.current_period_end) || undefined;
    updateData.trialEnd = toDate(prefetchedSubscription.trial_end) || undefined;
    updateData.cancelAtPeriodEnd = prefetchedSubscription.cancel_at_period_end || false;
  } else {
    updateData.subscriptionStatus = 'active';
  }

  await tx.user.update({
    where: { id: userId },
    data: updateData,
  });
}

async function handleInvoicePaymentFailed(
  tx: Tx,
  event: Stripe.Event,
  prefetchedSubscription?: Stripe.Subscription | null,
) {
  const invoice = event.data.object as Stripe.Invoice;
  const customerId = typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id || null;
  const subscriptionId = getInvoiceSubscriptionId(invoice);

  const userId = await findUserForInvoice(tx, invoice, prefetchedSubscription);

  if (!userId) {
    console.warn('[stripe][webhook] invoice.payment_failed: user not found', {
      eventId: event.id,
      customerId,
      subscriptionId,
      metadataUserId: prefetchedSubscription?.metadata?.userId || null,
    });
    return;
  }

  const updateData: Prisma.UserUpdateInput = {
    subscriptionStatus: 'past_due',
    accountStatus: 'active',
  };

  if (prefetchedSubscription) {
    updateData.cancelAtPeriodEnd = prefetchedSubscription.cancel_at_period_end || false;
  }

  await tx.user.update({
    where: { id: userId },
    data: updateData,
  });
}

async function processEvent(tx: Tx, event: Stripe.Event, prefetched: PrefetchedStripeData) {
  switch (event.type) {
    case 'checkout.session.completed': {
      await handleCheckoutCompleted(tx, event, prefetched.checkoutSubscription);
      return;
    }

    case 'customer.subscription.created': {
      await handleSubscriptionCreated(tx, event);
      return;
    }

    case 'customer.subscription.updated': {
      await handleSubscriptionUpdated(tx, event);
      return;
    }

    case 'customer.subscription.deleted': {
      await handleSubscriptionDeleted(tx, event);
      return;
    }

    case 'invoice.payment_succeeded': {
      await handleInvoicePaymentSucceeded(tx, event, prefetched.invoiceSucceededSubscription);
      return;
    }

    case 'invoice.payment_failed': {
      await handleInvoicePaymentFailed(tx, event, prefetched.invoiceFailedSubscription);
      return;
    }

    default:
      console.log('[stripe][webhook] Unhandled event type', event.type);
      return;
  }
}

async function prefetchStripeDataForEvent(stripe: Stripe, event: Stripe.Event): Promise<PrefetchedStripeData> {
  const prefetched: PrefetchedStripeData = {};

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session;
    const subscriptionId = getCheckoutSessionSubscriptionId(session);
    if (subscriptionId) {
      prefetched.checkoutSubscription = await stripe.subscriptions.retrieve(subscriptionId);
    }
  }

  if (event.type === 'invoice.payment_succeeded') {
    const invoice = event.data.object as Stripe.Invoice;
    const subscriptionId = getInvoiceSubscriptionId(invoice);
    if (subscriptionId) {
      prefetched.invoiceSucceededSubscription = await stripe.subscriptions.retrieve(subscriptionId);
    }
  }

  if (event.type === 'invoice.payment_failed') {
    const invoice = event.data.object as Stripe.Invoice;
    const subscriptionId = getInvoiceSubscriptionId(invoice);
    if (subscriptionId) {
      prefetched.invoiceFailedSubscription = await stripe.subscriptions.retrieve(subscriptionId);
    }
  }

  return prefetched;
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

    // Important: fetch Stripe resources outside the DB transaction.
    const prefetched = await prefetchStripeDataForEvent(stripe, event);

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
        await processEvent(tx, event, prefetched);

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
