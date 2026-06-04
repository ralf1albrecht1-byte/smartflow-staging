export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { generateOfferNumber } from "@/lib/doc-numbers";
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
  calculateDocumentTotals,
  calculateLineTotal,
  roundMoney,
} from "@/lib/currency";

const CRITICAL_SOURCE_ORDER_REVIEW_PATTERNS = [
  /^currency_/,
  /^item_currency_mismatch/,
  /^unit_mismatch:/,
  /^unit_price_review$/,
  /^quantity_review$/,
  /^price_unclear:/,
  /^price_override:/,
  /^unbekannte_leistung_pruefen$/,
  /^stunden_arbeitsposition_pruefen$/,
  /^total_unrealistic_check$/,
  /^currency_unsupported$/,
  /^manual_flat_service_from_text$/,
  // V17.90L24: hard global order gate. These are not soft catalog hints;
  // they mean the complete order structure is unsafe for documents.
  /^intake_risk:special_notes_polluted$/,
  /^intake_risk:appointment_note_incomplete$/,
  /^intake_risk:appointment_hint_missing$/,
  /^intake_risk:item_evidence_not_line_local$/,
  /^intake_risk:service_name_unresolved$/,
  /^intake_risk:priced_item_total_blocked$/,
  /^intake_risk:priced_service_line_missing_or_mismatched$/,
  /^intake_risk:order_total_mismatch$/,
];

const isSourceOrderItemResolvedForDocument = (item: any) => {
  const quantity = Number(item?.quantity ?? 0);
  const unitPrice = Number(item?.unitPrice ?? 0);
  const total = Number(item?.totalPrice ?? quantity * unitPrice);

  return quantity > 0 && unitPrice > 0 && total > 0;
};

const hasSourceOrderAllItemsResolvedForDocument = (order: any) => {
  const items = Array.isArray(order?.items) ? order.items : [];
  if (items.length === 0) return false;
  return items.every(isSourceOrderItemResolvedForDocument);
};

const isResolvableSourceOrderReviewReason = (reason: string) =>
  reason.startsWith("currency_") ||
  reason.startsWith("item_currency_mismatch") ||
  reason.startsWith("currency_conflict_item:") ||
  reason.startsWith("price_unclear:") ||
  reason.startsWith("price_override:") ||
  reason.startsWith("unit_mismatch:") ||
  reason.startsWith("unit_missing_in_text:") ||
  reason === "unit_price_review" ||
  reason === "unbekannte_leistung_pruefen" ||
  reason === "stunden_arbeitsposition_pruefen" ||
  reason === "manual_flat_service_from_text";

function sourceOrderBlockers(order: any): string[] {
  const blockers: string[] = [];
  const items = Array.isArray(order?.items) ? order.items : [];
  const reviewReasons = Array.isArray(order?.reviewReasons)
    ? order.reviewReasons.filter(Boolean)
    : [];

  if (items.length === 0) blockers.push("Keine Leistungen vorhanden");

  const allItemsResolved = hasSourceOrderAllItemsResolvedForDocument(order);

  if (!allItemsResolved) {
    blockers.push("Preis/Menge prüfen");
  }

  if (
    reviewReasons.some((reason: string) => {
      const isCritical = CRITICAL_SOURCE_ORDER_REVIEW_PATTERNS.some((pattern) =>
        pattern.test(reason),
      );
      if (!isCritical) return false;

      // Gelbe/softe Prüfhinweise dürfen die Dokumenterstellung nicht
      // blockieren, sobald jede Position einen verwertbaren Service, Preis,
      // eine Menge und ein Total hat. Harte Fehler bleiben automatisch
      // Blocker, weil allItemsResolved dann false ist.
      return !(allItemsResolved && isResolvableSourceOrderReviewReason(reason));
    })
  ) {
    blockers.push("Offene Prüfhinweise im Auftrag");
  }

  if (order?.needsReview && reviewReasons.length > 0 && !allItemsResolved) {
    blockers.push("Auftrag ist noch auf Prüfen gesetzt");
  }

  const customer = order?.customer;
  if (
    !String(customer?.name || "").trim() ||
    !String(customer?.address || "").trim() ||
    !String(customer?.plz || "").trim() ||
    !String(customer?.city || "").trim()
  ) {
    blockers.push("Kundendaten prüfen");
  }

  return Array.from(new Set(blockers));
}


async function validateSourceOrdersForDocument(
  userId: string,
  orderIds: unknown,
) {
  const ids = Array.isArray(orderIds)
    ? orderIds.map((id) => String(id || "").trim()).filter(Boolean)
    : [];
  if (ids.length === 0) return null;

  const orders = await prisma.order.findMany({
    where: { id: { in: ids }, userId, deletedAt: null },
    include: {
      items: { include: { workSite: true } },
      workSites: true,
      customer: true,
    },
  });

  if (orders.length !== ids.length) {
    return {
      error:
        "Angebot/Rechnung nicht möglich: Mindestens ein Auftrag wurde nicht gefunden.",
      blockers: ["Auftrag nicht gefunden"],
    };
  }

  const blocked = orders
    .map((order: any) => ({
      id: order.id,
      blockers: sourceOrderBlockers(order),
    }))
    .filter((entry: any) => entry.blockers.length > 0);

  if (blocked.length === 0) return null;

  return {
    error: "Angebot/Rechnung nicht möglich: Auftrag enthält offene Prüfungen.",
    blockers: blocked,
  };
}

function validateDocumentItems(items: any[]) {
  if (!Array.isArray(items) || items.length === 0) {
    return "Mindestens eine Leistung ist erforderlich.";
  }

  const invalid = items.some(
    (item: any) =>
      !String(item?.description || "").trim() ||
      Number(item?.quantity || 0) <= 0 ||
      Number(item?.unitPrice || 0) <= 0,
  );

  return invalid
    ? "Preis/Menge prüfen: Angebot/Rechnung kann nicht mit leeren oder 0-Positionen erstellt werden."
    : null;
}

export async function GET() {
  try {
    let userId: string;
    try {
      userId = await requireUserId();
    } catch {
      return unauthorizedResponse();
    }

    const offers = await prisma.offer.findMany({
      where: { deletedAt: null, userId },
      orderBy: { offerDate: "desc" },
      include: {
        customer: true,
        items: true,
        orders: {
          select: {
            id: true,
            createdAt: true,
            date: true,
            description: true,
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
          },
        },
      },
    });
    return NextResponse.json(
      offers?.map((o: any) => ({
        ...o,
        subtotal: roundMoney(Number(o?.subtotal ?? 0)),
        vatAmount: roundMoney(Number(o?.vatAmount ?? 0)),
        total: roundMoney(Number(o?.total ?? 0)),
      })) ?? [],
    );
  } catch (error: any) {
    console.error(error);
    return NextResponse.json([], { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    let userId: string;
    try {
      userId = await requireUserId();
    } catch {
      return unauthorizedResponse();
    }
    const data = await request.json();
    const itemError = validateDocumentItems(data?.items ?? []);
    if (itemError)
      return NextResponse.json({ error: itemError }, { status: 400 });
    const sourceOrderError = await validateSourceOrdersForDocument(
      userId,
      data?.orderIds,
    );
    if (sourceOrderError)
      return NextResponse.json(sourceOrderError, { status: 409 });
    const currency = data?.currency === "EUR" ? "EUR" : "CHF"; // Use vatRate from client if provided, otherwise fetch from Settings, fallback 8.1%
    let vatRate = 8.1;
    if (data?.vatRate !== undefined && data.vatRate !== null) {
      vatRate = Number(data.vatRate);
    } else {
      try {
        const settings = await prisma.companySettings.findFirst({
          where: { userId },
        });
        if (settings?.mwstAktiv && settings?.mwstSatz != null)
          vatRate = Number(settings.mwstSatz);
        else if (settings && !settings.mwstAktiv) vatRate = 0;
      } catch {}
    }
    const items = data?.items ?? [];
    const { subtotal, vatAmount, total } = calculateDocumentTotals(
      items.map((item: any) => ({
        quantity: item?.quantity ?? 0,
        unitPrice: item?.unitPrice ?? 0,
      })),
      vatRate,
    );
    const validUntil = new Date();
    validUntil.setDate(validUntil.getDate() + Number(data?.validDays ?? 14));

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
            currency,
            offerDate: data?.offerDate ? new Date(data.offerDate) : new Date(),
            validUntil,
            notes: data?.notes || null,
            status: data?.status ?? "Entwurf",
            items: {
              create: items.map((item: any) => ({
                description: item?.description ?? "",
                quantity: Number(item?.quantity ?? 1),
                unit: item?.unit ?? "Stunde",
                unitPrice: roundMoney(Number(item?.unitPrice ?? 0)),
                totalPrice: calculateLineTotal(
                  item?.quantity ?? 1,
                  item?.unitPrice ?? 0,
                ),
                siteName: item?.siteName || null,
                siteAddress: item?.siteAddress || null,
                sitePlz: item?.sitePlz || null,
                siteCity: item?.siteCity || null,
                siteNote: item?.siteNote || null,
                sourceOrderId: item?.sourceOrderId || null,
              })),
            },
          },
          include: { customer: true, items: true },
        });
        break; // success
      } catch (createErr: any) {
        if (createErr?.code === "P2002" && attempt < 2) {
          console.warn(
            `[offers] P2002 collision on attempt ${attempt + 1}, retrying…`,
          );
          continue;
        }
        throw createErr;
      }
    }
    // Link orders if provided
    if (data?.orderIds?.length) {
      await prisma.order.updateMany({
        where: { id: { in: data.orderIds }, userId },
        data: { offerId: offer.id },
      });
    }
    const su = await getSessionUser();
    logAuditAsync({
      userId: su?.id,
      userEmail: su?.email,
      userRole: su?.role,
      action: "OFFER_CREATE",
      area: "OFFERS",
      targetType: "Offer",
      targetId: offer.id,
      request,
    });
    return NextResponse.json({
      ...offer,
      subtotal: roundMoney(Number(offer?.subtotal ?? 0)),
      vatAmount: roundMoney(Number(offer?.vatAmount ?? 0)),
      total: roundMoney(Number(offer?.total ?? 0)),
    });
  } catch (error: any) {
    if (error instanceof CustomerArchivedError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    console.error(error);
    return NextResponse.json(
      { error: "Fehler beim Erstellen" },
      { status: 500 },
    );
  }
}
