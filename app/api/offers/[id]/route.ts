export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireUserId, unauthorizedResponse, getSessionUser } from '@/lib/get-session';
import { logAuditAsync } from '@/lib/audit';
import { assertCustomerNotArchived, CustomerArchivedError } from '@/lib/customer-links';

export async function GET(request: Request, { params }: { params: { id: string } }) {
  try {
    let userId: string;
    try { userId = await requireUserId(); } catch { return unauthorizedResponse(); }

    const offer = await prisma.offer.findFirst({ where: { id: params?.id, userId }, include: { customer: true, items: true, orders: { select: { id: true, notes: true, specialNotes: true, needsReview: true, hinweisLevel: true, mediaUrl: true, mediaType: true, imageUrls: true, audioTranscript: true, audioDurationSec: true, audioTranscriptionStatus: true, description: true } } } });
    if (!offer) return NextResponse.json({ error: 'Nicht gefunden' }, { status: 404 });
    return NextResponse.json({ ...offer, subtotal: Number(offer?.subtotal ?? 0), vatAmount: Number(offer?.vatAmount ?? 0), total: Number(offer?.total ?? 0), items: offer?.items?.map((i: any) => ({ ...i, quantity: Number(i?.quantity ?? 0), unitPrice: Number(i?.unitPrice ?? 0), totalPrice: Number(i?.totalPrice ?? 0) })) ?? [] });
  } catch (error: any) {
    console.error(error);
    return NextResponse.json({ error: 'Fehler' }, { status: 500 });
  }
}

export async function PUT(request: Request, { params }: { params: { id: string } }) {
  try {
    let userId: string;
    try { userId = await requireUserId(); } catch { return unauthorizedResponse(); }

    // Verify ownership
    const existing = await prisma.offer.findFirst({ where: { id: params?.id, userId } });
    if (!existing) return NextResponse.json({ error: 'Nicht gefunden' }, { status: 404 });

    const data = await request.json();

    // Guard: reject reassignment to an archived customer
    if (data.customerId && data.customerId !== existing.customerId) {
      await assertCustomerNotArchived(prisma, data.customerId);
    }

    // If items are provided, update items and recalculate totals
    if (data.items && Array.isArray(data.items)) {
      await prisma.offerItem.deleteMany({ where: { offerId: params.id } });

      const itemsData = data.items.map((item: any) => ({
        description: item.description || '',
        quantity: Number(item.quantity || 1),
        unit: item.unit || 'Stunde',
        unitPrice: Number(item.unitPrice || 0),
        totalPrice: Number(item.quantity || 1) * Number(item.unitPrice || 0),
      }));

      const subtotal = itemsData.reduce((sum: number, i: any) => sum + i.totalPrice, 0);
      const vatRate = data.vatRate !== undefined && data.vatRate !== null ? Number(data.vatRate) : 8.1;
      const vatAmount = subtotal * (vatRate / 100);
      const total = subtotal + vatAmount;

      const offer = await prisma.offer.update({
        where: { id: params.id },
        data: {
          status: data.status,
          notes: data.notes,
          customerId: data.customerId || undefined,
          subtotal,
          vatRate,
          vatAmount,
          total,
          items: { create: itemsData },
        },
        include: { customer: true, items: true },
      });
      const su = await getSessionUser();
      logAuditAsync({ userId: su?.id, userEmail: su?.email, userRole: su?.role, action: 'OFFER_UPDATE', area: 'OFFERS', targetType: 'Offer', targetId: params?.id, request });
      return NextResponse.json(offer);
    }

    // Simple status/notes update
    const offer = await prisma.offer.update({ where: { id: params?.id }, data: { status: data?.status, notes: data?.notes }, include: { customer: true, items: true } });
    const su = await getSessionUser();
    logAuditAsync({ userId: su?.id, userEmail: su?.email, userRole: su?.role, action: 'OFFER_UPDATE', area: 'OFFERS', targetType: 'Offer', targetId: params?.id, request });
    return NextResponse.json(offer);
  } catch (error: any) {
    if (error instanceof CustomerArchivedError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    console.error(error);
    return NextResponse.json({ error: 'Fehler' }, { status: 500 });
  }
}

export async function DELETE(request: Request, { params }: { params: { id: string } }) {
  try {
    let userId: string;
    try { userId = await requireUserId(); } catch { return unauthorizedResponse(); }

    const existing = await prisma.offer.findFirst({ where: { id: params?.id, userId } });
    if (!existing) return NextResponse.json({ error: 'Nicht gefunden' }, { status: 404 });

    // Soft-delete the offer — do NOT null offerId on linked orders to prevent them from resurfacing in active orders list
    await prisma.offer.update({ where: { id: params?.id }, data: { deletedAt: new Date() } });
    const su2 = await getSessionUser();
    logAuditAsync({ userId: su2?.id, userEmail: su2?.email, userRole: su2?.role, action: 'OFFER_DELETE', area: 'OFFERS', targetType: 'Offer', targetId: params?.id, request });
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error(error);
    return NextResponse.json({ error: 'Fehler' }, { status: 500 });
  }
}
