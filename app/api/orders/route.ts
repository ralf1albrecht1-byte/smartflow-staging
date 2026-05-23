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
    patterns: [/\bschimmel\b/, /\bmold\b/, /\bmould\b/, /\bmoho\b/, /\bmoisi/, /\bmuffa\b/, /\bbolor\b/],
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
        .map((item: any) => [item?.serviceName, item?.description].filter(Boolean).join(" "))
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

/**
 * VAT persistence on Order (since 2026-04-18):
 *   - vatRate / vatAmount / total are stored columns (see prisma/schema.prisma).
 *   - totalPrice remains the NETTO subtotal (unchanged meaning).
 *   - For legacy orders that existed before the VAT columns were added, the
 *     column defaults (8.1 / 0 / 0) mean `vatAmount` and `total` may be 0 even
 *     though `totalPrice` has a value. We compute a safe fallback on read so
 *     old rows display correctly without rewriting them.
 */
function roundMoney(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Number((Math.round((value + Number.EPSILON) * 100) / 100).toFixed(2));
}

function calculateVatTotals(netValue: number, vatRateValue: number) {
  const totalPrice = roundMoney(Number(netValue ?? 0));
  const vatRate = Number.isFinite(vatRateValue) && vatRateValue > 0 ? vatRateValue : 0;
  const vatAmount = roundMoney((totalPrice * vatRate) / 100);
  const total = roundMoney(totalPrice + vatAmount);

  return {
    totalPrice,
    vatRate,
    vatAmount,
    total,
  };
}

function normalizeOrderVat(o: any) {
  const totalPrice = Number(o?.totalPrice ?? 0);
  const vatRate = o?.vatRate == null ? 8.1 : Number(o.vatRate);
  // If vatAmount/total were never written (legacy rows default to 0), recompute.
  const storedVatAmount = Number(o?.vatAmount ?? 0);
  const storedTotal = Number(o?.total ?? 0);
const computed = calculateVatTotals(totalPrice, vatRate);

// Heuristic:
// - alte Datensätze mit total = 0 neu berechnen
// - falsch gerundete gespeicherte Werte ebenfalls beim Lesen korrigiert anzeigen
const storedVatRounded = roundMoney(storedVatAmount);
const storedTotalRounded = roundMoney(storedTotal);

const storedLooksWrong =
  Math.abs(storedVatRounded - computed.vatAmount) >= 0.005 ||
  Math.abs(storedTotalRounded - computed.total) >= 0.005;

const useComputed = (storedTotal === 0 && totalPrice > 0) || storedLooksWrong;

return {
  vatRate: computed.vatRate,
  vatAmount: useComputed ? computed.vatAmount : storedVatRounded,
  total: useComputed ? computed.total : storedTotalRounded,
};}

export async function GET(request: Request) {
  let userId: string;
  try {
    userId = await requireUserId();
  } catch {
    return unauthorizedResponse();
  }
  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams?.get("status");
    const where: any = { deletedAt: null, userId };
    if (status && status !== "Alle") where.status = status;
    const orders = await prisma.order.findMany({
      where,
      orderBy: { date: "desc" },
      include: {
        customer: {
          select: {
            id: true,
            name: true,
            phone: true,
            email: true,
            address: true,
            plz: true,
            city: true,
            customerNumber: true,
          },
        },
        items: true,
      },
    });
    return NextResponse.json(
      orders?.map((o: any) => ({
        ...o,
        totalPrice: Number(o?.totalPrice ?? 0),
        unitPrice: Number(o?.unitPrice ?? 0),
        quantity: Number(o?.quantity ?? 0),
        ...normalizeOrderVat(o),
        items: (o?.items ?? []).map((item: any) => ({
          ...item,
          unitPrice: Number(item?.unitPrice ?? 0),
          quantity: Number(item?.quantity ?? 0),
          totalPrice: Number(item?.totalPrice ?? 0),
        })),
      })) ?? [],
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
    const data = await request.json();
    const normalizedSpecialNotes = normalizeOrderSpecialNotes(data);
    const hasNormalizedSafetyWarnings =
      splitSpecialNotes(normalizedSpecialNotes).safetyWarnings.length > 0;
    const currency = data?.currency === "EUR" ? "EUR" : "CHF";
    const items = data?.items as any[] | undefined;
    let totalPrice = 0;
    let primaryServiceName = data?.serviceName ?? null;
    let primaryPriceType = data?.priceType ?? "Stunde";
    let primaryUnitPrice = Number(data?.unitPrice ?? 0);
    let primaryQuantity = Number(data?.quantity ?? 1);
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
        const settings = await prisma.companySettings.findFirst({
          where: { userId },
        });
        if (settings?.mwstAktiv && settings?.mwstSatz != null)
          vatRate = Number(settings.mwstSatz);
        else if (settings && !settings.mwstAktiv) vatRate = 0;
      } catch {}
    }
    if (!isFinite(vatRate) || vatRate < 0) vatRate = 0;
  const calculatedTotals = calculateVatTotals(totalPrice, vatRate);
totalPrice = calculatedTotals.totalPrice;
vatRate = calculatedTotals.vatRate;
const vatAmount = calculatedTotals.vatAmount;
const total = calculatedTotals.total;
    // Guard: reject creation linked to an archived customer
    if (data?.customerId) {
      await assertCustomerNotArchived(prisma, data.customerId);
    }

    const order = await prisma.order.create({
      data: {
        customerId: data?.customerId,
        description: data?.description ?? "",
        serviceName: primaryServiceName,
        status: data?.status ?? "Offen",
        priceType: primaryPriceType,
        unitPrice: primaryUnitPrice,
        quantity: primaryQuantity,
        totalPrice,
        vatRate,
        vatAmount,
        total,
        currency,
        siteAddressDifferent: Boolean(data?.siteAddressDifferent),
        siteName: data?.siteName?.trim() || null,
        siteAddress: data?.siteAddress?.trim() || null,
        sitePlz: data?.sitePlz?.trim() || null,
        siteCity: data?.siteCity?.trim() || null,
        siteNote: data?.siteNote?.trim() || null,
        date: data?.date ? new Date(data.date) : new Date(),
        notes: data?.notes ?? null,
        specialNotes: normalizedSpecialNotes,
        hinweisLevel:
          data?.hinweisLevel ?? (hasNormalizedSafetyWarnings ? "warning" : "none"),
        mediaUrl: data?.mediaUrl ?? null,
        mediaType: data?.mediaType ?? null,
        imageUrls: data?.imageUrls ?? [],
        audioTranscript: data?.audioTranscript ?? null,
        userId,
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
      action: "ORDER_CREATE",
      area: "ORDERS",
      targetType: "Order",
      targetId: order.id,
      request,
    });
    return NextResponse.json({
      ...order,
      totalPrice: Number(order?.totalPrice ?? 0),
      unitPrice: Number(order?.unitPrice ?? 0),
      quantity: Number(order?.quantity ?? 0),
      vatRate: Number(order?.vatRate ?? 0),
      vatAmount: Number(order?.vatAmount ?? 0),
      total: Number(order?.total ?? 0),
      currency: order?.currency === "EUR" ? "EUR" : "CHF",
      items: (order?.items ?? []).map((item: any) => ({
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
    return NextResponse.json(
      { error: "Fehler beim Erstellen" },
      { status: 500 },
    );
  }
}
