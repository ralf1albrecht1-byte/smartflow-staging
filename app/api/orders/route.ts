export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireUserId, unauthorizedResponse, getSessionUser } from '@/lib/get-session';
import { logAuditAsync } from '@/lib/audit';
import { assertCustomerNotArchived, CustomerArchivedError } from '@/lib/customer-links';

/**
 * VAT persistence on Order (since 2026-04-18):
 *   - vatRate / vatAmount / total are stored columns (see prisma/schema.prisma).
 *   - totalPrice remains the NETTO subtotal (unchanged meaning).
 *   - For legacy orders that existed before the VAT columns were added, the
 *     column defaults (8.1 / 0 / 0) mean `vatAmount` and `total` may be 0 even
 *     though `totalPrice` has a value. We compute a safe fallback on read so
 *     old rows display correctly without rewriting them.
 */
function normalizeOrderVat(o: any) {
  const totalPrice = Number(o?.totalPrice ?? 0);
  const vatRate = o?.vatRate == null ? 8.1 : Number(o.vatRate);
  // If vatAmount/total were never written (legacy rows default to 0), recompute.
  const storedVatAmount = Number(o?.vatAmount ?? 0);
  const storedTotal = Number(o?.total ?? 0);
  const computedVatAmount = totalPrice * vatRate / 100;
  const computedTotal = totalPrice + computedVatAmount;
  // Heuristic: if stored total is 0 but totalPrice > 0, these columns have never
  // been written for this row -> use computed values.
  const useComputed = storedTotal === 0 && totalPrice > 0;
  return {
    vatRate,
    vatAmount: useComputed ? computedVatAmount : storedVatAmount,
    total: useComputed ? computedTotal : storedTotal,
  };
}

export async function GET(request: Request) {
  let userId: string;
  try { userId = await requireUserId(); } catch { return unauthorizedResponse(); }
  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams?.get('status');
    const where: any = { deletedAt: null, userId };
    if (status && status !== 'Alle') where.status = status;
    const orders = await prisma.order.findMany({
      where,
      orderBy: { date: 'desc' },
      include: { customer: { select: { id: true, name: true, phone: true, email: true, address: true, plz: true, city: true, customerNumber: true } }, items: true },
    });
    return NextResponse.json(orders?.map((o: any) => ({
      ...o,
      totalPrice: Number(o?.totalPrice ?? 0),
      unitPrice: Number(o?.unitPrice ?? 0),
      quantity: Number(o?.quantity ?? 0),
      ...normalizeOrderVat(o),
      items: (o?.items ?? []).map((item: any) => ({ ...item, unitPrice: Number(item?.unitPrice ?? 0), quantity: Number(item?.quantity ?? 0), totalPrice: Number(item?.totalPrice ?? 0) })),
    })) ?? []);
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
    const items = data?.items as any[] | undefined;
    let totalPrice = 0;
    let primaryServiceName = data?.serviceName ?? null;
    let primaryPriceType = data?.priceType ?? 'Stunde';
    let primaryUnitPrice = Number(data?.unitPrice ?? 50);
    let primaryQuantity = Number(data?.quantity ?? 1);
    if (items && items.length > 0) {
      totalPrice = items.reduce((sum: number, item: any) => sum + (Number(item.unitPrice ?? 0) * Number(item.quantity ?? 1)), 0);
      primaryServiceName = items[0].serviceName ?? primaryServiceName;
      primaryPriceType = items[0].unit ?? primaryPriceType;
      primaryUnitPrice = Number(items[0].unitPrice ?? 50);
      primaryQuantity = Number(items[0].quantity ?? 1);
    } else {
      totalPrice = primaryQuantity * primaryUnitPrice;
    }
    // Resolve VAT: client-provided value wins; else fall back to CompanySettings;
    // else default 8.1 (current Swiss standard). A value of 0 means VAT disabled.
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
    if (!isFinite(vatRate) || vatRate < 0) vatRate = 0;
    const vatAmount = totalPrice * vatRate / 100;
    const total = totalPrice + vatAmount;
    // Guard: reject creation linked to an archived customer
    if (data?.customerId) {
      await assertCustomerNotArchived(prisma, data.customerId);
    }

    const order = await prisma.order.create({
      data: {
        customerId: data?.customerId, description: data?.description ?? '', serviceName: primaryServiceName,
        status: data?.status ?? 'Offen', priceType: primaryPriceType, unitPrice: primaryUnitPrice,
        quantity: primaryQuantity, totalPrice, vatRate, vatAmount, total,
        date: data?.date ? new Date(data.date) : new Date(),
        notes: data?.notes ?? null, specialNotes: data?.specialNotes ?? null,
        hinweisLevel: data?.hinweisLevel ?? 'none', mediaUrl: data?.mediaUrl ?? null,
        mediaType: data?.mediaType ?? null, imageUrls: data?.imageUrls ?? [], audioTranscript: data?.audioTranscript ?? null,
        userId,
        ...(items && items.length > 0 ? { items: { create: items.map((item: any) => ({ serviceName: item.serviceName ?? '', description: item.description ?? '', quantity: Number(item.quantity ?? 1), unit: item.unit ?? 'Stunde', unitPrice: Number(item.unitPrice ?? 0), totalPrice: Number(item.unitPrice ?? 0) * Number(item.quantity ?? 1) })) } } : {}),
      },
      include: { customer: true, items: true },
    });
    const su = await getSessionUser();
    logAuditAsync({ userId: su?.id, userEmail: su?.email, userRole: su?.role, action: 'ORDER_CREATE', area: 'ORDERS', targetType: 'Order', targetId: order.id, request });
    return NextResponse.json({ ...order, totalPrice: Number(order?.totalPrice ?? 0), unitPrice: Number(order?.unitPrice ?? 0), quantity: Number(order?.quantity ?? 0), vatRate: Number(order?.vatRate ?? 0), vatAmount: Number(order?.vatAmount ?? 0), total: Number(order?.total ?? 0), items: (order?.items ?? []).map((item: any) => ({ ...item, unitPrice: Number(item?.unitPrice ?? 0), quantity: Number(item?.quantity ?? 0), totalPrice: Number(item?.totalPrice ?? 0) })) });
  } catch (error: any) {
    if (error instanceof CustomerArchivedError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    console.error(error);
    return NextResponse.json({ error: 'Fehler beim Erstellen' }, { status: 500 });
  }
}
