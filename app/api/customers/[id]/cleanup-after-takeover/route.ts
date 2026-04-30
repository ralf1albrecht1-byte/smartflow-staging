export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireUserId, unauthorizedResponse } from '@/lib/get-session';
import { getCustomerDeleteBlockerCounts, isCustomerDeleteBlocked } from '@/lib/customer-links';

/**
 * POST /api/customers/[id]/cleanup-after-takeover
 *
 * Called after "Diesen Kunden übernehmen" reassigns a document from oldCustomer
 * (params.id) to keptCustomer (body.keptCustomerId).
 *
 * 1. Checks if oldCustomer now has zero active documents (same rule as delete blocker).
 * 2. If zero: transfers non-empty fields from old → kept (fill gaps only, never overwrite),
 *    then soft-deletes old customer (deletedAt = now()).
 * 3. If non-zero: returns { cleaned: false } — old customer still has docs.
 *
 * Tenant-safe: filters by userId.
 */
export async function POST(
  request: Request,
  { params }: { params: { id: string } },
) {
  let userId: string;
  try {
    userId = await requireUserId();
  } catch {
    return unauthorizedResponse();
  }

  const oldCustomerId = params?.id;
  if (!oldCustomerId) {
    return NextResponse.json({ error: 'Missing customer id' }, { status: 400 });
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const keptCustomerId = body?.keptCustomerId;
  if (!keptCustomerId || typeof keptCustomerId !== 'string') {
    return NextResponse.json({ error: 'Missing keptCustomerId' }, { status: 400 });
  }

  if (oldCustomerId === keptCustomerId) {
    return NextResponse.json({ cleaned: false, reason: 'same_customer' });
  }

  try {
    // Verify both customers belong to this user
    const [oldCust, keptCust] = await Promise.all([
      prisma.customer.findFirst({ where: { id: oldCustomerId, userId } }),
      prisma.customer.findFirst({ where: { id: keptCustomerId, userId } }),
    ]);

    if (!oldCust) {
      return NextResponse.json({ cleaned: false, reason: 'old_not_found' });
    }
    if (!keptCust) {
      return NextResponse.json({ cleaned: false, reason: 'kept_not_found' });
    }

    // Already archived?
    if (oldCust.deletedAt) {
      return NextResponse.json({ cleaned: true, reason: 'already_archived' });
    }

    // Check if old customer still has blocking documents
    const counts = await getCustomerDeleteBlockerCounts(prisma, oldCustomerId, userId);
    if (isCustomerDeleteBlocked(counts)) {
      return NextResponse.json({
        cleaned: false,
        reason: 'has_active_documents',
        counts,
      });
    }

    // Transfer non-empty fields from old → kept (fill gaps only, never overwrite)
    const TRANSFER_FIELDS = ['name', 'address', 'plz', 'city', 'country', 'phone', 'email', 'notes'] as const;
    const fillData: Record<string, string> = {};
    for (const field of TRANSFER_FIELDS) {
      const oldVal = (oldCust as any)[field];
      const keptVal = (keptCust as any)[field];
      // Only fill if old has a non-empty value and kept is empty/null
      if (oldVal && String(oldVal).trim() && (!keptVal || !String(keptVal).trim())) {
        fillData[field] = String(oldVal).trim();
      }
    }

    // Execute in transaction: update kept customer fields + soft-delete old
    await prisma.$transaction(async (tx: any) => {
      if (Object.keys(fillData).length > 0) {
        await tx.customer.update({
          where: { id: keptCustomerId },
          data: fillData,
        });
      }
      await tx.customer.update({
        where: { id: oldCustomerId },
        data: { deletedAt: new Date() },
      });
    });

    return NextResponse.json({
      cleaned: true,
      fieldsTransferred: Object.keys(fillData),
    });
  } catch (err: any) {
    console.error('[cleanup-after-takeover] Error:', err);
    return NextResponse.json(
      { error: 'Interner Fehler beim Aufräumen' },
      { status: 500 },
    );
  }
}
