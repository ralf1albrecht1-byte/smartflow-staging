export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireUserId, unauthorizedResponse, getSessionUser } from '@/lib/get-session';
import { logAuditAsync } from '@/lib/audit';

/**
 * POST /api/offers/[id]/revert
 * Moves an offer back to orders stage:
 * 1. Unlinks orders from this offer (offerId = null) so they reappear in active orders
 * 2. Soft-deletes the offer
 * No duplicate records — true stage transition.
 */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    let userId: string;
    try { userId = await requireUserId(); } catch { return unauthorizedResponse(); }

    const offer = await prisma.offer.findFirst({
      where: { id: params?.id, userId, deletedAt: null },
      include: { orders: { select: { id: true } } },
    });
    if (!offer) return NextResponse.json({ error: 'Angebot nicht gefunden' }, { status: 404 });

    // Check if any invoice references this offer — block revert if so
    const linkedInvoice = await prisma.invoice.findFirst({
      where: { sourceOfferId: offer.id, deletedAt: null },
      select: { id: true, invoiceNumber: true },
    });
    if (linkedInvoice) {
      return NextResponse.json(
        { error: `Kann nicht zurücksetzen — Rechnung ${linkedInvoice.invoiceNumber} ist mit diesem Angebot verknüpft. Bitte zuerst die Rechnung löschen oder zurücksetzen.` },
        { status: 409 }
      );
    }

    // 1. Unlink all orders from this offer
    const orderIds = offer.orders.map((o: any) => o.id);
    if (orderIds.length > 0) {
      await prisma.order.updateMany({
        where: { id: { in: orderIds } },
        data: { offerId: null },
      });
    }

    // 2. Soft-delete the offer
    await prisma.offer.update({
      where: { id: offer.id },
      data: { deletedAt: new Date() },
    });

    const sessionUser = await getSessionUser();
    logAuditAsync({
      userId, action: 'OFFER_REVERT_TO_ORDER', area: 'OFFERS',
      targetType: 'Offer', targetId: offer.id, success: true,
      userEmail: sessionUser?.email, userRole: sessionUser?.role,
      details: { offerNumber: offer.offerNumber, revertedOrderIds: orderIds },
    });

    return NextResponse.json({ success: true, revertedOrders: orderIds.length });
  } catch (error: any) {
    console.error('Offer revert error:', error);
    return NextResponse.json({ error: 'Fehler beim Zurücksetzen' }, { status: 500 });
  }
}
