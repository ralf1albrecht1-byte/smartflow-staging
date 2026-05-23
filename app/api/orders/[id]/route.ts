export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  requireUserId,
  unauthorizedResponse,
  getSessionUser,
} from "@/lib/get-session";
import { logAuditAsync } from "@/lib/audit";
import {
  assertCustomerNotArchived,
  CustomerArchivedError,
  isCustomerDataIncomplete,
} from "@/lib/customer-links";
import { buildSpecialNotes, splitSpecialNotes } from "@/lib/special-notes-utils";



type SemanticNoteMatch = {
  label: string;
  type: "safety" | "hint";
  patterns: RegExp[];
};

const normalizeSearchText = (value: unknown) =>
  String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9äöüß\s/-]/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

const semanticNoteMatches: SemanticNoteMatch[] = [
  {
    label: "Hund vor Ort",
    type: "safety",
    patterns: [
      /\bhund\b/,
      /\bdog\b/,
      /\bchien\b/,
      /\bperro\b/,
      /\bcane\b/,
      /\bcao\b/,
      /\bpis\b/,
    ],
  },
  {
    label: "Rutschiger Boden wegen Öl",
    type: "safety",
    patterns: [
      /\b(oel|ol|oil|aceite|huile|olio|oleo)\b.*\b(rutsch|slippery|glissant|resbaladiz|scivolos|escorregadi)/,
      /\b(rutsch|slippery|glissant|resbaladiz|scivolos|escorregadi)\b.*\b(oel|ol|oil|aceite|huile|olio|oleo)\b/,
    ],
  },
  {
    label: "Rutschiger Boden",
    type: "safety",
    patterns: [
      /\brutsch/,
      /\bslippery\b/,
      /\bglissant\b/,
      /\bresbaladiz/,
      /\bscivolos/,
      /\bescorregadi/,
      /\bnasser boden\b/,
      /\bwet floor\b/,
      /\bsuelo mojado\b/,
      /\bsol mouille\b/,
      /\bpavimento bagnato\b/,
    ],
  },
  {
    label: "Öl vor Ort prüfen",
    type: "safety",
    patterns: [/\b(oel|ol|oil|aceite|huile|olio|oleo)\b/],
  },
  {
    label: "Offene Stromkabel / Stromgefahr",
    type: "safety",
    patterns: [
      /\bstromkabel\b/,
      /\boffene kabel\b/,
      /\belektr.*kabel\b/,
      /\belectric(al)? wires?\b/,
      /\bexposed wires?\b/,
      /\bcables? electricos?\b/,
      /\bcables? electriques?\b/,
      /\bcavi elettric/,
      /\bcabos? eletric/,
      /\bcorriente\b/,
    ],
  },
  {
    label: "Gas-/Rauchgeruch prüfen",
    type: "safety",
    patterns: [
      /\bgasgeruch\b/,
      /\bgas smell\b/,
      /\bsmell of gas\b/,
      /\bolor a gas\b/,
      /\bodeur de gaz\b/,
      /\bodore di gas\b/,
      /\brauchgeruch\b/,
      /\bsmoke smell\b/,
      /\bodeur de fumee\b/,
    ],
  },
  {
    label: "Brand-/Feuergefahr",
    type: "safety",
    patterns: [
      /\bbrandgefahr\b/,
      /\bfeuergefahr\b/,
      /\bfire hazard\b/,
      /\brisk of fire\b/,
      /\bpeligro de incendio\b/,
      /\brisque d incendie\b/,
      /\bpericolo di incendio\b/,
      /\brisco de incendio\b/,
    ],
  },
  {
    label: "Sturzgefahr",
    type: "safety",
    patterns: [
      /\bsturzgefahr\b/,
      /\babsturzgefahr\b/,
      /\bfall hazard\b/,
      /\brisk of falling\b/,
      /\briesgo de caida\b/,
      /\brisque de chute\b/,
      /\brischio di caduta\b/,
      /\brisco de queda\b/,
    ],
  },
  {
    label: "Scherben / Schnittgefahr",
    type: "safety",
    patterns: [
      /\bscherben\b/,
      /\bglasscherben\b/,
      /\bbroken glass\b/,
      /\bshards?\b/,
      /\bvidrios? rotos?\b/,
      /\bverre casse\b/,
      /\bvetro rotto\b/,
      /\bvidro quebrado\b/,
    ],
  },
  {
    label: "Asbestverdacht",
    type: "safety",
    patterns: [/\basbest\b/, /\basbestos\b/, /\bamiante\b/, /\bamianto\b/],
  },
  {
    label: "Schimmel / Gesundheitsgefahr",
    type: "safety",
    patterns: [
      /\bschimmel\b/,
      /\bmold\b/,
      /\bmould\b/,
      /\bmoho\b/,
      /\bmoisi/,
      /\bmuffa\b/,
      /\bbolor\b/,
    ],
  },
  {
    label: "Chemikalien vor Ort",
    type: "safety",
    patterns: [
      /\bchemikal/,
      /\bchemical/,
      /\bquimic/,
      /\bchimic/,
      /\bproduit chimique\b/,
      /\bproducto quimico\b/,
    ],
  },
  {
    label: "Instabile Bauteile / Einsturzgefahr",
    type: "safety",
    patterns: [
      /\beinsturzgefahr\b/,
      /\binstabil/,
      /\bunstable\b/,
      /\bcollapse risk\b/,
      /\briesgo de derrumbe\b/,
      /\brisque d effondrement\b/,
      /\brischio di crollo\b/,
      /\brisco de colapso\b/,
    ],
  },
  {
    label: "Leiter eventuell benötigt",
    type: "hint",
    patterns: [
      /\bleiter\b/,
      /\bladder\b/,
      /\bescalera\b/,
      /\bechelle\b/,
      /\bscala\b/,
      /\bescada\b/,
    ],
  },
  {
    label: "Rückruf vor Arbeitsbeginn",
    type: "hint",
    patterns: [
      /\bruckruf\b/,
      /\bzuruckrufen\b/,
      /\banrufen\b/,
      /\bcall back\b/,
      /\bplease call\b/,
      /\bllamar\b/,
      /\bdevolver la llamada\b/,
      /\brappeler\b/,
      /\brichiamare\b/,
      /\bligar de volta\b/,
    ],
  },
  {
    label: "Schwieriger Zugang",
    type: "hint",
    patterns: [
      /\bschwieriger zugang\b/,
      /\bschwer zuganglich\b/,
      /\bkein lift\b/,
      /\bohne lift\b/,
      /\bdifficult access\b/,
      /\bno elevator\b/,
      /\bno lift\b/,
      /\bdificil acceso\b/,
      /\bsin ascensor\b/,
      /\bacces difficile\b/,
      /\bsans ascenseur\b/,
      /\baccesso difficile\b/,
      /\bsem elevador\b/,
    ],
  },
  {
    label: "Zugang über Seiteneingang",
    type: "hint",
    patterns: [
      /\bseiteneingang\b/,
      /\bside entrance\b/,
      /\bentrada lateral\b/,
      /\bentree laterale\b/,
      /\bingresso laterale\b/,
    ],
  },
  {
    label: "Parkplatz prüfen",
    type: "hint",
    patterns: [
      /\bparkplatz\b/,
      /\bparking\b/,
      /\baparcamiento\b/,
      /\bestacionamento\b/,
      /\bparcheggio\b/,
    ],
  },
  {
    label: "Schlüssel / Zugang klären",
    type: "hint",
    patterns: [
      /\bschlussel\b/,
      /\bkey\b/,
      /\bllave\b/,
      /\bcle\b/,
      /\bchiave\b/,
      /\bchave\b/,
    ],
  },
  {
    label: "Termin abstimmen",
    type: "hint",
    patterns: [
      /\btermin abstimmen\b/,
      /\bappointment\b/,
      /\bschedule\b/,
      /\bcita\b/,
      /\brendez vous\b/,
      /\bappuntamento\b/,
      /\bagendamento\b/,
    ],
  },
  {
    label: "Hanglage",
    type: "hint",
    patterns: [
      /\bhanglage\b/,
      /\bhang\b/,
      /\bslope\b/,
      /\bsteep\b/,
      /\bpendiente\b/,
      /\bpente\b/,
      /\bpendio\b/,
    ],
  },
];

function detectSemanticNotes(source: unknown) {
  const text = normalizeSearchText(source);
  const safetyWarnings: string[] = [];
  const jobHints: string[] = [];

  if (!text) return { safetyWarnings, jobHints };

  for (const match of semanticNoteMatches) {
    if (match.patterns.some((pattern) => pattern.test(text))) {
      if (match.type === "safety") safetyWarnings.push(match.label);
      else jobHints.push(match.label);
    }
  }

  return {
    safetyWarnings: Array.from(new Set(safetyWarnings)),
    jobHints: Array.from(new Set(jobHints)),
  };
}

function normalizeOrderSpecialNotes(data: any) {
  const parsed = splitSpecialNotes(data?.specialNotes);
  const itemText = Array.isArray(data?.items)
    ? data.items
        .map((item: any) =>
          [item?.serviceName, item?.description].filter(Boolean).join(" "),
        )
        .join("\n")
    : "";

  const sourceText = [
    data?.description,
    data?.serviceName,
    data?.notes,
    data?.specialNotes,
    data?.audioTranscript,
    itemText,
  ]
    .filter(Boolean)
    .join("\n");

  const detectedAll = detectSemanticNotes(sourceText);

  const existingSafety = parsed.safetyWarnings.flatMap((line) => {
    const detectedLine = detectSemanticNotes(line).safetyWarnings;
    return detectedLine.length > 0 ? detectedLine : [line];
  });

  const existingJobHints = parsed.jobHints.flatMap((line) => {
    const detectedLine = detectSemanticNotes(line);
    if (detectedLine.safetyWarnings.length > 0) return [];
    return detectedLine.jobHints.length > 0 ? detectedLine.jobHints : [line];
  });

  const nextSafetyWarnings = Array.from(
    new Set([...existingSafety, ...detectedAll.safetyWarnings]),
  );
  const nextJobHints = Array.from(
    new Set([...existingJobHints, ...detectedAll.jobHints]),
  );

  if (
    nextSafetyWarnings.length === 0 &&
    nextJobHints.length === 0 &&
    parsed.systemHints.length === 0
  ) {
    return data?.specialNotes ?? null;
  }

  return buildSpecialNotes({
    safetyWarnings: nextSafetyWarnings,
    jobHints: nextJobHints,
    systemHints: parsed.systemHints,
  });
}

/** Legacy-safe VAT normalizer: see app/api/orders/route.ts for the reasoning. */
function normalizeOrderVat(o: any) {
  const totalPrice = Number(o?.totalPrice ?? 0);
  const vatRate = o?.vatRate == null ? 8.1 : Number(o.vatRate);
  const storedVatAmount = Number(o?.vatAmount ?? 0);
  const storedTotal = Number(o?.total ?? 0);
  const computedVatAmount = (totalPrice * vatRate) / 100;
  const computedTotal = totalPrice + computedVatAmount;
  const useComputed = storedTotal === 0 && totalPrice > 0;
  return {
    vatRate,
    vatAmount: useComputed ? computedVatAmount : storedVatAmount,
    total: useComputed ? computedTotal : storedTotal,
  };
}

export async function GET(
  request: Request,
  { params }: { params: { id: string } },
) {
  let userId: string;
  try {
    userId = await requireUserId();
  } catch {
    return unauthorizedResponse();
  }
  try {
    const order = await prisma.order.findFirst({
      where: { id: params?.id, userId },
      include: { customer: true, items: true },
    });
    if (!order)
      return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
    return NextResponse.json({
      ...order,
      totalPrice: Number(order?.totalPrice ?? 0),
      unitPrice: Number(order?.unitPrice ?? 0),
      quantity: Number(order?.quantity ?? 0),
      currency: order?.currency === "EUR" ? "EUR" : "CHF",
      ...normalizeOrderVat(order),
      items: (order?.items ?? []).map((item: any) => ({
        ...item,
        unitPrice: Number(item?.unitPrice ?? 0),
        quantity: Number(item?.quantity ?? 0),
        totalPrice: Number(item?.totalPrice ?? 0),
      })),
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
  let userId: string;
  try {
    userId = await requireUserId();
  } catch {
    return unauthorizedResponse();
  }
  try {
    const existing = await prisma.order.findFirst({
      where: { id: params?.id, userId },
    });
    if (!existing)
      return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
    const data = await request.json();
    const shouldNormalizeSpecialNotes =
      data?.specialNotes !== undefined ||
      data?.notes !== undefined ||
      data?.audioTranscript !== undefined ||
      data?.description !== undefined ||
      data?.serviceName !== undefined ||
      data?.items !== undefined;
    const normalizedSpecialNotes = shouldNormalizeSpecialNotes
      ? normalizeOrderSpecialNotes({
          ...existing,
          ...data,
          specialNotes:
            data?.specialNotes !== undefined
              ? data.specialNotes
              : existing?.specialNotes,
          notes: data?.notes !== undefined ? data.notes : existing?.notes,
          audioTranscript:
            data?.audioTranscript !== undefined
              ? data.audioTranscript
              : existing?.audioTranscript,
          description:
            data?.description !== undefined
              ? data.description
              : existing?.description,
          serviceName:
            data?.serviceName !== undefined
              ? data.serviceName
              : existing?.serviceName,
        })
      : undefined;
    const currency = data?.currency === "EUR" ? "EUR" : undefined;
    const items = data?.items as any[] | undefined;
    let totalPrice = 0;
    let primaryServiceName = data?.serviceName;
    let primaryPriceType = data?.priceType;
    // Only set price/quantity when caller explicitly provided them — prevents
    // overwriting existing DB values with defaults on partial updates (e.g. customerId-only).
    let primaryUnitPrice: number | undefined =
      data?.unitPrice !== undefined ? Number(data.unitPrice) : undefined;
    let primaryQuantity: number | undefined =
      data?.quantity !== undefined ? Number(data.quantity) : undefined;
    if (items && items.length > 0) {
      totalPrice = items.reduce(
        (sum: number, item: any) =>
          sum + Number(item.unitPrice ?? 0) * Number(item.quantity ?? 1),
        0,
      );
      primaryServiceName = items[0].serviceName ?? primaryServiceName;
      primaryPriceType = items[0].unit ?? primaryPriceType;
      primaryUnitPrice = Number(items[0].unitPrice ?? 0);
      primaryQuantity = Number(items[0].quantity ?? 1);
    } else if (
      primaryUnitPrice !== undefined ||
      primaryQuantity !== undefined
    ) {
      // Only recalculate totalPrice when price fields are explicitly provided
      const up = primaryUnitPrice ?? Number(existing?.unitPrice ?? 0);
      const qty = primaryQuantity ?? Number(existing?.quantity ?? 1);
      totalPrice = qty * up;
    }
    if (items) {
      await prisma.orderItem.deleteMany({ where: { orderId: params?.id } });
    }

    // Resolve VAT rate for this update.
    //  - If the client explicitly sent `vatRate`, that value always wins (incl. 0 = disabled).
    //  - Else: keep whatever the existing row had (never silently reset on a partial update).
    //  - Only a brand-new order with no prior VAT value would fall back to settings; this PUT
    //    branch is for existing orders so we prefer existing.vatRate.
    let effectiveVatRate: number;
    if (data?.vatRate !== undefined && data.vatRate !== null) {
      effectiveVatRate = Number(data.vatRate);
      if (!isFinite(effectiveVatRate) || effectiveVatRate < 0)
        effectiveVatRate = 0;
    } else {
      effectiveVatRate =
        existing?.vatRate == null ? 8.1 : Number(existing.vatRate);
    }

    // Re-derive net totalPrice when items or price fields are (re)computed;
    // else carry forward existing net. Pure metadata updates (e.g. customerId-only)
    // must NOT recalculate or overwrite existing price/total values.
    const hasItemsField = Array.isArray(items);
    const hasPriceFields =
      primaryUnitPrice !== undefined || primaryQuantity !== undefined;
    const shouldRecalculate =
      hasItemsField || hasPriceFields || data?.vatRate !== undefined;
    const netTotal = hasItemsField
      ? totalPrice
      : hasPriceFields
        ? totalPrice
        : Number(existing?.totalPrice ?? 0);
    const effectiveVatAmount = shouldRecalculate
      ? (netTotal * effectiveVatRate) / 100
      : undefined;
    const effectiveTotal = shouldRecalculate
      ? netTotal + (effectiveVatAmount ?? 0)
      : undefined;

    // Guard: reject reassignment to an archived customer
    if (data?.customerId && data.customerId !== existing.customerId) {
      await assertCustomerNotArchived(prisma, data.customerId);
    }

    const order = await prisma.order.update({
      where: { id: params?.id },
      data: {
        customerId: data?.customerId,
        description: data?.description,
        serviceName: primaryServiceName,
        status: data?.status,
        priceType: primaryPriceType,
        unitPrice: primaryUnitPrice,
        quantity: primaryQuantity,
        ...(currency ? { currency } : {}),
        // totalPrice only updates if items or price fields were provided
        ...(hasItemsField || hasPriceFields ? { totalPrice } : {}),
        // VAT only re-persists when prices/items/vatRate changed — not on metadata-only updates
      ...(shouldRecalculate
  ? { vatRate: effectiveVatRate, vatAmount: effectiveVatAmount, total: effectiveTotal }
  : {}),
currency: data?.currency === 'EUR' ? 'EUR' : data?.currency === 'CHF' ? 'CHF' : undefined,
siteAddressDifferent:
  data?.siteAddressDifferent !== undefined
    ? Boolean(data.siteAddressDifferent)
    : undefined,
siteName: data?.siteName !== undefined ? data.siteName?.trim() || null : undefined,
siteAddress:
  data?.siteAddress !== undefined ? data.siteAddress?.trim() || null : undefined,
sitePlz: data?.sitePlz !== undefined ? data.sitePlz?.trim() || null : undefined,
siteCity:
  data?.siteCity !== undefined ? data.siteCity?.trim() || null : undefined,
siteNote:
  data?.siteNote !== undefined ? data.siteNote?.trim() || null : undefined,
date: data?.date ? new Date(data.date) : undefined,
        notes: data?.notes,
        specialNotes: normalizedSpecialNotes,
        needsReview:
          data?.needsReview !== undefined ? data.needsReview : undefined,
        reviewReasons:
          data?.reviewReasons !== undefined ? data.reviewReasons : undefined,
        hinweisLevel:
          data?.hinweisLevel !== undefined ? data.hinweisLevel : undefined,
        mediaUrl: data?.mediaUrl !== undefined ? data.mediaUrl : undefined,
        mediaType: data?.mediaType !== undefined ? data.mediaType : undefined,
        imageUrls: data?.imageUrls !== undefined ? data.imageUrls : undefined,
        audioTranscript:
          data?.audioTranscript !== undefined
            ? data.audioTranscript
            : undefined,
        ...(items && items.length > 0
          ? {
              items: {
                create: items.map((item: any) => ({
                  serviceName: item.serviceName ?? "",
                  description: item.description ?? "",
                  quantity: Number(item.quantity ?? 1),
                  unit: item.unit ?? "Stunde",
                  unitPrice: Number(item.unitPrice ?? 0),
                  totalPrice:
                    Number(item.unitPrice ?? 0) * Number(item.quantity ?? 1),
                })),
              },
            }
          : {}),
      },
      include: { customer: true, items: true },
    });
    const su = await getSessionUser();
    logAuditAsync({
      userId: su?.id,
      userEmail: su?.email,
      userRole: su?.role,
      action: "ORDER_UPDATE",
      area: "ORDERS",
      targetType: "Order",
      targetId: params?.id,
      request,
    });

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
        data: { needsReview: false, reviewReasons: [], hinweisLevel: "none" },
        include: { customer: true, items: true },
      });
      logAuditAsync({
        userId: su?.id,
        userEmail: su?.email,
        userRole: su?.role,
        action: "ORDER_REVIEW_CLEARED",
        area: "ORDERS",
        targetType: "Order",
        targetId: params?.id,
        details: { reason: "customer_data_complete" },
        request,
      });
    }

    return NextResponse.json({
      ...finalOrder,
      totalPrice: Number(finalOrder?.totalPrice ?? 0),
      vatRate: Number(finalOrder?.vatRate ?? 0),
      vatAmount: Number(finalOrder?.vatAmount ?? 0),
      total: Number(finalOrder?.total ?? 0),
      currency: finalOrder?.currency === "EUR" ? "EUR" : "CHF",
      items: (finalOrder?.items ?? []).map((item: any) => ({
        ...item,
        unitPrice: Number(item?.unitPrice ?? 0),
        quantity: Number(item?.quantity ?? 0),
        totalPrice: Number(item?.totalPrice ?? 0),
      })),
    });
  } catch (error: any) {
    if (error instanceof CustomerArchivedError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    console.error(error);
    return NextResponse.json({ error: "Fehler" }, { status: 500 });
  }
}


const FALLBACK_CUSTOMER_NAMES = new Set([
  "",
  "-",
  "--",
  "name fehlt",
  "kunde fehlt",
  "kunde ohne name",
  "kunde ohne namen",
  "kunde nicht zugeordnet",
  "nicht zugeordnet",
  "unbekannter kunde",
  "unbekannt",
  "unknown",
]);

const isDisposableEmptyCustomer = (customer: any) => {
  if (!customer) return false;

  const normalizedName = normalizeSearchText(customer?.name);
  const hasUsefulName =
    !!normalizedName &&
    !FALLBACK_CUSTOMER_NAMES.has(normalizedName) &&
    !/^k-?\d+$/i.test(normalizedName);

  // Only visible master-data fields make a customer real.
  // Customer notes alone must not keep an otherwise empty dummy customer alive,
  // because parser/test flows can leave hidden notes on fallback customers.
  const hasRealData = [
    customer?.address,
    customer?.plz,
    customer?.city,
    customer?.phone,
    customer?.email,
  ].some((value) => String(value ?? "").trim().length > 0);

  return !hasUsefulName && !hasRealData;
};

const cleanupEmptyCustomerAfterOrderDelete = async (
  customerId: string | null | undefined,
  deletedOrderId: string,
  userId: string,
  request: Request,
) => {
  // Safety: this cleanup is scoped to the exact customerId linked to the deleted
  // order. It never searches/deletes by display name such as "Kunde ohne Name",
  // because multiple dummy customers can share that label.
  if (!customerId) return null;

  const customer = await prisma.customer.findFirst({
    where: { id: customerId, userId, deletedAt: null },
    select: {
      id: true,
      customerNumber: true,
      name: true,
      address: true,
      plz: true,
      city: true,
      phone: true,
      email: true,
      notes: true,
    },
  });

  if (!customer || !isDisposableEmptyCustomer(customer)) return null;

  const [remainingOrders, remainingOffers, remainingInvoices] = await Promise.all([
    prisma.order.count({
      where: {
        customerId,
        userId,
        deletedAt: null,
        id: { not: deletedOrderId },
      },
    }),
    prisma.offer.count({
      where: { customerId, userId, deletedAt: null },
    }),
    prisma.invoice.count({
      where: { customerId, userId, deletedAt: null },
    }),
  ]);

  if (remainingOrders > 0 || remainingOffers > 0 || remainingInvoices > 0) {
    return null;
  }

  await prisma.customer.update({
    where: { id: customerId },
    data: { deletedAt: new Date() },
  });

  const su = await getSessionUser();
  logAuditAsync({
    userId: su?.id,
    userEmail: su?.email,
    userRole: su?.role,
    action: "CUSTOMER_AUTO_DELETE_EMPTY_AFTER_ORDER_DELETE",
    area: "CUSTOMERS",
    targetType: "Customer",
    targetId: customerId,
    details: {
      orderId: deletedOrderId,
      customerNumber: customer.customerNumber,
      reason: "empty_customer_without_remaining_records",
    },
    request,
  });

  return customer;
};

export async function DELETE(
  request: Request,
  { params }: { params: { id: string } },
) {
  let userId: string;
  try {
    userId = await requireUserId();
  } catch {
    return unauthorizedResponse();
  }
  try {
    const existing = await prisma.order.findFirst({
      where: { id: params?.id, userId },
    });
    if (!existing)
      return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
    await prisma.order.update({
      where: { id: params?.id },
      data: { deletedAt: new Date() },
    });

    const removedEmptyCustomer = await cleanupEmptyCustomerAfterOrderDelete(
      existing.customerId,
      params?.id,
      userId,
      request,
    );

    const su = await getSessionUser();
    logAuditAsync({
      userId: su?.id,
      userEmail: su?.email,
      userRole: su?.role,
      action: "ORDER_DELETE",
      area: "ORDERS",
      targetType: "Order",
      targetId: params?.id,
      details: removedEmptyCustomer
        ? {
            removedEmptyCustomerId: removedEmptyCustomer.id,
            removedEmptyCustomerNumber: removedEmptyCustomer.customerNumber,
          }
        : undefined,
      request,
    });
    return NextResponse.json({
      success: true,
      removedEmptyCustomer: Boolean(removedEmptyCustomer),
      removedEmptyCustomerNumber: removedEmptyCustomer?.customerNumber ?? null,
    });
  } catch (error: any) {
    console.error(error);
    return NextResponse.json({ error: "Fehler" }, { status: 500 });
  }
}
