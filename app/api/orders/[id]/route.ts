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
import {
  buildSpecialNotes,
  splitSpecialNotes,
} from "@/lib/special-notes-utils";
import {
  repairPersistedOrderZeroHourItemsFromText,
  repairZeroQuantityHourItemsFromText,
} from "@/lib/order-hour-line-repair";

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

function normalizeServiceNameForDisplay(value?: string | null) {
  const name = String(value || "").replace(/\s+/g, " ").trim();
  const key = normalizeSearchText(name);
  if (!name) return "";

  if (/archive\s+room|archivraum|\barchiv\b/.test(key)) {
    return "Archivraum reinigen";
  }
  if (/glass\s+door|glastuer|glastur|glastuere|glastüren|porte\s+vitree/.test(key)) {
    return "Glastür reinigen";
  }
  if (/local\s+technique|technikraum|technical\s+room|serverraum/.test(key)) {
    return "Technikraum reinigen";
  }
  if (/meeting\s+(?:area|room)|besprechungsbereich|besprechungsraum|sitzungszimmer|salle\s+de\s+reunion/.test(key)) {
    return "Besprechungsbereich reinigen";
  }
  if (/kontrollgang/.test(key)) {
    return "Kontrollgang reinigen";
  }
  if (/gangbereich|corridor|couloir|flur/.test(key)) {
    return "Gangbereich reinigen";
  }

  if (/\b(anfahrt|fahrt|fahrtkosten|fahrpauschale|wegpauschale|reisepauschale|deplacement|déplacement|frais\s+de\s+deplacement|travel|travel\s+flat\s+fee|trip|transport|viaje)\b/.test(key)) {
    return "Anfahrt";
  }

  const hasFloorIntent =
    /(?:^|\b|[a-z])boden\b|\bbode\b|\bfloor\b|\bsol\b|\bpaviment|\bsuelo\b/.test(key) ||
    /bodenreinigung|floor cleaning|nettoyage du sol|pulizia pavimento|limpieza suelo/.test(key);
  const hasCleaningIntent = /reinig|putz|putze|saeuber|clean|nettoyage|pulizia|limpieza|wisch/.test(key);
  if (hasFloorIntent && hasCleaningIntent) return "Boden reinigen";

  const hasWindowIntent = /fenster|fensterli|vitrin|vitre|window|fenetre|finestr|ventan/.test(key);
  const hasNonCleaningWindowIntent = /streich|maler|lackier|reparier|ersetzen|montier|einbau|abdicht|dicht/.test(key);
  if (hasWindowIntent && !hasNonCleaningWindowIntent) return "Fenster reinigen";

  return name;
}

function cleanWorkSiteDisplayName(value?: string | null) {
  let text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return null;

  text = text
    .replace(/^(?:arbeitsort|ausführungsort|ausfuehrungsort|ausführung|ausfuehrung|ausführungsadresse|ausfuehrungsadresse|einsatzort|objekt|baustelle|job site|work site|lieu|lieu d['’]?intervention|adresse de travail)\s*(?:ist|isch|is|=|:)?\s*/i, "")
    .replace(/^(?:wo\s+gemacht\s+werden\s+muss|wo\s+arbeiten\s+sind|wo\s+es\s+gemacht\s+wird)\s*:?\s*/i, "")
    .replace(/^(?:ist|isch|is)\s+(?:nicht|nöd|noed|not)\s+(?:gleich|gliich)\s*,?\s*/i, "")
    .replace(/^(?:nicht|nöd|noed|not)\s+(?:gleich|gliich)\s*,?\s*/i, "")
    .replace(/^[:\-–,\s]+/, "")
    .trim();

  return text || String(value || "").replace(/\s+/g, " ").trim() || null;
}

function getOrderSourceTextForItems(data: any) {
  return [
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
}

function isHourUnitForPersistedRepair(value?: string | null) {
  const unit = normalizeSearchText(value || "").replace(/[^a-z0-9]/g, "");
  return ["stunde", "stunden", "std", "h", "hour", "hours", "heure", "heures", "hora", "horas", "ora", "ore"].includes(unit);
}

function shouldRunPersistedHourRepairForOrder(order: any) {
  const items = Array.isArray(order?.items) ? order.items : [];
  if (items.length === 0) return false;

  const hasBrokenHourItem = items.some((item: any) => {
    const unitPrice = Number(item?.unitPrice || 0);
    const quantity = Number(item?.quantity || 0);
    const totalPrice = Number(item?.totalPrice || 0);

    return (
      isHourUnitForPersistedRepair(item?.unit) &&
      Number.isFinite(unitPrice) &&
      unitPrice > 0 &&
      (!Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(totalPrice) || totalPrice <= 0)
    );
  });

  if (!hasBrokenHourItem) return false;

  const source = getOrderSourceTextForItems(order);
  return /\b(?:stunde|stunden|std\.?|h|hour|hours|heure|heures|hora|horas|ora|ore)\b/i.test(source);
}

function serviceIntentTokens(serviceName?: string | null) {
  const key = normalizeSearchText(normalizeServiceNameForDisplay(serviceName));
  if (/boden/.test(key)) return ["boden", "bode", "floor", "sol", "suelo", "paviment"];
  if (/fenster/.test(key)) return ["fenster", "fensterli", "fensterfront", "window", "vitrin", "vitre", "ventan", "fenetre"];
  if (/anfahrt/.test(key)) return ["anfahrt", "fahrt", "fahrtkosten", "deplacement", "travel", "trip", "transport"];
  return key.split(/\s+/g).filter((token) => token.length >= 4);
}

function sourceLineContainsNumber(line: string, value: unknown) {
  const number = Number(String(value ?? "").replace("'", "").replace(",", "."));
  if (!Number.isFinite(number) || number <= 0) return false;
  const label = Number.isInteger(number) ? String(number) : String(Number(number.toFixed(2))).replace(".", "[.,]");
  return new RegExp(`(^|[^0-9])${label}([^0-9]|$)`).test(line);
}

function hasSourceLineSpecificIntentConflict(line: string, serviceName?: string | null) {
  const lineKey = normalizeSearchText(line);
  const serviceKey = normalizeSearchText(normalizeServiceNameForDisplay(serviceName));
  if (!lineKey || !serviceKey) return false;

  const itemIsWindow = /fenster|window|vitrin|vitre|fenetre|ventan|glastuer|glastur|glass door/.test(serviceKey);
  const lineIsWindow = /fenster|window|vitrin|vitre|fenetre|ventan|glastuer|glastur|glass door/.test(lineKey);
  if (lineIsWindow && !itemIsWindow) return true;

  const itemIsTravel = /anfahrt|fahrt|travel|trip|transport|deplacement|reisepauschale/.test(serviceKey);
  const lineIsTravel = /anfahrt|fahrt|travel|trip|transport|deplacement|reisepauschale/.test(lineKey);
  if (lineIsTravel && !itemIsTravel) return true;

  return false;
}

function hasExplicitMissingPriceHint(value?: string | null) {
  return /preis\s*(?:fehlt|offen|unklar|nachtragen)|betrag\s*(?:fehlt|offen|unklar|nachtragen)|ohne\s+preis|kein\s+preis|noch\s+kein\s+preis|price\s*(?:missing|open|unknown|tbd)/i.test(
    String(value || ""),
  );
}

function findSourceLineForItem(source: string, item: any) {
  const tokens = serviceIntentTokens(item?.serviceName);
  if (!source || tokens.length === 0) return "";

  let bestLine = "";
  let bestScore = 0;
  const lines = source
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split(/\n+/g)
    .map((line) => line.trim())
    .filter(Boolean);

  for (const line of lines) {
    if (/^\s*\[?\s*(?:titel|title)\s*:/i.test(line)) continue;
    const normalized = normalizeSearchText(line);
    if (!normalized) continue;
    if (hasSourceLineSpecificIntentConflict(line, item?.serviceName)) continue;
    const hits = tokens.filter((token) => normalized.includes(token)).length;
    if (hits === 0) continue;

    let score = hits * 6;
    if (sourceLineContainsNumber(normalized, item?.quantity)) score += 4;
    if (sourceLineContainsNumber(normalized, item?.unitPrice)) score += 2;
    if (/\b(chf|eur|franken|stutz|sfr)\b|€|\.\-/.test(normalized) || /€/.test(line)) score += 2;

    if (score > bestScore) {
      bestScore = score;
      bestLine = line;
    }
  }

  return bestScore >= 6 ? bestLine : "";
}

function parseNumberToken(value?: string | null) {
  const number = Number(String(value || "").replace("'", "").replace(",", "."));
  return Number.isFinite(number) && number > 0 ? number : null;
}

function extractUnitPriceFromSourceLine(line: string, item?: any) {
  if (!line) return null;

  const patterns: Array<{ re: RegExp; priceGroup: number }> = [
    { re: /(?:je|each|à|a|zu|pro|per)\s*(?:chf|eur|fr\.?|sfr|franken|stutz|€)?\s*(\d+(?:[.,]\d+)?)/gi, priceGroup: 1 },
    { re: /(?:chf|eur|fr\.?|sfr|€)\s*(\d+(?:[.,]\d+)?)\s*(?:je|each)\b/gi, priceGroup: 1 },
    { re: /(?:chf|eur|fr\.?|sfr|€)\s*(\d+(?:[.,]\d+)?)/gi, priceGroup: 1 },
    { re: /(\d+(?:[.,]\d+)?)\s*(?:chf|eur|franken|stutz|sfr|€)\b/gi, priceGroup: 1 },
    { re: /(\d+(?:[.,]\d+)?)\s*\.-/gi, priceGroup: 1 },
  ];

  const matches: Array<{ amount: number; index: number }> = [];
  for (const pattern of patterns) {
    for (const match of line.matchAll(pattern.re)) {
      const amount = parseNumberToken(match?.[pattern.priceGroup]);
      if (!amount) continue;
      const index = match.index ?? 0;
      if (!matches.some((entry) => entry.amount === amount && Math.abs(entry.index - index) < 3)) {
        matches.push({ amount, index });
      }
    }
  }

  if (matches.length === 0) return null;
  if (matches.length === 1 || !item) return matches[0].amount;

  const normalized = normalizeSearchText(line);
  const tokens = serviceIntentTokens(item?.serviceName);
  const serviceIndexes = tokens
    .map((token) => normalized.indexOf(token))
    .filter((index) => index >= 0);
  const quantity = Number(String(item?.quantity ?? '').replace("'", '').replace(',', '.'));
  const quantityIndex = Number.isFinite(quantity) && quantity > 0
    ? normalized.search(new RegExp(`(^|[^0-9])${String(quantity).replace('.', '[.,]')}([^0-9]|$)`))
    : -1;

  const anchor = serviceIndexes.length > 0
    ? Math.min(...serviceIndexes)
    : quantityIndex >= 0
      ? quantityIndex
      : -1;

  if (anchor < 0) return null;

  return matches
    .map((match) => ({ ...match, distance: Math.abs(match.index - anchor) }))
    .sort((a, b) => a.distance - b.distance)[0]?.amount || null;
}

function shouldTrustSourcePriceForItem(item: any, data: any) {
  const reviewText = [
    item?.description,
    ...(Array.isArray(data?.reviewReasons) ? data.reviewReasons : []),
  ]
    .filter(Boolean)
    .join(" ");
  return (
    Number(item?.unitPrice ?? 0) <= 0 ||
    /preis\s+im\s+text\s+unklar|textpreis\s+übernommen|textpreis\s+uebernommen|price_unclear|unit_price_review/i.test(reviewText)
  );
}


function hasCurrencyConflictReviewOnOrderLike(value: any): boolean {
  const reasons = Array.isArray(value?.reviewReasons) ? value.reviewReasons : [];
  return reasons.some((reason: any) =>
    String(reason || "").startsWith("currency_") ||
    String(reason || "").startsWith("item_currency_mismatch:") ||
    String(reason || "").startsWith("currency_conflict_item:"),
  );
}

function isBlockedAmountReviewItemForPersist(item: any, data?: any): boolean {
  const reviewText = [
    item?.unit,
    item?.description,
    item?.sourceText,
    item?.evidence,
    item?.reviewReason,
    ...(Array.isArray(data?.reviewReasons) ? data.reviewReasons : []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return (
    hasCurrencyConflictReviewOnOrderLike(data || {}) ||
    /einheit\s+(?:fehlt|offen|unklar|pr[üu]fen|muss)/i.test(reviewText) ||
    /unit\s+(?:missing|open|unknown|unclear|review)/i.test(reviewText) ||
    /unit_missing_in_text|unit_mismatch:/i.test(reviewText) ||
    /preis\s+(?:fehlt|offen|unklar|pr[üu]fen)/i.test(reviewText) ||
    /price\s+(?:missing|open|unknown|unclear|review)/i.test(reviewText) ||
    /price_unclear:|unit_price_review/i.test(reviewText) ||
    /menge\s+(?:fehlt|offen|unklar|pr[üu]fen)/i.test(reviewText) ||
    /quantity\s+(?:missing|open|unknown|unclear|review)/i.test(reviewText) ||
    /quantity_review/i.test(reviewText) ||
    /currency_review|currency_conflict|currency_unsupported|item_currency_mismatch|currency_conflict_item/i.test(reviewText)
  );
}

function normalizeItemsForPersist(items: any[] | undefined, data: any) {
  if (!Array.isArray(items)) return undefined;
  const source = getOrderSourceTextForItems(data);

  const normalized = items.map((item: any) => {
    const serviceName = normalizeServiceNameForDisplay(item?.serviceName);
    const sourceLine = findSourceLineForItem(source, { ...item, serviceName });
    const sourcePrice = extractUnitPriceFromSourceLine(sourceLine, { ...item, serviceName });
    const reviewText = [
      item?.description,
      ...(Array.isArray(data?.reviewReasons) ? data.reviewReasons : []),
    ]
      .filter(Boolean)
      .join(" ");
    const forceMissingPriceReview =
      !sourcePrice &&
      /preis\s+im\s+text\s+unklar|price_unclear|unit_price_review/i.test(reviewText);
    let unitPrice = forceMissingPriceReview
      ? 0
      : sourcePrice && shouldTrustSourcePriceForItem(item, data)
        ? sourcePrice
        : Number(item?.unitPrice ?? 0);
    let quantity = Number(item?.quantity ?? 1);
    let unit = item?.unit;

    if (serviceName === "Anfahrt") {
      unit = "Pauschal";
      quantity = 1;
      // V17.13: Quelle darf eine manuelle Korrektur nicht mehr überschreiben.
      // Bei Mischwährung trägt der Benutzer den Zielpreis bewusst ein; die
      // alte Textzeile (z. B. "Anfahrt CHF 50") ist dann nur noch Evidenz,
      // nicht mehr der zu persistierende EUR-Preis.
      if (sourcePrice && sourcePrice > 0 && shouldTrustSourcePriceForItem(item, data)) {
        unitPrice = sourcePrice;
      }
    }

    const amountBlocked = isBlockedAmountReviewItemForPersist(
      { ...item, serviceName, unit, unitPrice, quantity },
      data,
    );

    return {
      ...item,
      serviceName,
      unit,
      unitPrice: amountBlocked && hasCurrencyConflictReviewOnOrderLike(data) ? 0 : unitPrice,
      quantity,
      totalPrice: amountBlocked ? 0 : Number(item?.totalPrice ?? unitPrice * quantity),
    };
  });

  return repairZeroQuantityHourItemsFromText(normalized, source, {
    logPrefix: "[OrdersIdNormalizeHourFixV17_06]",
  }).items;
}

function extractExactOperationalHints(data: any) {
  const source = [data?.notes, data?.audioTranscript, data?.specialNotes]
    .filter(Boolean)
    .join("\n");
  if (!source) return [];

  return Array.from(
    new Set(
      source
        .replace(/\r\n/g, "\n")
        .replace(/\r/g, "\n")
        .split(/\n+/g)
        .map((line) => line.trim())
        .filter(Boolean)
        .filter((line) => !/^\[Titel\s*:/i.test(line) && !/^\[Priorität\s*:/i.test(line))
        .filter((line) => {
          const text = normalizeSearchText(line);
          if (!text) return false;
          return (
            /nicht\s+anrufen|keine?\s+telefonische|kein\s+telefon|mail\s+reicht|e\s*mail\s+reicht|nur\s+(?:per\s+)?(?:mail|whats\s*app|sms)|whats\s*app(?:\s+nummer)?|\bsms\b/.test(text) ||
            /(?:bitte\s+)?(?:kurz\s+)?(?:anrufen|telefonieren|zurueckrufen|zuruckrufen|rueckrufen|ruckrufen|alueute|aluete|alute)\b/.test(text) ||
            /(?:nach|ab|erst\s+nach)\s*\d{1,2}(?::\d{2})?\s*(?:uhr)?\s*(?:anrufen|telefonieren|kontaktieren|melden|alueute|aluete|alute)/.test(text) ||
            /termin.*(?:klaeren|klaren|abstimmen|vereinbaren|abmachen|melden|ruecksprache|rucksprache|vorschlagen)|(?:ruecksprache|rucksprache|melden|abmachen|vorschlagen).*termin/.test(text) ||
            /\b\d{1,2}[.\-/]\d{1,2}(?:[.\-/]\d{2,4})?\b.*(?:bestaetigen|bestätigen|falls|waere|wäre|geht|passt|confirm)/i.test(line) ||
            /leiter|schluessel|schlussel|key|rezeption|reception|zugang|hintereingang|seiteneingang|side entrance|park/.test(text)
          );
        })
        .map((line) => line.replace(/^\s*(?:whatsapp|telegram)\s*:\s*/i, "").trim()),
    ),
  );
}

function hasExplicitPriceCurrencySignal(data: any) {
  const source = [
    data?.notes,
    data?.description,
    data?.serviceName,
    data?.specialNotes,
    data?.audioTranscript,
    ...(Array.isArray(data?.items)
      ? data.items.flatMap((item: any) => [item?.serviceName, item?.description, item?.unitPrice])
      : []),
  ]
    .filter(Boolean)
    .join("\n");

  const normalized = normalizeSearchText(source);
  return /\b(chf|franken|stutz|sfr|eur|euro)\b|€|\.\-/.test(normalized) || /€/.test(source);
}

function normalizeReviewReasonsForPersist(data: any) {
  const reasons = Array.isArray(data?.reviewReasons)
    ? data.reviewReasons.filter(Boolean)
    : undefined;
  if (!reasons) return undefined;

  const items = Array.isArray(data?.items) ? data.items : [];
  const hasExplicitPriceSignal = hasExplicitPriceCurrencySignal(data);

  return reasons.filter((reason: string) => {
    if (!String(reason).startsWith("price_unclear:")) return true;
    const [, serviceName = ""] = String(reason).split(":");
    const item = items.find((candidate: any) =>
      normalizeSearchText(candidate?.serviceName) === normalizeSearchText(serviceName),
    );
    if (!item) return true;
    const hasPrice = Number(item?.unitPrice || 0) > 0 && Number(item?.quantity || 0) > 0;
    return !(hasPrice && hasExplicitPriceSignal);
  });
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
    label: "Zugang über Hintereingang",
    type: "hint",
    patterns: [
      /\bhintereingang\b/,
      /\bhinteren eingang\b/,
      /\beingang hinten\b/,
      /\bzugang hinten\b/,
      /\brear entrance\b/,
      /\bback entrance\b/,
      /\bentree arriere\b/,
      /\bentree par l arriere\b/,
      /\bacces par l entree arriere\b/,
      /\bentrada trasera\b/,
      /\bingresso posteriore\b/,
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
    label: "Nicht anrufen, E-Mail reicht",
    type: "hint",
    patterns: [
      /nicht\s+anrufen.*(?:mail|e-?mail)|(?:mail|e-?mail).*nicht\s+anrufen/i,
      /keine?\s+telefonische\s+rücksprache.*(?:mail|e-?mail)|(?:mail|e-?mail).*keine?\s+telefonische\s+rücksprache/i,
      /nur\s+(?:per\s+)?(?:mail|e-?mail)|(?:mail|e-?mail)\s+reicht/i,
    ],
  },
  {
    label: "Keine telefonische Rückfrage",
    type: "hint",
    patterns: [
      /bitte\s+keine?\s+telefonische\s+r[uü]ckfrage/i,
      /keine?\s+telefonische\s+r[uü]ckfrage/i,
      /nicht\s+telefonisch/i,
      /nicht\s+anrufen/i,
      /pas\s+par\s+t[eé]l[eé]phone/i,
      /no\s+calls?/i,
    ],
  },
  {
    label: "WhatsApp bevorzugt",
    type: "hint",
    patterns: [/whats\s*app/i],
  },
  {
    label: "SMS bevorzugt",
    type: "hint",
    patterns: [/\bsms\b/i],
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
  const exactOperationalHints = extractExactOperationalHints(data);

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
    new Set([...existingJobHints, ...detectedAll.jobHints, ...exactOperationalHints]),
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

function roundMoney(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Number((Math.round((value + Number.EPSILON) * 100) / 100).toFixed(2));
}

function isExplicitZeroTotalReviewItem(item: any): boolean {
  const storedTotal = Number(item?.totalPrice ?? 0);
  if (storedTotal > 0) return false;
  return isBlockedAmountReviewItemForPersist(item, {});
}

function getItemNetTotalForOrder(item: any): number {
  if (isExplicitZeroTotalReviewItem(item)) return 0;

  const quantity = Number(item?.quantity ?? 0);
  const unitPrice = Number(item?.unitPrice ?? 0);
  const storedTotal = Number(item?.totalPrice ?? 0);
  const calculated = quantity > 0 && unitPrice > 0 ? quantity * unitPrice : 0;
  const lineTotal = storedTotal > 0 ? storedTotal : calculated;

  return Number.isFinite(lineTotal) && lineTotal > 0 ? lineTotal : 0;
}

function calculateItemsNetTotal(o: any): number | null {
  const items = Array.isArray(o?.items) ? o.items : [];
  if (items.length === 0) return null;

  if (hasCurrencyConflictReviewOnOrderLike(o)) {
    return 0;
  }

  const net = items.reduce((sum: number, item: any) => sum + getItemNetTotalForOrder(item), 0);

  // Wenn Positionen vorhanden sind, sind sie Source of Truth. Auch 0 ist dann
  // ein gültiges Ergebnis, damit rote Prüfpositionen nicht über stale
  // Order.totalPrice oder quantity × price wieder in die Summe laufen.
  return roundMoney(net);
}

function calculateVatTotals(netValue: number, vatRateValue: number) {
  const totalPrice = roundMoney(Number(netValue ?? 0));
  const vatRate = Number.isFinite(vatRateValue) && vatRateValue > 0 ? vatRateValue : 0;
  const vatAmount = roundMoney((totalPrice * vatRate) / 100);
  const total = roundMoney(totalPrice + vatAmount);
  return { totalPrice, vatRate, vatAmount, total };
}

function getOrderNetTotalForResponse(o: any): number {
  return calculateItemsNetTotal(o) ?? roundMoney(Number(o?.totalPrice ?? 0));
}

/** Legacy-safe VAT normalizer: see app/api/orders/route.ts for the reasoning. */
function normalizeOrderVat(o: any) {
  const totalPrice = getOrderNetTotalForResponse(o);
  const vatRate = o?.vatRate == null ? 8.1 : Number(o.vatRate);
  const computed = calculateVatTotals(totalPrice, vatRate);
  return {
    vatRate: computed.vatRate,
    vatAmount: computed.vatAmount,
    total: computed.total,
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
      include: {
        customer: true,
        items: { include: { workSite: true } },
        workSites: true,
      },
    });
    if (!order)
      return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });

    const persistedHourRepair = shouldRunPersistedHourRepairForOrder(order)
      ? await repairPersistedOrderZeroHourItemsFromText({
          prisma,
          order,
          originalText: getOrderSourceTextForItems(order),
          logPrefix: "[OrdersIdGetHourFixV17_09_GET_ON_DEMAND]",
        })
      : { order, repairedCount: 0, remainingZeroHourRows: 0 };
    const safeOrder = persistedHourRepair.order || order;

    return NextResponse.json({
      ...safeOrder,
      totalPrice: getOrderNetTotalForResponse(safeOrder),
      unitPrice: Number(safeOrder?.unitPrice ?? 0),
      quantity: Number(safeOrder?.quantity ?? 0),
      currency: safeOrder?.currency === "EUR" ? "EUR" : "CHF",
      ...normalizeOrderVat(safeOrder),
      items: (safeOrder?.items ?? []).map((item: any) => ({
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
              ? normalizeServiceNameForDisplay(data.serviceName)
              : existing?.serviceName,
        })
      : undefined;
    const currency =
      inferExplicitCurrencyFromPayload(data) ||
      (data?.currency === "EUR"
        ? "EUR"
        : data?.currency === "CHF"
          ? "CHF"
          : undefined);
    const rawItems = data?.items as any[] | undefined;
    const items = normalizeItemsForPersist(rawItems, data);
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
        (sum: number, item: any) => sum + getItemNetTotalForOrder(item),
        0,
      );
      primaryServiceName = normalizeServiceNameForDisplay(items[0].serviceName ?? primaryServiceName);
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
    const workSiteIdMap = new Map<string, string>();
    const workSitePayload = Array.isArray(data?.workSites) ? data.workSites : null;

    if (workSitePayload) {
      const existingWorkSites = await prisma.orderWorkSite.findMany({
        where: { orderId: params?.id },
        select: { id: true },
      });
      const existingIds = new Set(existingWorkSites.map((site: any) => site.id));
      const keptIds: string[] = [];

      for (let index = 0; index < workSitePayload.length; index += 1) {
        const site = workSitePayload[index] || {};
        const originalId = String(site.id || "").trim();
        const siteData = {
          siteName: cleanWorkSiteDisplayName(site.siteName),
          siteAddress: String(site.siteAddress || "").trim() || null,
          sitePlz: String(site.sitePlz || "").trim() || null,
          siteCity: String(site.siteCity || "").trim() || null,
          siteNote: String(site.siteNote || "").trim() || null,
          isPrimary: Boolean(site.isPrimary) || index === 0,
          sortOrder: Number.isFinite(Number(site.sortOrder))
            ? Number(site.sortOrder)
            : index,
          sourceOrderId: String(site.sourceOrderId || "").trim() || null,
        };

        let savedSite: any;
        if (originalId && existingIds.has(originalId)) {
          savedSite = await prisma.orderWorkSite.update({
            where: { id: originalId },
            data: siteData,
          });
        } else {
          savedSite = await prisma.orderWorkSite.create({
            data: {
              ...siteData,
              orderId: params?.id,
            },
          });
        }

        keptIds.push(savedSite.id);
        if (originalId) workSiteIdMap.set(originalId, savedSite.id);
        workSiteIdMap.set(savedSite.id, savedSite.id);
      }

      if (items) {
        await prisma.orderItem.deleteMany({ where: { orderId: params?.id } });
      }

      if (keptIds.length > 0) {
        await prisma.orderWorkSite.deleteMany({
          where: {
            orderId: params?.id,
            id: { notIn: keptIds },
          },
        });
      }
    } else if (items) {
      await prisma.orderItem.deleteMany({ where: { orderId: params?.id } });
    }

    const resolveWorkSiteId = (value?: string | null) => {
      const raw = String(value || "").trim();
      if (!raw) return null;
      return workSiteIdMap.get(raw) || raw;
    };

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
        serviceName: normalizeServiceNameForDisplay(primaryServiceName),
        status: data?.status,
        priceType: primaryPriceType,
        unitPrice: primaryUnitPrice,
        quantity: primaryQuantity,
        ...(currency ? { currency } : {}),
        // totalPrice only updates if items or price fields were provided
        ...(hasItemsField || hasPriceFields ? { totalPrice } : {}),
        // VAT only re-persists when prices/items/vatRate changed — not on metadata-only updates
        ...(shouldRecalculate
          ? {
              vatRate: effectiveVatRate,
              vatAmount: effectiveVatAmount,
              total: effectiveTotal,
            }
          : {}),
        currency,
        siteAddressDifferent:
          data?.siteAddressDifferent !== undefined
            ? Boolean(data.siteAddressDifferent)
            : undefined,
        siteName:
          data?.siteName !== undefined
            ? cleanWorkSiteDisplayName(data.siteName)
            : undefined,
        siteAddress:
          data?.siteAddress !== undefined
            ? data.siteAddress?.trim() || null
            : undefined,
        sitePlz:
          data?.sitePlz !== undefined
            ? data.sitePlz?.trim() || null
            : undefined,
        siteCity:
          data?.siteCity !== undefined
            ? data.siteCity?.trim() || null
            : undefined,
        siteNote:
          data?.siteNote !== undefined
            ? data.siteNote?.trim() || null
            : undefined,
        date: data?.date ? new Date(data.date) : undefined,
        notes: data?.notes,
        specialNotes: normalizedSpecialNotes,
        needsReview:
          data?.needsReview !== undefined ? data.needsReview : undefined,
        reviewReasons:
          data?.reviewReasons !== undefined ? normalizeReviewReasonsForPersist(data) : undefined,
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
                  serviceName: normalizeServiceNameForDisplay(item.serviceName),
                  description: item.description ?? "",
                  quantity: Number(item.quantity ?? 1),
                  unit: item.unit ?? "Stunde",
                  unitPrice: Number(item.unitPrice ?? 0),
                  totalPrice: Number(
                    item.totalPrice ??
                      (Number(item.unitPrice ?? 0) * Number(item.quantity ?? 1)),
                  ),
                  workSiteId: resolveWorkSiteId(item.workSiteId),
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
        include: {
          customer: true,
          items: { include: { workSite: true } },
          workSites: true,
        },
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

    const persistedHourRepairAfterUpdate = await repairPersistedOrderZeroHourItemsFromText({
      prisma,
      order: finalOrder,
      originalText: getOrderSourceTextForItems({ ...existing, ...data, items: finalOrder.items }),
      logPrefix: "[OrdersIdPutHourFixV17_06]",
    });
    if (persistedHourRepairAfterUpdate.repairedCount > 0 && persistedHourRepairAfterUpdate.order) {
      finalOrder = persistedHourRepairAfterUpdate.order;
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

  const [remainingOrders, remainingOffers, remainingInvoices] =
    await Promise.all([
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
