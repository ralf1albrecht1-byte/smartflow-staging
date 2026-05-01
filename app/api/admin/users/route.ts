/**
 * Phase 3 — Admin: list users with trial / activity overview.
 *
 * GET /api/admin/users  →  { users: [...] }
 *   - Admin-only via requireAdmin().
 *   - Optional ?q= search on email / name (case-insensitive contains).
 *   - Returns essential fields plus computed counts of customers / orders.
 *
 * Read-only: this route never writes. Trial set/clear lives in
 *   /api/admin/users/[id]/trial/route.ts
 */
export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
  requireAdmin,
  unauthorizedResponse,
  forbiddenResponse,
} from '@/lib/get-session';

export async function GET(request: Request) {
  try {
    await requireAdmin();
  } catch (e: any) {
    if (e?.message === 'UNAUTHORIZED') return unauthorizedResponse();
    if (e?.message === 'FORBIDDEN') return forbiddenResponse();
    return NextResponse.json({ error: 'Server-Fehler' }, { status: 500 });
  }

  try {
    const url = new URL(request.url);
    const q = (url.searchParams.get('q') || '').trim().toLowerCase();

    const users = await prisma.user.findMany({
      where: q
        ? {
            OR: [
              { email: { contains: q, mode: 'insensitive' } },
              { name: { contains: q, mode: 'insensitive' } },
            ],
          }
        : {},
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        emailVerified: true,
        createdAt: true,
        trialStart: true,
        trialEndDate: true,
        trialNote: true,
        audioExtraMinutes: true,
        stripeCustomerId: true,
        stripeSubscriptionId: true,
        subscriptionStatus: true,
        currentPeriodEnd: true,
        // Block U — account status fields for admin compliance/user management
        accountStatus: true,
        accessEndsAt: true,
        blockedAt: true,
        blockedReason: true,
        cancellationAcceptedAt: true,
        anonymizedAt: true,
        deletionCompletedAt: true,
        _count: {
          select: {
            customers: true,
            orders: true,
            offers: true,
            invoices: true,
          },
        },
      },
      orderBy: [{ createdAt: 'desc' }],
      take: 500,
    });

    const now = Date.now();
    const shaped = users.map((u: any) => {
      let trialStatus: 'none' | 'active' | 'expired' = 'none';
      let daysRemaining: number | null = null;
      if (u.trialEndDate) {
        const diffMs = new Date(u.trialEndDate).getTime() - now;
        daysRemaining = Math.ceil(diffMs / (24 * 60 * 60 * 1000));
        trialStatus = diffMs <= 0 ? 'expired' : 'active';
      }
      return {
        id: u.id,
        email: u.email,
        name: u.name,
        role: u.role,
        emailVerified: u.emailVerified ? u.emailVerified.toISOString() : null,
        createdAt: u.createdAt.toISOString(),
        trialStart: u.trialStart ? u.trialStart.toISOString() : null,
        trialEndDate: u.trialEndDate ? u.trialEndDate.toISOString() : null,
        trialNote: u.trialNote || null,
        audioExtraMinutes: u.audioExtraMinutes || 0,
        stripeCustomerId: u.stripeCustomerId || null,
        stripeSubscriptionId: u.stripeSubscriptionId || null,
        subscriptionStatus: u.subscriptionStatus || null,
        currentPeriodEnd: u.currentPeriodEnd ? u.currentPeriodEnd.toISOString() : null,
        trialStatus,
        daysRemaining,
        // Block U — account status fields
        accountStatus: u.accountStatus || 'active',
        accessEndsAt: u.accessEndsAt ? u.accessEndsAt.toISOString() : null,
        blockedAt: u.blockedAt ? u.blockedAt.toISOString() : null,
        blockedReason: u.blockedReason || null,
        cancellationAcceptedAt: u.cancellationAcceptedAt ? u.cancellationAcceptedAt.toISOString() : null,
        anonymizedAt: u.anonymizedAt ? u.anonymizedAt.toISOString() : null,
        deletionCompletedAt: u.deletionCompletedAt ? u.deletionCompletedAt.toISOString() : null,
        counts: {
          customers: u._count.customers,
          orders: u._count.orders,
          offers: u._count.offers,
          invoices: u._count.invoices,
        },
      };
    });

    return NextResponse.json({ users: shaped });
  } catch (error: any) {
    console.error('GET /api/admin/users error:', error);
    return NextResponse.json({ error: 'Fehler beim Laden der Benutzer' }, { status: 500 });
  }
}
