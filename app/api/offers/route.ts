export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { generateOfferNumber } from '@/lib/doc-numbers';
import { requireUserId, unauthorizedResponse, getSessionUser } from '@/lib/get-session';
import { logAuditAsync } from '@/lib/audit';
import { assertCustomerNotArchived, CustomerArchivedError } from '@/lib/customer-links';

export async function GET() {
  try {
    let userId: string;
    try { userId = await requireUserId(); } catch { return unauthorizedResponse(); }

    const offers = await prisma.offer.findMany({ where: { deletedAt: null, userId }, orderBy: { offerDate: 'desc' }, include: { customer: true, items: true, orders: { select: { id: true, createdAt: true, date: true, description: true, notes: true, specialNotes: true, needsReview: true, hinweisLevel: true, mediaUrl: true, mediaType: true, imageUrls: true, thumbnailUrls: true, audioTranscript: true, audioDurationSec: true, audioTranscriptionStatus: true } } } });
    return NextResponse.json(offers?.map((o: any) => ({ ...o, subtotal: Number(o?.subtotal ?? 0), vatAmount: Number(o?.vatAmount ?? 0), total: Number(o?.total ?? 0) })) ?? []);
  } catch (error: any) {
    console.error(error);
    return NextResponse.json([], { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    let userId: string;
    try { userId = await requireUserId(); } catch { return unauthorizedResponse(); }

    const data = await request.json();
    // Use vatRate from client if provided, otherwise fetch from Settings, fallback 8.1%
    let vatRate = 8.1;
    if (data?.vatRate !== undefined && data.vatRate !== null) {
      vatRate = Number(data.vatRate);
    } else {
      try {
        const settings = await prisma.companySettings.findFirst({ where: { userId } });
        if (settings?.mwstAktiv && settings?.mwstSatz != null) vatRate = Number(settings.mwstSatz);
        else if (settings && !settings.mwstAktiv) vatRate = 0;
      } catch {}
    }
    const items = data?.items ?? [];
    const subtotal = items.reduce((sum: number, item: any) => sum + Number(item?.quantity ?? 0) * Number(item?.unitPrice ?? 0), 0);
    const vatAmount = subtotal * (vatRate / 100);
    const total = subtotal + vatAmount;
    const validUntil = new Date();
    validUntil.setDate(validUntil.getDate() + (Number(data?.validDays ?? 14)));

    // Guard: reject creation linked to an archived customer
    if (data?.customerId) {
      await assertCustomerNotArchived(prisma, data.customerId);
    }

    // Retry loop: guards against P2002 (unique constraint on offerNumber)
    // in case of a race condition between concurrent requests.
    let offer: any = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      const offerNumber = await generateOfferNumber(userId);
      try {
        offer = await prisma.offer.create({
          data: {
            offerNumber,
            customerId: data?.customerId,
            userId,
            subtotal,
            vatRate,
            vatAmount,
            total,
            offerDate: data?.offerDate ? new Date(data.offerDate) : new Date(),
            validUntil,
            notes: data?.notes || null,
            status: data?.status ?? 'Entwurf',
            items: { create: items.map((item: any) => ({ description: item?.description ?? '', quantity: Number(item?.quantity ?? 1), unit: item?.unit ?? 'Stunde', unitPrice: Number(item?.unitPrice ?? 0), totalPrice: Number(item?.quantity ?? 1) * Number(item?.unitPrice ?? 0) })) },
          },
          include: { customer: true, items: true },
        });
        break; // success
      } catch (createErr: any) {
        if (createErr?.code === 'P2002' && attempt < 2) {
          console.warn(`[offers] P2002 collision on attempt ${attempt + 1}, retrying…`);
          continue;
        }
        throw createErr;
      }
    }
    // Link orders if provided
    if (data?.orderIds?.length) {
      await prisma.order.updateMany({ where: { id: { in: data.orderIds }, userId }, data: { offerId: offer.id } });
    }
    const su = await getSessionUser();
    logAuditAsync({ userId: su?.id, userEmail: su?.email, userRole: su?.role, action: 'OFFER_CREATE', area: 'OFFERS', targetType: 'Offer', targetId: offer.id, request });
    return NextResponse.json({ ...offer, subtotal: Number(offer?.subtotal ?? 0), vatAmount: Number(offer?.vatAmount ?? 0), total: Number(offer?.total ?? 0) });
  } catch (error: any) {
    if (error instanceof CustomerArchivedError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    console.error(error);
    return NextResponse.json({ error: 'Fehler beim Erstellen' }, { status: 500 });
  }
}
