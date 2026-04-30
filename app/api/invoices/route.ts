export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { generateInvoiceNumber } from '@/lib/doc-numbers';
import { requireUserId, unauthorizedResponse, getSessionUser } from '@/lib/get-session';
import { logAuditAsync } from '@/lib/audit';
import { assertCustomerNotArchived, CustomerArchivedError } from '@/lib/customer-links';

export async function GET(request: Request) {
  let userId: string;
  try { userId = await requireUserId(); } catch { return unauthorizedResponse(); }
  try {
    const url = new URL(request.url);
    const statusFilter = url.searchParams.get('status');
    const where: any = { deletedAt: null, userId };
    if (statusFilter) where.status = statusFilter;
    const invoices = await prisma.invoice.findMany({ where, orderBy: { invoiceDate: 'desc' }, include: { customer: true, items: true, orders: { select: { id: true, createdAt: true, date: true, mediaUrl: true, mediaType: true, imageUrls: true, thumbnailUrls: true, audioTranscript: true, audioDurationSec: true, audioTranscriptionStatus: true, notes: true, specialNotes: true, needsReview: true, hinweisLevel: true, description: true } } } });
    // Enrich with source offer number for traceability
    const offerIds = invoices.map((i: any) => i.sourceOfferId).filter(Boolean);
    let offerMap: Record<string, string> = {};
    if (offerIds.length > 0) {
      const offers = await prisma.offer.findMany({ where: { id: { in: offerIds } }, select: { id: true, offerNumber: true } });
      offerMap = Object.fromEntries(offers.map((o: any) => [o.id, o.offerNumber]));
    }
    return NextResponse.json(invoices?.map((i: any) => ({ ...i, subtotal: Number(i?.subtotal ?? 0), vatAmount: Number(i?.vatAmount ?? 0), total: Number(i?.total ?? 0), sourceOfferNumber: i.sourceOfferId ? (offerMap[i.sourceOfferId] || null) : null })) ?? []);
  } catch (error: any) {
    console.error(error);
    return NextResponse.json([], { status: 500 });
  }
}

export async function POST(request: Request) {
  let userId: string;
  try { userId = await requireUserId(); } catch { return unauthorizedResponse(); }
  try {
    const data = await request.json();
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
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + (Number(data?.paymentDays ?? 30)));
    // Guard: reject creation linked to an archived customer
    if (data?.customerId) {
      await assertCustomerNotArchived(prisma, data.customerId);
    }

    // Duplicate guard: if an invoice already exists for this sourceOfferId, return it
    if (data?.sourceOfferId) {
      const existing = await prisma.invoice.findFirst({
        where: { sourceOfferId: data.sourceOfferId, userId, deletedAt: null },
        include: { customer: true, items: true },
      });
      if (existing) {
        return NextResponse.json({ ...existing, subtotal: Number(existing.subtotal ?? 0), vatAmount: Number(existing.vatAmount ?? 0), total: Number(existing.total ?? 0), existed: true });
      }
    }

    // Retry loop: guards against P2002 (unique constraint on invoiceNumber)
    // in case of a race condition between concurrent requests.
    let invoice: any = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      const invoiceNumber = await generateInvoiceNumber(userId);
      try {
        invoice = await prisma.invoice.create({
          data: {
            invoiceNumber, customerId: data?.customerId, subtotal, vatRate, vatAmount, total,
            invoiceDate: data?.invoiceDate ? new Date(data.invoiceDate) : new Date(), dueDate,
            notes: data?.notes || null, status: data?.status ?? 'Entwurf',
            sourceOfferId: data?.sourceOfferId ?? null, userId,
            items: { create: items.map((item: any) => ({ description: item?.description ?? '', quantity: Number(item?.quantity ?? 1), unit: item?.unit ?? 'Stunde', unitPrice: Number(item?.unitPrice ?? 0), totalPrice: Number(item?.quantity ?? 1) * Number(item?.unitPrice ?? 0) })) },
          },
          include: { customer: true, items: true },
        });
        break; // success
      } catch (createErr: any) {
        if (createErr?.code === 'P2002' && attempt < 2) {
          console.warn(`[invoices] P2002 collision on attempt ${attempt + 1}, retrying…`);
          continue;
        }
        throw createErr;
      }
    }
    if (data?.orderIds?.length) {
      await prisma.order.updateMany({ where: { id: { in: data.orderIds } }, data: { invoiceId: invoice.id } });
    }
    const su = await getSessionUser();
    logAuditAsync({ userId: su?.id, userEmail: su?.email, userRole: su?.role, action: 'INVOICE_CREATE', area: 'INVOICES', targetType: 'Invoice', targetId: invoice.id, request });
    return NextResponse.json({ ...invoice, subtotal: Number(invoice?.subtotal ?? 0), vatAmount: Number(invoice?.vatAmount ?? 0), total: Number(invoice?.total ?? 0) });
  } catch (error: any) {
    if (error instanceof CustomerArchivedError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    console.error(error);
    return NextResponse.json({ error: 'Fehler beim Erstellen' }, { status: 500 });
  }
}
