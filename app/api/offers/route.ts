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

const HARD_CURRENCY_SOURCE_ORDER_REVIEW_PATTERNS = [
  /^currency_/,
  /^item_currency_mismatch/,
  /^currency_conflict_item:/,
  /^currency_unsupported$/,
];

const normalizeDocumentReviewTextV17_90L36b = (value: unknown) =>
  String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const isUnresolvedSourceServiceNameV17_90L36b = (value: unknown) => {
  const key = normalizeDocumentReviewTextV17_90L36b(value);
  if (!key) return true;
  return (
    key === "leistung pruefen" ||
    key === "leistung prufen" ||
    key === "unbekannte leistung" ||
    key === "unklare leistung" ||
    key.includes("leistung suchen") ||
    key.includes("leistung eingeben")
  );
};

const isUnresolvedSourceUnitV17_90L36b = (value: unknown) => {
  const key = normalizeDocumentReviewTextV17_90L36b(value);
  if (!key) return true;
  return (
    key === "pruefen" ||
    key === "prufen" ||
    key === "einheit pruefen" ||
    key === "einheit prufen" ||
    key.includes("einheit fehlt") ||
    key.includes("einheit unklar") ||
    key.includes("unit missing") ||
    key.includes("unit unclear")
  );
};

const isSourceOrderItemResolvedForDocument = (item: any) => {
  const quantity = Number(item?.quantity ?? 0);
  const unitPrice = Number(item?.unitPrice ?? 0);
  const total = Number(item?.totalPrice ?? quantity * unitPrice);

  return (
    !isUnresolvedSourceServiceNameV17_90L36b(item?.serviceName) &&
    !isUnresolvedSourceUnitV17_90L36b(item?.unit) &&
    quantity > 0 &&
    unitPrice > 0 &&
    total > 0
  );
};

const hasActiveExecutionAddressReviewV17_90L36b = (order: any) => {
  const reasons = Array.isArray(order?.reviewReasons)
    ? order.reviewReasons.filter(Boolean)
    : [];
  const hasAddressReason = reasons.some(
    (reason: string) =>
      reason === "address_role_uncertain" ||
      reason === "customer_address_quarantined_ambiguous_role_v17_61" ||
      reason === "execution_address_incomplete" ||
      reason.startsWith("intake_address:"),
  );
  if (!hasAddressReason) return false;

  const workSites = Array.isArray(order?.workSites) ? order.workSites : [];
  const primary =
    workSites.find((site: any) => Boolean(site?.isPrimary)) ||
    workSites[0] ||
    null;
  const siteAddress = String(primary?.siteAddress || order?.siteAddress || "").trim();
  const sitePlz = String(primary?.sitePlz || order?.sitePlz || "").trim();
  const siteCity = String(primary?.siteCity || order?.siteCity || "").trim();
  const hasAnySiteValue = Boolean(siteAddress || sitePlz || siteCity);
  const siteIsComplete = Boolean(siteAddress && sitePlz && siteCity);

  // Wurde keine abweichende Ausführungsadresse gewählt und sind keine
  // Ausführungsdaten vorhanden, ist ein alter Review-Grund erledigt.
  if (!order?.siteAddressDifferent && !hasAnySiteValue) return false;
  return !siteIsComplete;
};

function sourceOrderBlockers(order: any): string[] {
  const blockers: string[] = [];
  const items = Array.isArray(order?.items) ? order.items : [];
  const reviewReasons = Array.isArray(order?.reviewReasons)
    ? order.reviewReasons.filter(Boolean)
    : [];

  if (items.length === 0) blockers.push("Keine Leistungen vorhanden");

  if (
    items.some(
      (item: any) =>
        isUnresolvedSourceServiceNameV17_90L36b(item?.serviceName) ||
        isUnresolvedSourceUnitV17_90L36b(item?.unit),
    )
  ) {
    blockers.push("Leistung/Einheit prüfen");
  }

  if (items.some((item: any) => !isSourceOrderItemResolvedForDocument(item))) {
    const hasInvalidAmount = items.some((item: any) => {
      const quantity = Number(item?.quantity ?? 0);
      const unitPrice = Number(item?.unitPrice ?? 0);
      const total = Number(item?.totalPrice ?? quantity * unitPrice);
      return quantity <= 0 || unitPrice <= 0 || total <= 0;
    });
    if (hasInvalidAmount) blockers.push("Preis/Menge prüfen");
  }

  if (
    reviewReasons.some((reason: string) =>
      HARD_CURRENCY_SOURCE_ORDER_REVIEW_PATTERNS.some((pattern) =>
        pattern.test(reason),
      ),
    )
  ) {
    blockers.push("Währung prüfen");
  }

  if (reviewReasons.includes("total_unrealistic_check")) {
    blockers.push("Betrag prüfen");
  }

  if (hasActiveExecutionAddressReviewV17_90L36b(order)) {
    blockers.push("Ausführungsadresse prüfen");
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

  // Alte intake_risk:* Diagnosen und needsReview allein sind kein Blocker.
  // Entscheidend sind nur die aktuell gespeicherten, konkreten Felder oben.
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
