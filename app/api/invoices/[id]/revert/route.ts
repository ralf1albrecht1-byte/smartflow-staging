export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireUserId, unauthorizedResponse, getSessionUser } from '@/lib/get-session';
import { logAuditAsync } from '@/lib/audit';

/**
 * POST /api/invoices/[id]/revert
 * Moves an invoice back to offer stage:
 * 1. If sourceOfferId exists, reactivate that offer (status → 'Gesendet')
 * 2. Unlink orders from this invoice (invoiceId = null)
 * 3. Soft-delete the invoice
 * No duplicate records — true stage transition.
 */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    let userId: string;
    try { userId = await requireUserId(); } catch { return unauthorizedResponse(); }

    const invoice = await prisma.invoice.findFirst({
      where: { id: params?.id, userId, deletedAt: null },
      include: { orders: { select: { id: true } } },
    });
    if (!invoice) return NextResponse.json({ error: 'Rechnung nicht gefunden' }, { status: 404 });

    // 1. Reactivate source offer if exists
    let reactivatedOffer = false;
    if (invoice.sourceOfferId) {
      const offer = await prisma.offer.findFirst({
        where: { id: invoice.sourceOfferId, userId },
      });
      if (offer) {
        await prisma.offer.update({
          where: { id: offer.id },
          data: {
            status: 'Gesendet',
            deletedAt: null, // un-delete if it was soft-deleted
          },
        });
        reactivatedOffer = true;
      }
    }

    // 2. Unlink orders from this invoice
    const orderIds = invoice.orders.map((o: any) => o.id);
    if (orderIds.length > 0) {
      await prisma.order.updateMany({
        where: { id: { in: orderIds } },
        data: { invoiceId: null },
      });
    }

    // 3. Soft-delete the invoice
    await prisma.invoice.update({
      where: { id: invoice.id },
      data: { deletedAt: new Date() },
    });

    const sessionUser = await getSessionUser();
    logAuditAsync({
      userId, action: 'INVOICE_REVERT_TO_OFFER', area: 'INVOICES',
      targetType: 'Invoice', targetId: invoice.id, success: true,
      userEmail: sessionUser?.email, userRole: sessionUser?.role,
      details: { invoiceNumber: invoice.invoiceNumber, sourceOfferId: invoice.sourceOfferId, reactivatedOffer, revertedOrderIds: orderIds },
    });

    return NextResponse.json({ success: true, reactivatedOffer, revertedOrders: orderIds.length });
  } catch (error: any) {
    console.error('Invoice revert error:', error);
    return NextResponse.json({ error: 'Fehler beim Zurücksetzen' }, { status: 500 });
  }
}
