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
import {
  buildSpecialNotes,
  splitSpecialNotes,
} from "@/lib/special-notes-utils";

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

// V16.37: Route-level safety net for browser-created orders.
// If the UI posts an order with a blank/new customerId and the original text
// contains a clear nameless "Rechnung an:" block, persist that billing address
// on the linked blank customer. This catches paths that do not go through
// lib/order-intake.ts.
function extractNamelessBillingAddressFromOrderPayloadV1637(
  ...values: unknown[]
): {
  street: string | null;
  plz: string | null;
  city: string | null;
  phone: string | null;
  email: string | null;
} | null {
  const source = values
    .map((value) => String(value ?? ""))
    .filter(Boolean)
    .join("\n")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (!source) return null;

  const lines = source
    .split(/\n+/g)
    .map((line) => line.trim())
    .filter(Boolean);

  const markerRegex =
    /^\s*(?:rechnung\s+(?:geht\s+)?an|rechnung\s+(?:für|fuer)|rechnung\s+bekommt|rechnungsadresse|rechnungsempfänger|rechnungsempfaenger|rechnungskunde|billing\s+address|bill\s+to|invoice\s+customer|billing\s+customer|client\s*\/\s*facturation|facturation)\s*:?\s*(.*)$/i;
  const stopRegex =
    /^\s*(?:arbeitsort|objekt|einsatzort|einsatzadresse|ausführungsadresse|ausfuehrungsadresse|ausführungsort|ausfuehrungsort|arbeitsadresse|baustelle|montageort|serviceadresse|adresse\s+de\s+travail|lieu\s+d['’]?intervention|work\s+address|job\s+site|kontakt\s+vor\s+ort|kontaktperson|ansprechperson|person\s+vor\s+ort|besonderheiten|bemerkungen|hinweise|leistungen|leistungsübersicht|leistungsuebersicht|termin|datum)\s*:?/i;

  const parseStreet = (line: string): string | null => {
    const raw = String(line || "")
      .replace(
        /^\s*(?:adresse|anschrift|strasse|straße|street\s+address|address)\s*:?\s*/i,
        "",
      )
      .replace(/[,;]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (!raw) return null;

    const houseNumber = "\\d+[a-zA-Z]?(?:\\s*[/-]\\s*\\d+[a-zA-Z]?)?";
    const word = "[A-ZÄÖÜa-zäöüß][A-Za-zÄÖÜäöüß'.-]*";
    const suffix =
      "(?:strasse|straße|str\\.?|weg|gasse|platz|allee|ring|rain|halde|steig|route|street|road|lane)";
    const patterns = [
      new RegExp(
        `\\b((?:${word}\\s+){0,3}${word}${suffix}\\s+${houseNumber})\\b`,
        "i",
      ),
      new RegExp(
        `\\b((?:${word}\\s+){1,4}${suffix}\\s+${houseNumber})\\b`,
        "i",
      ),
      new RegExp(
        `\\b((?:rue|avenue|av\\.?|chemin|via|viale)\\s+${word}(?:\\s+(?:de|des|du|del|della|la|le|les|l['’]?|d['’]?|${word})){0,6}\\s+${houseNumber})\\b`,
        "i",
      ),
    ];

    for (const pattern of patterns) {
      const match = raw.match(pattern);
      if (match?.[1]) {
        return match[1]
          .replace(
            /^\s*(?:beim|bei|an|am|in|zur|zum)\s+(?:der|dem|den|das)?\s*/i,
            "",
          )
          .replace(/\s+/g, " ")
          .trim();
      }
    }

    return null;
  };

  const parsePlzCity = (
    line: string,
  ): { plz: string | null; city: string | null } => {
    const cleaned = String(line || "")
      .replace(
        /^\s*(?:plz\s*\/\s*ort|plz|ort|postleitzahl|zip|postal\s+code|ville|city)\s*:?\s*/i,
        "",
      )
      .replace(/[,;]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    const match = cleaned.match(
      /\b(\d{4,5})\s+([A-ZÄÖÜ][A-Za-zÄÖÜäöüß' .\-]{1,60}?)(?=\s*(?:$|\b(?:tel\.?|telefon|phone|mobile|handy|natel|e-?mail|email|arbeitsort|objekt|kontakt|besonderheiten|leistungen|leistungsübersicht|leistungsuebersicht)\b|[,;.]))/i,
    );
    if (!match) return { plz: null, city: null };

    const city = String(match[2] || "")
      .replace(
        /\b(?:kommen|arbeiten|reinigen|melden|montieren|prüfen|pruefen|machen|erledigen)\b.*$/i,
        "",
      )
      .replace(/[,;:.]+$/g, "")
      .replace(/\s+/g, " ")
      .trim();

    return { plz: match[1] || null, city: city || null };
  };

  const extractPhone = (block: string): string | null => {
    const explicit = block.match(
      /\b(?:tel\.?|telefon|phone|mobile|handy|natel)\s*[:.]?\s*(\+?\d[\d\s()./-]{6,}\d)\b/i,
    );
    const loose =
      explicit?.[1] || block.match(/(\+?\d[\d\s()./-]{7,}\d)/)?.[1] || null;
    return loose ? loose.replace(/\s+/g, " ").trim() : null;
  };

  const extractEmail = (block: string): string | null =>
    block.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0]?.trim() || null;

  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(markerRegex);
    if (!match) continue;

    const blockLines: string[] = [];
    if (match[1]?.trim()) blockLines.push(match[1].trim());

    for (let offset = 1; offset <= 10; offset += 1) {
      const line = lines[index + offset];
      if (!line) break;
      if (stopRegex.test(line)) break;
      if (/^\[Titel\s*:/i.test(line)) break;
      blockLines.push(line);
    }

    const block = blockLines.join("\n").trim();
    if (!block) continue;

    let street: string | null = null;
    let plz: string | null = null;
    let city: string | null = null;

    for (const line of blockLines) {
      if (
        /^\s*(?:e-?mail|email|tel\.?|telefon|phone|mobile|handy|natel)\b/i.test(
          line,
        )
      )
        continue;

      if (!street) street = parseStreet(line);

      const parsedPlzCity = parsePlzCity(line);
      if (!plz && parsedPlzCity.plz) plz = parsedPlzCity.plz;
      if (!city && parsedPlzCity.city) city = parsedPlzCity.city;
    }

    if (!street) street = parseStreet(block);
    if (!plz || !city) {
      const wholePlzCity = parsePlzCity(block);
      if (!plz && wholePlzCity.plz) plz = wholePlzCity.plz;
      if (!city && wholePlzCity.city) city = wholePlzCity.city;
    }

    const phone = extractPhone(block);
    const email = extractEmail(block);

    const hasSafeAddress = Boolean(street && plz && city);
    const hasSafePartialWithContact = Boolean(
      (street || (plz && city)) && (phone || email),
    );
    if (!hasSafeAddress && !hasSafePartialWithContact) continue;

    return { street, plz, city, phone, email };
  }

  return null;
}

function inferExplicitCurrencyFromPayload(data: any): "CHF" | "EUR" | undefined {
  const source = [
    data?.notes,
    data?.description,
    data?.serviceName,
    data?.specialNotes,
    data?.audioTranscript,
    ...(Array.isArray(data?.items)
      ? data.items.flatMap((item: any) => [item?.serviceName, item?.description])
      : []),
  ]
    .filter(Boolean)
    .join("\n");

  const normalized = normalizeSearchText(source);
  const hasChf = /\bchf\b|\bfranken\b|\bstutz\b|\bsfr\b/.test(normalized);
  const hasEur = /\beur\b|\beuro\b|€/.test(source);

  if (hasChf && !hasEur) return "CHF";
  if (hasEur && !hasChf) return "EUR";
  return undefined;
}

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
    label: "Termin klären",
    type: "hint",
    patterns: [
      /\btermin\s+(?:klaeren|klaren|abstimmen|vereinbaren)\b/,
      /\b(?:melden|kontaktieren|anrufen|schreiben)\b.*\btermin\b/,
      /\btermin\b.*\b(?:melden|kontaktieren|abstimmen|vereinbaren|klaeren|klaren)\b/,
      /\bappointment\s+(?:to\s+schedule|to\s+arrange|arrange|schedule)\b/,
      /\bschedule\b.*\bappointment\b/,
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
  const vatRate =
    Number.isFinite(vatRateValue) && vatRateValue > 0 ? vatRateValue : 0;
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
  };
}

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
        items: { include: { workSite: true } },
        workSites: true,
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
    const currency =
      inferExplicitCurrencyFromPayload(data) ||
      (data?.currency === "EUR" ? "EUR" : "CHF");
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

    let order = await prisma.order.create({
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
          data?.hinweisLevel ??
          (hasNormalizedSafetyWarnings ? "warning" : "none"),
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
      include: {
        customer: true,
        items: { include: { workSite: true } },
        workSites: true,
      },
    });

    // V16.37: If this browser/API path created an order linked to a blank
    // customer, persist an explicit nameless "Rechnung an:" block from the
    // original order text onto that customer. This does not touch real named
    // customers and never reads the execution address block.
    if (data?.customerId) {
      const explicitBillingAddress =
        extractNamelessBillingAddressFromOrderPayloadV1637(
          data?.notes,
          data?.description,
          data?.audioTranscript,
          data?.specialNotes,
        );

      if (explicitBillingAddress) {
        const linkedCustomer = await prisma.customer.findUnique({
          where: { id: data.customerId },
          select: {
            id: true,
            name: true,
            address: true,
            plz: true,
            city: true,
            phone: true,
            email: true,
          },
        });

        const customerNameMissing = !String(linkedCustomer?.name || "").trim();
        const customerAddressMissing =
          !String(linkedCustomer?.address || "").trim() &&
          !String(linkedCustomer?.plz || "").trim() &&
          !String(linkedCustomer?.city || "").trim();

        if (linkedCustomer && customerNameMissing && customerAddressMissing) {
          const customerUpdate: Record<string, string> = {};
          if (explicitBillingAddress.street)
            customerUpdate.address = explicitBillingAddress.street;
          if (explicitBillingAddress.plz)
            customerUpdate.plz = explicitBillingAddress.plz;
          if (explicitBillingAddress.city)
            customerUpdate.city = explicitBillingAddress.city;
          if (explicitBillingAddress.phone && !linkedCustomer.phone)
            customerUpdate.phone = explicitBillingAddress.phone;
          if (explicitBillingAddress.email && !linkedCustomer.email)
            customerUpdate.email = explicitBillingAddress.email;

          if (Object.keys(customerUpdate).length > 0) {
            await prisma.customer.update({
              where: { id: linkedCustomer.id },
              data: customerUpdate,
            });

            order =
              (await prisma.order.findUnique({
                where: { id: order.id },
                include: {
                  customer: true,
                  items: { include: { workSite: true } },
                  workSites: true,
                },
              })) ?? order;
          }
        }
      }
    }

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
