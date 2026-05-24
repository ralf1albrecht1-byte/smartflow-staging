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


// INTAKE_RISK_VALIDATOR_V16_41
// Zweiter Prüfer als Sicherheitskontrollschicht:
// - ändert keine Kundendaten
// - ändert keine Leistungen, Preise, Mengen oder Währungen
// - liefert strukturierte Warnungen
// - der Aufrufer setzt daraus Review-Pflicht / Blocker, damit unsichere Daten
//   nicht ungeprüft in Angebot/Rechnung/PDF weiterlaufen
export interface ReadOnlyIntakeRiskValidatorInput {
  originalText: string;
  billingCustomer: {
    name?: string | null;
    street?: string | null;
    plz?: string | null;
    city?: string | null;
    phone?: string | null;
    source?: string | null;
    hasReliableCustomerBlock?: boolean | null;
  };
  executionAddress?: ExtractedExecutionAddress | null;
  detectedCurrencies?: string[] | null;
  finalCurrency?: string | null;
}

export interface ReadOnlyIntakeRiskValidatorResult {
  active: boolean;
  riskLevel: "none" | "info" | "warning" | "critical";
  warnings: string[];
  checks: {
    hasReliableBillingCustomer: boolean;
    hasExecutionMarker: boolean;
    hasExecutionAddress: boolean;
    hasOnsiteContactMarker: boolean;
    phoneCount: number;
    hasMultipleCurrencies: boolean;
    hasUnsupportedCurrency: boolean;
  };
}

const normalizeRiskText = (value?: string | null) =>
  String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

const normalizeRiskPhone = (value?: string | null) =>
  String(value || "").replace(/\D/g, "");

function extractRiskPhoneCandidates(value?: string | null): string[] {
  const source = String(value || "");
  if (!source.trim()) return [];

  const matches = source.match(/\+?\d[\d\s()./-]{6,}\d/g) || [];
  const normalized = matches
    .map((match) => normalizeRiskPhone(match))
    .filter((digits) => digits.length >= 7 && digits.length <= 15);

  return Array.from(new Set(normalized));
}

export function runReadOnlyIntakeRiskValidator(
  input: ReadOnlyIntakeRiskValidatorInput,
): ReadOnlyIntakeRiskValidatorResult {
  const text = normalizeRiskText(input.originalText);
  const detectedCurrencies = input.detectedCurrencies?.length
    ? input.detectedCurrencies
    : detectCurrenciesInText(input.originalText);
  const supportedCurrencies = new Set(["CHF", "EUR"]);
  const phoneCandidates = extractRiskPhoneCandidates(input.originalText);

  const hasReliableBillingCustomer = Boolean(
    input.billingCustomer?.hasReliableCustomerBlock &&
      String(input.billingCustomer?.name || "").trim(),
  );
  const hasExecutionAddress = Boolean(
    input.executionAddress &&
      (input.executionAddress.siteAddress ||
        input.executionAddress.sitePlz ||
        input.executionAddress.siteCity ||
        input.executionAddress.siteName),
  );
  const hasCompleteExecutionAddress = Boolean(
    input.executionAddress?.siteAddress &&
      input.executionAddress?.sitePlz &&
      input.executionAddress?.siteCity,
  );
  // V16.39: structure-based risk check. The validator no longer tries to
  // detect address roles from multilingual marker words; it only checks the
  // already sorted structured result.
  const hasExecutionMarker = hasExecutionAddress;
  const hasOnsiteContactMarker = false;
  const hasMultipleCurrencies = detectedCurrencies.length > 1;
  const hasUnsupportedCurrency = detectedCurrencies.some(
    (currency) => !supportedCurrencies.has(currency),
  );

  const warnings: string[] = [];

  if (!hasReliableBillingCustomer) {
    warnings.push("billing_customer_missing_or_uncertain");
  }

  if (hasExecutionAddress && !hasCompleteExecutionAddress) {
    warnings.push("execution_address_incomplete");
  }

  if (hasOnsiteContactMarker && phoneCandidates.length > 1) {
    warnings.push("onsite_contact_with_multiple_phone_numbers");
  }

  if (hasMultipleCurrencies) {
    warnings.push("multiple_currencies_detected");
  }

  if (hasUnsupportedCurrency) {
    warnings.push("unsupported_currency_detected");
  }

  const riskLevel: ReadOnlyIntakeRiskValidatorResult["riskLevel"] = hasMultipleCurrencies || hasUnsupportedCurrency
    ? "critical"
    : warnings.length > 0
      ? "warning"
      : "none";

  return {
    active: true,
    riskLevel,
    warnings,
    checks: {
      hasReliableBillingCustomer,
      hasExecutionMarker,
      hasExecutionAddress,
      hasOnsiteContactMarker,
      phoneCount: phoneCandidates.length,
      hasMultipleCurrencies,
      hasUnsupportedCurrency,
    },
  };
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
  "(?:stueck|stück|stuck|stk|einheit|piece|pieces|pi[eè]ce|pi[eè]ces|vitre|vitres|fenetre|fenetres|window|windows|quadratmeter|quadratmetern|qm|m2|m²|sqm|kubikmeter|kubikmetern|cbm|meter|laufmeter|lfm|stunde|stunden|std\\.?|hour|hours|tag|tage|day|days|kg|kilogramm|tonne|tonnen|liter|ltr|l)";

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

// INTAKE_CURRENCY_ONLY_EUR_FIX_V13
function stripNegatedCurrencyMentions(text?: string | null): string {
  let source = String(text || "").toLowerCase();
  if (!source.trim()) return "";

  // Do not count currencies that are only mentioned as a negative instruction,
  // e.g. "nicht in CHF umrechnen", "not CHF", "no CHF".
  // This keeps EUR-only jobs from becoming CHF conflicts just because the user
  // explicitly says "Bitte nicht in CHF umrechnen".
  const currencyWords =
    "(?:chf|franken|fr\\.?|sfr\\.?|stutz|eur|euro|€|usd|us-dollar|dollar|us\\$|\\$|gbp|pfund|pound|british\\s+pound|£)";

  const negatedCurrencyPatterns = [
    new RegExp(
      `\\b(?:nicht|kein|keine|keinen|ohne|not|no|dont|don't|do\\s+not|pas|ne\\s+pas)\\s+(?:in|als|auf|zu|nach|to|as|en)?\\s*${currencyWords}\\b`,
      "gi",
    ),
    new RegExp(
      `\\b(?:not|no|nicht)\\s+${currencyWords}\\b`,
      "gi",
    ),
    new RegExp(
      `\\b(?:nicht|not|no)\\s+(?:umrechnen|convert|converted|conversion)\\s+(?:in|to)?\\s*${currencyWords}\\b`,
      "gi",
    ),
    new RegExp(
      `\\b${currencyWords}\\s+(?:nicht|not|no)\\s+(?:verwenden|benutzen|use|take|nehmen|umrechnen|convert)\\b`,
      "gi",
    ),
  ];

  for (const pattern of negatedCurrencyPatterns) {
    source = source.replace(pattern, " ");
  }

  return source.replace(/\s+/g, " ").trim();
}

export function detectCurrenciesInText(text?: string | null): string[] {
  const source = stripNegatedCurrencyMentions(text);
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

  if (/\b(stueck|stuck|stück|stk|piece|pieces|piece|pi[eè]ce|pi[eè]ces|vitre|vitres|fenetre|fenetres|window|windows|einheit|einheiten)\b/i.test(source)) return "piece";
  if (/\b(quadratmeter|qm|m2|m²|sqm)\b/i.test(source)) return "square_meter";
  if (/\b(kubikmeter|cbm|m3|m³)\b/i.test(source)) return "cubic_meter";
  if (/\b(stunde|stunden|std|hour|hours|h)\b/i.test(source)) return "hour";
  if (/\b(tag|tage|day|days)\b/i.test(source)) return "day";
  if (/\b(laufmeter|lfm|meter|m)\b/i.test(source)) return "meter";
  if (/\b(kg|kilogramm)\b/i.test(source)) return "kilogram";
  if (/\b(tonne|tonnen)\b/i.test(source)) return "ton";
  if (/\b(liter|ltr|l)\b/i.test(source)) return "liter";
  if (/\b(pauschal|pauschale|fixpreis|festpreis|forfait|flat|flat)\b/i.test(source)) return "flat";

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

function hasExplicitCurrencyAmount(value?: string | null): boolean {
  const source = normalizeText(value);
  if (!source) return false;

  return (
    new RegExp(`\\b(?:${CURRENCY_WORDS})\\s*${PRICE_NUMBER}\\b`, "i").test(source) ||
    new RegExp(`\\b${PRICE_NUMBER}\\s*(?:${CURRENCY_WORDS})\\b`, "i").test(source)
  );
}

function hasQuantityWithExplicitUnit(value?: string | null): boolean {
  return new RegExp(`\\b\\d+(?:[.,]\\d+)?\\s*${UNIT_WORDS}\\b`, "i").test(
    String(value || ""),
  );
}

function isLikelyStandaloneFlatServiceLine(value?: string | null): boolean {
  const source = normalizeText(value);
  const normalized = normalizeCompare(source);
  if (!source || !normalized) return false;
  if (!hasExplicitCurrencyAmount(source)) return false;
  if (hasQuantityWithExplicitUnit(source)) return false;

  // Targeted safety-net for auxiliary services that customers usually write as
  // flat lines without the word "pauschal": "Abdecken CHF 90", "Anfahrt CHF 45",
  // "Grüngut entsorgen CHF 75". Measured services like m²/Stück/Meter stay out.
  return /\b(?:anfahrt|fahrtkosten|fahrpauschale|wegpauschale|abdeck\w*|spachtel\w*|grungut|gruengut|entsorg\w*|material\s+entsorg\w*|deplacement)\b/i.test(
    normalized,
  );
}

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
      re: new RegExp(`(${CURRENCY_WORDS})\\s*${PRICE_NUMBER}\\s*(?:pro|je|per|par|à|a|/)\\s*(${UNIT_WORDS})\\b`, "gi"),
      currencyGroup: 1,
      priceGroup: 2,
      unitGroup: 3,
    },
    {
      re: new RegExp(`${PRICE_NUMBER}\\s*(${CURRENCY_WORDS})\\s*(?:pro|je|per|par|à|a|/)\\s*(${UNIT_WORDS})\\b`, "gi"),
      currencyGroup: 2,
      priceGroup: 1,
      unitGroup: 3,
    },
    // V16.40: "35 m2 Wände streichen à CHF 18" / "30 m2 Decke streichen zu CHF 22".
    // The quantity unit is anchored earlier in the same segment, not after the price.
    {
      re: new RegExp(`(?:à|a|zu|preis|einzelpreis|ep|=|:)\\s*(${CURRENCY_WORDS})\\s*${PRICE_NUMBER}\\b`, "gi"),
      currencyGroup: 1,
      priceGroup: 2,
    },
    {
      re: new RegExp(`(?:à|a|zu|preis|einzelpreis|ep|=|:)\\s*${PRICE_NUMBER}\\s*(${CURRENCY_WORDS})\\b`, "gi"),
      currencyGroup: 2,
      priceGroup: 1,
    },
    {
      re: new RegExp(`(?:preis|sonderpreis|vereinbart|ansatz|stundensatz|stundenansatz|tagessatz|zu|für|fuer|kostet|kosten|ist|=|:)\\s*(?:ist|von|zu|=|:)?\\s*(${CURRENCY_WORDS})\\s*${PRICE_NUMBER}\\s*(?:pro|je|per|par|à|a|/)\\s*(${UNIT_WORDS})\\b`, "gi"),
      currencyGroup: 1,
      priceGroup: 2,
      unitGroup: 3,
    },
    {
      re: new RegExp(`(?:preis|sonderpreis|vereinbart|ansatz|stundensatz|stundenansatz|tagessatz|zu|für|fuer|kostet|kosten|ist|=|:)\\s*(?:ist|von|zu|=|:)?\\s*${PRICE_NUMBER}\\s*(${CURRENCY_WORDS})\\s*(?:pro|je|per|par|à|a|/)\\s*(${UNIT_WORDS})\\b`, "gi"),
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
      re: new RegExp(`(?:pauschal|pauschale|fixpreis|festpreis|forfait|flat)\\s*(${CURRENCY_WORDS})\\s*${PRICE_NUMBER}\\b`, "gi"),
      currencyGroup: 1,
      priceGroup: 2,
    },
    {
      re: new RegExp(`(${CURRENCY_WORDS})\\s*${PRICE_NUMBER}\\s*(?:pauschal|pauschale|fixpreis|festpreis|forfait|flat)\\b`, "gi"),
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
  if (!/\b(pauschal|pauschale|fixpreis|festpreis|forfait|flat)\b/i.test(source)) return null;

  const patterns = [
    /\b(?:pauschal|pauschale|fixpreis|festpreis|forfait|flat)\s*(?:ist|von|zu|=|:)?\s*(\d+(?:[.,]\d{1,2})?)\b/i,
    /\b(\d+(?:[.,]\d{1,2})?)\s*(?:pauschal|pauschale|fixpreis|festpreis|forfait|flat)\b/i,
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

function canonicalGermanServiceNameFromText(value?: string | null): string | null {
  const normalized = normalizeCompare(value);
  if (!normalized) return null;

  if (/\b(nettoyage\s+du\s+garage|nettoyage\s+du\s+sol\s+du\s+garage|garage\s+floor|sol\s+du\s+garage|garagenboden)\b/.test(normalized)) {
    return "Garageboden reinigen";
  }
  if (/\b(nettoyage\s+de\s+l\s*entree|nettoyage\s+de\s+lentree|nettoyage\s+de\s+l['’]?\s*entree|entrance\s+clean|limpieza\s+de\s+entrada|pulizia\s+ingresso|eingangsbereich)\b/.test(normalized)) {
    return "Eingangsbereich reinigen";
  }
  if (/\b(nettoyage\s+des\s+vitres|nettoyage\s+vitres|vitres|fenetres|windows|window\s+cleaning|fenster|ventanas|limpieza\s+de\s+ventanas|finestre|pulizia\s+finestre|janelas|limpeza\s+de\s+janelas)\b/.test(normalized)) {
    return "Fenster reinigen";
  }
  if (/\b(boden\s+reinigen|bodenreinigung|floor\s+cleaning|floor\s+clean|clean\s+floor|nettoyage\s+du\s+sol|nettoyage\s+sol|nettoyer\s+(?:le\s+|du\s+)?sol|nettoyer\s+sol|limpieza\s+de\s+suelo|limpieza\s+suelo|pulizia\s+pavimento|pulizia\s+del\s+pavimento|pulizia\s+suolo|limpeza\s+do\s+chao|limpeza\s+chao)\b/.test(normalized)) {
    return "Boden reinigen";
  }
  if (/\b(deplacement|déplacement|fahrtkosten|fahrpauschale|wegpauschale|anfahrt)\b/.test(normalized)) {
    return "Anfahrt";
  }
  if (/\b(abdeckarbeiten|abdecken|abdeck\w*)\b/.test(normalized)) {
    return "Abdeckarbeiten";
  }
  if (/\b(spachtelarbeiten|spachteln|spachtel\w*)\b/.test(normalized)) {
    return "Spachtelarbeiten";
  }
  if (/\b(buroreinigung|buero(?:reinigung)?|office\s+clean|office\s+cleaning)\b/.test(normalized)) {
    return "Büroreinigung";
  }

  return null;
}

function normalizeFlatServiceNameFromText(value: string): string {
  const canonical = canonicalGermanServiceNameFromText(value);
  if (canonical) return canonical;

  const normalized = normalizeCompare(value);
  if (/\b(deplacement|déplacement|fahrtkosten|fahrpauschale|wegpauschale|anfahrt)\b/.test(normalized)) {
    return "Anfahrt";
  }
  if (/\btiefgarage\b/.test(normalized) && /\b(reinigen|reinigung|putzen)\b/.test(normalized)) {
    return "Tiefgarage reinigen";
  }
  if (/\bgarage\b/.test(normalized) && /\b(reinigen|reinigung|putzen)\b/.test(normalized)) {
    return "Garageboden reinigen";
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

function earliestServiceAnchorIndex(
  normalizedSegment: string,
  serviceKey: string,
  tokens: string[],
): number {
  const anchorTokens = tokens.filter(
    (token) => !/^(?:pauschal|pauschale|fixpreis|festpreis|forfait|flat)$/.test(token),
  );
  const indexes = [
    serviceKey ? normalizedSegment.indexOf(serviceKey) : -1,
    ...anchorTokens.map((token) => normalizedSegment.indexOf(token)),
  ].filter((index) => index >= 0);

  return indexes.length > 0 ? Math.min(...indexes) : -1;
}

function flatSignalIndex(normalizedSegment: string): number {
  const match = normalizedSegment.match(/\b(pauschal|pauschale|fixpreis|festpreis|forfait|flat)\b/i);
  return match?.index ?? -1;
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

    // V16.41: A measured m²/Meter/Stück line must never repair a flat service.
    // Example: the combined segment
    // "42 m2 Wände streichen à CHF 18. Abdecken CHF 90."
    // contains the word "Abdecken", but CHF 18 belongs only to the m² line.
    if (itemUnitType === "flat" && hasQuantityWithExplicitUnit(segment)) {
      continue;
    }

    // V16.40: Do not leak neighbouring flat prices into measured services.
    // Example: "35 m2 Wände streichen à CHF 18" must never receive the
    // following "Abdeckarbeiten CHF 90 pauschal" price just because the full
    // WhatsApp text was copied into item evidence.
    if (detected.unitType === "flat" && itemUnitType && itemUnitType !== "flat") {
      continue;
    }
    if (itemUnitType && detected.unitType && itemUnitType !== detected.unitType) {
      continue;
    }

    const hasExactServiceAnchor = Boolean(serviceKey && normalizedSegment.includes(serviceKey));
    const anchorTokens = tokens.filter(
      (token) => !/^(?:pauschal|pauschale|fixpreis|festpreis|forfait|flat)$/.test(token),
    );
    const serviceTokenHits = anchorTokens.filter((token) => normalizedSegment.includes(token)).length;
    const hasServiceAnchor = hasExactServiceAnchor || serviceTokenHits > 0;
    const hasQuantityAnchor = segmentContainsQuantity(segment, itemQuantity, itemUnitType);

    if (detected.unitType === "flat") {
      const serviceAnchorIndex = earliestServiceAnchorIndex(normalizedSegment, serviceKey, tokens);
      const flatIndex = flatSignalIndex(normalizedSegment);
      if (serviceAnchorIndex >= 0 && flatIndex >= 0 && serviceAnchorIndex > flatIndex) continue;
    }

    // Evidence containment alone is too weak when item evidence contains the
    // whole customer message. Require the segment to match the service OR the
    // quantity/unit of this item.
    if (!hasServiceAnchor && !hasQuantityAnchor) continue;

    let score = 0;

    if (hasExactServiceAnchor) score += 150;
    score += serviceTokenHits * 45;

    if (itemEvidence && normalizeCompare(itemEvidence).includes(normalizedSegment)) {
      score += 30;
    }

    if (hasQuantityAnchor) {
      score += 110;
    }

    if (itemUnitType && detected.unitType) {
      if (itemUnitType === detected.unitType) score += 90;
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

function detectExplicitFlatPriceForItem(
  originalText: string,
  item: ParsedOrderItemForValidation,
  fallbackCurrency: IntakeCurrency,
): DetectedUnitPrice | null {
  const itemEvidence = [item.sourceText, item.evidence, item.description]
    .map((part) => normalizeText(part))
    .filter(Boolean)
    .join("\n");

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
    if (!/\b(pauschal|pauschale|fixpreis|festpreis|forfait|flat)\b/i.test(normalizedSegment)) continue;

    const detected =
      chooseBestPriceFromSegment(segment) ||
      detectCurrencylessFlatPriceFromSegment(segment, fallbackCurrency);
    if (!detected || detected.unitType !== "flat") continue;

    const hasExactServiceAnchor = Boolean(serviceKey && normalizedSegment.includes(serviceKey));
    const anchorTokens = tokens.filter(
      (token) => !/^(?:pauschal|pauschale|fixpreis|festpreis|forfait|flat)$/.test(token),
    );
    const serviceTokenHits = anchorTokens.filter((token) => normalizedSegment.includes(token)).length;
    const hasServiceAnchor = hasExactServiceAnchor || serviceTokenHits > 0;

    // V16.40: A flat price line may only repair the matching flat service.
    // Do not copy "Abdeckarbeiten CHF 90 pauschal" onto "Anfahrt"
    // just because the whole WhatsApp message was present as item evidence.
    if (!hasServiceAnchor) continue;

    const serviceAnchorIndex = earliestServiceAnchorIndex(normalizedSegment, serviceKey, tokens);
    const flatIndex = flatSignalIndex(normalizedSegment);
    if (serviceAnchorIndex >= 0 && flatIndex >= 0 && serviceAnchorIndex > flatIndex) continue;

    let score = 0;
    if (hasExactServiceAnchor) score += 120;
    score += serviceTokenHits * 70;
    if (itemEvidence && normalizeCompare(itemEvidence).includes(normalizedSegment)) score += 30;
    if (segment.length <= 180) score += 20;
    if (segment.length > 320) score -= 80;

    if (score < 70) continue;
    if (!best || score > best.score) best = { detected, score };
  }

  return best?.detected || null;
}


function selectFlatServiceSourceFromSegment(
  segment: string,
  explicitFlatLine: { amount: number; currency: string | null; index: number; raw: string } | null,
): string {
  const source = normalizeText(segment);
  if (!source) return source;

  const pieces = source
    .split(/\n+|(?<=[.!?])\s+|;/g)
    .map((piece) => piece.trim())
    .filter(Boolean);

  if (pieces.length <= 1) return source;

  const rawKey = normalizeCompare(explicitFlatLine?.raw || "");
  const flatSignalPattern = /\b(pauschal|pauschale|fixpreis|festpreis|forfait|flat)\b/i;

  for (const piece of pieces) {
    const key = normalizeCompare(piece);
    if (!key) continue;

    const hasMatchingPrice =
      explicitFlatLine &&
      (rawKey ? key.includes(rawKey) : true) &&
      hasExplicitCurrencyAmount(piece);

    if ((flatSignalPattern.test(key) || isLikelyStandaloneFlatServiceLine(piece) || hasMatchingPrice) && hasExplicitCurrencyAmount(piece)) {
      return piece;
    }
  }

  return source;
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
    const hasFlatSignal = /\b(pauschal|pauschale|fixpreis|festpreis|forfait|flat)\b/i.test(normalized);
    const standaloneFlatLine = isLikelyStandaloneFlatServiceLine(segment);

    if (!hasFlatSignal && !standaloneFlatLine) {
      continue;
    }

    const explicitFlatLine = findExplicitFlatPriceInLine(segment, fallbackCurrency);
    const detected =
      chooseBestPriceFromSegment(segment) ||
      detectCurrencylessFlatPriceFromSegment(segment, fallbackCurrency) ||
      (explicitFlatLine
        ? {
            amount: explicitFlatLine.amount,
            currency: explicitFlatLine.currency,
            segment,
            unitType: "flat",
          }
        : null);
    if (!detected || detected.currency !== fallbackCurrency) continue;

    const flatServiceSource = selectFlatServiceSourceFromSegment(segment, explicitFlatLine);
    const flatSourceHasFlatSignal = /\b(pauschal|pauschale|fixpreis|festpreis|forfait|flat)\b/i.test(
      normalizeCompare(flatServiceSource),
    );
    const beforeFlat = flatSourceHasFlatSignal
      ? flatServiceSource
          .split(/\b(?:pauschal|pauschale|fixpreis|festpreis|forfait|flat)\b/i)[0]
          ?.replace(/^\s*(leistung|leistungen|bitte|zusätzlich|zusaetzlich|und|plus|[0-9]+[.)])\s*[:\-–—]?\s*/i, "")
          .replace(/[,;:.]+$/g, "")
          .trim()
      : cleanExplicitServiceNameFromLine(flatServiceSource, {
          priceRaw: explicitFlatLine?.raw,
        });

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

  const flatRecords = flatItems.map((flatItem) => ({
    amount: roundMoney(Number(flatItem.unitPrice || 0)),
    key: normalizeCompare(flatItem.serviceName),
    tokens: serviceTokens(flatItem.serviceName),
  }));

  return items.filter((item) => {
    const itemPrice = roundMoney(Number(item.unitPrice || 0));
    const matchingFlat = flatRecords.find((flat) => flat.amount === itemPrice);
    if (!matchingFlat) return true;

    const itemText = itemEvidenceText(item);
    const itemKey = normalizeCompare(item.serviceName);
    const sameFlatDomain = Boolean(
      matchingFlat.key &&
        itemKey &&
        (matchingFlat.key.includes(itemKey) ||
          itemKey.includes(matchingFlat.key) ||
          matchingFlat.tokens.some((token) => itemKey.includes(token))),
    );

    if (sameFlatDomain) return true;

    // A real non-flat unit price may coincidentally have the same number as a
    // flat price. Keep it only if its own line has an explicit unit-price signal.
    if (!isFlatUnit(item.unit) && hasOwnUnitPriceSignal(item)) return true;

    // Flat rows with the same amount are only safe through sameFlatDomain above.
    // If another service name uses the same flat amount, it is probably a copied
    // pauschal price and must not increase the total.
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

function itemEvidenceText(item: ParsedOrderItemForValidation): string {
  return [item.serviceName, item.description, item.sourceText, item.evidence]
    .map((part) => normalizeText(part))
    .filter(Boolean)
    .join("\n");
}

function hasOwnUnitPriceSignal(item: ParsedOrderItemForValidation): boolean {
  const text = itemEvidenceText(item);
  if (!text) return false;
  return extractUnitPricesFromSegment(text).some((price) => price.unitType && price.unitType !== "flat");
}

function detectQuantityForUnitTypeFromText(
  text: string,
  unitType: string | null,
): number | null {
  const source = normalizeCompare(text);
  if (!source || !unitType) return null;

  const patterns: Record<string, RegExp[]> = {
    piece: [
      /\b(\d+(?:[.,]\d+)?)\s*(?:stueck|stuck|stk|piece|pieces|piece|pieces|pi[eè]ce|pi[eè]ces|vitre|vitres|fenetre|fenetres|window|windows)\b/i,
    ],
    square_meter: [
      /\b(\d+(?:[.,]\d+)?)\s*(?:quadratmeter|qm|m2|m²|sqm)\b/i,
    ],
    cubic_meter: [/\b(\d+(?:[.,]\d+)?)\s*(?:kubikmeter|cbm|m3|m³)\b/i],
    meter: [/\b(\d+(?:[.,]\d+)?)\s*(?:laufmeter|lfm|meter|m)\b/i],
    hour: [/\b(\d+(?:[.,]\d+)?)\s*(?:stunde|stunden|std|hour|hours|h)\b/i],
    day: [/\b(\d+(?:[.,]\d+)?)\s*(?:tag|tage|day|days)\b/i],
  };

  for (const pattern of patterns[unitType] || []) {
    const match = source.match(pattern);
    const parsed = parsePriceNumber(match?.[1]);
    if (parsed) return parsed;
  }

  return null;
}

function repairCommonMultilingualCleaningItems(
  originalText: string,
  items: ParsedOrderItemForValidation[],
  finalCurrency: IntakeCurrency,
): ParsedOrderItemForValidation[] {
  return items.map((item) => {
    const evidence = itemEvidenceText(item);
    const key = normalizeCompare(evidence);
    if (!key) return item;

    let next: ParsedOrderItemForValidation = { ...item };
    let targetUnitType: string | null = null;

    if (/\b(nettoyage\s+(?:des\s+)?vitres|vitres?|fenetres?|windows?|fenster)\b/i.test(key)) {
      const ownLineEvidence = [item.description, item.sourceText]
        .map((part) => normalizeText(part))
        .filter(Boolean)
        .join("\n");
      const explicitUnitType = unitTypeFromText(ownLineEvidence);
      const hasOwnExplicitQuantityUnit = hasQuantityWithExplicitUnit(ownLineEvidence);
      const shouldKeepTextUnit = Boolean(
        hasOwnExplicitQuantityUnit &&
          explicitUnitType &&
          explicitUnitType !== "piece",
      );

      next.serviceName = "Fenster reinigen";
      if (shouldKeepTextUnit) {
        next.unit = unitTypeToDisplayUnit(explicitUnitType) || next.unit;
        targetUnitType = explicitUnitType;
      } else {
        next.unit = "Stück";
        targetUnitType = "piece";
      }
    } else if (/\b(nettoyage\s+du\s+garage|nettoyage\s+du\s+sol\s+du\s+garage|sol\s+du\s+garage|garage\s+floor|garagenboden|lagerboden)\b/i.test(key)) {
      next.serviceName = /\blagerboden\b/i.test(key) ? "Lagerboden reinigen" : "Garageboden reinigen";
      next.unit = "Quadratmeter";
      targetUnitType = "square_meter";
    } else if (/\b(nettoyage\s+de\s+l\s*entree|nettoyage\s+de\s+lentree|entrance\s+clean|eingangsbereich)\b/i.test(key)) {
      next.serviceName = "Eingangsbereich reinigen";
      next.unit = "Pauschal";
      targetUnitType = "flat";
    } else if (/\b(office\s+floor|boden\s+reinigen|floor\s+clean)\b/i.test(key)) {
      next.serviceName = "Boden reinigen";
      next.unit = "Quadratmeter";
      targetUnitType = "square_meter";
    }

    if (!targetUnitType) return item;

    const quantityFromText = detectQuantityForUnitTypeFromText(evidence, targetUnitType);
    if (quantityFromText) next.quantity = quantityFromText;

    const explicitPrice = detectExplicitUnitPriceForItem(originalText, next);
    if (explicitPrice?.currency === finalCurrency) {
      next.unitPrice = explicitPrice.amount;
    }

    next.totalPrice = calculateSafeLineTotal(next);
    if (next.unitPrice > 0 && next.quantity > 0) {
      next.needsReview = Boolean(next.reviewReason && !/price|quantity|unit_price|unbekannte/i.test(next.reviewReason));
      if (!next.needsReview) next.reviewReason = null;
    }

    return next;
  });
}

function dedupeUnsafeDuplicateItems(
  items: ParsedOrderItemForValidation[],
): ParsedOrderItemForValidation[] {
  const result: ParsedOrderItemForValidation[] = [];

  for (const item of items) {
    const key = normalizeCompare(item.serviceName);
    const unitType = unitTypeFromDisplayUnit(item.unit) || "unknown";
    const quantity = roundMoney(Number(item.quantity || 0));
    const price = roundMoney(Number(item.unitPrice || 0));

    const existingIndex = result.findIndex((existing) => {
      const existingKey = normalizeCompare(existing.serviceName);
      if (!key || !existingKey || key !== existingKey) return false;
      const existingUnitType = unitTypeFromDisplayUnit(existing.unit) || "unknown";
      if (unitType !== existingUnitType) return false;
      const existingQuantity = roundMoney(Number(existing.quantity || 0));
      return existingQuantity === quantity || !existingQuantity || !quantity;
    });

    if (existingIndex < 0) {
      result.push(item);
      continue;
    }

    const existing = result[existingIndex];
    const existingTotal = calculateSafeLineTotal(existing);
    const itemTotal = calculateSafeLineTotal(item);

    // Keep the safer/priced row. Drop duplicate zero-review rows and duplicate flat-price artifacts.
    if (itemTotal > existingTotal) {
      result[existingIndex] = item;
    } else if (itemTotal === existingTotal && price > Number(existing.unitPrice || 0)) {
      result[existingIndex] = item;
    }
  }

  return result;
}


function removeMeasuredFlatDuplicateArtifacts(
  items: ParsedOrderItemForValidation[],
): ParsedOrderItemForValidation[] {
  if (items.length <= 1) return items;

  return items.filter((item, index) => {
    if (!isFlatUnit(item.unit)) return true;
    if (roundMoney(Number(item.quantity || 0)) !== 1) return true;

    const itemPrice = roundMoney(Number(item.unitPrice || 0));
    if (itemPrice <= 0) return true;

    const itemName = normalizeCompare(item.serviceName);
    const itemTokens = meaningfulServiceTokens(item.serviceName);
    if (!itemName || itemTokens.length === 0) return true;

    const itemEvidence = normalizeCompare(
      [item.sourceText, item.evidence, item.description]
        .filter(Boolean)
        .join(" "),
    );

    return !items.some((other, otherIndex) => {
      if (otherIndex === index) return false;

      const otherUnitType = unitTypeFromDisplayUnit(other.unit);
      if (!otherUnitType || otherUnitType === "flat") return false;
      if (roundMoney(Number(other.unitPrice || 0)) !== itemPrice) return false;

      const otherName = normalizeCompare(other.serviceName);
      const otherTokens = meaningfulServiceTokens(other.serviceName);
      const sameService =
        itemName === otherName ||
        itemTokens.some((token) => otherTokens.includes(token) || otherName.includes(token));
      if (!sameService) return false;

      const otherEvidence = normalizeCompare(
        [other.sourceText, other.evidence, other.description]
          .filter(Boolean)
          .join(" "),
      );

      return (
        hasQuantityWithExplicitUnit(otherEvidence) &&
        Boolean(
          (itemEvidence && otherEvidence && (itemEvidence.includes(otherEvidence) || otherEvidence.includes(itemEvidence))) ||
            itemTokens.some((token) => otherEvidence.includes(token)),
        )
      );
    });
  });
}


function hasOwnStandaloneFlatLineForService(
  originalText: string,
  item: ParsedOrderItemForValidation,
  fallbackCurrency: IntakeCurrency,
): boolean {
  const itemPrice = roundMoney(Number(item.unitPrice || 0));
  if (itemPrice <= 0) return false;

  const serviceKey = normalizeCompare(item.serviceName);
  const tokens = meaningfulServiceTokens(item.serviceName);
  if (!serviceKey && tokens.length === 0) return false;

  for (const segment of splitIntoPriceSegments(originalText)) {
    const segmentText = normalizeText(segment);
    const normalizedSegment = normalizeCompare(segmentText);
    if (!normalizedSegment) continue;
    if (hasQuantityWithExplicitUnit(segmentText)) continue;

    const explicitFlatLine = findExplicitFlatPriceInLine(segmentText, fallbackCurrency);
    const detected =
      (explicitFlatLine
        ? {
            amount: explicitFlatLine.amount,
            currency: explicitFlatLine.currency,
          }
        : null) || chooseBestPriceFromSegment(segmentText);

    if (!detected || detected.currency !== fallbackCurrency) continue;
    if (Math.abs(roundMoney(detected.amount) - itemPrice) >= 0.01) continue;

    const hasServiceAnchor =
      Boolean(serviceKey && normalizedSegment.includes(serviceKey)) ||
      tokens.some((token) => normalizedSegment.includes(token));

    if (hasServiceAnchor) return true;
  }

  return false;
}

function sameServiceDomain(
  a: ParsedOrderItemForValidation,
  b: ParsedOrderItemForValidation,
): boolean {
  const aKey = normalizeCompare(a.serviceName);
  const bKey = normalizeCompare(b.serviceName);
  if (!aKey || !bKey) return false;
  if (aKey === bKey || aKey.includes(bKey) || bKey.includes(aKey)) return true;

  const aTokens = meaningfulServiceTokens(a.serviceName);
  const bTokens = meaningfulServiceTokens(b.serviceName);
  return aTokens.length > 0 && aTokens.some((token) => bTokens.includes(token) || bKey.includes(token));
}

function removeFlatItemsDuplicatingMeasuredServiceWithoutOwnLine(
  originalText: string,
  items: ParsedOrderItemForValidation[],
  fallbackCurrency: IntakeCurrency,
): ParsedOrderItemForValidation[] {
  if (items.length <= 1) return items;

  return items.filter((item, index) => {
    if (!isFlatUnit(item.unit)) return true;
    if (roundMoney(Number(item.quantity || 0)) !== 1) return true;
    if (roundMoney(Number(item.unitPrice || 0)) <= 0) return true;

    const hasMeasuredSameService = items.some((other, otherIndex) => {
      if (otherIndex === index) return false;
      if (isFlatUnit(other.unit)) return false;
      if (Number(other.unitPrice || 0) <= 0 || Number(other.totalPrice || 0) <= 0) return false;
      return sameServiceDomain(item, other);
    });

    if (!hasMeasuredSameService) return true;

    return hasOwnStandaloneFlatLineForService(originalText, item, fallbackCurrency);
  });
}

function removeUnpricedDuplicateServiceArtifacts(
  items: ParsedOrderItemForValidation[],
): ParsedOrderItemForValidation[] {
  if (items.length <= 1) return items;

  return items.filter((item, index) => {
    const isUnpriced =
      Number(item.unitPrice || 0) <= 0 ||
      Number(item.totalPrice || 0) <= 0 ||
      Number(item.quantity || 0) <= 0;

    if (!isUnpriced) return true;

    return !items.some((other, otherIndex) => {
      if (otherIndex === index) return false;
      if (Number(other.unitPrice || 0) <= 0 || Number(other.totalPrice || 0) <= 0) return false;
      return sameServiceDomain(item, other);
    });
  });
}


function cleanValidationServiceDisplayName(value?: string | null): string {
  const cleaned = normalizeText(value || "")
    .replace(/^\s*(?:leistung|service|arbeit|position)\s*:?\s*/i, "")
    .replace(/\b(?:chf|franken|fr\.?|sfr\.?|stutz|eur|euro|usd|dollar|gbp|pfund)\s*\d+(?:[.,]\d{1,2})?\b/gi, " ")
    .replace(/\b\d+(?:[.,]\d{1,2})?\s*(?:chf|franken|fr\.?|sfr\.?|stutz|eur|euro|usd|dollar|gbp|pfund)\b/gi, " ")
    .replace(new RegExp(`\\b\\d+(?:[.,]\\d+)?\\s*${UNIT_WORDS}\\b`, "gi"), " ")
    .replace(new RegExp(`\\b(?:pro|je|per|par|à|a|/)\\s*${UNIT_WORDS}\\b`, "gi"), " ")
    .replace(/\b(?:pro|je|per|par|à|a)\b\s*[.,;:!?]*$/i, " ")
    .replace(/\b(?:und|\+)\s+anfahrt\b.*$/i, " ")
    .replace(/^[\s,;:.\-–—+]+|[\s,;:.\-–—+]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();

  const canonical = canonicalGermanServiceNameFromText(cleaned);
  if (canonical) return canonical;

  const key = normalizeCompare(cleaned);
  if (
    !key ||
    key.length < 3 ||
    /^(?:es\s+sind|es\s+ist|das\s+sind|das\s+ist|sind|ist|ca|circa|ungefaehr|ungefahr|etwa|about|approx)$/.test(key)
  ) {
    return "Unbekannte Leistung";
  }

  return cleaned.replace(/^./, (char) => char.toUpperCase());
}

function normalizeParsedServiceNames(
  items: ParsedOrderItemForValidation[],
): ParsedOrderItemForValidation[] {
  return items.map((item) => {
    const serviceName = cleanValidationServiceDisplayName(item.serviceName);
    return {
      ...item,
      serviceName,
      reviewReason: item.reviewReason?.startsWith("price_unclear:")
        ? `price_unclear:${serviceName}`
        : item.reviewReason,
    };
  });
}

function serviceDomainTopics(value?: string | null): string[] {
  const source = normalizeCompare(value);
  const topics: string[] = [];
  const tests: Array<[RegExp, string]> = [
    [/\bfenster\b|\bvitres?\b|\bwindows?\b|\bfenetres?\b/, "fenster"],
    [/\bboden\b|\bfloor\b|\bsol\b/, "boden"],
    [/\bwand\b|\bwaende\b|\bwande\b|\bwände\b/, "wand"],
    [/\bdecke\b|\bdecken\b/, "decke"],
    [/\bspachtel\w*\b/, "spachtel"],
    [/\babdeck\w*\b/, "abdecken"],
    [/\blampe\b|\bleuchte\b/, "lampe"],
    [/\bkabelkanal\b|\bkabel\b/, "kabelkanal"],
    [/\bsteckdose\w*\b/, "steckdose"],
    [/\babfluss\b/, "abfluss"],
    [/\bdichtung\b/, "dichtung"],
    [/\bhecke\b|\bhecken\b/, "hecke"],
    [/\bgruen(?:gut|abfall)\b|\bgrün(?:gut|abfall)\b/, "gruengut"],
    [/\bregiearbeit\b|\bregie\b/, "regie"],
    [/\bentsorgung\b|\bentsorgen\b|\bmaterial\b/, "entsorgung"],
    [/\banfahrt\b/, "anfahrt"],
  ];

  for (const [pattern, topic] of tests) {
    if (pattern.test(source)) topics.push(topic);
  }

  return unique(topics);
}

function removeCompositeServiceNameArtifacts(
  items: ParsedOrderItemForValidation[],
): ParsedOrderItemForValidation[] {
  if (items.length <= 1) return items;

  return items.filter((item, index) => {
    const name = normalizeCompare(item.serviceName);
    if (!name) return true;

    const hasJoiner = /\b(?:mit|und|plus)\b|\+/.test(name);
    if (!hasJoiner) return true;

    const ownTopics = serviceDomainTopics(item.serviceName).filter((topic) => topic !== "anfahrt");
    if (ownTopics.length < 2) return true;

    const coveredTopics = new Set<string>();
    items.forEach((other, otherIndex) => {
      if (otherIndex === index) return;
      for (const topic of serviceDomainTopics(other.serviceName)) {
        if (ownTopics.includes(topic)) coveredTopics.add(topic);
      }
    });

    // Nur Sammel-/Satzrest löschen, wenn mindestens zwei fachliche Teile
    // bereits als eigene Positionen vorhanden sind. Sonst bleibt die Position
    // lieber prüfpflichtig erhalten.
    return coveredTopics.size < 2;
  });
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



function hasUnclearPriceSignal(value?: string | null): boolean {
  const source = normalizeCompare(value);
  if (!source) return false;

  return (
    /\b(preis\s+(?:wie\s+letztes\s+mal|wie\s+immer|wie\s+gehabt|offen|unklar|normal|standard|muss\s+(?:noch\s+)?(?:geprueft|pruefen|abgeklaert|abklaeren)|noch\s+(?:pruefen|abklaeren|offen))|wie\s+letztes\s+mal|wie\s+immer|wie\s+gehabt|gleicher\s+preis|letzter\s+preis|normaler\s+preis|standardpreis|nach\s+aufwand|ungefaehr|ungefahr|ca\.?|circa)\b/i.test(source) ||
    /\b(?:anfahrt|fahrt|deplacement)\s+(?:normal|standard|wie\s+immer|wie\s+gehabt)\b/i.test(source) ||
    /\b(price\s+(?:open|unclear|normal|standard|to\s+check|needs\s+checking)|same\s+as\s+last\s+time|same\s+as\s+always|approx(?:imately)?|about|tbd)\b/i.test(source) ||
    /\b(prix\s+(?:a\s+verifier|ouvert|incertain|normal|standard)|comme\s+la\s+derniere\s+fois|comme\s+d\s+habitude|environ)\b/i.test(source)
  );
}

function hasStandaloneUnclearPriceReference(originalText: string): boolean {
  return splitRawIntakeLines(originalText).some((line) => {
    if (!hasUnclearPriceSignal(line)) return false;
    if (hasExplicitCurrencyAmount(line)) return false;
    if (detectCurrencylessFlatPriceFromSegment(line, "CHF")) return false;
    if (extractUnitPricesFromSegment(line).length > 0) return false;
    return true;
  });
}

function hasExplicitPriceEvidenceForItem(
  originalText: string,
  item: ParsedOrderItemForValidation,
  fallbackCurrency: IntakeCurrency,
): boolean {
  const explicitFlat = detectExplicitFlatPriceForItem(originalText, item, fallbackCurrency);
  const explicitUnit = detectExplicitUnitPriceForItem(originalText, item);
  if (explicitFlat || explicitUnit) return true;

  // Broad item evidence can contain the full WhatsApp message. In that case a
  // price from another line (for example Anfahrt CHF 45) must not count as
  // explicit price evidence for a neighbouring service with "Preis wie letztes
  // Mal". Only accept loose evidence when it is anchored to this item's
  // service name or to this item's quantity/unit.
  const itemEvidence = [item.sourceText, item.evidence, item.description]
    .map((part) => normalizeText(part))
    .filter(Boolean)
    .join("\n");

  const itemUnitType = unitTypeFromDisplayUnit(item.unit);
  const itemQuantity = Number(item.quantity || 0);
  const serviceKey = normalizeCompare(item.serviceName);
  const tokens = serviceTokens(item.serviceName);

  return splitIntoPriceSegments(itemEvidence).some((segment) => {
    const normalizedSegment = normalizeCompare(segment);
    if (!normalizedSegment) return false;

    const hasAnyPriceSignal =
      hasExplicitCurrencyAmount(segment) ||
      extractUnitPricesFromSegment(segment).length > 0 ||
      Boolean(detectCurrencylessFlatPriceFromSegment(segment, fallbackCurrency));

    if (!hasAnyPriceSignal) return false;

    const hasExactServiceAnchor = Boolean(
      serviceKey && normalizedSegment.includes(serviceKey),
    );
    const serviceTokenHits = tokens.filter((token) =>
      normalizedSegment.includes(token),
    ).length;
    const hasQuantityAnchor = segmentContainsQuantity(
      segment,
      itemQuantity,
      itemUnitType,
    );

    return hasExactServiceAnchor || serviceTokenHits > 0 || hasQuantityAnchor;
  });
}

function findQuantityOnlyUnclearLine(line: string): {
  quantity: number;
  unitType: string;
  quantityRaw: string;
} | null {
  if (!hasUnclearPriceSignal(line)) return null;
  const quantityMatch = line.match(new RegExp(`\\b(\\d+(?:[.,]\\d+)?)\\s*(${UNIT_WORDS})\\b`, "i"));
  const quantity = parsePriceNumber(quantityMatch?.[1]);
  const unitType = unitTypeFromText(quantityMatch?.[2]);
  if (!quantityMatch || !quantity || !unitType) return null;
  return { quantity, unitType, quantityRaw: quantityMatch[0] };
}


type UnclearPriceLine = {
  serviceName: string;
  quantity: number;
  unitType: string;
  quantityRaw: string;
  sourceText: string;
};

function splitRawIntakeLines(text?: string | null): string[] {
  const source = normalizeText(text);
  if (!source) return [];

  const cleanup = (line: string) =>
    normalizeText(line)
      .replace(/^\s*(?:[-–—•]+|\d+[.)])\s*/, "")
      .trim();

  // INTAKE_UNCLEAR_PRICE_FULL_LINE_V16_5:
  // Keep the original customer line first. Earlier we split before every
  // quantity ("Boden reinigen ca. 55 m2 ..." -> "55 m2 ...") and lost the
  // service topic. That allowed the following flat price ("Anfahrt CHF 45")
  // to leak into the uncertain Boden line. For uncertain-price guards the
  // full original line is the source of truth.
  const originalLines = source
    .split(/\n+|;|\s+•\s+|\s+\|\s+/g)
    .map(cleanup)
    .filter(Boolean);

  const splitQuantityLines = source
    .replace(/\s+(?=\d+(?:[.,]\d+)?\s*(?:m2|m²|qm|quadratmeter|m3|m³|cbm|stunden?|std\.?|h|tage?|meter|laufmeter|lfm|stück|stueck|stk|kg|kilogramm|tonnen?|liter|ltr\.?|piece|pieces|pi[eè]ces?|vitres?|fenetres?|windows?)\b)/gi, "\n")
    .split(/\n+|;|\s+•\s+|\s+\|\s+/g)
    .map(cleanup)
    .filter(Boolean);

  return unique([...originalLines, ...splitQuantityLines]);
}

function extractUnclearPriceLines(originalText: string): UnclearPriceLine[] {
  const result: UnclearPriceLine[] = [];

  for (const line of splitRawIntakeLines(originalText)) {
    const unclear = findQuantityOnlyUnclearLine(line);
    if (!unclear) continue;

    const serviceName = cleanExplicitServiceNameFromLine(line, {
      quantityRaw: unclear.quantityRaw,
    });

    result.push({
      serviceName,
      quantity: unclear.quantity,
      unitType: unclear.unitType,
      quantityRaw: unclear.quantityRaw,
      sourceText: line,
    });
  }

  const byKey = new Map<string, UnclearPriceLine>();
  for (const line of result) {
    const key = `${normalizeCompare(line.sourceText)}:${line.quantity}:${line.unitType}`;
    if (!byKey.has(key)) byKey.set(key, line);
  }

  return Array.from(byKey.values());
}


function weakServiceTopic(value?: string | null): string | null {
  const source = normalizeCompare(value);
  if (!source) return null;

  const topicPatterns: Array<[RegExp, string]> = [
    [/\btreppenhaus\b/, "treppenhaus"],
    [/\bkellerboden\b/, "kellerboden"],
    [/\bboden\b/, "boden"],
    [/\bwand\b|\bwaende\b|\bwände\b/, "wand"],
    [/\bmaler\b|\bmalerarbeiten\b|\bstreichen\b/, "malerarbeiten"],
    [/\bsockelleisten?\b|\bleisten?\b/, "sockelleisten"],
    [/\bfenster\b|\bvitres?\b|\bwindows?\b|\bfenetres?\b|\bfenêtres?\b/, "fenster"],
    [/\bgarage\b|\btiefgarage\b/, "garage"],
    [/\beingangsbereich\b|\bentrée\b|\bentree\b|\bentrance\b/, "eingangsbereich"],
    [/\banfahrt\b/, "anfahrt"],
    [/\bentsorgung\b|\bmaterial\b/, "entsorgung"],
  ];

  for (const [pattern, topic] of topicPatterns) {
    if (pattern.test(source)) return topic;
  }

  return null;
}

function itemHasUnclearPriceSignal(item: ParsedOrderItemForValidation): boolean {
  return hasUnclearPriceSignal(
    [item.serviceName, item.description, item.sourceText, item.evidence]
      .filter(Boolean)
      .join(" "),
  );
}

function itemMatchesUnclearPriceLine(
  item: ParsedOrderItemForValidation,
  unclear: UnclearPriceLine,
): boolean {
  const itemText = normalizeCompare(
    [item.sourceText, item.evidence, item.description, item.serviceName]
      .filter(Boolean)
      .join(" "),
  );
  const itemName = normalizeCompare(item.serviceName);
  const lineText = normalizeCompare(unclear.sourceText);
  const unclearName = normalizeCompare(unclear.serviceName);

  if (!itemText || !lineText) return false;
  if (itemText.includes(lineText) || lineText.includes(itemText)) return true;
  if (itemName && lineText.includes(itemName)) return true;
  if (unclearName && itemText.includes(unclearName)) return true;

  const itemUnitType = unitTypeFromDisplayUnit(item.unit);
  const sameUnit = !itemUnitType || itemUnitType === unclear.unitType;
  const sameQuantity =
    Number(item.quantity || 0) > 0 &&
    Math.abs(Number(item.quantity || 0) - unclear.quantity) < 0.001;

  const itemTokens = meaningfulServiceTokens(item.serviceName);
  const unclearTokens = meaningfulServiceTokens(unclear.serviceName);
  const overlap = unclearTokens.filter(
    (token) => itemTokens.includes(token) || itemText.includes(token),
  ).length;

  if (sameUnit && sameQuantity && overlap > 0) return true;

  // Generic names like "Boden reinigen" may have no meaningful tokens after
  // generic-token filtering. In that case, use a weak service topic plus
  // quantity/unit evidence. This blocks price leakage from neighbouring lines.
  const itemTopic = weakServiceTopic([item.serviceName, itemText].join(" "));
  const lineTopic = weakServiceTopic([unclear.serviceName, lineText].join(" "));

  if (sameUnit && sameQuantity && itemTopic && lineTopic && itemTopic === lineTopic) {
    return true;
  }

  if (
    sameUnit &&
    itemTopic &&
    lineTopic &&
    itemTopic === lineTopic &&
    (Number(item.quantity || 0) <= 0 || item.needsReview)
  ) {
    return true;
  }

  // Generic direct-name fallback.
  if (sameUnit && sameQuantity && itemName && lineText.includes(itemName)) return true;

  return false;
}

function applyUnclearPriceLineGuard(
  items: ParsedOrderItemForValidation[],
  originalText: string,
): { items: ParsedOrderItemForValidation[]; reviewReasons: string[] } {
  const unclearLines = extractUnclearPriceLines(originalText);
  if (unclearLines.length === 0) return { items, reviewReasons: [] };

  const reviewReasons: string[] = [];
  const nextItems = [...items];

  for (const unclear of unclearLines) {
    const displayUnit = unitTypeToDisplayUnit(unclear.unitType) || "Pauschal";
    const reason = `price_unclear:${unclear.serviceName}`;
    const existingIndex = nextItems.findIndex((item) =>
      itemMatchesUnclearPriceLine(item, unclear),
    );

    const guardedItem: ParsedOrderItemForValidation = {
      serviceName: unclear.serviceName,
      description: unclear.sourceText,
      quantity: unclear.quantity,
      unit: displayUnit,
      unitPrice: 0,
      totalPrice: 0,
      needsReview: true,
      reviewReason: reason,
      sourceText: unclear.sourceText,
      evidence: unclear.sourceText,
      detectedCurrency: null,
    };

    if (existingIndex >= 0) {
      const existing = nextItems[existingIndex];
      nextItems[existingIndex] = {
        ...existing,
        serviceName:
          normalizeCompare(existing.serviceName).length >= 3
            ? existing.serviceName
            : unclear.serviceName,
        description: existing.description || unclear.sourceText,
        quantity: unclear.quantity,
        unit: displayUnit,
        unitPrice: 0,
        totalPrice: 0,
        needsReview: true,
        reviewReason: reason,
        sourceText: existing.sourceText || unclear.sourceText,
        evidence: existing.evidence || unclear.sourceText,
      };
    } else {
      nextItems.push(guardedItem);
    }

    reviewReasons.push(reason, "unit_price_review");
  }

  return {
    items: removeDuplicateUnclearPriceItems(nextItems, unclearLines),
    reviewReasons: unique(reviewReasons),
  };
}


function removeDuplicateUnclearPriceItems(
  items: ParsedOrderItemForValidation[],
  unclearLines: UnclearPriceLine[],
): ParsedOrderItemForValidation[] {
  if (unclearLines.length === 0) return items;

  return items.filter((item, index) => {
    if (!itemHasUnclearPriceSignal(item)) return true;

    const itemTopic = weakServiceTopic(
      [item.serviceName, item.description, item.sourceText, item.evidence].join(" "),
    );

    if (!itemTopic) return true;

    const hasGuardedSibling = items.some((other, otherIndex) => {
      if (otherIndex === index) return false;
      if (!other.reviewReason?.startsWith("price_unclear:")) return false;

      const otherTopic = weakServiceTopic(
        [other.serviceName, other.description, other.sourceText, other.evidence].join(" "),
      );

      return otherTopic === itemTopic;
    });

    // Remove only redundant review-only AI artifacts. Keep the guarded item.
    return !hasGuardedSibling;
  });
}

type ExplicitServiceLineItem = ParsedOrderItemForValidation & {
  detectedCurrency?: string | null;
  sourceText: string;
};

const EXPLICIT_SERVICE_NAME_BLOCKLIST = new Set([
  "leistungsuebersicht",
  "leistungsübersicht",
  "leistungen",
  "besonderheiten",
  "whatsapp",
  "auftrag",
]);

function splitExplicitServiceLineCandidates(text?: string | null): string[] {
  const source = normalizeText(text);
  if (!source) return [];

  const cleanup = (line: string) =>
    normalizeText(line)
      // INTAKE_SAFE_LINE_COVERAGE_V16_7:
      // Do NOT strip a naked leading quantity. It may be the real measured
      // quantity ("4 Stunden", "32 m2"). Only strip bullets / numbered lists.
      .replace(/^\s*(?:[-–—•]+|\d+[.)])\s*/, "")
      .trim();

  const originalLines = source
    .split(/\n+|;|\s+•\s+|\s+\|\s+/g)
    .map(cleanup)
    .filter(Boolean);

  const quantitySplitLines = source
    .replace(/\s+(?=\d+(?:[.,]\d+)?\s*(?:m2|m²|qm|quadratmeter|m3|m³|cbm|stunden?|std\.?|h|tage?|meter|laufmeter|lfm|stück|stueck|stk|kg|kilogramm|tonnen?|liter|ltr\.?|piece|pieces|pi[eè]ces?|vitres?|fenetres?|windows?)\b)/gi, "\n")
    .split(/\n+|;|\s+•\s+|\s+\|\s+/g)
    .map(cleanup)
    .filter(Boolean);

  const candidateLines = unique([...originalLines, ...quantitySplitLines]).filter((line) => {
    const normalized = normalizeCompare(line);
    if (!normalized || normalized.length < 8) return false;
    if (EXPLICIT_SERVICE_NAME_BLOCKLIST.has(normalized.replace(/\s+/g, ""))) return false;

    const hasQuantityWithUnit = new RegExp(`\\b\\d+(?:[.,]\\d+)?\\s*${UNIT_WORDS}\\b`, "i").test(line);
    const hasFlatSignal = /\b(pauschal|pauschale|fixpreis|festpreis|forfait|flat)\b/i.test(line);
    const hasCurrency = new RegExp(CURRENCY_WORDS, "i").test(line);
    const hasCurrencylessUnitPrice = new RegExp(`${PRICE_NUMBER}\\s*(?:pro|je|per|par|à|a|/)\\s*${UNIT_WORDS}\\b`, "i").test(line);
    const hasCurrencylessFlatPrice =
      hasFlatSignal && /\b\d+(?:[.,]\d{1,2})?\b/i.test(line);
    const hasStandaloneFlatServicePrice = isLikelyStandaloneFlatServiceLine(line);

    return (
      (hasQuantityWithUnit && (hasCurrency || hasCurrencylessUnitPrice)) ||
      (hasFlatSignal && (hasCurrency || hasCurrencylessFlatPrice)) ||
      hasStandaloneFlatServicePrice
    );
  });

  // If a full original line exists, drop the generated quantity-only suffix.
  // Example:
  // "Büroreinigung 4 Stunden CHF 82 pro Stunde" is kept,
  // "4 Stunden CHF 82 pro Stunde" is dropped.
  return candidateLines.filter((line) => {
    const key = normalizeCompare(line);
    if (!key) return false;

    return !candidateLines.some((other) => {
      if (other === line) return false;
      const otherKey = normalizeCompare(other);
      if (!otherKey || otherKey.length <= key.length + 4) return false;
      return otherKey.endsWith(key) && /[a-z]/i.test(otherKey.slice(0, Math.max(0, otherKey.length - key.length)));
    });
  });
}

function normalizeExplicitCurrency(value?: string | null): string | null {
  return normalizeCurrency(value);
}

function findExplicitUnitPriceInLine(
  line: string,
  fallbackCurrency: IntakeCurrency,
): {
  amount: number;
  currency: string | null;
  unitType: string | null;
  index: number;
  raw: string;
} | null {
  const patterns: Array<{
    re: RegExp;
    currencyGroup?: number;
    priceGroup: number;
    unitGroup?: number;
  }> = [
    {
      re: new RegExp(`(${CURRENCY_WORDS})\\s*${PRICE_NUMBER}\\s*(?:pro|je|per|par|à|a|/)\\s*(${UNIT_WORDS})\\b`, "i"),
      currencyGroup: 1,
      priceGroup: 2,
      unitGroup: 3,
    },
    {
      re: new RegExp(`${PRICE_NUMBER}\\s*(${CURRENCY_WORDS})\\s*(?:pro|je|per|par|à|a|/)\\s*(${UNIT_WORDS})\\b`, "i"),
      currencyGroup: 2,
      priceGroup: 1,
      unitGroup: 3,
    },
    // V16.40: Unit price after a measured quantity without repeated unit:
    // "35 m2 Wände streichen à CHF 18" / "30 m2 Decke streichen zu CHF 22".
    {
      re: new RegExp(`(?:à|a|zu|preis|einzelpreis|ep|=|:)\\s*(${CURRENCY_WORDS})\\s*${PRICE_NUMBER}\\b`, "i"),
      currencyGroup: 1,
      priceGroup: 2,
    },
    {
      re: new RegExp(`(?:à|a|zu|preis|einzelpreis|ep|=|:)\\s*${PRICE_NUMBER}\\s*(${CURRENCY_WORDS})\\b`, "i"),
      currencyGroup: 2,
      priceGroup: 1,
    },
    // 90 pro Stunde / 35 pro m2 / 11 pro Meter.
    // Currency is omitted by the customer; use the already resolved fallback currency.
    {
      re: new RegExp(`${PRICE_NUMBER}\\s*(?:pro|je|per|par|à|a|/)\\s*(${UNIT_WORDS})\\b`, "i"),
      priceGroup: 1,
      unitGroup: 2,
    },
  ];

  for (const pattern of patterns) {
    const match = line.match(pattern.re);
    const amount = parsePriceNumber(match?.[pattern.priceGroup]);
    const currency = pattern.currencyGroup
      ? normalizeExplicitCurrency(match?.[pattern.currencyGroup])
      : fallbackCurrency;
    const unitType = pattern.unitGroup ? unitTypeFromText(match?.[pattern.unitGroup]) : null;
    if (!match || !amount || !currency) continue;
    return {
      amount,
      currency,
      unitType,
      index: match.index ?? 0,
      raw: match[0],
    };
  }

  return null;
}

function findExplicitFlatPriceInLine(line: string, fallbackCurrency: IntakeCurrency): {
  amount: number;
  currency: string | null;
  index: number;
  raw: string;
} | null {
  const allowStandaloneFlatPrice = isLikelyStandaloneFlatServiceLine(line);
  const patterns: Array<{ re: RegExp; currencyGroup?: number; priceGroup: number }> = [
    {
      re: new RegExp(`\\b(?:pauschal|pauschale|fixpreis|festpreis|forfait|flat)\\s*(?:ist|von|zu|=|:)?\\s*(${CURRENCY_WORDS})\\s*${PRICE_NUMBER}\\b`, "i"),
      currencyGroup: 1,
      priceGroup: 2,
    },
    {
      re: new RegExp(`\\b(?:pauschal|pauschale|fixpreis|festpreis|forfait|flat)\\s*(?:ist|von|zu|=|:)?\\s*${PRICE_NUMBER}\\s*(${CURRENCY_WORDS})\\b`, "i"),
      currencyGroup: 2,
      priceGroup: 1,
    },
    {
      re: new RegExp(`(${CURRENCY_WORDS})\\s*${PRICE_NUMBER}\\s*(?:pauschal|pauschale|fixpreis|festpreis|forfait|flat)\\b`, "i"),
      currencyGroup: 1,
      priceGroup: 2,
    },
    {
      re: /\b(?:pauschal|pauschale|fixpreis|festpreis|forfait|flat)\s*(?:ist|von|zu|=|:)?\s*(\d+(?:[.,]\d{1,2})?)\b/i,
      priceGroup: 1,
    },
  ];

  if (allowStandaloneFlatPrice) {
    patterns.push(
      {
        re: new RegExp(`(${CURRENCY_WORDS})\\s*${PRICE_NUMBER}\\b`, "i"),
        currencyGroup: 1,
        priceGroup: 2,
      },
      {
        re: new RegExp(`${PRICE_NUMBER}\\s*(${CURRENCY_WORDS})\\b`, "i"),
        currencyGroup: 2,
        priceGroup: 1,
      },
    );
  }

  for (const pattern of patterns) {
    const match = line.match(pattern.re);
    const amount = parsePriceNumber(match?.[pattern.priceGroup]);
    const currency = pattern.currencyGroup
      ? normalizeExplicitCurrency(match?.[pattern.currencyGroup])
      : fallbackCurrency;
    if (!match || !amount || !currency) continue;
    return {
      amount,
      currency,
      index: match.index ?? 0,
      raw: match[0],
    };
  }

  return null;
}

function cleanExplicitServiceNameFromLine(line: string, parts: {
  quantityRaw?: string | null;
  priceRaw?: string | null;
}): string {
  let cleaned = normalizeText(line)
    .replace(/^\s*(?:leistung|leistungsübersicht|leistungsuebersicht)\s*:?\s*/i, " ")
    // INTAKE_SAFE_NAME_CLEANUP_V16_2: keep naked leading quantities until quantityRaw is removed.
    .replace(/^\s*(?:[-–—•]+|\d+[.)])\s*/, " ");

  if (parts.quantityRaw) {
    cleaned = cleaned.replace(parts.quantityRaw, " ");
  }
  if (parts.priceRaw) {
    cleaned = cleaned.replace(parts.priceRaw, " ");
  }

  // INTAKE_UNCLEAR_PRICE_NAME_CLEANUP_V16_4:
  // Remove uncertainty tails from visible service names. These words are
  // instructions for the validator, not part of the service label.
  cleaned = cleaned
    .replace(/\b(?:ungefähr|ungefaehr|ungefahr|ca\.?|circa|approximately|approx\.?|about|environ)\b.*$/i, " ")
    .replace(/\bpreis\s+(?:wie\s+letztes\s+mal|offen|unklar|muss\s+(?:noch\s+)?(?:geprüft|geprueft|prüfen|pruefen|abgeklärt|abgeklaert|abklären|abklaeren)|noch\s+(?:prüfen|pruefen|abklären|abklaeren|offen)).*$/i, " ")
    .replace(/\b(?:price\s+(?:open|unclear|to\s+check|needs\s+checking)|same\s+as\s+last\s+time|tbd).*$/i, " ")
    .replace(/\b(?:prix\s+(?:à\s+vérifier|a\s+verifier|ouvert|incertain)|comme\s+la\s+dernière\s+fois|comme\s+la\s+derniere\s+fois).*$/i, " ");

  cleaned = cleaned
  .replace(/\b(?:pauschal|pauschale|fixpreis|festpreis|forfait|flat)\b/gi, " ")
  .replace(new RegExp(`\\b\\d+(?:[.,]\\d+)?\\s*${UNIT_WORDS}\\b`, "gi"), " ")
  .replace(new RegExp(`\\b(?:${CURRENCY_WORDS})\\s*\\d+(?:[.,]\\d{1,2})?\\b`, "gi"), " ")
  .replace(new RegExp(`\\b\\d+(?:[.,]\\d{1,2})?\\s*(?:${CURRENCY_WORDS})\\b`, "gi"), " ")
  .replace(new RegExp(`\\b(?:pro|je|per|par|à|a|/)\\s*${UNIT_WORDS}\\b`, "gi"), " ")
  .replace(new RegExp(`\\b(?:${CURRENCY_WORDS})\\b`, "gi"), " ")
  .replace(/\b(?:pro|je|per|par|à|a)\b\s*[.,;:!?]*$/i, " ")
  .replace(/\b(?:und|\+)\s+anfahrt\b.*$/i, " ")
  .replace(/[.,;:!?]+$/g, " ")
  // Remove unit prefixes that may remain in the visible service name.
  .replace(/^\s*(?:m2|m²|qm|quadratmeter|meter|laufmeter|lfm|stunde|stunden|std\.?|h|stück|stueck|stk|piece|pieces)\s+/gi, " ")
  .replace(/\b\d+(?:[.,]\d+)?\b/g, " ")
  .replace(/[;:]+/g, " ")
  .replace(/\s+/g, " ")
  .trim();

  // Fallback: when the service name was before a flat-price phrase, keep text before that phrase.
  if (!cleaned || normalizeCompare(cleaned).length < 3) {
    const beforeFlat = line.split(/\b(?:pauschal|pauschale|fixpreis|festpreis|forfait|flat)\b/i)[0] || "";
    cleaned = normalizeText(beforeFlat).replace(/^\s*(?:[-–—•]+|\d+[.)])\s*/, " ").trim();
  }

  const cleanedKey = normalizeCompare(cleaned);
  if (
    !cleaned ||
    cleanedKey.length < 3 ||
    /^(?:es\s+sind|es\s+ist|das\s+sind|das\s+ist|sind|ist|ca|circa|etwa|ungefaehr|ungefahr|ungefähr|approx|approximately|about)$/.test(cleanedKey)
  ) {
    return "Unbekannte Leistung";
  }

  const sourceKey = normalizeCompare(line);
  if (/\bbuero(?:reinigung)?\b|\bburo(?:reinigung)?\b|\boffice\b/.test(sourceKey) && /\b(stunde|stunden|hour|hours|std|h)\b/.test(sourceKey)) {
    return "Büroreinigung";
  }
  const canonicalServiceName = canonicalGermanServiceNameFromText(line);
  if (canonicalServiceName) {
    return canonicalServiceName;
  }
  if (/\btreppenhaus\b/.test(sourceKey) && /\b(reinigen|reinigung|putzen)\b/.test(sourceKey)) {
    return "Treppenhaus reinigen";
  }
  if (/\beingangsbereich\b/.test(sourceKey)) {
    return "Eingangsbereich reinigen";
  }

  return cleaned
    .replace(/^./, (char) => char.toUpperCase());
}


function isWeakExplicitServiceName(value?: string | null): boolean {
  const normalized = normalizeCompare(value);
  if (!normalized || normalized === "unbekannte leistung") return true;

  if (
    /^(?:es\s+sind|es\s+ist|das\s+sind|das\s+ist|sind|ist|ca|circa|etwa|ungefaehr|ungefahr|ungefähr|ungefahr|approx|approximately|about)[\s,.;:-]*$/i.test(
      normalized,
    )
  ) {
    return true;
  }

  if (/^(?:es\s+sind|es\s+ist|das\s+sind|das\s+ist)\b/i.test(normalized)) {
    const remainder = normalized
      .replace(/^(?:es\s+sind|es\s+ist|das\s+sind|das\s+ist)\b/i, "")
      .replace(/[,\s.;:-]+/g, " ")
      .trim();
    if (remainder.length < 4) return true;
  }

  const canonical = canonicalGermanServiceNameFromText(value);
  if (canonical) return false;

  const tokens = meaningfulServiceTokens(value);
  return tokens.length === 0;
}

function inferExplicitServiceNameFromPreviousContext(
  originalText: string,
  currentLine: string,
): string | null {
  const source = normalizeText(originalText);
  const current = normalizeText(currentLine);
  if (!source || !current) return null;

  const index = source.indexOf(current);
  const before = index >= 0 ? source.slice(0, index) : source;

  const candidates = before
    .split(/\n+|(?<=[.!?])\s+/g)
    .map((piece) => piece.trim())
    .filter(Boolean)
    .slice(-8)
    .reverse();

  const skipPattern =
    /^(?:rechnung|rechnungsadresse|kunde|kundin|arbeitsort|objekt|ausführungsadresse|ausfuehrungsadresse|kontakt\s+vor\s+ort|kontaktperson|ansprechperson|tel\.?|telefon|phone|mobile|handy|natel|e-?mail|termin|titel|leistungen|leistungsübersicht|leistungsuebersicht)\b/i;

  for (const candidate of candidates) {
    if (skipPattern.test(candidate)) continue;

    const canonical = canonicalGermanServiceNameFromText(candidate);
    if (canonical) return canonical;

    const normalized = normalizeCompare(candidate);
    if (
      /\b(?:fenster|vitres|fenetres|windows|ventanas|finestre|janelas)\b/.test(normalized) &&
      /\b(?:reinigen|reinigung|putzen|clean|cleaning|nettoyage|limpieza|limpiar|pulizia|pulire|limpeza)\b/.test(normalized)
    ) {
      return "Fenster reinigen";
    }

    if (
      /\b(?:boden|sol|floor|suelo|pavimento|suolo|chao)\b/.test(normalized) &&
      /\b(?:reinigen|reinigung|putzen|clean|cleaning|nettoyage|limpieza|limpiar|pulizia|pulire|limpeza)\b/.test(normalized)
    ) {
      return "Boden reinigen";
    }
  }

  return null;
}

function resolveExplicitServiceNameFromContext(
  originalText: string,
  line: string,
  proposedName: string,
): string {
  const canonicalFromLine = canonicalGermanServiceNameFromText(line);
  if (canonicalFromLine) return canonicalFromLine;

  if (!isWeakExplicitServiceName(proposedName)) return proposedName;

  return (
    inferExplicitServiceNameFromPreviousContext(originalText, line) ||
    "Unbekannte Leistung"
  );
}

function extractExplicitServiceLineItems(
  originalText: string,
  fallbackCurrency: IntakeCurrency,
): ExplicitServiceLineItem[] {
  const lines = splitExplicitServiceLineCandidates(originalText);
  const result: ExplicitServiceLineItem[] = [];

  for (const line of lines) {
    const quantityMatch = line.match(new RegExp(`\\b(\\d+(?:[.,]\\d+)?)\\s*(${UNIT_WORDS})\\b`, "i"));
    const unitPrice = findExplicitUnitPriceInLine(line, fallbackCurrency);
    const flatPrice = findExplicitFlatPriceInLine(line, fallbackCurrency);
    const unclearQuantityOnly = findQuantityOnlyUnclearLine(line);

    if (unclearQuantityOnly && !unitPrice && !flatPrice) {
      const serviceName = resolveExplicitServiceNameFromContext(
        originalText,
        line,
        cleanExplicitServiceNameFromLine(line, {
          quantityRaw: unclearQuantityOnly.quantityRaw,
        }),
      );

      result.push({
        serviceName,
        description: line,
        quantity: unclearQuantityOnly.quantity,
        unit: unitTypeToDisplayUnit(unclearQuantityOnly.unitType) || "Pauschal",
        unitPrice: 0,
        totalPrice: 0,
        needsReview: true,
        reviewReason: `price_unclear:${serviceName}`,
        sourceText: line,
        evidence: line,
        detectedCurrency: fallbackCurrency,
      });
      continue;
    }

    if (quantityMatch && unitPrice) {
      const quantity = parsePriceNumber(quantityMatch[1]) || 0;
      const quantityUnitType = unitTypeFromText(quantityMatch[2]);
      const unitType = quantityUnitType || unitPrice.unitType;
      if (!quantity || !unitType) continue;

      const serviceName = resolveExplicitServiceNameFromContext(
        originalText,
        line,
        cleanExplicitServiceNameFromLine(line, {
          quantityRaw: quantityMatch[0],
          priceRaw: unitPrice.raw,
        }),
      );

      result.push({
        serviceName,
        description: line,
        quantity,
        unit: unitTypeToDisplayUnit(unitType) || "Pauschal",
        unitPrice: unitPrice.amount,
        totalPrice: roundMoney(quantity * unitPrice.amount),
        needsReview: false,
        reviewReason: null,
        sourceText: line,
        evidence: line,
        detectedCurrency: unitPrice.currency,
      });
      continue;
    }

    if (flatPrice && (/\b(pauschal|pauschale|fixpreis|festpreis|forfait|flat)\b/i.test(line) || isLikelyStandaloneFlatServiceLine(line))) {
      const serviceName = resolveExplicitServiceNameFromContext(
        originalText,
        line,
        cleanExplicitServiceNameFromLine(line, {
          priceRaw: flatPrice.raw,
        }),
      );

      result.push({
        serviceName,
        description: line,
        quantity: 1,
        unit: "Pauschal",
        unitPrice: flatPrice.amount,
        totalPrice: flatPrice.amount,
        needsReview: false,
        reviewReason: null,
        sourceText: line,
        evidence: line,
        detectedCurrency: flatPrice.currency,
      });
    }
  }

  const byKey = new Map<string, ExplicitServiceLineItem>();
  for (const item of result) {
    const key = `${normalizeCompare(item.sourceText)}:${item.detectedCurrency || ""}`;
    if (!byKey.has(key)) byKey.set(key, item);
  }

  return Array.from(byKey.values());
}

function meaningfulServiceTokens(value?: string | null): string[] {
  return normalizeCompare(value)
    .split(" ")
    .map((token) => token.trim())
    .filter(
      (token) =>
        token.length >= 4 &&
        !GENERIC_SERVICE_WORDS.has(token) &&
        !["boden", "garage", "material", "pauschal"].includes(token),
    );
}

function itemCoversExplicitLine(
  item: ParsedOrderItemForValidation,
  explicit: ExplicitServiceLineItem,
): boolean {
  const itemSource = normalizeCompare(
    [item.sourceText, item.evidence, item.description, item.serviceName]
      .filter(Boolean)
      .join(" "),
  );
  const explicitSource = normalizeCompare(explicit.sourceText);

  const itemUnitType = unitTypeFromDisplayUnit(item.unit);
  const explicitUnitType = unitTypeFromDisplayUnit(explicit.unit);
  const sameUnit = !itemUnitType || !explicitUnitType || itemUnitType === explicitUnitType;
  const sameQuantity = Math.abs(Number(item.quantity || 0) - Number(explicit.quantity || 0)) < 0.001;
  const samePrice = Math.abs(Number(item.unitPrice || 0) - Number(explicit.unitPrice || 0)) < 0.01;
  const itemTokens = meaningfulServiceTokens(item.serviceName);
  const explicitTokens = meaningfulServiceTokens(explicit.serviceName);
  const nameTokenOverlap = explicitTokens.filter((token) => itemTokens.includes(token)).length;
  const sourceTokenOverlap = explicitTokens.filter((token) => itemTokens.includes(token) || itemSource.includes(token)).length;

  if (explicitSource && itemSource && (itemSource.includes(explicitSource) || explicitSource.includes(itemSource))) {
    // V16.40: Full WhatsApp text in item evidence must not make every item
    // cover every explicit service line. Broad evidence only counts when the
    // item also matches the explicit line by unit/quantity/topic.
    const itemSourceLooksBroad = itemSource.length > explicitSource.length + 120 && /\b(?:rechnung|arbeitsort|termin|anfahrt|whatsapp)\b/i.test(itemSource);
    if (!itemSourceLooksBroad) return true;
    if (sameUnit && sameQuantity && nameTokenOverlap > 0) return true;
  }

  if (sameUnit && sameQuantity && samePrice) return true;
  if (sameUnit && sameQuantity && nameTokenOverlap > 0) return true;

  return sameUnit && samePrice && sourceTokenOverlap > 0 && nameTokenOverlap > 0;
}

function shouldPreferExplicitServiceName(
  item: ParsedOrderItemForValidation,
  explicit: ExplicitServiceLineItem,
): boolean {
  const itemName = normalizeCompare(item.serviceName);
  const explicitName = normalizeCompare(explicit.serviceName);
  if (!explicitName || explicitName === "unbekannte leistung") return false;
  if (!itemName || itemName === "unbekannte leistung" || itemName === "reinigung") return true;

  const itemTokens = meaningfulServiceTokens(item.serviceName);
  const explicitTokens = meaningfulServiceTokens(explicit.serviceName);
  const overlap = explicitTokens.filter((token) => itemTokens.includes(token)).length;

  if (overlap === 0 && explicitTokens.length > 0) return true;

  // A very common catalog failure: a specific floor-cleaning line is mapped to a wrong historic catalog item.
  if (/\b(farbreste|farbe|kellerboden)\b/.test(itemName) && !/\b(farbreste|farbe)\b/.test(explicitName)) {
    return true;
  }

  return false;
}

function itemIsLikelySameExplicitService(
  item: ParsedOrderItemForValidation,
  explicit: ExplicitServiceLineItem,
): boolean {
  const itemSource = normalizeCompare(
    [item.sourceText, item.evidence, item.description, item.serviceName]
      .filter(Boolean)
      .join(" "),
  );
  const explicitSource = normalizeCompare(explicit.sourceText);
  if (explicitSource && itemSource && (itemSource.includes(explicitSource) || explicitSource.includes(itemSource))) {
    return true;
  }

  const itemTokens = meaningfulServiceTokens(item.serviceName);
  const explicitTokens = meaningfulServiceTokens(explicit.serviceName);
  if (itemTokens.length === 0 || explicitTokens.length === 0) return false;

  const overlap = explicitTokens.filter(
    (token) => itemTokens.includes(token) || itemSource.includes(token),
  ).length;

  const requiredOverlap = explicitTokens.length >= 2 ? 2 : 1;
  return overlap >= requiredOverlap;
}

function applyExplicitLineCoverage(
  items: ParsedOrderItemForValidation[],
  originalText: string,
  finalCurrency: IntakeCurrency,
): { items: ParsedOrderItemForValidation[]; reviewReasons: string[] } {
  const explicitItems = extractExplicitServiceLineItems(originalText, finalCurrency);
  if (explicitItems.length === 0) return { items, reviewReasons: [] };

  const reviewReasons: string[] = [];
  const nextItems = [...items];

  for (const explicit of explicitItems) {
    const existingIndex = nextItems.findIndex((item) => itemCoversExplicitLine(item, explicit));
    const supportedCurrency = explicit.detectedCurrency === "CHF" || explicit.detectedCurrency === "EUR";
    const currencyMatches = supportedCurrency && explicit.detectedCurrency === finalCurrency;
    const explicitNeedsReview = Boolean(explicit.needsReview) || Number(explicit.unitPrice || 0) <= 0;
    const explicitReviewReason = explicitNeedsReview
      ? explicit.reviewReason || `price_unclear:${explicit.serviceName}`
      : null;

    const explicitAsItem: ParsedOrderItemForValidation = {
      ...explicit,
      unitPrice: currencyMatches && !explicitNeedsReview ? explicit.unitPrice : 0,
      totalPrice: currencyMatches && !explicitNeedsReview ? calculateSafeLineTotal(explicit) : 0,
      needsReview: !currencyMatches || explicitNeedsReview,
      reviewReason: currencyMatches
        ? explicitReviewReason
        : `item_currency_mismatch:${explicit.serviceName}:${explicit.detectedCurrency || "UNKNOWN"}:${finalCurrency}`,
    };

    if (!currencyMatches) {
      reviewReasons.push("currency_review", explicitAsItem.reviewReason as string);
    } else if (explicitAsItem.needsReview && explicitAsItem.reviewReason) {
      reviewReasons.push(explicitAsItem.reviewReason);
    }

    if (existingIndex >= 0) {
      const existing = nextItems[existingIndex];
      const repaired: ParsedOrderItemForValidation = {
        ...existing,
        serviceName: shouldPreferExplicitServiceName(existing, explicit)
          ? explicit.serviceName
          : existing.serviceName,
        description: existing.description || explicit.description,
        quantity: currencyMatches ? explicit.quantity : existing.quantity,
        unit: currencyMatches ? explicit.unit : existing.unit,
        unitPrice: currencyMatches && !explicitNeedsReview ? explicit.unitPrice : 0,
        totalPrice: currencyMatches && !explicitNeedsReview ? calculateSafeLineTotal(explicit) : 0,
        needsReview: currencyMatches ? explicitNeedsReview : true,
        reviewReason: currencyMatches ? explicitReviewReason : explicitAsItem.reviewReason,
        sourceText: existing.sourceText || explicit.sourceText,
        evidence: existing.evidence || explicit.evidence,
        detectedCurrency: explicit.detectedCurrency || existing.detectedCurrency,
      };

      nextItems[existingIndex] = repaired;
    } else {
      nextItems.push(explicitAsItem);
    }
  }

  return { items: nextItems, reviewReasons: unique(reviewReasons) };
}


function removeSubsumedReviewOnlyItems(
  items: ParsedOrderItemForValidation[],
): ParsedOrderItemForValidation[] {
  return items.filter((item, index) => {
    const itemReviewOnly =
      Boolean(item.needsReview) ||
      Number(item.unitPrice || 0) <= 0 ||
      Number(item.totalPrice || 0) <= 0;

    if (!itemReviewOnly) return true;

    const itemUnit = unitTypeFromDisplayUnit(item.unit);
    const itemQuantity = Number(item.quantity || 0);
    const itemTokens = meaningfulServiceTokens(item.serviceName);
    const itemName = normalizeCompare(item.serviceName);

    if (!itemUnit || itemQuantity <= 0 || itemTokens.length === 0) return true;

    const isSubsumed = items.some((other, otherIndex) => {
      if (otherIndex === index) return false;
      if (Number(other.unitPrice || 0) <= 0 || Number(other.totalPrice || 0) <= 0) return false;
      if (Math.abs(Number(other.quantity || 0) - itemQuantity) >= 0.001) return false;
      if (unitTypeFromDisplayUnit(other.unit) !== itemUnit) return false;

      const otherName = normalizeCompare(other.serviceName);
      const otherTokens = meaningfulServiceTokens(other.serviceName);
      const tokenSubset = itemTokens.every((token) => otherTokens.includes(token) || otherName.includes(token));
      const genericShortName = itemTokens.length <= 1 || ["wand", "boden", "stunden", "stunde"].includes(itemName);

      return tokenSubset || genericShortName;
    });

    return !isSubsumed;
  });
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

  const coverage = applyExplicitLineCoverage(
    input.items,
    input.originalText,
    finalCurrency,
  );
  reviewReasons.push(...coverage.reviewReasons);

  const hasGlobalUnclearPriceReference = hasStandaloneUnclearPriceReference(input.originalText);

  let items = coverage.items.map((item) => {
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

    const explicitFlatPrice = detectExplicitFlatPriceForItem(
      input.originalText,
      next,
      finalCurrency,
    );

    if (
      explicitFlatPrice &&
      explicitFlatPrice.currency === finalCurrency &&
      !(
        !isFlatUnit(next.unit) &&
        new RegExp(`\\b\\d+(?:[.,]\\d+)?\\s*${UNIT_WORDS}\\b`, "i").test(
          [next.sourceText, next.evidence, next.description].filter(Boolean).join(" "),
        )
      )
    ) {
      next.unit = "Pauschal";
      next.quantity = 1;
      next.unitPrice = explicitFlatPrice.amount;
      next.totalPrice = explicitFlatPrice.amount;
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

    if (
      hasGlobalUnclearPriceReference &&
      !hasExplicitPriceEvidenceForItem(input.originalText, next, finalCurrency)
    ) {
      itemReasons.push(`price_unclear:${next.serviceName}`, "unit_price_review");
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

  items = repairCommonMultilingualCleaningItems(input.originalText, items, finalCurrency);

  const missingFlatItems = detectFlatPriceItems(input.originalText, items, finalCurrency);
  if (missingFlatItems.length > 0) {
    items = [...missingFlatItems, ...items];
    reviewReasons.push("manual_flat_service_from_text");
  }

  items = removeItemsUsingForeignFlatPrice(input.originalText, items, finalCurrency);
  items = normalizeParsedServiceNames(items);
  items = removeCompositeServiceNameArtifacts(items);
  items = dedupeUnsafeDuplicateItems(items);
  items = removeMeasuredFlatDuplicateArtifacts(items);
  items = removeFlatItemsDuplicatingMeasuredServiceWithoutOwnLine(input.originalText, items, finalCurrency);
  items = removeUnpricedDuplicateServiceArtifacts(items);

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

  const unclearGuard = applyUnclearPriceLineGuard(items, input.originalText);
  items = normalizeParsedServiceNames(unclearGuard.items);
  items = removeCompositeServiceNameArtifacts(items);
  items = removeFlatItemsDuplicatingMeasuredServiceWithoutOwnLine(input.originalText, items, finalCurrency);
  items = removeUnpricedDuplicateServiceArtifacts(items);
  reviewReasons.push(...unclearGuard.reviewReasons);

  items = removeSubsumedReviewOnlyItems(items);

  const priceUnclearServiceNames = new Set(
    items
      .filter((item) => item.reviewReason?.startsWith("price_unclear:"))
      .map((item) => normalizeCompare(item.serviceName)),
  );

  const hasRealCurrencyProblem =
    detectedCurrencies.length > 1 ||
    unsupportedDetectedCurrencies.length > 0 ||
    items.some((item) => {
      const detectedCurrency = normalizeCurrency(item.detectedCurrency);
      return Boolean(detectedCurrency && detectedCurrency !== finalCurrency);
    });

  if (!hasRealCurrencyProblem) {
    items = items.map((item) => {
      const reason = item.reviewReason || "";
      if (
        reason === "currency_review" ||
        reason === "currency_conflict" ||
        reason === "currency_unsupported" ||
        reason.startsWith("item_currency_mismatch:")
      ) {
        return { ...item, needsReview: false, reviewReason: null };
      }
      return item;
    });
  }

  const finalReviewReasons = unique(reviewReasons)
    .filter((reason) => {
      if (!reason.startsWith("unit_mismatch:")) return true;
      const [, serviceName] = reason.split(":");
      return !priceUnclearServiceNames.has(normalizeCompare(serviceName));
    })
    .filter((reason) => {
      if (
        reason === "currency_review" ||
        reason === "currency_conflict" ||
        reason === "currency_unsupported" ||
        reason.startsWith("item_currency_mismatch:")
      ) {
        return hasRealCurrencyProblem;
      }
      return true;
    });

  const finalNeedsReview =
    finalReviewReasons.length > 0 ||
    items.some((item) => {
      if (!item.needsReview) return false;
      const reason = item.reviewReason || "";
      if (
        !hasRealCurrencyProblem &&
        (reason === "currency_review" ||
          reason === "currency_conflict" ||
          reason === "currency_unsupported" ||
          reason.startsWith("item_currency_mismatch:"))
      ) {
        return false;
      }
      return true;
    });

  return {
    items,
    reviewReasons: finalReviewReasons,
    needsReview: finalNeedsReview,
    finalCurrency,
    detectedCurrencies,
  };
}

const EXECUTION_ADDRESS_MARKER =
  /\b(ausführungsadresse|ausfuehrungsadresse|ausführende\s+adresse|ausfuehrende\s+adresse|ausführungsort|ausfuehrungsort|ausführung|ausfuehrung|arbeitsort|arbeitsadresse|einsatzort|baustellenadresse|baustelle|objektadresse|objekt|leistungsadresse|leistungsort|serviceadresse|montageadresse|reinigungsadresse|ort\s+der\s+ausführung|ort\s+der\s+ausfuehrung|adresse\s+vor\s+ort|adresse\s+wo\s+gearbeitet\s+wird|arbeiten\s+(?:bitte\s+)?(?:bei|beim|in|im)|arbeit\s+(?:bitte\s+)?(?:bei|beim|in|im)|work\s+address|job\s+site|job\s+address|service\s+address|site\s+address|location\s+of\s+work|adresse\s+de\s+travail|adresse\s+d[’']intervention|adresse\s+du\s+chantier|lieu\s+d[’']intervention|dirección\s+de\s+trabajo|direccion\s+de\s+trabajo|dirección\s+de\s+obra|direccion\s+de\s+obra|lugar\s+de\s+trabajo|indirizzo\s+di\s+lavoro|indirizzo\s+cantiere|luogo\s+di\s+intervento)\b/i;

const STOP_MARKER =
  /\b(rechnungsadresse|rechnung\s+an|rechnungskunde|rechnungsempfänger|rechnungsempfaenger|auftraggeber|besteller|zahler|factura|fatura|fattura|facture|kunde|kundendaten|leistung|leistungen|preis|preise|kosten|telefon|tel\.?|e-mail|email|mail|bemerkung|bemerkungen|hinweis|hinweise|notiz|notizen|termin|datum|mwst|währung|waehrung|kundennachricht|whatsapp|titel|title)\b/i;

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

  // Standalone type street names: "Untere Gasse 4", "Alter Weg 2".
  const prefixedGenericStreet = new RegExp(
    `\\b(${allowedStreetPrefix}\\s+${streetSuffix}\\s+${houseNumber})\\b`,
    "gi",
  );

  for (const match of text.matchAll(prefixedGenericStreet)) {
    const candidate = match[1]?.replace(/\s+/g, " ").trim();
    if (candidate) streetCandidates.push(candidate);
  }

  // French/Italian multi-word street names: "Rue du Lac 18",
  // "Avenue des Fleurs 9", "Chemin de la Gare 4".
  const foreignStreet = new RegExp(
    `\\b((?:rue|avenue|av\\.?|chemin|via|viale)\\s+[A-ZÄÖÜa-zäöüß][A-Za-zÄÖÜäöüß'.-]*(?:\\s+(?:de|des|du|del|della|la|le|les|l['’]?|d['’]?|[A-ZÄÖÜa-zäöüß][A-Za-zÄÖÜäöüß'.-]*)){0,6}\\s+${houseNumber})\\b`,
    "gi",
  );

  for (const match of text.matchAll(foreignStreet)) {
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
    .replace(/\b(leisting|leistung|leistungen|bitte|preis|preise|kosten|fenster|treppenhaus|reinigung|reinigen|farbreste|hecke|garage|tiefgarage|pauschal|arbeiten|kommen|melden|montieren|machen|erledigen|schneiden|streichen|entsorgen)\b.*$/gi, "")
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
  /\b(liegenschaft|arbeitsort|arbeitsadresse|arbeit\s+(?:ist|isch|is|wird)|gearbeitet\s+wird|arbeiten|work\s+location|job\s+location|adresse\s+de\s+travail|lieu\s+du\s+travail|ort\s+der\s+arbeit|sondern\s+(?:in|im|bei|beim))\b/i;

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

  // Titel-Zeilen sind reine Auftrags-/Karten-Titel und niemals Objekt-/Ortsnamen.
  if (/^\s*\[?\s*(?:titel|title)\s*[:：].*\]?\s*$/i.test(candidate)) return null;

  candidate = candidate
    .replace(/^\s*(?:um\s*)?\d{1,2}[:.]\d{2}\s*(?:uhr)?\s*(?:beim|bei|am|an|im|in)?\s*$/i, "")
    .replace(/^\s*(?:beim|bei|am|an|im|in|um|uhr|m)\s*$/i, "")
    .trim();

  if (!candidate) return null;

  candidate = candidate
    .replace(/^.*?\bsondern\s+(?:in\s+der|in\s+dem|im|in|bei\s+der|beim|bei|bi\s+de|bi)\s+/i, "")
    .replace(/^.*?\b(?:liegenschaft|objektadresse|objekt|baustelle|arbeitsort|arbeitsadresse|leistungsort|serviceadresse|job\s+site|job\s+location|work\s+location|lieu\s+du\s+travail)\b\s*(?:ist|isch|is|:)?\s*/i, "")
    .replace(/^.*?\b(?:arbeit\s+(?:ist|isch|is)|gearbeitet\s+wird)\b\s*(?:aber\s+)?(?:drueben|drüben)?\s*(?:bei\s+der|beim|bei|bi\s+de|bi|in\s+der|in\s+dem|im|in)?\s*/i, "")
    .replace(/^(?:es\s+(?:geht|goht)\s+um(?:s)?|ist|isch|is|aber|drueben|drüben|bei\s+der|beim|bei|bi\s+de|bi|in\s+der|in\s+dem|im|in|de|der|die|das)\s+/i, "")
    .replace(/^[:\-–—]+\s*/, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!candidate) return null;

  const softSplit = candidate.split(/\b(?:liegenschaft|objekt|baustelle|arbeitsort|arbeitsadresse|leistungsort|sondern)\b/i);
  candidate = (softSplit[softSplit.length - 1] || candidate)
    .replace(/^(?:es\s+(?:geht|goht)\s+um(?:s)?|ist|isch|is|in\s+der|in\s+dem|im|in|bei\s+der|beim|bei|bi\s+de|bi|de|der|die|das)\s+/i, "")
    .replace(/[,;:.]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();

  candidate = candidate
    .replace(/^\s*(?:um\s*)?\d{1,2}[:.]\d{2}\s*(?:uhr)?\s*(?:beim|bei|am|an|im|in)?\s*$/i, "")
    .replace(/^\s*(?:beim|bei|am|an|im|in|um|uhr|m)\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim();

  return candidate || null;
}

function isSafeSiteNameCandidate(value?: string | null): boolean {
  const candidate = normalizeText(value || "");
  const key = normalizeCompare(candidate);
  if (!candidate || !key) return false;
  if (/^\s*\[?\s*(?:titel|title)\s*[:：].*\]?\s*$/i.test(candidate)) return false;
  if (candidate.length < 3 || candidate.length > 80) return false;
  if (/^\s*(?:um\s*)?\d{1,2}[:.]\d{2}\s*(?:uhr)?\s*(?:beim|bei|am|an|im|in)?\s*$/i.test(candidate)) return false;
  if (/\b\d{4,5}\b/.test(candidate)) return false;
  if (/\b\d+(?:[.,]\d+)?\s*(?:stueck|stuck|stück|stk|quadratmeter|qm|m2|meter|stunde|stunden|std|h|tag|tage)\b/i.test(key)) return false;
  if (/\b(chf|franken|stutz|eur|euro|usd|dollar|preis|ansatz|pauschal|pro|per|je)\b/i.test(key)) return false;
  if (/\b(reinigen|reinigung|putzen|schneiden|stutzen|entfernen|streichen|malen|maehen|mähen|montieren|demontieren|reparieren|liefern|entsorgen|entsorgung)\b/i.test(key)) return false;
  if (ADDRESS_WORD_PATTERN.test(candidate)) return false;
  if (STOP_MARKER.test(candidate)) return false;
  if (EXECUTION_ADDRESS_MARKER.test(candidate)) return false;

  const blocked = new Set([
    "ist",
    "isch",
    "is",
    "dort",
    "hier",
    "adresse",
    "ausfuehrungsadresse",
    "ausführungsadresse",
    "bei",
    "bi",
    "in",
    "im",
    "de",
    "der",
    "die",
    "das",
  ]);
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

    // Titel-Zeilen sind reine Auftrags-/Karten-Titel und beenden den Adressblock.
    if (/^\s*\[?\s*(?:titel|title)\s*[:：].*\]?\s*$/i.test(cleaned)) {
      break;
    }

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
