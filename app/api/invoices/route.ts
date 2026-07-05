export const dynamic = "force-dynamic";
// SMARTFLOW_V17_90L371CF_INVOICE_ROOT_ITEM_HARD_OVERRIDE
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { normalizePositionType, getPositionBlockingIssues } from "@/lib/position-types";
import { getActiveDataScope, type DataScope } from "@/lib/data-scope";
import { generateInvoiceNumber } from "@/lib/doc-numbers";
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
import {
  buildDocumentCustomerSnapshot,
  DOCUMENT_CUSTOMER_SELECT,
  isCustomerSnapshotStatus,
  withDocumentCustomerSnapshot,
} from "@/lib/document-customer-snapshot";

const DEFAULT_PAYMENT_DAYS = 14;
const MIN_PAYMENT_DAYS = 1;
const MAX_PAYMENT_DAYS = 365;

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
    blockers.push("Position/Einheit prüfen");
  }

  const positionIssueLabels = items.flatMap((item: any) => getPositionBlockingIssues(item));
  if (positionIssueLabels.length > 0) {
    blockers.push(...positionIssueLabels.map((issue: string) => `Position prüfen: ${issue}`));
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
  dataScope: DataScope,
  orderIds: unknown,
) {
  const ids = Array.isArray(orderIds)
    ? orderIds.map((id) => String(id || "").trim()).filter(Boolean)
    : [];
  if (ids.length === 0) return null;

  const orders = await prisma.order.findMany({
    where: { id: { in: ids }, userId, dataScope, deletedAt: null },
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

function normalizePaymentDays(value: unknown): number | null {
  const days = Number(value);
  if (!Number.isInteger(days)) return null;
  if (days < MIN_PAYMENT_DAYS || days > MAX_PAYMENT_DAYS) return null;
  return days;
}

async function resolvePaymentDays(userId: string, requestedValue: unknown) {
  const requested = normalizePaymentDays(requestedValue);
  if (requested !== null) return requested;

  try {
    const stored = await prisma.counter.findUnique({
      where: { name: `invoice-payment-days:${userId}` },
      select: { value: true },
    });
    return normalizePaymentDays(stored?.value) ?? DEFAULT_PAYMENT_DAYS;
  } catch {
    return DEFAULT_PAYMENT_DAYS;
  }
}

function parseInvoiceDateInput(value: unknown): Date | null {
  if (!value) return null;
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}


const compactInvoiceRouteText = (value: unknown) =>
  String(value ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

function getPrimarySourceOrderSiteForInvoice(order: any) {
  const workSites = Array.isArray(order?.workSites)
    ? [...order.workSites].sort(
        (a: any, b: any) =>
          Number(Boolean(b?.isPrimary)) - Number(Boolean(a?.isPrimary)) ||
          Number(a?.sortOrder ?? 0) - Number(b?.sortOrder ?? 0),
      )
    : [];
  const primary = workSites[0] || null;
  const site = {
    siteName: compactInvoiceRouteText(primary?.siteName || order?.siteName) || null,
    siteAddress: compactInvoiceRouteText(primary?.siteAddress || order?.siteAddress) || null,
    sitePlz: compactInvoiceRouteText(primary?.sitePlz || order?.sitePlz) || null,
    siteCity: compactInvoiceRouteText(primary?.siteCity || order?.siteCity) || null,
    siteNote: compactInvoiceRouteText(primary?.siteNote || order?.siteNote) || null,
    sourceOrderId: primary?.sourceOrderId || order?.id || null,
  };
  return site.siteName || site.siteAddress || site.sitePlz || site.siteCity || site.siteNote
    ? site
    : null;
}

async function loadSourceOrdersForInvoiceCreation(
  userId: string,
  dataScope: DataScope,
  orderIds: unknown,
) {
  const ids = Array.isArray(orderIds)
    ? Array.from(new Set(orderIds.map((id) => String(id || "").trim()).filter(Boolean)))
    : [];
  if (ids.length === 0) return [];
  return prisma.order.findMany({
    where: { id: { in: ids }, userId, dataScope, deletedAt: null },
    include: {
      workSites: true,
      items: { include: { workSite: true } },
    },
  });
}

const normalizeInvoiceItemMatchText = (value: unknown) =>
  compactInvoiceRouteText(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

function findMatchingInvoiceSourceOrderItem(
  order: any,
  item: any,
  index: number,
  totalItems: number,
) {
  const sourceItems = Array.isArray(order?.items) ? order.items : [];
  if (sourceItems.length === 0) return null;
  const descriptionKey = normalizeInvoiceItemMatchText(item?.description);
  const quantity = Number(item?.quantity ?? 0);
  const unitPrice = Number(item?.unitPrice ?? 0);
  const exact = sourceItems.find((sourceItem: any) => {
    const sourceKey = normalizeInvoiceItemMatchText(
      sourceItem?.serviceName || sourceItem?.description,
    );
    return (
      sourceKey === descriptionKey &&
      Number(sourceItem?.quantity ?? 0) === quantity &&
      Number(sourceItem?.unitPrice ?? 0) === unitPrice
    );
  });
  if (exact) return exact;
  const numericMatches = sourceItems.filter(
    (sourceItem: any) =>
      Number(sourceItem?.quantity ?? 0) === quantity &&
      Number(sourceItem?.unitPrice ?? 0) === unitPrice,
  );
  if (numericMatches.length === 1) return numericMatches[0];
  return sourceItems.length === totalItems ? sourceItems[index] || null : null;
}

function enrichInvoiceItemsFromSourceOrders(items: any[], sourceOrders: any[]) {
  const byId = new Map(sourceOrders.map((order: any) => [String(order.id), order]));
  const singleOrder = sourceOrders.length === 1 ? sourceOrders[0] : null;
  return items.map((item: any, index: number) => {
    const explicitOrderId = compactInvoiceRouteText(item?.sourceOrderId);
    const sourceOrder = (explicitOrderId ? byId.get(explicitOrderId) : null) || singleOrder;
    const sourceItem = sourceOrder
      ? findMatchingInvoiceSourceOrderItem(sourceOrder, item, index, items.length)
      : null;

    // SMARTFLOW_V17_90L371CF_INVOICE_ROOT_ITEM_HARD_OVERRIDE:
    // Eine Angebot-/Auftragsposition ohne Arbeitsortdaten ist eine Root-/Rechnungsadresse-Position.
    // Wenn die passende Quellposition ebenfalls keine workSite hat, darf sie beim Erstellen der
    // Rechnung NICHT mit dem ersten/primären Ausführungsort aufgefüllt werden.
    // Vorher landete z. B. "Briefkasten reinigen" aus der Rechnungsadresse falsch bei Werkstatt West.
    const sourceItemIsBillingRoot = Boolean(sourceItem) && !sourceItem?.workSite;
    const sourceSite = sourceItem?.workSite
      ? {
          siteName: compactInvoiceRouteText(sourceItem.workSite.siteName) || null,
          siteAddress: compactInvoiceRouteText(sourceItem.workSite.siteAddress) || null,
          sitePlz: compactInvoiceRouteText(sourceItem.workSite.sitePlz) || null,
          siteCity: compactInvoiceRouteText(sourceItem.workSite.siteCity) || null,
          siteNote: compactInvoiceRouteText(sourceItem.workSite.siteNote) || null,
          sourceOrderId: sourceItem.workSite.sourceOrderId || sourceOrder?.id || null,
        }
      : sourceItemIsBillingRoot
        ? null
        : sourceOrder
          ? getPrimarySourceOrderSiteForInvoice(sourceOrder)
          : null;

    const itemSiteName = compactInvoiceRouteText(item?.siteName);
    const itemSiteAddress = compactInvoiceRouteText(item?.siteAddress);
    const itemSitePlz = compactInvoiceRouteText(item?.sitePlz);
    const itemSiteCity = compactInvoiceRouteText(item?.siteCity);
    const itemSiteNote = compactInvoiceRouteText(item?.siteNote);

    // SMARTFLOW_V17_90L371CF_INVOICE_ROOT_ITEM_HARD_OVERRIDE:
    // Wenn die echte Quellposition Root/Rechnungsadresse ist, gewinnt diese Quelle
    // gegen eventuell vom Frontend bereits falsch vorausgefüllte Arbeitsortdaten.
    // Sonst bleibt eine Root-Position trotz API-Guard weiterhin bei Werkstatt West hängen.
    if (sourceItemIsBillingRoot) {
      return {
        ...item,
        siteName: null,
        siteAddress: null,
        sitePlz: null,
        siteCity: null,
        siteNote: null,
        sourceOrderId: explicitOrderId || sourceOrder?.id || null,
      };
    }

    return {
      ...item,
      siteName: itemSiteName || sourceSite?.siteName || null,
      siteAddress: itemSiteAddress || sourceSite?.siteAddress || null,
      sitePlz: itemSitePlz || sourceSite?.sitePlz || null,
      siteCity: itemSiteCity || sourceSite?.siteCity || null,
      siteNote: itemSiteNote || sourceSite?.siteNote || null,
      sourceOrderId: explicitOrderId || sourceSite?.sourceOrderId || sourceOrder?.id || null,
    };
  });
}

export async function GET(request: Request) {
  let userId: string;
  try {
    userId = await requireUserId();
  } catch {
    return unauthorizedResponse();
  }
  try {
    const dataScope = await getActiveDataScope(userId);
    const url = new URL(request.url);
    const statusFilter = url.searchParams.get("status");
    const where: any = { deletedAt: null, userId, dataScope };
    if (statusFilter) where.status = statusFilter;
    const invoices = await prisma.invoice.findMany({
      where,
      orderBy: { invoiceDate: "desc" },
      include: {
        customer: true,
        items: true,
        orders: {
          where: { dataScope },
          select: {
            id: true,
            originOrderIds: true,
            reviewReasons: true,
            createdAt: true,
            date: true,
            mediaUrl: true,
            mediaType: true,
            imageUrls: true,
            thumbnailUrls: true,
            audioTranscript: true,
            audioDurationSec: true,
            audioTranscriptionStatus: true,
            notes: true,
            specialNotes: true,
            intakeSchemaVersion: true,
            intakeSnapshot: true,
            needsReview: true,
            hinweisLevel: true,
            description: true,
            siteAddressDifferent: true,
            siteName: true,
            siteAddress: true,
            sitePlz: true,
            siteCity: true,
            siteNote: true,
            customer: {
              select: { name: true, phone: true, email: true },
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
          },
        },
      },
    });
    // Enrich with source offer number for traceability
    const offerIds = invoices.map((i: any) => i.sourceOfferId).filter(Boolean);
    let offerMap: Record<string, string> = {};
    if (offerIds.length > 0) {
      const offers = await prisma.offer.findMany({
        where: { id: { in: offerIds }, userId, dataScope },
        select: { id: true, offerNumber: true },
      });
      offerMap = Object.fromEntries(
        offers.map((o: any) => [o.id, o.offerNumber]),
      );
    }
    return NextResponse.json(
      invoices?.map((i: any) => {
        const document = withDocumentCustomerSnapshot(i, "invoice");
        return {
          ...document,
          subtotal: roundMoney(Number(document?.subtotal ?? 0)),
          vatAmount: roundMoney(Number(document?.vatAmount ?? 0)),
          total: roundMoney(Number(document?.total ?? 0)),
          sourceOfferNumber: document.sourceOfferId
            ? offerMap[document.sourceOfferId] || null
            : null,
        };
      }) ?? [],
    );
  } catch (error: any) {
    console.error(error);
    return NextResponse.json([], { status: 500 });
  }
}

export async function POST(request: Request) {
  let userId: string;
  try {
    userId = await requireUserId();
  } catch {
    return unauthorizedResponse();
  }
  try {
    const dataScope = await getActiveDataScope(userId);
    const data = await request.json();
    const itemError = validateDocumentItems(data?.items ?? []);
    if (itemError)
      return NextResponse.json({ error: itemError }, { status: 400 });
    const sourceOrderError = await validateSourceOrdersForDocument(
      userId,
      dataScope,
      data?.orderIds,
    );
    if (sourceOrderError)
      return NextResponse.json(sourceOrderError, { status: 409 });
    const currency = data?.currency === "EUR" ? "EUR" : "CHF";
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
    const sourceOrders = await loadSourceOrdersForInvoiceCreation(
      userId,
      dataScope,
      data?.orderIds,
    );
    const items = enrichInvoiceItemsFromSourceOrders(
      data?.items ?? [],
      sourceOrders,
    );
    const { subtotal, vatAmount, total } = calculateDocumentTotals(
      items.map((item: any) => ({
        quantity: item?.quantity ?? 0,
        unitPrice: item?.unitPrice ?? 0,
      })),
      vatRate,
    );
    const invoiceDate = parseInvoiceDateInput(data?.invoiceDate) ?? new Date();
    const requestedDueDate = parseInvoiceDateInput(data?.dueDate);
    const paymentDays = await resolvePaymentDays(userId, data?.paymentDays);
    const dueDate = requestedDueDate ?? new Date(invoiceDate);

    if (!requestedDueDate) {
      dueDate.setDate(dueDate.getDate() + paymentDays);
    }

    if (dueDate.getTime() < invoiceDate.getTime()) {
      return NextResponse.json(
        { error: "Das Fälligkeitsdatum darf nicht vor dem Rechnungsdatum liegen." },
        { status: 400 },
      );
    }

    // Guard: reject creation linked to an archived customer and load the
    // exact customer state used for a possible historical snapshot.
    let activeCustomer: any = null;
    if (data?.customerId) {
      activeCustomer = await prisma.customer.findFirst({
        where: { id: data.customerId, userId, dataScope, deletedAt: null },
        select: DOCUMENT_CUSTOMER_SELECT,
      });
      if (!activeCustomer) {
        return NextResponse.json({ error: "Kunde gehört nicht zum aktiven TEST-/LIVE-Bestand oder liegt im Papierkorb." }, { status: 409 });
      }
      await assertCustomerNotArchived(prisma, data.customerId);
    }

    const requestedStatus = String(data?.status ?? "Entwurf");
    const requestedCustomerSnapshot =
      activeCustomer && isCustomerSnapshotStatus("invoice", requestedStatus)
        ? buildDocumentCustomerSnapshot(activeCustomer)
        : null;
    const customerSnapshotData = requestedCustomerSnapshot
      ? {
          customerSnapshot: requestedCustomerSnapshot,
          customerSnapshotAt: new Date(),
          ...(requestedStatus === "Erledigt"
            ? {
                archivedCustomerSnapshot: requestedCustomerSnapshot,
                archivedCustomerSnapshotAt: new Date(),
              }
            : {}),
        }
      : {};

    // Source offer must belong to the same active TEST/LIVE scope.
    if (data?.sourceOfferId) {
      const sourceOffer = await prisma.offer.findFirst({
        where: { id: data.sourceOfferId, userId, dataScope, deletedAt: null },
        select: { id: true },
      });
      if (!sourceOffer) {
        return NextResponse.json({ error: "Angebot gehört nicht zum aktiven TEST-/LIVE-Bestand oder liegt im Papierkorb." }, { status: 409 });
      }

      // Duplicate guard: if an invoice already exists for this sourceOfferId, return it.
      // V17.90L277: The source offer keeps its exact pre-conversion status while
      // hidden by the active invoice link. Never rewrite the offer status here.
      const existing = await prisma.invoice.findFirst({
        where: { sourceOfferId: data.sourceOfferId, userId, dataScope, deletedAt: null },
        include: { customer: true, items: true },
      });
      if (existing) {
        const responseExisting = withDocumentCustomerSnapshot(
          existing,
          "invoice",
        );
        return NextResponse.json({
          ...responseExisting,
          subtotal: roundMoney(Number(responseExisting.subtotal ?? 0)),
          vatAmount: roundMoney(Number(responseExisting.vatAmount ?? 0)),
          total: roundMoney(Number(responseExisting.total ?? 0)),
          existed: true,
        });
      }
    }

    // V17.90L193: Rechnung, Auftragsverknüpfung und Angebotsweiterführung
    // werden gemeinsam gespeichert. So entsteht nie eine sichtbare Kopie,
    // falls ein nachgelagerter Schritt fehlschlägt.
    let invoice: any = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      const invoiceNumber = await generateInvoiceNumber(userId);
      try {
        invoice = await prisma.$transaction(async (tx) => {
          const createdInvoice = await tx.invoice.create({
            data: {
              invoiceNumber,
              customerId: data?.customerId,
              subtotal,
              vatRate,
              vatAmount,
              total,
              currency,
              invoiceDate,
              dueDate,
              notes: data?.notes || null,
              status: requestedStatus,
              ...customerSnapshotData,
              sourceOfferId: data?.sourceOfferId ?? null,
              userId,
              dataScope,
              items: {
                create: items.map((item: any) => ({
                  description: item?.description ?? "",
                  positionType: normalizePositionType(item?.positionType),
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

          if (data?.orderIds?.length) {
            await tx.order.updateMany({
              where: { id: { in: data.orderIds }, userId, dataScope },
              data: { invoiceId: createdInvoice.id },
            });
          }

          // V17.90L277: Do not mutate the source offer status when moving
          // forward to an invoice. The active sourceOfferId link hides the offer,
          // and its original status remains available for an exact rollback.

          return createdInvoice;
        });
        break;
      } catch (createErr: any) {
        if (createErr?.code === "P2002" && attempt < 2) {
          console.warn(
            `[invoices] P2002 collision on attempt ${attempt + 1}, retrying…`,
          );
          continue;
        }
        throw createErr;
      }
    }
    const su = await getSessionUser();
    logAuditAsync({
      userId: su?.id,
      userEmail: su?.email,
      userRole: su?.role,
      action: "INVOICE_CREATE",
      area: "INVOICES",
      targetType: "Invoice",
      targetId: invoice.id,
      request,
    });
    const responseInvoice = withDocumentCustomerSnapshot(invoice, "invoice");
    return NextResponse.json({
      ...responseInvoice,
      subtotal: roundMoney(Number(responseInvoice?.subtotal ?? 0)),
      vatAmount: roundMoney(Number(responseInvoice?.vatAmount ?? 0)),
      total: roundMoney(Number(responseInvoice?.total ?? 0)),
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
