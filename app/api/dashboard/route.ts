export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import Stripe from 'stripe';
import { prisma } from '@/lib/prisma';
import { requireUserId, unauthorizedResponse } from '@/lib/get-session';
import { isCustomerDataIncomplete } from '@/lib/customer-links';
import { getCurrentPlan } from '@/lib/plan';
import { getMonthlyAudioUsage } from '@/lib/audio-usage';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', {
  apiVersion: '2025-02-24.acacia',
});

export async function GET() {
  try {
    let userId: string;

    try {
      userId = await requireUserId();
    } catch {
      return unauthorizedResponse();
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        subscriptionStatus: true,
        stripeCustomerId: true,
        stripeSubscriptionId: true,
        currentPeriodEnd: true,
      },
    });

    let subscriptionStatus = user?.subscriptionStatus || null;
    let currentPeriodEnd = user?.currentPeriodEnd || null;

    // Safety sync:
    // If Stripe says the subscription changed but the webhook did not update the DB yet,
    // the dashboard pulls the latest Stripe status once and keeps the UI correct.
    if (user?.stripeSubscriptionId && process.env.STRIPE_SECRET_KEY) {
      try {
        const stripeSub = await stripe.subscriptions.retrieve(user.stripeSubscriptionId);

        subscriptionStatus = stripeSub.status;
       const stripeEnd =
  stripeSub.status === 'trialing' && stripeSub.trial_end
    ? stripeSub.trial_end
    : stripeSub.current_period_end;

currentPeriodEnd = new Date(stripeEnd * 1000);

        if (
          user.subscriptionStatus !== subscriptionStatus ||
          user.currentPeriodEnd?.getTime() !== currentPeriodEnd.getTime()
        ) {
          await prisma.user.update({
            where: { id: userId },
            data: {
              subscriptionStatus,
              currentPeriodEnd,
              stripeCustomerId: user.stripeCustomerId || (stripeSub.customer as string),
            },
          });
        }
      } catch (stripeError) {
        console.error('Dashboard Stripe subscription sync failed:', stripeError);
      }
    }

    const subscription = {
      isActive: subscriptionStatus === 'active',
      status: subscriptionStatus,
      stripeSubscriptionId: user?.stripeSubscriptionId || null,
      currentPeriodEnd: currentPeriodEnd?.toISOString() || null,
    };

    const activeOrderCount = await prisma.order.count({
      where: { offerId: null, invoiceId: null, deletedAt: null, userId },
    });

    const activeOfferCount = await prisma.offer.count({
      where: { deletedAt: null, userId, status: { in: ['Entwurf', 'Gesendet'] } },
    });

    const activeInvoiceCount = await prisma.invoice.count({
      where: { deletedAt: null, userId, status: { notIn: ['Erledigt', 'Bezahlt'] } },
    });

    const allCustomers = await prisma.customer.findMany({
      where: {
        deletedAt: null,
        userId,
      },
      select: {
        id: true,
        name: true,
        address: true,
        plz: true,
        city: true,
      },
    });

    const incompleteCustomerCount = allCustomers.filter(isCustomerDataIncomplete).length;

    const uncertainAssignmentCount = await prisma.order.count({
      where: {
        deletedAt: null,
        userId,
        reviewReasons: { has: 'uncertain_assignment' },
      },
    });

    const totalReviewCount = incompleteCustomerCount + uncertainAssignmentCount;

    const recentOrders = await prisma.order.findMany({
      where: { offerId: null, invoiceId: null, deletedAt: null, userId },
      take: 5,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        description: true,
        serviceName: true,
        status: true,
        totalPrice: true,
        date: true,
        createdAt: true,
        customer: { select: { name: true, customerNumber: true } },
        items: { select: { serviceName: true }, take: 3 },
      },
    });

    const recentOffers = await prisma.offer.findMany({
      where: { deletedAt: null, userId, status: { in: ['Entwurf', 'Gesendet'] } },
      take: 5,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        offerNumber: true,
        status: true,
        total: true,
        createdAt: true,
        customer: { select: { name: true, customerNumber: true } },
        items: { select: { description: true }, take: 3 },
        orders: { select: { createdAt: true }, take: 1, orderBy: { createdAt: 'asc' } },
      },
    });

    const recentInvoices = await prisma.invoice.findMany({
      where: { deletedAt: null, userId, status: { notIn: ['Erledigt', 'Bezahlt'] } },
      take: 5,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        invoiceNumber: true,
        status: true,
        total: true,
        createdAt: true,
        customer: { select: { name: true, customerNumber: true } },
        items: { select: { description: true }, take: 3 },
        orders: { select: { createdAt: true }, take: 1, orderBy: { createdAt: 'asc' } },
      },
    });

    const audioUsage = await getMonthlyAudioUsage(userId);
    const plan = await getCurrentPlan(userId);
    const includedMinutes = plan.includedMinutes;
    const usedMinutes = audioUsage.receivedMinutes;
    const usagePercent = includedMinutes > 0
      ? Math.round((usedMinutes / includedMinutes) * 100)
      : 0;

    return NextResponse.json({
      subscription,
      activeOrders: activeOrderCount,
      activeOffers: activeOfferCount,
      totalInvoices: activeInvoiceCount,
      audioUsage: {
        plan: plan.name,
        planIsFallback: plan.isFallback,
        monthlyPriceChf: plan.monthlyPriceChf,
        extraMinutePriceChf: plan.extraMinutePriceChf,
        includedMinutes,
        usedMinutes,
        transcribedMinutes: audioUsage.transcribedMinutes,
        skippedMinutes: audioUsage.skippedMinutes,
        failedMinutes: audioUsage.failedMinutes,
        audioOrderCount: audioUsage.audioOrderCount,
        usagePercent,
        windowStartIso: audioUsage.windowStartIso,
        windowEndIso: audioUsage.windowEndIso,
        windowTimezone: audioUsage.windowTimezone,
      },
      review: {
        total: totalReviewCount,
        incompleteCustomers: incompleteCustomerCount,
        uncertainAssignments: uncertainAssignmentCount,
      },
      needsReview: totalReviewCount,
      recentOrders: recentOrders?.map((o: any) => ({
        ...o,
        totalPrice: Number(o?.totalPrice ?? 0),
      })) ?? [],
      recentOffers: recentOffers?.map((o: any) => ({
        ...o,
        total: Number(o?.total ?? 0),
        intakeTime: o?.orders?.[0]?.createdAt || null,
      })) ?? [],
      recentInvoices: recentInvoices?.map((o: any) => ({
        ...o,
        total: Number(o?.total ?? 0),
        intakeTime: o?.orders?.[0]?.createdAt || null,
      })) ?? [],
    });
  } catch (error: any) {
    console.error('Dashboard error:', error);
    return NextResponse.json({ error: 'Fehler beim Laden' }, { status: 500 });
  }
}