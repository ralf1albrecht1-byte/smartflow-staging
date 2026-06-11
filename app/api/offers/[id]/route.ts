export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getActiveDataScope } from "@/lib/data-scope";
import {
  requireUserId,
  unauthorizedResponse,
  getSessionUser,
} from "@/lib/get-session";
import { logAuditAsync } from "@/lib/audit";
import {
  assertCustomerNotArchived,
  CustomerArchivedError,
} from "@/lib/customer-links";
import {
  buildDocumentCustomerSnapshot,
  DOCUMENT_CUSTOMER_SELECT,
  isCustomerSnapshotStatus,
  withDocumentCustomerSnapshot,
} from "@/lib/document-customer-snapshot";

function validateDocumentItemsForUpdate(items: any[]) {
  if (!Array.isArray(items)) return null;
  if (items.length === 0) return "Mindestens eine Leistung ist erforderlich.";

  const invalid = items.some(
    (item: any) =>
      !String(item?.description || "").trim() ||
      Number(item?.quantity || 0) <= 0 ||
      Number(item?.unitPrice || 0) <= 0,
  );

  return invalid
    ? "Preis/Menge prüfen: Dokument kann nicht mit leeren oder 0-Positionen gespeichert werden."
    : null;
}

function buildOfferDateUpdate(existing: any, data: any) {
  const parsedOfferDate = data?.offerDate
    ? new Date(data.offerDate)
    : new Date(existing?.offerDate || new Date());
  const offerDate = Number.isNaN(parsedOfferDate.getTime())
    ? new Date(existing?.offerDate || new Date())
    : parsedOfferDate;

  const currentOfferDate = new Date(existing?.offerDate || offerDate);
  const currentValidUntil = existing?.validUntil
    ? new Date(existing.validUntil)
    : null;
  const currentDays =
    currentValidUntil && !Number.isNaN(currentValidUntil.getTime())
      ? Math.max(
          0,
          Math.round(
            (currentValidUntil.getTime() - currentOfferDate.getTime()) /
              86_400_000,
          ),
        )
      : 14;
  const validDays =
    data?.validDays !== undefined
      ? Math.max(0, Number(data.validDays) || 14)
      : currentDays;
  const validUntil = new Date(offerDate);
  validUntil.setDate(validUntil.getDate() + validDays);

  return { offerDate, validUntil };
}

const offerOrderSelect = {
  id: true,
  createdAt: true,
  date: true,
  notes: true,
  specialNotes: true,
  needsReview: true,
  hinweisLevel: true,
  mediaUrl: true,
  mediaType: true,
  imageUrls: true,
  thumbnailUrls: true,
  audioTranscript: true,
  audioDurationSec: true,
  audioTranscriptionStatus: true,
  description: true,
  siteAddressDifferent: true,
  siteName: true,
  siteAddress: true,
  sitePlz: true,
  siteCity: true,
  siteNote: true,
  originOrderIds: true,
  reviewReasons: true,
  customer: {
    select: {
      id: true,
      name: true,
      phone: true,
      email: true,
    },
  },
  workSites: {
    select: {
      id: true,
      siteName: true,
      siteAddress: true,
      sitePlz: true,
      siteCity: true,
      siteNote: true,
      isPrimary: true,
      sortOrder: true,
      sourceOrderId: true,
    },
  },
} as const;

export async function GET(
  request: Request,
  { params }: { params: { id: string } },
) {
  try {
    let userId: string;
    try {
      userId = await requireUserId();
    } catch {
      return unauthorizedResponse();
    }
    const dataScope = await getActiveDataScope(userId);

    const offer = await prisma.offer.findFirst({
      where: { id: params?.id, userId, dataScope },
      include: {
        customer: true,
        items: true,
        orders: { select: offerOrderSelect },
      },
    });
    if (!offer)
      return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
    const responseOffer = withDocumentCustomerSnapshot(offer, "offer");
    return NextResponse.json({
      ...responseOffer,
      subtotal: Number(responseOffer?.subtotal ?? 0),
      vatAmount: Number(responseOffer?.vatAmount ?? 0),
      total: Number(responseOffer?.total ?? 0),
      items:
        responseOffer?.items?.map((i: any) => ({
          ...i,
          quantity: Number(i?.quantity ?? 0),
          unitPrice: Number(i?.unitPrice ?? 0),
          totalPrice: Number(i?.totalPrice ?? 0),
        })) ?? [],
    });
  } catch (error: any) {
    console.error(error);
    return NextResponse.json({ error: "Fehler" }, { status: 500 });
  }
}

export async function PUT(
  request: Request,
  { params }: { params: { id: string } },
) {
  try {
    let userId: string;
    try {
      userId = await requireUserId();
    } catch {
      return unauthorizedResponse();
    }
    const dataScope = await getActiveDataScope(userId);

    // Verify ownership
    const existing = await prisma.offer.findFirst({
      where: { id: params?.id, userId, dataScope },
    });
    if (!existing)
      return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });

    const data = await request.json();
    const { offerDate, validUntil } = buildOfferDateUpdate(existing, data);
    const itemError = validateDocumentItemsForUpdate(data?.items);
    if (itemError)
      return NextResponse.json({ error: itemError }, { status: 400 });

    const currentStatus = String(existing.status || "Entwurf");
    const nextStatus = String(data?.status ?? currentStatus);
    const currentLocked = isCustomerSnapshotStatus("offer", currentStatus);
    const nextLocked = isCustomerSnapshotStatus("offer", nextStatus);
    const nextCustomerId = String(data?.customerId || existing.customerId);

    // Historical offers must not silently change their linked customer. To
    // correct one, reopen it as a draft first and then resend it.
    if (
      currentLocked &&
      data?.customerId &&
      data.customerId !== existing.customerId
    ) {
      return NextResponse.json(
        {
          error:
            "Gesendete oder abgelehnte Angebote behalten ihre historischen Kundendaten. Setzen Sie das Angebot zuerst auf Entwurf, bevor Sie den Kunden ändern.",
        },
        { status: 409 },
      );
    }

    let activeCustomer: any = null;
    if (data?.customerId && data.customerId !== existing.customerId) {
      activeCustomer = await prisma.customer.findFirst({
        where: { id: data.customerId, userId, dataScope, deletedAt: null },
        select: DOCUMENT_CUSTOMER_SELECT,
      });
      if (!activeCustomer) {
        return NextResponse.json({ error: "Kunde gehört nicht zum aktiven TEST-/LIVE-Bestand oder liegt im Papierkorb." }, { status: 409 });
      }
      await assertCustomerNotArchived(prisma, data.customerId);
    }

    const needsCustomerSnapshot =
      nextLocked && (!currentLocked || !existing.customerSnapshot);
    if (needsCustomerSnapshot && !activeCustomer) {
      activeCustomer = await prisma.customer.findFirst({
        where: { id: nextCustomerId, userId, dataScope, deletedAt: null },
        select: DOCUMENT_CUSTOMER_SELECT,
      });
      if (!activeCustomer) {
        return NextResponse.json(
          { error: "Kundendaten für den historischen Angebotsstand konnten nicht geladen werden." },
          { status: 409 },
        );
      }
    }

    const customerSnapshotData = needsCustomerSnapshot
      ? {
          customerSnapshot: buildDocumentCustomerSnapshot(activeCustomer),
          customerSnapshotAt: new Date(),
        }
      : {};

    // If items are provided, update items and recalculate totals
    if (data.items && Array.isArray(data.items)) {
      await prisma.offerItem.deleteMany({ where: { offerId: params.id } });

      const itemsData = data.items.map((item: any) => ({
        description: item.description || "",
        quantity: Number(item.quantity || 1),
        unit: item.unit || "Stunde",
        unitPrice: Number(item.unitPrice || 0),
        totalPrice: Number(item.quantity || 1) * Number(item.unitPrice || 0),
        siteName: item.siteName || null,
        siteAddress: item.siteAddress || null,
        sitePlz: item.sitePlz || null,
        siteCity: item.siteCity || null,
        siteNote: item.siteNote || null,
        sourceOrderId: item.sourceOrderId || null,
      }));

      const subtotal = itemsData.reduce(
        (sum: number, i: any) => sum + i.totalPrice,
        0,
      );
      const vatRate =
        data.vatRate !== undefined && data.vatRate !== null
          ? Number(data.vatRate)
          : 8.1;
      const vatAmount = subtotal * (vatRate / 100);
      const total = subtotal + vatAmount;

      const offer = await prisma.offer.update({
        where: { id: params.id },
        data: {
          status: data.status,
          notes: data.notes,
          currency:
            data?.currency === "EUR" || data?.currency === "CHF"
              ? data.currency
              : existing.currency,
          customerId: data.customerId || undefined,
          offerDate,
          validUntil,
          subtotal,
          vatRate,
          vatAmount,
          total,
          ...customerSnapshotData,
          items: { create: itemsData },
        },
        include: {
          customer: true,
          items: true,
          orders: { select: offerOrderSelect },
        },
      });
      const su = await getSessionUser();
      logAuditAsync({
        userId: su?.id,
        userEmail: su?.email,
        userRole: su?.role,
        action: "OFFER_UPDATE",
        area: "OFFERS",
        targetType: "Offer",
        targetId: params?.id,
        request,
      });
      return NextResponse.json(
        withDocumentCustomerSnapshot(offer, "offer"),
      );
    }

    // Simple update (status/notes/customerId — no items recalculation)
    const simpleData: Record<string, any> = {};
    if (data?.customerId) simpleData.customerId = data.customerId;
    if (data?.status !== undefined) simpleData.status = data.status;
    if (data?.notes !== undefined) simpleData.notes = data.notes;
    if (data?.currency !== undefined)
      simpleData.currency = data.currency === "EUR" ? "EUR" : "CHF";
    if (data?.offerDate !== undefined || data?.validDays !== undefined) {
      simpleData.offerDate = offerDate;
      simpleData.validUntil = validUntil;
    }
    Object.assign(simpleData, customerSnapshotData);
    const offer = await prisma.offer.update({
      where: { id: params?.id },
      data: simpleData,
      include: {
        customer: true,
        items: true,
        orders: { select: offerOrderSelect },
      },
    });
    const su = await getSessionUser();
    logAuditAsync({
      userId: su?.id,
      userEmail: su?.email,
      userRole: su?.role,
      action: "OFFER_UPDATE",
      area: "OFFERS",
      targetType: "Offer",
      targetId: params?.id,
      request,
    });
    return NextResponse.json(
      withDocumentCustomerSnapshot(offer, "offer"),
    );
  } catch (error: any) {
    if (error instanceof CustomerArchivedError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    console.error(error);
    return NextResponse.json({ error: "Fehler" }, { status: 500 });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: { id: string } },
) {
  try {
    let userId: string;
    try {
      userId = await requireUserId();
    } catch {
      return unauthorizedResponse();
    }
    const dataScope = await getActiveDataScope(userId);

    const existing = await prisma.offer.findFirst({
      where: { id: params?.id, userId, dataScope },
    });
    if (!existing)
      return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });

    // Soft-delete the offer — do NOT null offerId on linked orders to prevent them from resurfacing in active orders list
    await prisma.offer.update({
      where: { id: params?.id },
      data: { deletedAt: new Date() },
    });
    const su2 = await getSessionUser();
    logAuditAsync({
      userId: su2?.id,
      userEmail: su2?.email,
      userRole: su2?.role,
      action: "OFFER_DELETE",
      area: "OFFERS",
      targetType: "Offer",
      targetId: params?.id,
      request,
    });
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error(error);
    return NextResponse.json({ error: "Fehler" }, { status: 500 });
  }
}
