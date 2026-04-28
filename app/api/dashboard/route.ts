export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireUserId, unauthorizedResponse } from '@/lib/get-session';
import { isCustomerDataIncomplete } from '@/lib/customer-links';
import { getCurrentPlan } from '@/lib/plan';
import { getMonthlyAudioUsage } from '@/lib/audio-usage';

export async function GET() {
  try {
    let userId: string;
    try { userId = await requireUserId(); } catch { return unauthorizedResponse(); }

    // Run all counts sequentially to avoid pool exhaustion

    // 1. Active orders: not linked to offer or invoice
    const activeOrderCount = await prisma.order.count({
      where: { offerId: null, invoiceId: null, deletedAt: null, userId },
    });

    // 2. Active offers: only Entwurf + Gesendet status
    const activeOfferCount = await prisma.offer.count({
      where: { deletedAt: null, userId, status: { in: ['Entwurf', 'Gesendet'] } },
    });

    // 3. Active invoices: exclude Erledigt and Bezahlt
    const activeInvoiceCount = await prisma.invoice.count({
      where: { deletedAt: null, userId, status: { notIn: ['Erledigt', 'Bezahlt'] } },
    });

    // === REVIEW CATEGORIES (structured, no naked number) ===

    // Category A: Customers with missing contact data.
    //
    // This count MUST match 1:1 with the "⚠ Kundendaten fehlen" chip on the
    // /kunden list. Both sides call the same helper `isCustomerDataIncomplete`
    // from lib/customer-links.ts so the rule cannot drift.
    //
    // REQUIRED fields checked by the canonical rule: name, address, plz, city.
    // OPTIONAL (ignored): phone, email.
    //
    // Paket M bugfix: the previous `select` clause was `{id, address, city, phone}`
    // — it was MISSING `name` and `plz` (two of the four required fields). Since
    // Prisma returns undefined for un-selected fields, `isRequiredCustomerFieldMissing`
    // evaluated undefined as missing for every customer, which flagged EVERY non-deleted
    // customer as incomplete. That made the dashboard show the total customer count
    // instead of the true incomplete count → mismatch with the /kunden chip.
    // Fix: select exactly the four REQUIRED fields so the helper gets the same
    // data shape the customer-list page gets from /api/customers.
    //
    // No "has active orders" filter here: the list shows the chip on every
    // non-deleted customer with missing required fields, regardless of whether
    // the customer currently has active work, so the dashboard counts them all
    // too. A customer-level count (not order-based) to avoid double-counting.
    const allCustomers = await prisma.customer.findMany({
      where: {
        deletedAt: null,
        ...(userId ? { userId } : {}),
      },
      select: { id: true, name: true, address: true, plz: true, city: true },
    });

    const incompleteCustomerCount = allCustomers.filter(isCustomerDataIncomplete).length;

    // Category C: Orders with uncertain assignment (stored in reviewReasons)
    const uncertainAssignmentCount = await prisma.order.count({
      where: {
        deletedAt: null,
        userId,
        reviewReasons: { has: 'uncertain_assignment' },
      },
    });

    const totalReviewCount = incompleteCustomerCount + uncertainAssignmentCount;

    // 5. Recent orders (5 newest active)
    const recentOrders = await prisma.order.findMany({
      where: { offerId: null, invoiceId: null, deletedAt: null, userId },
      take: 5,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, description: true, serviceName: true, status: true,
        totalPrice: true, date: true, createdAt: true,
        customer: { select: { name: true, customerNumber: true } },
        items: { select: { serviceName: true }, take: 3 },
      },
    });

    // 6. Recent offers (5 newest active)
    const recentOffers = await prisma.offer.findMany({
      where: { deletedAt: null, userId, status: { in: ['Entwurf', 'Gesendet'] } },
      take: 5,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, offerNumber: true, status: true, total: true, createdAt: true,
        customer: { select: { name: true, customerNumber: true } },
        items: { select: { description: true }, take: 3 },
        orders: { select: { createdAt: true }, take: 1, orderBy: { createdAt: 'asc' } },
      },
    });

    // 7. Recent invoices (5 newest active)
    const recentInvoices = await prisma.invoice.findMany({
      where: { deletedAt: null, userId, status: { notIn: ['Erledigt', 'Bezahlt'] } },
      take: 5,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, invoiceNumber: true, status: true, total: true, createdAt: true,
        customer: { select: { name: true, customerNumber: true } },
        items: { select: { description: true }, take: 3 },
        orders: { select: { createdAt: true }, take: 1, orderBy: { createdAt: 'asc' } },
      },
    });

    // ─── Stage I — Audio usage this month + active plan ───
    // Sequential to keep the existing pool-friendly pattern. Both functions
    // are robust to missing data (zero rows / no plan field yet).
    const audioUsage = await getMonthlyAudioUsage(userId);
    const plan = await getCurrentPlan(userId);
    const includedMinutes = plan.includedMinutes;
    const usedMinutes = audioUsage.receivedMinutes;
    const usagePercent = includedMinutes > 0
      ? Math.round((usedMinutes / includedMinutes) * 100)
      : 0;

    return NextResponse.json({
      activeOrders: activeOrderCount,
      activeOffers: activeOfferCount,
      totalInvoices: activeInvoiceCount,
      // Stage I — Audio usage block consumed by the dashboard "Audio-Minuten
      // diesen Monat" card. Always present (zero values if no audio yet).
      audioUsage: {
        // Plan info
        plan: plan.name,
        planIsFallback: plan.isFallback,
        monthlyPriceChf: plan.monthlyPriceChf,
        extraMinutePriceChf: plan.extraMinutePriceChf,
        includedMinutes,
        // Usage breakdown
        usedMinutes,
        transcribedMinutes: audioUsage.transcribedMinutes,
        skippedMinutes: audioUsage.skippedMinutes,
        failedMinutes: audioUsage.failedMinutes,
        audioOrderCount: audioUsage.audioOrderCount,
        usagePercent,
        // Window metadata for transparency
        windowStartIso: audioUsage.windowStartIso,
        windowEndIso: audioUsage.windowEndIso,
        windowTimezone: audioUsage.windowTimezone,
      },
      // Structured review data
      review: {
        total: totalReviewCount,
        incompleteCustomers: incompleteCustomerCount,
        uncertainAssignments: uncertainAssignmentCount,
      },
      // Legacy field for backward compat
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
