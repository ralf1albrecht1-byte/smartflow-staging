export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getActiveDataScope } from '@/lib/data-scope';
import { requireUserId, unauthorizedResponse, getSessionUser } from '@/lib/get-session';
import { logAuditAsync } from '@/lib/audit';

/**
 * POST /api/invoices/[id]/revert
 * Moves an invoice back to offer stage:
 * 1. If sourceOfferId exists, reactivate that offer without changing its status
 * 2. Unlink orders from this invoice (invoiceId = null)
 * 3. Soft-delete the invoice
 * No duplicate records — true stage transition.
 */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    let userId: string;
    try { userId = await requireUserId(); } catch { return unauthorizedResponse(); }
    const dataScope = await getActiveDataScope(userId);

    const invoice = await prisma.invoice.findFirst({
      where: { id: params?.id, userId, dataScope, deletedAt: null },
      include: { orders: { where: { dataScope }, select: { id: true } } },
    });
    if (!invoice) return NextResponse.json({ error: 'Rechnung nicht gefunden' }, { status: 404 });

    const sourceOfferId = invoice.sourceOfferId;
    const orderIds = invoice.orders.map((o: any) => o.id);
    let reactivatedOffer = false;

    // V17.90L275: One atomic stage rollback. The existing source document is
    // reactivated without recreating or rewriting any customer, item or note
    // data. A reverted invoice is detached from the offer so the normal offer
    // list no longer treats that historical, soft-deleted invoice as active.
    await prisma.$transaction(async (tx) => {
      if (sourceOfferId) {
        const offer = await tx.offer.findFirst({
          where: { id: sourceOfferId, userId, dataScope },
          select: { id: true },
        });
        if (offer) {
          await tx.offer.update({
            where: { id: offer.id },
            // V17.90L277: Reactivation must not invent a workflow status.
            // The exact pre-conversion status was preserved during invoice creation.
            data: { deletedAt: null },
          });
          reactivatedOffer = true;
        }
      }

      if (orderIds.length > 0) {
        await tx.order.updateMany({
          where: { id: { in: orderIds }, userId, dataScope },
          data: { invoiceId: null },
        });
      }

      await tx.invoice.update({
        where: { id: invoice.id },
        data: {
          deletedAt: new Date(),
          ...(reactivatedOffer ? { sourceOfferId: null } : {}),
        },
      });
    });

    const sessionUser = await getSessionUser();
    logAuditAsync({
      userId, action: 'INVOICE_REVERT_TO_OFFER', area: 'INVOICES',
      targetType: 'Invoice', targetId: invoice.id, success: true,
      userEmail: sessionUser?.email, userRole: sessionUser?.role,
      details: { invoiceNumber: invoice.invoiceNumber, sourceOfferId, reactivatedOffer, revertedOrderIds: orderIds },
    });

    return NextResponse.json({ success: true, reactivatedOffer, revertedOrders: orderIds.length });
  } catch (error: any) {
    console.error('Invoice revert error:', error);
    return NextResponse.json({ error: 'Fehler beim Zurücksetzen' }, { status: 500 });
  }
}
