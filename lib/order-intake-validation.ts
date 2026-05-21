// INTAKE_VALIDATION_SEMANTIC_SAFETY_V12
export type IntakeCurrency = "CHF" | "EUR";

export interface ParsedOrderItemForValidation {
  serviceName: string;
  description: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  totalPrice: number;
  needsReview: boolean;
  reviewReason: string | null;
  sourceText?: string | null;
  evidence?: string | null;
  detectedCurrency?: string | null;
}

export interface IntakeValidationInput {
  items: ParsedOrderItemForValidation[];
  originalText: string;
  fallbackCurrency: IntakeCurrency;
}

export interface IntakeValidationResult {
  items: ParsedOrderItemForValidation[];
  reviewReasons: string[];
  needsReview: boolean;
  finalCurrency: IntakeCurrency;
  detectedCurrencies: string[];
}

export interface ExtractedExecutionAddress {
  siteName: string | null;
  siteAddress: string | null;
  sitePlz: string | null;
  siteCity: string | null;
  siteNote: string | null;
}

type DetectedUnitPrice = {
  amount: number;
  currency: string | null;
  segment: string;
  unitType: string | null;
};

const normalizeText = (value?: string | null) =>
  String(value || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

const normalizeCompare = (value?: string | null) =>
  String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/strasse|straße|str\./g, "str")
    .replace(/[^a-z0-9€$£]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const unique = (values: string[]) => Array.from(new Set(values.filter(Boolean)));

const CURRENCY_WORDS =
  "(?:chf|franken|fr\\.?|sfr\\.?|stutz|eur|euro|€|usd|us-dollar|dollar|us\\$|\\$|gbp|pfund|pound|£)";

const UNIT_WORDS =
  "(?:stueck|stück|stk|einheit|piece|quadratmeter|quadratmetern|qm|m2|m²|sqm|kubikmeter|kubikmetern|cbm|meter|laufmeter|lfm|stunde|stunden|std\\.?|hour|hours|tag|tage|day|days|kg|kilogramm|tonne|tonnen|liter|ltr|l)";

const PRICE_NUMBER = "(\\d+(?:[.,]\\d{1,2})?)";

const GENERIC_SERVICE_WORDS = new Set([
  "reinigen",
  "reinigung",
  "entfernen",
  "machen",
  "bitte",
  "auftrag",
  "leistung",
  "leistungen",
  "kunde",
  "keller",
  "haus",
  "mfh",
]);

export function detectCurrenciesInText(text?: string | null): string[] {
  const source = String(text || "").toLowerCase();
  if (!source.trim()) return [];

  const currencies: string[] = [];

  if (/\b(chf|franken|fr\.?|sfr\.?|stutz)\b/i.test(source)) currencies.push("CHF");
  if (/\b(eur|euro)\b|€/i.test(source)) currencies.push("EUR");
  if (/\b(usd|us-dollar|dollar)\b|\bus\$|\$/i.test(source)) currencies.push("USD");
  if (/\b(gbp|pfund|pound|british pound)\b|£/i.test(source)) currencies.push("GBP");

  return unique(currencies);
}

const normalizeCurrency = (value?: string | null): string | null => {
  const currency = String(value || "").toLowerCase().trim();
  if (!currency) return null;
  if (/^(chf|franken|fr\.?|sfr\.?|stutz)$/.test(currency)) return "CHF";
  if (/^(eur|euro|€)$/.test(currency)) return "EUR";
  if (/^(usd|us-dollar|dollar|us\$|\$)$/.test(currency)) return "USD";
  if (/^(gbp|pfund|pound|£)$/.test(currency)) return "GBP";
  return null;
};

const parsePriceNumber = (value?: string | null) => {
  const parsed = Number(String(value || "").replace("'", "").replace(",", "."));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const unitTypeFromText = (value?: string | null): string | null => {
  const source = normalizeCompare(value);
  if (!source) return null;

  if (/\b(stueck|stuck|stück|stk|piece|einheit|einheiten)\b/i.test(source)) return "piece";
  if (/\b(quadratmeter|qm|m2|m²|sqm)\b/i.test(source)) return "square_meter";
  if (/\b(kubikmeter|cbm|m3|m³)\b/i.test(source)) return "cubic_meter";
  if (/\b(stunde|stunden|std|hour|hours|h)\b/i.test(source)) return "hour";
  if (/\b(tag|tage|day|days)\b/i.test(source)) return "day";
  if (/\b(laufmeter|lfm|meter|m)\b/i.test(source)) return "meter";
  if (/\b(kg|kilogramm)\b/i.test(source)) return "kilogram";
  if (/\b(tonne|tonnen)\b/i.test(source)) return "ton";
  if (/\b(liter|ltr|l)\b/i.test(source)) return "liter";
  if (/\b(pauschal|pauschale|fixpreis|festpreis|flat)\b/i.test(source)) return "flat";

  return null;
};

const unitTypeFromDisplayUnit = (unit?: string | null): string | null => {
  const value = normalizeCompare(unit);
  if (!value) return null;

  if (["stueck", "stuck", "stück", "stk"].includes(value)) return "piece";
  if (["quadratmeter", "qm", "m2"].includes(value)) return "square_meter";
  if (["kubikmeter", "cbm", "m3"].includes(value)) return "cubic_meter";
  if (["stunde", "stunden", "std", "h"].includes(value)) return "hour";
  if (["tag", "tage"].includes(value)) return "day";
  if (["meter", "laufmeter", "lfm", "m"].includes(value)) return "meter";
  if (["kilogramm", "kg"].includes(value)) return "kilogram";
  if (["tonne", "tonnen"].includes(value)) return "ton";
  if (["liter", "ltr", "l"].includes(value)) return "liter";
  if (["pauschal", "pauschale", "fixpreis", "festpreis", "flat"].includes(value)) return "flat";

  return null;
};

const isFlatUnit = (unit?: string | null) => unitTypeFromDisplayUnit(unit) === "flat";

const roundMoney = (value: number) =>
  Math.round((value + Number.EPSILON) * 100) / 100;

const serviceTokens = (serviceName?: string | null) =>
  normalizeCompare(serviceName)
    .split(" ")
    .map((token) => token.trim())
    .filter((token) => token.length >= 4 && !GENERIC_SERVICE_WORDS.has(token));

function splitIntoPriceSegments(text?: string | null): string[] {
  const source = normalizeText(text);
  if (!source) return [];

  const lines = source
    .split(/\n+/g)
    .map((line) => line.trim())
    .filter(Boolean);

  const segments: string[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];

    const numberedParts = line
      .replace(/\s+(?=\d+[.)]\s+)/g, "\n")
      .split(/\n+/g)
      .flatMap((part) => part.split(/;|\s+•\s+|\s+\|\s+/g))
      .map((part) => part.trim())
      .filter(Boolean);

    segments.push(line, ...numberedParts);

    for (const part of numberedParts) {
      const sentenceParts = part
        .split(/(?<=[.!?])\s+/g)
        .map((piece) => piece.trim())
        .filter(Boolean);
      segments.push(...sentenceParts);
    }

    const next = lines[index + 1];
    if (next && line.length + next.length <= 320) {
      segments.push(`${line} ${next}`);
    }
  }

  return unique(segments);
}

function extractUnitPricesFromSegment(segment: string): DetectedUnitPrice[] {
  const source = normalizeText(segment);
  if (!source) return [];

  const results: Array<DetectedUnitPrice & { index: number }> = [];

  const patterns: Array<{
    re: RegExp;
    currencyGroup: number;
    priceGroup: number;
    unitGroup?: number;
  }> = [
    {
      re: new RegExp(`(${CURRENCY_WORDS})\\s*${PRICE_NUMBER}\\s*(?:pro|je|per|à|a|/)\\s*(${UNIT_WORDS})\\b`, "gi"),
      currencyGroup: 1,
      priceGroup: 2,
      unitGroup: 3,
    },
    {
      re: new RegExp(`${PRICE_NUMBER}\\s*(${CURRENCY_WORDS})\\s*(?:pro|je|per|à|a|/)\\s*(${UNIT_WORDS})\\b`, "gi"),
      currencyGroup: 2,
      priceGroup: 1,
      unitGroup: 3,
    },
    {
      re: new RegExp(`(?:preis|sonderpreis|vereinbart|ansatz|stundensatz|stundenansatz|tagessatz|zu|für|fuer|kostet|kosten|ist|=|:)\\s*(?:ist|von|zu|=|:)?\\s*(${CURRENCY_WORDS})\\s*${PRICE_NUMBER}\\s*(?:pro|je|per|à|a|/)\\s*(${UNIT_WORDS})\\b`, "gi"),
      currencyGroup: 1,
      priceGroup: 2,
      unitGroup: 3,
    },
    {
      re: new RegExp(`(?:preis|sonderpreis|vereinbart|ansatz|stundensatz|stundenansatz|tagessatz|zu|für|fuer|kostet|kosten|ist|=|:)\\s*(?:ist|von|zu|=|:)?\\s*${PRICE_NUMBER}\\s*(${CURRENCY_WORDS})\\s*(?:pro|je|per|à|a|/)\\s*(${UNIT_WORDS})\\b`, "gi"),
      currencyGroup: 2,
      priceGroup: 1,
      unitGroup: 3,
    },
    {
      re: new RegExp(`(?:stundenpreis|stundenansatz|stundensatz|tagessatz|quadratmeterpreis|meterpreis|stückpreis|stueckpreis|kilopreis|tonnenpreis|literpreis)\\s*(?:ist|von|zu|=|:)?\\s*(${CURRENCY_WORDS})\\s*${PRICE_NUMBER}\\b`, "gi"),
      currencyGroup: 1,
      priceGroup: 2,
    },
    {
      re: new RegExp(`(?:stundenpreis|stundenansatz|stundensatz|tagessatz|quadratmeterpreis|meterpreis|stückpreis|stueckpreis|kilopreis|tonnenpreis|literpreis)\\s*(?:ist|von|zu|=|:)?\\s*${PRICE_NUMBER}\\s*(${CURRENCY_WORDS})\\b`, "gi"),
      currencyGroup: 2,
      priceGroup: 1,
    },
    {
      re: new RegExp(`(?:pauschal|pauschale|fixpreis|festpreis)\\s*(${CURRENCY_WORDS})\\s*${PRICE_NUMBER}\\b`, "gi"),
      currencyGroup: 1,
      priceGroup: 2,
    },
    {
      re: new RegExp(`(${CURRENCY_WORDS})\\s*${PRICE_NUMBER}\\s*(?:pauschal|pauschale|fixpreis|festpreis)\\b`, "gi"),
      currencyGroup: 1,
      priceGroup: 2,
    },
  ];

  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern.re)) {
      const currency = normalizeCurrency(match[pattern.currencyGroup]);
      const amount = parsePriceNumber(match[pattern.priceGroup]);
      const unitType = pattern.unitGroup ? unitTypeFromText(match[pattern.unitGroup]) : unitTypeFromText(match[0]);
      if (!amount || !currency) continue;

      results.push({
        amount,
        currency,
        segment: source,
        unitType,
        index: match.index ?? 0,
      });
    }
  }

  const byKey = new Map<string, DetectedUnitPrice & { index: number }>();
  for (const result of results) {
    // Mehrere Regex-Varianten können denselben Preis im selben Segment finden.
    // Für die Entscheidung zählt der Preis fachlich nur einmal.
    const key = `${result.amount}:${result.currency}:${result.unitType || ""}:${normalizeCompare(result.segment)}`;
    if (!byKey.has(key)) byKey.set(key, result);
  }

  return Array.from(byKey.values()).sort((a, b) => a.index - b.index);
}

function chooseBestPriceFromSegment(segment: string): DetectedUnitPrice | null {
  const prices = extractUnitPricesFromSegment(segment);
  if (prices.length === 0) return null;
  if (prices.length === 1) return prices[0];

  const normalized = normalizeCompare(segment);
  const correctionSignal =
    /\b(final|verwenden|nehmen|korrigiert|korrektur|schlussendlich|stattdessen|bitte aber|nicht der normale|sonderpreis)\b/i.test(
      normalized,
    );

  if (correctionSignal) {
    return prices[prices.length - 1];
  }

  // Mehrere Preise im selben Segment ohne Korrektur-Signal sind gefährlich.
  // Nicht raten, sondern die Aufteilung/Zuordnung über bessere Segmente suchen.
  return null;
}

function detectCurrencylessFlatPriceFromSegment(
  segment: string,
  fallbackCurrency: IntakeCurrency,
): DetectedUnitPrice | null {
  const source = normalizeText(segment);
  if (!source) return null;
  if (!/\b(pauschal|pauschale|fixpreis|festpreis)\b/i.test(source)) return null;

  const patterns = [
    /\b(?:pauschal|pauschale|fixpreis|festpreis)\s*(?:ist|von|zu|=|:)?\s*(\d+(?:[.,]\d{1,2})?)\b/i,
    /\b(\d+(?:[.,]\d{1,2})?)\s*(?:pauschal|pauschale|fixpreis|festpreis)\b/i,
  ];

  for (const pattern of patterns) {
    const match = source.match(pattern);
    const amount = parsePriceNumber(match?.[1]);
    if (!amount) continue;

    return {
      amount,
      currency: fallbackCurrency,
      segment: source,
      unitType: "flat",
    };
  }

  return null;
}

function normalizeFlatServiceNameFromText(value: string): string {
  const normalized = normalizeCompare(value);
  if (/\btiefgarage\b/.test(normalized) && /\b(reinigen|reinigung|putzen)\b/.test(normalized)) {
    return "Reinigung tiefgarage";
  }
  if (/\bgarage\b/.test(normalized) && /\b(reinigen|reinigung|putzen)\b/.test(normalized)) {
    return "Garagenreinigung";
  }

  return value
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^./, (char) => char.toUpperCase());
}

function segmentContainsQuantity(
  segment: string,
  quantity: number,
  unitType: string | null,
) {
  if (!quantity || quantity <= 0) return false;
  const normalized = normalizeCompare(segment);
  const q = String(quantity).replace(".", "[.,]?");
  if (!new RegExp(`\\b${q}\\b`).test(normalized)) return false;

  if (!unitType) return true;
  const segmentUnit = unitTypeFromText(segment);
  return !segmentUnit || segmentUnit === unitType;
}

function detectExplicitUnitPriceForItem(
  originalText: string,
  item: ParsedOrderItemForValidation,
): DetectedUnitPrice | null {
  const itemEvidence = [item.sourceText, item.evidence, item.description]
    .map((part) => normalizeText(part))
    .filter(Boolean)
    .join("\n");

  const itemUnitType = unitTypeFromDisplayUnit(item.unit);
  const itemQuantity = Number(item.quantity || 0);
  const serviceKey = normalizeCompare(item.serviceName);
  const tokens = serviceTokens(item.serviceName);

  const candidates = [
    ...splitIntoPriceSegments(itemEvidence),
    ...splitIntoPriceSegments(originalText),
  ];

  let best: { detected: DetectedUnitPrice; score: number } | null = null;

  for (const segment of candidates) {
    const normalizedSegment = normalizeCompare(segment);
    if (!normalizedSegment) continue;

    const detected = chooseBestPriceFromSegment(segment);
    if (!detected) continue;

    let score = 0;

    if (serviceKey && normalizedSegment.includes(serviceKey)) score += 150;
    for (const token of tokens) {
      if (normalizedSegment.includes(token)) score += 45;
    }

    if (itemEvidence && normalizeCompare(itemEvidence).includes(normalizedSegment)) {
      score += 80;
    }

    if (segmentContainsQuantity(segment, itemQuantity, itemUnitType)) {
      score += 110;
    }

    if (itemUnitType && detected.unitType) {
      if (itemUnitType === detected.unitType) score += 90;
      else score -= 140;
    }

    if (segment.length <= 180) score += 20;
    if (segment.length > 320) score -= 80;

    // Avoid matching "Fenster reinigen im Treppenhaus" as Treppenhaus reinigen.
    if (
      serviceKey.includes("treppenhaus") &&
      normalizedSegment.includes("fenster") &&
      detected.unitType === "piece"
    ) {
      score -= 180;
    }

    if (score < 90) continue;
    if (!best || score > best.score) best = { detected, score };
  }

  return best?.detected || null;
}

function detectFlatPriceItems(
  originalText: string,
  existingItems: ParsedOrderItemForValidation[],
  fallbackCurrency: IntakeCurrency,
): ParsedOrderItemForValidation[] {
  const existingKeys = new Set(
    existingItems.map((item) => normalizeCompare(item.serviceName)),
  );
  const segments = splitIntoPriceSegments(originalText);
  const result: ParsedOrderItemForValidation[] = [];

  for (const segment of segments) {
    const normalized = normalizeCompare(segment);
    if (!/\b(pauschal|pauschale|fixpreis|festpreis)\b/i.test(normalized)) {
      continue;
    }

    const detected =
      chooseBestPriceFromSegment(segment) ||
      detectCurrencylessFlatPriceFromSegment(segment, fallbackCurrency);
    if (!detected || detected.currency !== fallbackCurrency) continue;

    const beforeFlat = segment
      .split(/\b(?:pauschal|pauschale|fixpreis|festpreis)\b/i)[0]
      ?.replace(/^\s*(leistung|leistungen|bitte|zusätzlich|zusaetzlich|und|plus|[0-9]+[.)])\s*[:\-–—]?\s*/i, "")
      .replace(/[,;:.]+$/g, "")
      .trim();

    if (!beforeFlat || beforeFlat.length < 4 || beforeFlat.length > 80) {
      continue;
    }

    const serviceName = normalizeFlatServiceNameFromText(beforeFlat);

    const key = normalizeCompare(serviceName);
    if (!key || existingKeys.has(key)) continue;

    // Do not duplicate if an existing item shares a strong token with the flat item.
    const tokens = serviceTokens(serviceName);
    const alreadyRepresented = existingItems.some((item) => {
      const itemKey = normalizeCompare(item.serviceName);
      return tokens.length > 0 && tokens.some((token) => itemKey.includes(token));
    });
    if (alreadyRepresented) continue;

    result.push({
      serviceName,
      description: segment,
      quantity: 1,
      unit: "Pauschal",
      unitPrice: detected.amount,
      totalPrice: detected.amount,
      needsReview: true,
      reviewReason: "manual_flat_service_from_text",
      sourceText: segment,
      evidence: segment,
      detectedCurrency: detected.currency,
    });

    existingKeys.add(key);
  }

  return result;
}

function removeItemsUsingForeignFlatPrice(
  originalText: string,
  items: ParsedOrderItemForValidation[],
  fallbackCurrency: IntakeCurrency,
): ParsedOrderItemForValidation[] {
  const flatItems = detectFlatPriceItems(originalText, [], fallbackCurrency);
  if (flatItems.length === 0) return items;

  const flatAmounts = new Set(flatItems.map((item) => roundMoney(Number(item.unitPrice || 0))));
  const flatServiceKeys = flatItems.map((item) => normalizeCompare(item.serviceName));

  return items.filter((item) => {
    if (isFlatUnit(item.unit)) return true;

    const itemPrice = roundMoney(Number(item.unitPrice || 0));
    if (!flatAmounts.has(itemPrice)) return true;

    const itemKey = normalizeCompare(item.serviceName);
    const isSameFlatDomain = flatServiceKeys.some((flatKey) => {
      if (!flatKey || !itemKey) return false;
      return flatKey.includes(itemKey) || itemKey.includes(flatKey);
    });

    if (isSameFlatDomain) return true;

    // V11 fail-safe: Fremde Pauschale nicht als Stück-/Stundenpreis speichern.
    return false;
  });
}

function calculateSafeLineTotal(item: ParsedOrderItemForValidation) {
  const quantity = Number(item.quantity || 0);
  const unitPrice = Number(item.unitPrice || 0);

  if (!Number.isFinite(unitPrice) || unitPrice <= 0) return 0;
  if (isFlatUnit(item.unit)) return roundMoney(unitPrice);
  if (!Number.isFinite(quantity) || quantity <= 0) return 0;

  return roundMoney(quantity * unitPrice);
}


const QUANTITY_REVIEW_REASON_PATTERN =
  /(menge|quantity|leistung_ist_pauschal|pauschal|pruefen|prüfen)/i;

function findAmbiguousQuantityRanges(text?: string | null): Array<{
  lower: number;
  upper: number;
  unitType: string | null;
  segment: string;
  serviceName: string | null;
}> {
  const source = normalizeText(text);
  if (!source) return [];

  const pieces = source
    .split(/\n+|(?<=[.!?])\s+|;/g)
    .map((piece) => piece.trim())
    .filter(Boolean);

  const ranges: Array<{
    lower: number;
    upper: number;
    unitType: string | null;
    segment: string;
    serviceName: string | null;
  }> = [];

  const rangePattern = new RegExp(
    `(.{0,90}?)\\b(\\d+(?:[.,]\\d+)?)\\s*(?:oder|bis|und|/|-|–|—)\\s*(\\d+(?:[.,]\\d+)?)\\s*(${UNIT_WORDS})\\b`,
    "gi",
  );

  for (const piece of pieces) {
    for (const match of piece.matchAll(rangePattern)) {
      const lower = parsePriceNumber(match[2]);
      const upper = parsePriceNumber(match[3]);
      if (!lower || !upper || lower === upper) continue;

      const before = normalizeText(match[1] || "")
        .replace(/^.*?\b(leisti?ung|arbeiten?|zu machen|bitte)\b\s*[:\-–—]?\s*/i, "")
        .replace(/\b(ungefähr|ungefaehr|circa|ca\.?|etwa|rund)\b/gi, "")
        .replace(/[,;:.]+$/g, "")
        .trim();

      let serviceName: string | null = before || null;
      if (serviceName) {
        serviceName = serviceName
          .replace(/\s+/g, " ")
          .trim()
          .replace(/^./, (char) => char.toUpperCase());
      }

      ranges.push({
        lower,
        upper,
        unitType: unitTypeFromText(match[4]),
        segment: piece,
        serviceName,
      });
    }
  }

  return ranges;
}

function isGenericRangeArtifact(item: ParsedOrderItemForValidation) {
  const name = normalizeCompare(item.serviceName);
  if (!name) return false;

  return (
    name === "lange" ||
    name === "laenge" ||
    name === "länge" ||
    name === "meter" ||
    name === "strecke" ||
    name === "anzahl" ||
    name === "menge" ||
    name.startsWith("lange ") ||
    name.startsWith("laenge ") ||
    name.startsWith("länge ")
  );
}

function repairAmbiguousQuantityRangeItems(
  originalText: string,
  items: ParsedOrderItemForValidation[],
): ParsedOrderItemForValidation[] {
  const ranges = findAmbiguousQuantityRanges(originalText);
  if (ranges.length === 0) return items;

  const rangeUnits = new Set(ranges.map((range) => range.unitType).filter(Boolean));
  const rangeValues = new Set<number>();
  for (const range of ranges) {
    rangeValues.add(range.lower);
    rangeValues.add(range.upper);
  }

  const cleaned: ParsedOrderItemForValidation[] = [];
  let primaryRangeItemSeen = false;

  for (const item of items) {
    const itemUnitType = unitTypeFromDisplayUnit(item.unit);
    const itemQuantity = Number(item.quantity || 0);
    const itemName = normalizeCompare(item.serviceName);
    const itemText = normalizeCompare(
      [item.serviceName, item.description, item.sourceText, item.evidence]
        .filter(Boolean)
        .join(" "),
    );

    const isRangeArtifact =
      isGenericRangeArtifact(item) &&
      (!itemUnitType || rangeUnits.has(itemUnitType)) &&
      (!itemQuantity || rangeValues.has(itemQuantity));

    if (isRangeArtifact) {
      // Do not keep helper rows like "Länge" that were created from
      // "10 oder 11 Meter". They create a false total.
      continue;
    }

    const matchingRange = ranges.find((range) => {
      const rangeName = normalizeCompare(range.serviceName);
      if (rangeName && itemText.includes(rangeName)) return true;
      if (itemName && range.segment && normalizeCompare(range.segment).includes(itemName)) return true;
      return false;
    });

    if (matchingRange && !primaryRangeItemSeen) {
      const priceFromRange = chooseBestPriceFromSegment(matchingRange.segment);
      const next: ParsedOrderItemForValidation = {
        ...item,
        serviceName: matchingRange.serviceName || item.serviceName,
        unit: unitTypeToDisplayUnit(matchingRange.unitType) || item.unit,
        unitPrice: priceFromRange?.amount || item.unitPrice,
        quantity: 0,
        totalPrice: 0,
        needsReview: true,
        reviewReason: "quantity_review",
        sourceText: item.sourceText || matchingRange.segment,
        evidence: item.evidence || matchingRange.segment,
      };

      cleaned.push(next);
      primaryRangeItemSeen = true;
      continue;
    }

    cleaned.push(item);
  }

  return cleaned;
}

function unitTypeToDisplayUnit(unitType?: string | null): string | null {
  switch (unitType) {
    case "piece":
      return "Stück";
    case "square_meter":
      return "Quadratmeter";
    case "cubic_meter":
      return "Kubikmeter";
    case "hour":
      return "Stunde";
    case "day":
      return "Tag";
    case "meter":
      return "Meter";
    case "kilogram":
      return "Kilogramm";
    case "ton":
      return "Tonne";
    case "liter":
      return "Liter";
    case "flat":
      return "Pauschal";
    default:
      return null;
  }
}

export function validateAndRepairParsedOrderItems(
  input: IntakeValidationInput,
): IntakeValidationResult {
  const reviewReasons: string[] = [];
  const detectedCurrencies = detectCurrenciesInText(input.originalText);
  const supportedDetectedCurrencies = detectedCurrencies.filter(
    (currency): currency is IntakeCurrency => currency === "CHF" || currency === "EUR",
  );
  const unsupportedDetectedCurrencies = detectedCurrencies.filter(
    (currency) => currency !== "CHF" && currency !== "EUR",
  );

  let finalCurrency: IntakeCurrency = input.fallbackCurrency;

  if (detectedCurrencies.length > 1) {
    reviewReasons.push("currency_conflict", "currency_review");
  } else if (unsupportedDetectedCurrencies.length > 0) {
    reviewReasons.push("currency_unsupported", "currency_review");
  } else if (supportedDetectedCurrencies.length === 1) {
    finalCurrency = supportedDetectedCurrencies[0];
  }

  let items = input.items.map((item) => {
    const quantity = Number(item.quantity || 0);
    const unitPrice = Number(item.unitPrice || 0);
    const next: ParsedOrderItemForValidation = {
      ...item,
      quantity: Number.isFinite(quantity) ? quantity : 0,
      unitPrice: Number.isFinite(unitPrice) ? unitPrice : 0,
    };

    const itemReasons: string[] = [];

    // Pauschalpreise haben fachlich keine Mengenberechnung. Für die UI und
    // die gespeicherte Summe setzen wir sie intern auf Menge 1, damit nicht
    // fälschlich "Menge prüfen" und Total CHF 0.00 entsteht.
    if (isFlatUnit(next.unit) && next.unitPrice > 0) {
      next.quantity = 1;
      if (next.reviewReason && QUANTITY_REVIEW_REASON_PATTERN.test(next.reviewReason)) {
        next.reviewReason = null;
        next.needsReview = false;
      }
    }

    const explicitUnitPrice = detectExplicitUnitPriceForItem(
      input.originalText,
      next,
    );

    if (explicitUnitPrice) {
      const explicitCurrency = explicitUnitPrice.currency;
      const supportedCurrency = explicitCurrency === "CHF" || explicitCurrency === "EUR";
      const canUseExplicitPrice = supportedCurrency && explicitCurrency === finalCurrency;

      if (canUseExplicitPrice) {
        if (Math.abs(Number(next.unitPrice || 0) - explicitUnitPrice.amount) >= 0.01) {
          itemReasons.push(
            `price_repaired_from_text:${next.serviceName}:${Number(next.unitPrice || 0)}:${explicitUnitPrice.amount}`,
          );
        }
        next.unitPrice = explicitUnitPrice.amount;
      } else {
        next.unitPrice = 0;
        itemReasons.push(
          `item_currency_mismatch:${next.serviceName}:${explicitCurrency || "UNKNOWN"}:${finalCurrency}`,
          "currency_review",
        );
      }
    }

    const safeTotal = calculateSafeLineTotal(next);
    next.totalPrice = safeTotal;

    if (next.unitPrice <= 0) itemReasons.push("unit_price_review");
    if (!isFlatUnit(next.unit) && next.quantity <= 0) itemReasons.push("quantity_review");
    if (safeTotal > 50000) itemReasons.push("total_unrealistic_check");

    if (itemReasons.length > 0) {
      next.needsReview = true;
      if (!next.reviewReason) next.reviewReason = itemReasons[0];
      reviewReasons.push(...itemReasons);
    }

    return next;
  });

  const missingFlatItems = detectFlatPriceItems(input.originalText, items, finalCurrency);
  if (missingFlatItems.length > 0) {
    items = [...missingFlatItems, ...items];
    reviewReasons.push("manual_flat_service_from_text");
  }

  items = removeItemsUsingForeignFlatPrice(input.originalText, items, finalCurrency);

  items = repairAmbiguousQuantityRangeItems(input.originalText, items).map((item) => {
    if (!isFlatUnit(item.unit) || item.unitPrice <= 0) return item;

    const next = {
      ...item,
      quantity: 1,
      totalPrice: calculateSafeLineTotal({ ...item, quantity: 1 }),
    };

    if (next.reviewReason && QUANTITY_REVIEW_REASON_PATTERN.test(next.reviewReason)) {
      next.reviewReason = null;
      next.needsReview = false;
    }

    return next;
  });

  return {
    items,
    reviewReasons: unique(reviewReasons),
    needsReview: reviewReasons.length > 0 || items.some((item) => item.needsReview),
    finalCurrency,
    detectedCurrencies,
  };
}

const EXECUTION_ADDRESS_MARKER =
  /\b(ausführungsadresse|ausfuehrungsadresse|ausführende\s+adresse|ausfuehrende\s+adresse|ausführungsort|ausfuehrungsort|ausführung|ausfuehrung|arbeitsort|arbeitsadresse|einsatzort|baustellenadresse|baustelle|objektadresse|objekt|leistungsadresse|leistungsort|serviceadresse|montageadresse|reinigungsadresse|ort\s+der\s+ausführung|ort\s+der\s+ausfuehrung|adresse\s+vor\s+ort|adresse\s+wo\s+gearbeitet\s+wird|work\s+address|job\s+site|job\s+address|service\s+address|site\s+address|location\s+of\s+work|adresse\s+d[’']intervention|adresse\s+du\s+chantier|lieu\s+d[’']intervention|dirección\s+de\s+trabajo|direccion\s+de\s+trabajo|dirección\s+de\s+obra|direccion\s+de\s+obra|lugar\s+de\s+trabajo|indirizzo\s+di\s+lavoro|indirizzo\s+cantiere|luogo\s+di\s+intervento)\b/i;

const STOP_MARKER =
  /\b(rechnungsadresse|rechnung\s+an|kunde|kundendaten|leistung|leistungen|preis|preise|kosten|telefon|tel\.?|e-mail|email|mail|bemerkung|bemerkungen|hinweis|hinweise|notiz|notizen|bitte|termin|datum|mwst|währung|waehrung|kundennachricht|whatsapp)\b/i;

const ADDRESS_WORD_PATTERN =
  /(?:strasse|straße|str\.?|weg|gasse|platz|allee|ring|rain|halde|steig|route|rue|avenue|av\.?|chemin|via|viale|street|road|lane)/i;

function cleanAddressLine(value: string): string {
  return normalizeText(value)
    .replace(EXECUTION_ADDRESS_MARKER, "")
    .replace(STOP_MARKER, "")
    .replace(/[,;]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^[:\-–—]+\s*/, "")
    .replace(/\s*[:\-–—]+\s*$/, "")
    .trim();
}

function parseStreet(value: string): string | null {
  const text = cleanAddressLine(value);
  if (!text) return null;

  const streetSuffix =
    "(?:strasse|straße|str\\.?|weg|gasse|platz|allee|ring|rain|halde|steig|route|rue|avenue|av\\.?|chemin|via|viale|street|road|lane)";

  const houseNumber = "\\d+[a-zA-Z]?(?:\\s*[/-]\\s*\\d+[a-zA-Z]?)?";

  const streetCandidates: string[] = [];

  // Most Swiss/German street names are one compact token ending in -strasse/-weg/etc.
  // Important: do NOT allow arbitrary words before the street token here.
  // Before V9, this could capture "Garage Haus Nord Bergstrasse 24" as one street.
  const compactStreet = new RegExp(
    `\\b([A-ZÄÖÜ][A-Za-zÄÖÜäöüß'.-]*${streetSuffix}\\s+${houseNumber})\\b`,
    "gi",
  );

  for (const match of text.matchAll(compactStreet)) {
    const candidate = match[1]?.replace(/\s+/g, " ").trim();
    if (candidate) streetCandidates.push(candidate);
  }

  // Controlled multi-word street names, without swallowing object names like
  // "Wohnanlage Seefeld" / "Garage Haus Nord" / "Innenhof Haus C".
  const allowedStreetPrefix =
    "(?:Alte|Neue|Ober(?:e|er|es)?|Unter(?:e|er|es)?|Mittlere|Hintere|Vordere|Kleine|Grosse|Große|Sankt|St\\.?|Im|Am|Zum|Zur|Auf\\s+der|An\\s+der)";
  const prefixedStreet = new RegExp(
    `\\b(${allowedStreetPrefix}\\s+[A-ZÄÖÜ][A-Za-zÄÖÜäöüß'.-]*${streetSuffix}\\s+${houseNumber})\\b`,
    "gi",
  );

  for (const match of text.matchAll(prefixedStreet)) {
    const candidate = match[1]?.replace(/\s+/g, " ").trim();
    if (candidate) streetCandidates.push(candidate);
  }

  const cleanedCandidates = unique(streetCandidates)
    .map((candidate) => candidate.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  if (cleanedCandidates.length > 0) {
    // Prefer the last concrete street token when polluted evidence contains
    // object text before the real street.
    return cleanedCandidates[cleanedCandidates.length - 1];
  }

  return null;
}
function parsePlzCity(value: string): { plz: string | null; city: string | null } {
  const text = cleanAddressLine(value);
  const match = text.match(/\b(\d{4,5})\s+([A-ZÄÖÜ][A-Za-zÄÖÜäöüß' .\-]{2,60})\b/);
  if (!match) return { plz: null, city: null };

  const rawCity = match[2] || "";
  const city = rawCity
    .replace(EXECUTION_ADDRESS_MARKER, "")
    .replace(STOP_MARKER, "")
    .replace(/\b(ausführungsadresse|ausfuehrungsadresse|ausführende|ausfuehrende|adresse|arbeitsort|baustelle|objekt|ort\s+der\s+ausführung|ort\s+der\s+ausfuehrung)\b/gi, "")
    // Cut accidental continuation text after a plausible city.
    .replace(/\b(leisting|leistung|leistungen|bitte|preis|preise|kosten|fenster|treppenhaus|reinigung|reinigen|farbreste|hecke|garage|tiefgarage|pauschal)\b.*$/gi, "")
    .replace(/\s+/g, " ")
    .trim();

  return {
    plz: match[1] || null,
    city: city || null,
  };
}

function stripMarker(value: string) {
  return cleanAddressLine(value);
}

function isLikelyAddressStreetLine(value: string): boolean {
  const text = cleanAddressLine(value);
  return ADDRESS_WORD_PATTERN.test(text) && /\d/.test(text);
}

// INTAKE_EXECUTION_ADDRESS_SAFE_EMPTY_V11
const SOFT_EXECUTION_ADDRESS_LINE_PATTERN =
  /\b(liegenschaft|arbeitsort|arbeitsadresse|arbeit\s+(?:ist|isch|is|wird)|gearbeitet\s+wird|work\s+location|job\s+location|lieu\s+du\s+travail|ort\s+der\s+arbeit|sondern\s+(?:in|im|bei))\b/i;

function isLikelyServiceOrPriceLine(value: string): boolean {
  const text = normalizeCompare(value);
  if (!text) return false;

  const hasWorkVerb =
    /\b(reinigen|reinigung|putzen|schneiden|stutzen|entfernen|streichen|malen|maehen|mähen|montieren|demontieren|reparieren|liefern|entsorgen|entsorgung)\b/i.test(text);
  const hasQtyOrPrice =
    /\b\d+(?:[.,]\d+)?\s*(?:stueck|stuck|stück|stk|quadratmeter|qm|m2|meter|stunde|stunden|std|h|tag|tage)\b/i.test(text) ||
    /\b(?:preis|ansatz|stutz|chf|eur|euro|usd|dollar|pauschal|pro|per|je)\b/i.test(text);

  return hasWorkVerb && hasQtyOrPrice;
}

function cleanSiteNameCandidate(value?: string | null): string | null {
  let candidate = normalizeText(value || "")
    .replace(EXECUTION_ADDRESS_MARKER, " ")
    .replace(/[,;:.]+$/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!candidate) return null;

  candidate = candidate
    .replace(/^.*?\bsondern\s+(?:in\s+der|in\s+dem|im|in|bei\s+der|bei|bi\s+de|bi)\s+/i, "")
    .replace(/^.*?\b(?:liegenschaft|objektadresse|objekt|baustelle|arbeitsort|arbeitsadresse|leistungsort|serviceadresse|job\s+site|job\s+location|work\s+location|lieu\s+du\s+travail)\b\s*(?:ist|isch|is|:)?\s*/i, "")
    .replace(/^.*?\b(?:arbeit\s+(?:ist|isch|is)|gearbeitet\s+wird)\b\s*(?:aber\s+)?(?:drueben|drüben)?\s*(?:bei\s+der|bei|bi\s+de|bi|in\s+der|in\s+dem|im|in)?\s*/i, "")
    .replace(/^(?:es\s+(?:geht|goht)\s+um(?:s)?|ist|isch|is|aber|drueben|drüben|bei\s+der|bei|bi\s+de|bi|in\s+der|in\s+dem|im|in|de|der|die|das)\s+/i, "")
    .replace(/^[:\-–—]+\s*/, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!candidate) return null;

  const softSplit = candidate.split(/\b(?:liegenschaft|objekt|baustelle|arbeitsort|arbeitsadresse|leistungsort|sondern)\b/i);
  candidate = (softSplit[softSplit.length - 1] || candidate)
    .replace(/^(?:es\s+(?:geht|goht)\s+um(?:s)?|ist|isch|is|in\s+der|in\s+dem|im|in|bei\s+der|bei|bi\s+de|bi|de|der|die|das)\s+/i, "")
    .replace(/[,;:.]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();

  return candidate || null;
}

function isSafeSiteNameCandidate(value?: string | null): boolean {
  const candidate = normalizeText(value || "");
  const key = normalizeCompare(candidate);
  if (!candidate || !key) return false;
  if (candidate.length < 3 || candidate.length > 80) return false;
  if (/\b\d{4,5}\b/.test(candidate)) return false;
  if (/\b\d+(?:[.,]\d+)?\s*(?:stueck|stuck|stück|stk|quadratmeter|qm|m2|meter|stunde|stunden|std|h|tag|tage)\b/i.test(key)) return false;
  if (/\b(chf|franken|stutz|eur|euro|usd|dollar|preis|ansatz|pauschal|pro|per|je)\b/i.test(key)) return false;
  if (/\b(reinigen|reinigung|putzen|schneiden|stutzen|entfernen|streichen|malen|maehen|mähen|montieren|demontieren|reparieren|liefern|entsorgen|entsorgung)\b/i.test(key)) return false;
  if (ADDRESS_WORD_PATTERN.test(candidate)) return false;
  if (STOP_MARKER.test(candidate)) return false;
  if (EXECUTION_ADDRESS_MARKER.test(candidate)) return false;

  const blocked = new Set(["ist", "isch", "is", "dort", "hier", "adresse", "ausfuehrungsadresse", "ausführungsadresse"]);
  if (blocked.has(key)) return false;

  return true;
}

function extractInlineExecutionAddressCandidate(
  line: string,
  customer?: {
    customerAddress?: string | null;
    customerPlz?: string | null;
    customerCity?: string | null;
  },
): ExtractedExecutionAddress | null {
  const raw = normalizeText(line);
  if (!raw) return null;
  if (!EXECUTION_ADDRESS_MARKER.test(raw) && !SOFT_EXECUTION_ADDRESS_LINE_PATTERN.test(raw)) {
    return null;
  }

  const siteAddress = parseStreet(raw);
  const plzCity = parsePlzCity(raw);
  if (!siteAddress || !plzCity.plz || !plzCity.city) return null;

  if (
    isSameAddress({
      extractedAddress: siteAddress,
      extractedPlz: plzCity.plz,
      extractedCity: plzCity.city,
      customerAddress: customer?.customerAddress,
      customerPlz: customer?.customerPlz,
      customerCity: customer?.customerCity,
    })
  ) {
    return null;
  }

  const beforeStreet = raw.split(new RegExp(escapeRegExp(siteAddress), "i"))[0] || "";
  const siteNameCandidate = cleanSiteNameCandidate(beforeStreet);
  const siteName = isSafeSiteNameCandidate(siteNameCandidate) ? siteNameCandidate : null;

  return {
    siteName,
    siteAddress,
    sitePlz: plzCity.plz,
    siteCity: plzCity.city,
    siteNote: null,
  };
}

function isSameAddress(args: {
  extractedAddress?: string | null;
  extractedPlz?: string | null;
  extractedCity?: string | null;
  customerAddress?: string | null;
  customerPlz?: string | null;
  customerCity?: string | null;
}) {
  const extracted = normalizeCompare(
    [args.extractedAddress, args.extractedPlz, args.extractedCity].filter(Boolean).join(" "),
  );
  const customer = normalizeCompare(
    [args.customerAddress, args.customerPlz, args.customerCity].filter(Boolean).join(" "),
  );

  return Boolean(extracted && customer && extracted === customer);
}

function getExecutionAddressCandidates(lines: string[], markerIndex: number) {
  const blockLines: string[] = [];
  const markerLine = lines[markerIndex] || "";
  const sameLine = stripMarker(markerLine);

  if (sameLine && !STOP_MARKER.test(sameLine)) blockLines.push(sameLine);

  for (let offset = 1; offset <= 5; offset += 1) {
    const nextLine = lines[markerIndex + offset];
    if (!nextLine) continue;
    if (EXECUTION_ADDRESS_MARKER.test(nextLine)) break;

    const cleaned = stripMarker(nextLine);
    if (!cleaned) continue;

    if (
      STOP_MARKER.test(nextLine) &&
      !isLikelyAddressStreetLine(nextLine) &&
      !parsePlzCity(nextLine).plz
    ) {
      break;
    }

    // V11: Service-/Preis-Sätze dürfen nicht als Objektname in den Adressblock laufen.
    if (isLikelyServiceOrPriceLine(cleaned)) {
      break;
    }

    blockLines.push(cleaned);

    const hasStreet = blockLines.some((line) => Boolean(parseStreet(line)));
    const hasPlzCity = blockLines.some((line) => Boolean(parsePlzCity(line).plz));
    if (hasStreet && hasPlzCity) break;
  }

  return blockLines;
}

function hasSuspiciousStreetPlzMix(siteAddress: string | null, sitePlz: string | null) {
  if (!siteAddress || !sitePlz) return false;
  const streetNumber = siteAddress.match(/\b(\d{4,5})\b/)?.[1] || null;
  return Boolean(streetNumber && streetNumber === sitePlz);
}

function findBestStreet(blockLines: string[]): string | null {
  const lineStreet = blockLines
    .map((candidate) => parseStreet(candidate))
    .find(Boolean);

  if (lineStreet) return lineStreet;

  // Fallback only for compact one-line addresses. Do not allow this fallback
  // to turn the PLZ into a fake house number.
  const joined = blockLines.join(" ");
  const joinedStreet = parseStreet(joined);
  const joinedPlz = parsePlzCity(joined).plz;
  if (hasSuspiciousStreetPlzMix(joinedStreet, joinedPlz)) return null;

  return joinedStreet;
}


function sanitizeStreetAgainstSiteName(
  siteAddress: string | null,
  siteName: string | null,
  sitePlz: string | null,
): string | null {
  const raw = cleanAddressLine(siteAddress || "");
  if (!raw) return null;

  const fromStreetParser = parseStreet(raw);
  let cleaned = fromStreetParser || raw;

  const nameKey = normalizeCompare(siteName);
  if (nameKey) {
    const cleanedKey = normalizeCompare(cleaned);
    if (cleanedKey.startsWith(nameKey + " ")) {
      const withoutName = cleaned.replace(new RegExp(`^\\s*${escapeRegExp(siteName || "")}\\s+`, "i"), "").trim();
      cleaned = parseStreet(withoutName) || withoutName || cleaned;
    }
  }

  const reparsed = parseStreet(cleaned);
  if (reparsed) cleaned = reparsed;

  if (sitePlz && hasSuspiciousStreetPlzMix(cleaned, sitePlz)) {
    return null;
  }

  return cleaned || null;
}

function escapeRegExp(value: string): string {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function pickSiteName(blockLines: string[], siteAddress: string | null, sitePlz: string | null) {
  for (const candidate of blockLines) {
    const cleaned = cleanSiteNameCandidate(stripMarker(candidate));
    if (!cleaned) continue;
    if (siteAddress && normalizeCompare(cleaned) === normalizeCompare(siteAddress)) continue;
    if (parseStreet(cleaned)) continue;
    if (parsePlzCity(cleaned).plz) continue;
    if (sitePlz && cleaned.includes(sitePlz)) continue;
    if (!isSafeSiteNameCandidate(cleaned)) continue;
    return cleaned;
  }

  // V11 fail-safe: lieber keinen Objektnamen speichern als einen Satzrest.
  return null;
}
export function extractExecutionAddressFromText(
  text?: string | null,
  customer?: {
    customerAddress?: string | null;
    customerPlz?: string | null;
    customerCity?: string | null;
  },
): ExtractedExecutionAddress | null {
  const source = normalizeText(text);
  if (!source || (!EXECUTION_ADDRESS_MARKER.test(source) && !SOFT_EXECUTION_ADDRESS_LINE_PATTERN.test(source))) return null;

  const lines = source
    .split(/\n+|(?<=[.!?])\s+/g)
    .map((line) => line.trim())
    .filter(Boolean);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!EXECUTION_ADDRESS_MARKER.test(line) && !SOFT_EXECUTION_ADDRESS_LINE_PATTERN.test(line)) continue;

    const inlineAddress = extractInlineExecutionAddressCandidate(line, customer);
    if (inlineAddress) return inlineAddress;

    const blockLines = getExecutionAddressCandidates(lines, index);
    if (blockLines.length === 0) continue;

    const siteAddress = findBestStreet(blockLines);

    const plzCityFromLine = blockLines
      .map((candidate) => parsePlzCity(candidate))
      .find((candidate) => candidate.plz && candidate.city);

    const fallbackPlzCity = parsePlzCity(blockLines.join(" "));
    const sitePlz = plzCityFromLine?.plz || fallbackPlzCity.plz;
    const siteCity = plzCityFromLine?.city || fallbackPlzCity.city;

    if (!siteAddress && !(sitePlz && siteCity)) continue;

    if (
      isSameAddress({
        extractedAddress: siteAddress,
        extractedPlz: sitePlz,
        extractedCity: siteCity,
        customerAddress: customer?.customerAddress,
        customerPlz: customer?.customerPlz,
        customerCity: customer?.customerCity,
      })
    ) {
      return null;
    }

    const siteName = pickSiteName(blockLines, siteAddress, sitePlz);
    const cleanSiteAddress = sanitizeStreetAgainstSiteName(siteAddress, siteName, sitePlz);

    return {
      siteName,
      siteAddress: cleanSiteAddress || siteAddress,
      sitePlz,
      siteCity,
      siteNote: null,
    };
  }

  return null;
}
