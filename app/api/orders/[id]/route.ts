export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireUserId, unauthorizedResponse, getSessionUser } from '@/lib/get-session';
import { logAuditAsync } from '@/lib/audit';
import { assertCustomerNotArchived, CustomerArchivedError, isCustomerDataIncomplete } from '@/lib/customer-links';

/** Legacy-safe VAT normalizer: see app/api/orders/route.ts for the reasoning. */
function normalizeOrderVat(o: any) {
  const totalPrice = Number(o?.totalPrice ?? 0);
  const vatRate = o?.vatRate == null ? 8.1 : Number(o.vatRate);
  const storedVatAmount = Number(o?.vatAmount ?? 0);
  const storedTotal = Number(o?.total ?? 0);
  const computedVatAmount = totalPrice * vatRate / 100;
  const computedTotal = totalPrice + computedVatAmount;
  const useComputed = storedTotal === 0 && totalPrice > 0;
  return {
    vatRate,
    vatAmount: useComputed ? computedVatAmount : storedVatAmount,
    total: useComputed ? computedTotal : storedTotal,
  };
}

export async function GET(request: Request, { params }: { params: { id: string } }) {
  let userId: string;
  try { userId = await requireUserId(); } catch { return unauthorizedResponse(); }
  try {
    const order = await prisma.order.findFirst({ where: { id: params?.id, userId }, include: { customer: true, items: true } });
    if (!order) return NextResponse.json({ error: 'Nicht gefunden' }, { status: 404 });
    return NextResponse.json({ ...order, totalPrice: Number(order?.totalPrice ?? 0), unitPrice: Number(order?.unitPrice ?? 0), quantity: Number(order?.quantity ?? 0), ...normalizeOrderVat(order), items: (order?.items ?? []).map((item: any) => ({ ...item, unitPrice: Number(item?.unitPrice ?? 0), quantity: Number(item?.quantity ?? 0), totalPrice: Number(item?.totalPrice ?? 0) })) });
  } catch (error: any) {
    console.error(error);
    return NextResponse.json({ error: 'Fehler' }, { status: 500 });
  }
}

export async function PUT(request: Request, { params }: { params: { id: string } }) {
  let userId: string;
  try { userId = await requireUserId(); } catch { return unauthorizedResponse(); }
  try {
    const existing = await prisma.order.findFirst({ where: { id: params?.id, userId } });
    if (!existing) return NextResponse.json({ error: 'Nicht gefunden' }, { status: 404 });
    const data = await request.json();
    const items = data?.items as any[] | undefined;
    let totalPrice = 0;
    let primaryServiceName = data?.serviceName;
    let primaryPriceType = data?.priceType;
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
    if (items) { await prisma.orderItem.deleteMany({ where: { orderId: params?.id } }); }

    // Resolve VAT rate for this update.
    //  - If the client explicitly sent `vatRate`, that value always wins (incl. 0 = disabled).
    //  - Else: keep whatever the existing row had (never silently reset on a partial update).
    //  - Only a brand-new order with no prior VAT value would fall back to settings; this PUT
    //    branch is for existing orders so we prefer existing.vatRate.
    let effectiveVatRate: number;
    if (data?.vatRate !== undefined && data.vatRate !== null) {
      effectiveVatRate = Number(data.vatRate);
      if (!isFinite(effectiveVatRate) || effectiveVatRate < 0) effectiveVatRate = 0;
    } else {
      effectiveVatRate = existing?.vatRate == null ? 8.1 : Number(existing.vatRate);
    }

    // Re-derive net totalPrice when items are (re)computed; else carry forward existing net.
    // Then compute vatAmount and gross total so saved values always stay consistent.
    //   - items is an array (any length): recompute totalPrice from the submitted line items
    //   - items missing:                  partial update (e.g. status change) → preserve totalPrice
    const hasItemsField = Array.isArray(items);
    const netTotal = hasItemsField ? totalPrice : Number(existing?.totalPrice ?? 0);
    const effectiveVatAmount = netTotal * effectiveVatRate / 100;
    const effectiveTotal = netTotal + effectiveVatAmount;

    // Guard: reject reassignment to an archived customer
    if (data?.customerId && data.customerId !== existing.customerId) {
      await assertCustomerNotArchived(prisma, data.customerId);
    }

    const order = await prisma.order.update({
      where: { id: params?.id },
      data: {
        customerId: data?.customerId, description: data?.description, serviceName: primaryServiceName,
        status: data?.status, priceType: primaryPriceType, unitPrice: primaryUnitPrice,
        quantity: primaryQuantity,
        // totalPrice only updates if items were provided (existing behavior preserved)
        ...(items ? { totalPrice } : {}),
        // VAT always re-persists alongside whichever net total the row now has
        vatRate: effectiveVatRate,
        vatAmount: effectiveVatAmount,
        total: effectiveTotal,
        date: data?.date ? new Date(data.date) : undefined,
        notes: data?.notes, specialNotes: data?.specialNotes,
        needsReview: data?.needsReview !== undefined ? data.needsReview : undefined,
        reviewReasons: data?.reviewReasons !== undefined ? data.reviewReasons : undefined,
        hinweisLevel: data?.hinweisLevel !== undefined ? data.hinweisLevel : undefined,
        mediaUrl: data?.mediaUrl !== undefined ? data.mediaUrl : undefined,
        mediaType: data?.mediaType !== undefined ? data.mediaType : undefined,
        imageUrls: data?.imageUrls !== undefined ? data.imageUrls : undefined,
        audioTranscript: data?.audioTranscript !== undefined ? data.audioTranscript : undefined,
        ...(items && items.length > 0 ? { items: { create: items.map((item: any) => ({ serviceName: item.serviceName ?? '', description: item.description ?? '', quantity: Number(item.quantity ?? 1), unit: item.unit ?? 'Stunde', unitPrice: Number(item.unitPrice ?? 0), totalPrice: Number(item.unitPrice ?? 0) * Number(item.quantity ?? 1) })) } } : {}),
      },
      include: { customer: true, items: true },
    });
    const su = await getSessionUser();
    logAuditAsync({ userId: su?.id, userEmail: su?.email, userRole: su?.role, action: 'ORDER_UPDATE', area: 'ORDERS', targetType: 'Order', targetId: params?.id, request });

    // Auto-clear stale review flag: once the linked customer has complete data
    // (name + address + plz + city), the original "Kundendaten unvollständig"
    // warning set at WhatsApp intake time is no longer accurate. Without this
    // cleanup the orange badge lingers on the order card until the user opens
    // "Kunde bearbeiten" and clicks "Kunde aktualisieren" — a confusing extra step.
    //
    // Only clears if:
    //  - the client did NOT explicitly send needsReview in this request (avoid racing user intent)
    //  - order.needsReview is currently true
    //  - the linked customer passes the canonical completeness check
    let finalOrder: any = order;
    if (
      data?.needsReview === undefined &&
      order.needsReview === true &&
      order.customer &&
      !isCustomerDataIncomplete(order.customer)
    ) {
      finalOrder = await prisma.order.update({
        where: { id: params?.id },
        data: { needsReview: false, reviewReasons: [], hinweisLevel: 'none' },
        include: { customer: true, items: true },
      });
      logAuditAsync({
        userId: su?.id, userEmail: su?.email, userRole: su?.role,
        action: 'ORDER_REVIEW_CLEARED', area: 'ORDERS',
        targetType: 'Order', targetId: params?.id,
        details: { reason: 'customer_data_complete' },
        request,
      });
    }

    return NextResponse.json({ ...finalOrder, totalPrice: Number(finalOrder?.totalPrice ?? 0), vatRate: Number(finalOrder?.vatRate ?? 0), vatAmount: Number(finalOrder?.vatAmount ?? 0), total: Number(finalOrder?.total ?? 0), items: (finalOrder?.items ?? []).map((item: any) => ({ ...item, unitPrice: Number(item?.unitPrice ?? 0), quantity: Number(item?.quantity ?? 0), totalPrice: Number(item?.totalPrice ?? 0) })) });
  } catch (error: any) {
    if (error instanceof CustomerArchivedError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    console.error(error);
    return NextResponse.json({ error: 'Fehler' }, { status: 500 });
  }
}

export async function DELETE(request: Request, { params }: { params: { id: string } }) {
  let userId: string;
  try { userId = await requireUserId(); } catch { return unauthorizedResponse(); }
  try {
    const existing = await prisma.order.findFirst({ where: { id: params?.id, userId } });
    if (!existing) return NextResponse.json({ error: 'Nicht gefunden' }, { status: 404 });
    await prisma.order.update({ where: { id: params?.id }, data: { deletedAt: new Date() } });
    const su = await getSessionUser();
    logAuditAsync({ userId: su?.id, userEmail: su?.email, userRole: su?.role, action: 'ORDER_DELETE', area: 'ORDERS', targetType: 'Order', targetId: params?.id, request });
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error(error);
    return NextResponse.json({ error: 'Fehler' }, { status: 500 });
  }
}
