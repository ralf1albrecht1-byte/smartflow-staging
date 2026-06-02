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

  const riskLevel: ReadOnlyIntakeRiskValidatorResult["riskLevel"] =
    hasMultipleCurrencies || hasUnsupportedCurrency
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

const unique = (values: string[]) =>
  Array.from(new Set(values.filter(Boolean)));

const CURRENCY_WORDS =
  "(?:chf|franken|fr\\.?|sfr\\.?|stutz|eur|euro|€|usd|us-dollar|dollar|us\\$|\\$|gbp|pfund|pound|£)";

const UNIT_WORDS =
  "(?:stueck|stück|stuck|stk|pcs|pc|einheit|piece|pieces|pi[eè]ce|pi[eè]ces|vitre|vitres|fenetre|fenetres|window|windows|quadratmeter|quadratmetern|qm|m2|m²|sqm|kubikmeter|kubikmetern|cbm|laufende\\s+meter|laufenden\\s+meter|laufmeter|lfm|meter|stunde|stunden|std\\.?|hour|hours|tag|tage|day|days|kg|kilogramm|tonne|tonnen|liter|ltr|l)";

const PRICE_NUMBER = "(\\d+(?:[.,]\\d{1,2})?)";

const QUANTITY_NUMBER_OR_WORD =
  "(?:\\d+(?:[.,]\\d+)?|ein|eine|einen|einem|einer|eins|viertel|halbe|halb|dreiviertel|anderthalb|eineinhalb|zweieinhalb|dreieinhalb|viereinhalb|fuenfeinhalb|funfeinhalb|sechseinhalb|siebeneinhalb|achteinhalb|neuneinhalb|zwei|drei|vier|fuenf|funf|sechs|sieben|acht|neun|zehn)";

const QUANTITY_WORD_VALUES: Record<string, number> = {
  ein: 1,
  eine: 1,
  einen: 1,
  einem: 1,
  einer: 1,
  eins: 1,
  viertel: 0.25,
  halb: 0.5,
  halbe: 0.5,
  dreiviertel: 0.75,
  anderthalb: 1.5,
  eineinhalb: 1.5,
  zwei: 2,
  zweieinhalb: 2.5,
  drei: 3,
  dreieinhalb: 3.5,
  vier: 4,
  viereinhalb: 4.5,
  fuenf: 5,
  funf: 5,
  fuenfeinhalb: 5.5,
  funfeinhalb: 5.5,
  sechs: 6,
  sechseinhalb: 6.5,
  sieben: 7,
  siebeneinhalb: 7.5,
  acht: 8,
  achteinhalb: 8.5,
  neun: 9,
  neuneinhalb: 9.5,
  zehn: 10,
};

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
function stripNonPricingCurrencyContext(text?: string | null): string {
  return String(text || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split(/\n+/g)
    .filter((line) => {
      const trimmed = line.trim();
      if (!trimmed) return false;

      // Titel/Metadaten sind keine Zahlungswährung.
      // Beispiel: "[Titel: CHF gewinnt trotz EUR Einstellung]" darf keinen
      // CHF/EUR-Konflikt erzeugen, wenn die Preiszeilen eindeutig CHF sind.
      return !/^\s*\[?\s*(?:titel|title)\s*:/i.test(trimmed);
    })
    .join("\n");
}

function stripNegatedCurrencyMentions(text?: string | null): string {
  let source = stripNonPricingCurrencyContext(text).toLowerCase();
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
    new RegExp(`\\b(?:not|no|nicht)\\s+${currencyWords}\\b`, "gi"),
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

function hasExplicitCurrencyAmountForCurrency(
  source: string,
  currencyWords: string,
): boolean {
  return (
    new RegExp(`\\b${currencyWords}\\s*${PRICE_NUMBER}\\b`, "i").test(source) ||
    new RegExp(`\\b${PRICE_NUMBER}\\s*${currencyWords}\\b`, "i").test(source)
  );
}

export function detectCurrenciesInText(text?: string | null): string[] {
  const source = stripNegatedCurrencyMentions(text);
  if (!source.trim()) return [];

  const explicitCurrencies: string[] = [];
  if (
    hasExplicitCurrencyAmountForCurrency(
      source,
      "(?:chf|franken|fr\\.?|sfr\\.?|stutz)",
    )
  )
    explicitCurrencies.push("CHF");
  if (hasExplicitCurrencyAmountForCurrency(source, "(?:eur|euro|€)"))
    explicitCurrencies.push("EUR");
  if (
    hasExplicitCurrencyAmountForCurrency(
      source,
      "(?:usd|us-dollar|dollar|us\\$|\\$)",
    )
  )
    explicitCurrencies.push("USD");
  if (
    hasExplicitCurrencyAmountForCurrency(
      source,
      "(?:gbp|pfund|pound|british pound|£)",
    )
  )
    explicitCurrencies.push("GBP");

  // Preisnahe Währungen sind verbindlicher als Währungswörter in Kundennamen
  // oder Titelzeilen. Dadurch bleibt "CHF Trotz EUR AG" mit CHF-Preiszeilen CHF.
  if (explicitCurrencies.length > 0) return unique(explicitCurrencies);

  const currencies: string[] = [];

  if (/\b(chf|franken|fr\.?|sfr\.?|stutz)\b/i.test(source))
    currencies.push("CHF");
  if (/\b(eur|euro)\b|€/i.test(source)) currencies.push("EUR");
  if (/\b(usd|us-dollar|dollar)\b|\bus\$|\$/i.test(source))
    currencies.push("USD");
  if (/\b(gbp|pfund|pound|british pound)\b|£/i.test(source))
    currencies.push("GBP");

  return unique(currencies);
}

const normalizeCurrency = (value?: string | null): string | null => {
  const currency = String(value || "")
    .toLowerCase()
    .trim();
  if (!currency) return null;
  if (/^(chf|franken|fr\.?|sfr\.?|stutz)$/.test(currency)) return "CHF";
  if (/^(eur|euro|€)$/.test(currency)) return "EUR";
  if (/^(usd|us-dollar|dollar|us\$|\$)$/.test(currency)) return "USD";
  if (/^(gbp|pfund|pound|£)$/.test(currency)) return "GBP";
  return null;
};

const parsePriceNumber = (value?: string | null) => {
  const parsed = Number(
    String(value || "")
      .replace("'", "")
      .replace(",", "."),
  );
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const parseQuantityNumber = (value?: string | null): number | null => {
  const numeric = parsePriceNumber(value);
  if (numeric) return numeric;

  const key = normalizeCompare(value).replace(/\s+/g, "");
  return QUANTITY_WORD_VALUES[key] || null;
};

type ExplicitHourQuantity = {
  quantity: number;
  raw: string;
};

const normalizeHourQuantity = (value: number | null | undefined) => {
  const quantity = Number(value || 0);
  if (!Number.isFinite(quantity) || quantity <= 0) return null;

  // Arbeitszeit wird praxisnah auf Viertelstunden normalisiert.
  // Damit funktionieren 0.25 / 0.5 / 0.75, 3.25 / 3.5 / 3.75 usw.
  return roundMoney(Math.round(quantity * 4) / 4);
};

const hourFractionFromWord = (value?: string | null): number | null => {
  const key = normalizeCompare(value).replace(/\s+/g, "");
  if (!key) return null;
  if (["viertel", "eineviertel", "einviertel", "viertelstunde"].includes(key))
    return 0.25;
  if (["halb", "halbe", "einehalbe", "einhalb", "halbestunde"].includes(key))
    return 0.5;
  if (["dreiviertel", "dreiviertelstunde"].includes(key)) return 0.75;
  return null;
};

function detectExplicitHourQuantityInLine(
  line?: string | null,
): ExplicitHourQuantity | null {
  const source = normalizeText(line);
  if (!source) return null;

  const hourUnit = "(?:stunden?|std\\.?|h|hours?)";
  const minuteUnit = "(?:min\\.?|minuten?|minutes?)";

  // 3.25 Stunden / 3,5 Std. / dreieinhalb Stunden
  const decimalOrWordHour = source.match(
    new RegExp(`\\b(${QUANTITY_NUMBER_OR_WORD})\\s*${hourUnit}\\b`, "i"),
  );
  if (decimalOrWordHour?.[1]) {
    const base = parseQuantityNumber(decimalOrWordHour[1]);
    if (base) {
      let total = base;
      const after = source.slice(
        (decimalOrWordHour.index || 0) + decimalOrWordHour[0].length,
      );
      const minuteAfter = after.match(
        new RegExp(`^\\s*(?:und|\\+)?\\s*(15|30|45)\\s*${minuteUnit}\\b`, "i"),
      );
      if (minuteAfter?.[1]) total += Number(minuteAfter[1]) / 60;
      const normalized = normalizeHourQuantity(total);
      if (normalized) {
        return {
          quantity: normalized,
          raw: `${decimalOrWordHour[0]}${minuteAfter?.[0] || ""}`.trim(),
        };
      }
    }
  }

  // 3 Stunden und Viertel / 3 Stunden und eine halbe / 3 Stunden und dreiviertel
  const hourPlusWordFraction = source.match(
    new RegExp(
      `\\b(${QUANTITY_NUMBER_OR_WORD})\\s*${hourUnit}\\s*(?:und|\\+)?\\s*(?:eine?n?\\s+)?(viertel|halb|halbe|dreiviertel)\\s*(?:stunde|stunden|std\\.?|h)?\\b`,
      "i",
    ),
  );
  if (hourPlusWordFraction?.[1] && hourPlusWordFraction?.[2]) {
    const base = parseQuantityNumber(hourPlusWordFraction[1]);
    const fraction = hourFractionFromWord(hourPlusWordFraction[2]);
    const normalized = normalizeHourQuantity((base || 0) + (fraction || 0));
    if (normalized)
      return { quantity: normalized, raw: hourPlusWordFraction[0] };
  }

  // 3h15 / 3 h 15 min / 3 Std. 45 Minuten
  const compactHourMinute = source.match(
    new RegExp(
      `\\b(\\d{1,2})\\s*(?:h|std\\.?|stunden?)\\s*(15|30|45)\\s*(?:${minuteUnit})?\\b`,
      "i",
    ),
  );
  if (compactHourMinute?.[1] && compactHourMinute?.[2]) {
    const normalized = normalizeHourQuantity(
      Number(compactHourMinute[1]) + Number(compactHourMinute[2]) / 60,
    );
    if (normalized) return { quantity: normalized, raw: compactHourMinute[0] };
  }

  // 15 Minuten / 30 Minuten / 45 Minuten als Stundenposition, wenn der Preis pro Stunde steht.
  const minuteOnly = source.match(
    new RegExp(`\\b(15|30|45)\\s*${minuteUnit}\\b`, "i"),
  );
  if (
    minuteOnly?.[1] &&
    /(?:pro|je|per|par|à|a|\/)\s*(?:stunde|stunden|std\.?|h|hour|hours)\b/i.test(
      source,
    )
  ) {
    const normalized = normalizeHourQuantity(Number(minuteOnly[1]) / 60);
    if (normalized) return { quantity: normalized, raw: minuteOnly[0] };
  }

  // Viertelstunde / halbe Stunde / dreiviertel Stunde.
  const wordOnlyFraction = source.match(
    /\b(?:eine?n?\s+)?(viertel|halb|halbe|dreiviertel)\s*(?:stunde|stunden|std\.?|h)\b/i,
  );
  if (wordOnlyFraction?.[1]) {
    const normalized = normalizeHourQuantity(
      hourFractionFromWord(wordOnlyFraction[1]) || 0,
    );
    if (normalized) return { quantity: normalized, raw: wordOnlyFraction[0] };
  }

  return null;
}

const unitTypeFromText = (value?: string | null): string | null => {
  const rawValue = String(value || "");
  if (/(^|[^a-z0-9])(?:quadratmeter|qm|m2|m²|sqm)(?=$|[^a-z0-9])/i.test(rawValue)) {
    return "square_meter";
  }
  if (/(^|[^a-z0-9])(?:kubikmeter|cbm|m3|m³)(?=$|[^a-z0-9])/i.test(rawValue)) {
    return "cubic_meter";
  }

  const source = normalizeCompare(value);
  if (!source) return null;

  if (
    /\b(stueck|stuck|stück|stk|pcs|pc|piece|pieces|piece|pi[eè]ce|pi[eè]ces|vitre|vitres|fenetre|fenetres|window|windows|einheit|einheiten)\b/i.test(
      source,
    )
  )
    return "piece";
  if (/\b(quadratmeter|qm|m2|m²|sqm)\b/i.test(source)) return "square_meter";
  if (/\b(kubikmeter|cbm|m3|m³)\b/i.test(source)) return "cubic_meter";
  if (/\b(stunde|stunden|std|hour|hours|h)\b/i.test(source)) return "hour";
  if (/\b(tag|tage|day|days)\b/i.test(source)) return "day";
  if (
    /\b(laufende\s+meter|laufenden\s+meter|laufmeter|lfm|meter|m)\b/i.test(
      source,
    )
  )
    return "meter";
  if (/\b(kg|kilogramm)\b/i.test(source)) return "kilogram";
  if (/\b(tonne|tonnen)\b/i.test(source)) return "ton";
  if (/\b(liter|ltr|l)\b/i.test(source)) return "liter";
  if (
    /\b(pauschal|pauschale|fixpreis|festpreis|forfait|flat|flat)\b/i.test(
      source,
    )
  )
    return "flat";

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
  if (
    ["pauschal", "pauschale", "fixpreis", "festpreis", "flat"].includes(value)
  )
    return "flat";

  return null;
};

const isFlatUnit = (unit?: string | null) =>
  unitTypeFromDisplayUnit(unit) === "flat";

function hasExplicitCurrencyAmount(value?: string | null): boolean {
  const source = normalizeText(value);
  if (!source) return false;

  return (
    new RegExp(`\\b(?:${CURRENCY_WORDS})\\s*${PRICE_NUMBER}\\b`, "i").test(
      source,
    ) ||
    new RegExp(`\\b${PRICE_NUMBER}\\s*(?:${CURRENCY_WORDS})\\b`, "i").test(
      source,
    )
  );
}

function hasQuantityWithExplicitUnit(value?: string | null): boolean {
  return new RegExp(
    `\\b${QUANTITY_NUMBER_OR_WORD}\\s*${UNIT_WORDS}\\b`,
    "i",
  ).test(String(value || ""));
}

function hasCurrencylessStandaloneTravelPrice(value?: string | null): boolean {
  const source = normalizeText(value);
  const normalized = normalizeCompare(source);
  if (!source || !normalized) return false;
  if (hasQuantityWithExplicitUnit(source)) return false;

  const travelConcept =
    /\b(?:anfahrt|anfahrtspauschale|fahrtkosten|fahrkosten|fahrpauschale|wegpauschale|einsatzpauschale|deplacement|déplacement|trasferta|transferta|travel\s+(?:fee|costs?)|trip\s+fee|fahrt)\b/i;
  if (!travelConcept.test(normalized)) return false;

  const numbers = source.match(/\b\d+(?:[.,]\d{1,2})?\b/g) || [];
  const priceNumbers = numbers
    .map((raw) => parsePriceNumber(raw))
    .filter((amount): amount is number =>
      Boolean(amount && amount > 0 && amount < 5000),
    );

  // One short travel line with one amount, e.g. "Fahrt 45". Do not touch
  // addresses, PLZs or measured service lines.
  return priceNumbers.length === 1 && normalized.length <= 80;
}

function isLikelyStandaloneFlatServiceLine(value?: string | null): boolean {
  const source = normalizeText(value);
  const normalized = normalizeCompare(source);
  if (!source || !normalized) return false;
  if (
    !hasExplicitCurrencyAmount(source) &&
    !hasCurrencylessStandaloneTravelPrice(source)
  )
    return false;
  if (hasQuantityWithExplicitUnit(source)) return false;

  // Targeted safety-net for auxiliary services that customers usually write as
  // flat lines without the word "pauschal": "Abdecken CHF 90", "Anfahrt CHF 45",
  // "Grüngut entsorgen CHF 75". Measured services like m²/Stück/Meter stay out.
  return /\b(?:anfahrt|anfahrtskosten|anfahrtspauschale|fahrtkosten|fahrkosten|fahrt|fahrpauschale|wegpauschale|einsatzpauschale|reise|reiseaufwand|reisekosten|reisepauschale|travel|trasferta|transferta|abdeck\w*|spachtel\w*|grungut|gruengut|gruenabfall|gartenabfall|entsorg\w*|materialpauschale|material|kleinmaterial|kleinzeug|verbrauchsmaterial|deplacement)\b/i.test(
    normalized,
  );
}

function detectUnitlessCountPriceServiceLineV17_51(
  line: string,
  fallbackCurrency: IntakeCurrency,
): { quantity: number; quantityRaw: string; price: NonNullable<ReturnType<typeof findExplicitUnitPriceInLine>> } | null {
  const source = normalizeText(line);
  const normalized = normalizeCompare(source);
  if (!source || !normalized) return null;
  if (hasQuantityWithExplicitUnit(source)) return null;

  const price = findExplicitUnitPriceInLine(source, fallbackCurrency);
  if (!price || price.currency !== fallbackCurrency) return null;

  const match = source.match(
    new RegExp(`^\\s*(${QUANTITY_NUMBER_OR_WORD})\\s+(.{3,160})$`, "i"),
  );
  const quantity = parseQuantityNumber(match?.[1]);
  if (!match || !quantity || quantity <= 0 || quantity > 9999) return null;

  const beforePrice = source.slice(0, price.index).trim();
  const restAfterQuantity = beforePrice
    .replace(match[1], " ")
    .replace(/^[\s,.;:–—-]+/g, "")
    .trim();
  if (!/[\p{L}]/u.test(restAfterQuantity) || restAfterQuantity.length < 3) {
    return null;
  }

  // V17.53: "à" is a non-ASCII/non-word price marker, so a word-boundary
  // around it does not match reliably. Keep the guard structural: a local
  // count/action line must contain a unit-price marker before it can become a
  // Stück line.
  if (!/(?:à|\b(?:a|je|each|per|pro|zu|mal|x)\b|\*)/i.test(source)) return null;

  return { quantity, quantityRaw: match[1], price };
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
      re: new RegExp(
        `(${CURRENCY_WORDS})\\s*${PRICE_NUMBER}\\s*(?:pro|je|per|par|à|a|/)\\s*(${UNIT_WORDS})\\b`,
        "gi",
      ),
      currencyGroup: 1,
      priceGroup: 2,
      unitGroup: 3,
    },
    {
      re: new RegExp(
        `${PRICE_NUMBER}\\s*(${CURRENCY_WORDS})\\s*(?:pro|je|per|par|à|a|/)\\s*(${UNIT_WORDS})\\b`,
        "gi",
      ),
      currencyGroup: 2,
      priceGroup: 1,
      unitGroup: 3,
    },

    // V16.73: unit price markers without repeated unit word.
    // Examples: "14 stk je CHF 8", "12 pcs CHF 9 each", "18 Stück je CHF 9".
    {
      re: new RegExp(
        `(?:je|each)\\s*(${CURRENCY_WORDS})\\s*${PRICE_NUMBER}\\b`,
        "gi",
      ),
      currencyGroup: 1,
      priceGroup: 2,
    },
    {
      re: new RegExp(
        `(?:je|each)\\s*${PRICE_NUMBER}\\s*(${CURRENCY_WORDS})\\b`,
        "gi",
      ),
      currencyGroup: 2,
      priceGroup: 1,
    },
    {
      re: new RegExp(
        `(${CURRENCY_WORDS})\\s*${PRICE_NUMBER}\\s*(?:each|je)\\b`,
        "gi",
      ),
      currencyGroup: 1,
      priceGroup: 2,
    },
    {
      re: new RegExp(
        `${PRICE_NUMBER}\\s*(${CURRENCY_WORDS})\\s*(?:each|je)\\b`,
        "gi",
      ),
      currencyGroup: 2,
      priceGroup: 1,
    },
    // V16.40: "35 m2 Wände streichen à CHF 18" / "30 m2 Decke streichen zu CHF 22".
    // The quantity unit is anchored earlier in the same segment, not after the price.
    {
      re: new RegExp(
        `(?:à|a|zu|zum\\s+preis\\s+von|zum\\s+preis|preis\\s+von|preis|einzelpreis|ep|=|:)\\s*(${CURRENCY_WORDS})\\s*${PRICE_NUMBER}\\b`,
        "gi",
      ),
      currencyGroup: 1,
      priceGroup: 2,
    },
    {
      re: new RegExp(
        `(?:à|a|zu|zum\\s+preis\\s+von|zum\\s+preis|preis\\s+von|preis|einzelpreis|ep|=|:)\\s*${PRICE_NUMBER}\\s*(${CURRENCY_WORDS})\\b`,
        "gi",
      ),
      currencyGroup: 2,
      priceGroup: 1,
    },
    {
      re: new RegExp(
        `(?:preis|sonderpreis|vereinbart|ansatz|stundensatz|stundenansatz|tagessatz|zu|für|fuer|kostet|kosten|ist|=|:)\\s*(?:ist|von|zu|=|:)?\\s*(${CURRENCY_WORDS})\\s*${PRICE_NUMBER}\\s*(?:pro|je|per|par|à|a|/)\\s*(${UNIT_WORDS})\\b`,
        "gi",
      ),
      currencyGroup: 1,
      priceGroup: 2,
      unitGroup: 3,
    },
    {
      re: new RegExp(
        `(?:preis|sonderpreis|vereinbart|ansatz|stundensatz|stundenansatz|tagessatz|zu|für|fuer|kostet|kosten|ist|=|:)\\s*(?:ist|von|zu|=|:)?\\s*${PRICE_NUMBER}\\s*(${CURRENCY_WORDS})\\s*(?:pro|je|per|par|à|a|/)\\s*(${UNIT_WORDS})\\b`,
        "gi",
      ),
      currencyGroup: 2,
      priceGroup: 1,
      unitGroup: 3,
    },
    {
      re: new RegExp(
        `(?:stundenpreis|stundenansatz|stundensatz|tagessatz|quadratmeterpreis|meterpreis|stückpreis|stueckpreis|kilopreis|tonnenpreis|literpreis)\\s*(?:ist|von|zu|=|:)?\\s*(${CURRENCY_WORDS})\\s*${PRICE_NUMBER}\\b`,
        "gi",
      ),
      currencyGroup: 1,
      priceGroup: 2,
    },
    {
      re: new RegExp(
        `(?:stundenpreis|stundenansatz|stundensatz|tagessatz|quadratmeterpreis|meterpreis|stückpreis|stueckpreis|kilopreis|tonnenpreis|literpreis)\\s*(?:ist|von|zu|=|:)?\\s*${PRICE_NUMBER}\\s*(${CURRENCY_WORDS})\\b`,
        "gi",
      ),
      currencyGroup: 2,
      priceGroup: 1,
    },
    {
      re: new RegExp(
        `(?:pauschal|pauschale|fixpreis|festpreis|forfait|flat)\\s*(${CURRENCY_WORDS})\\s*${PRICE_NUMBER}\\b`,
        "gi",
      ),
      currencyGroup: 1,
      priceGroup: 2,
    },
    {
      re: new RegExp(
        `(${CURRENCY_WORDS})\\s*${PRICE_NUMBER}\\s*(?:pauschal|pauschale|fixpreis|festpreis|forfait|flat)\\b`,
        "gi",
      ),
      currencyGroup: 1,
      priceGroup: 2,
    },
  ];

  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern.re)) {
      const currency = normalizeCurrency(match[pattern.currencyGroup]);
      const amount = parsePriceNumber(match[pattern.priceGroup]);
      const unitType = pattern.unitGroup
        ? unitTypeFromText(match[pattern.unitGroup])
        : unitTypeFromText(match[0]);
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

function chooseBestPriceFromSegmentForItem(
  segment: string,
  item: ParsedOrderItemForValidation,
): DetectedUnitPrice | null {
  const prices = extractUnitPricesFromSegment(segment) as Array<
    DetectedUnitPrice & { index?: number }
  >;
  if (prices.length === 0) return null;
  if (prices.length === 1) return prices[0];

  const normalizedSegment = normalizeCompare(segment);
  const serviceKey = normalizeCompare(item.serviceName);
  const tokens = serviceTokens(item.serviceName).filter(
    (token) =>
      !/^(?:pauschal|pauschale|fixpreis|festpreis|forfait|flat)$/.test(token),
  );
  const rawSegment = normalizeText(segment);

  const anchorIndexes = [
    serviceKey ? normalizedSegment.indexOf(serviceKey) : -1,
    ...tokens.map((token) => normalizedSegment.indexOf(token)),
  ].filter((index) => index >= 0);

  const quantity = Number(item.quantity || 0);
  const quantityIndex =
    quantity > 0
      ? rawSegment.search(
          new RegExp(
            `(^|[^0-9])${String(quantity).replace(".", "[.,]")}([^0-9]|$)`,
          ),
        )
      : -1;

  const anchorIndex =
    anchorIndexes.length > 0
      ? Math.min(...anchorIndexes)
      : quantityIndex >= 0
        ? quantityIndex
        : -1;

  if (anchorIndex < 0) return chooseBestPriceFromSegment(segment);

  const itemUnitType = unitTypeFromDisplayUnit(item.unit);
  const compatible = prices.filter((price) => {
    if (!itemUnitType || !price.unitType) return true;
    return itemUnitType === price.unitType;
  });
  const pool = compatible.length > 0 ? compatible : prices;

  return (
    pool
      .map((price) => ({
        price,
        distance: Math.abs((price.index ?? 0) - anchorIndex),
      }))
      .sort((a, b) => a.distance - b.distance)[0]?.price || null
  );
}

function detectCurrencylessFlatPriceFromSegment(
  segment: string,
  fallbackCurrency: IntakeCurrency,
): DetectedUnitPrice | null {
  const source = normalizeText(segment);
  if (!source) return null;
  const hasFlatSignal =
    /\b(pauschal|pauschale|fixpreis|festpreis|forfait|flat)\b/i.test(source);
  if (!hasFlatSignal && !hasCurrencylessStandaloneTravelPrice(source))
    return null;

  const patterns = hasFlatSignal
    ? [
        /\b(?:pauschal|pauschale|fixpreis|festpreis|forfait|flat)\s*(?:ist|von|zu|=|:)?\s*(\d+(?:[.,]\d{1,2})?)\b/i,
        /\b(\d+(?:[.,]\d{1,2})?)\s*(?:pauschal|pauschale|fixpreis|festpreis|forfait|flat)\b/i,
      ]
    : [/\b(\d+(?:[.,]\d{1,2})?)\b/i];

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

function hasFloorCleaningIntentKey(value?: string | null): boolean {
  const normalized = normalizeCompare(value);
  if (!normalized) return false;

  const hasFloorObject =
    /\b(boden|bode|floor|sol|paviment|suelo|chao)\b/.test(normalized) ||
    /bodenreinigung|floor\s+cleaning|nettoyage\s+(?:du\s+)?sol|nettoyer\s+(?:le\s+|du\s+)?sol|pulizia\s+(?:del\s+)?pavimento|limpieza\s+(?:de\s+)?suelo|limpeza\s+(?:do\s+)?chao/.test(
      normalized,
    );
  const hasCleaningAction =
    /reinig|putz|putze|saeuber|clean|nettoyage|nettoyer|pulizia|limpieza|limpeza|wisch/.test(
      normalized,
    );

  return hasFloorObject && hasCleaningAction;
}

function hasWindowCleaningIntentKey(value?: string | null): boolean {
  const normalized = normalizeCompare(value);
  if (!normalized) return false;

  return /fenster|fensterli|vitrin|vitre|window|fenetre|fenetres|finestr|ventan/.test(
    normalized,
  );
}

function canonicalGermanServiceNameFromText(
  value?: string | null,
): string | null {
  const normalized = normalizeCompare(value);
  if (!normalized) return null;

  if (
    /\b(nettoyage\s+du\s+garage|nettoyage\s+du\s+sol\s+du\s+garage|garage\s+floor|sol\s+du\s+garage|garagenboden)\b/.test(
      normalized,
    )
  ) {
    return "Garageboden reinigen";
  }
  if (hasFloorCleaningIntentKey(normalized)) {
    return "Boden reinigen";
  }
  if (
    /\b(nettoyage\s+de\s+l\s*entree|nettoyage\s+de\s+lentree|nettoyage\s+de\s+l['’]?\s*entree|entrance\s+clean|limpieza\s+de\s+entrada|pulizia\s+ingresso)\b/.test(
      normalized,
    )
  ) {
    return "Eingangsbereich reinigen";
  }
  if (
    /\b(nettoyage\s+des\s+vitres|nettoyage\s+vitres|nettoyage\s+des\s+vitrines|nettoyage\s+vitrines|vitres|vitrines|fenetres|windows|window\s+cleaning|fenster|ventanas|limpieza\s+de\s+ventanas|finestre|pulizia\s+finestre|janelas|limpeza\s+de\s+janelas)\b/.test(
      normalized,
    )
  ) {
    return "Fenster reinigen";
  }
  if (
    /\b(boden\s+reinigen|bodenreinigung|floor\s+cleaning|floor\s+clean|clean\s+floor|nettoyage\s+du\s+sol|nettoyage\s+sol|nettoyer\s+(?:le\s+|du\s+)?sol|nettoyer\s+sol|limpieza\s+de\s+suelo|limpieza\s+suelo|pulizia\s+pavimento|pulizia\s+del\s+pavimento|pulizia\s+suolo|limpeza\s+do\s+chao|limpeza\s+chao)\b/.test(
      normalized,
    )
  ) {
    return "Boden reinigen";
  }
  if (
    /\b(deplacement|déplacement|trasferta|transferta|travel fee|travel cost|trip fee|viaje|fahrt|fahrtkosten|fahrkosten|anfahrtspauschale|fahrpauschale|wegpauschale|anfahrt)\b/.test(
      normalized,
    )
  ) {
    return "Anfahrt";
  }
  if (/\b(abdeckarbeiten|abdecken|abdeck\w*)\b/.test(normalized)) {
    return "Abdeckarbeiten";
  }
  if (/\b(spachtelarbeiten|spachteln|spachtel\w*)\b/.test(normalized)) {
    return "Spachtelarbeiten";
  }
  if (
    /\b(waende|wande|wände|wand)\b/.test(normalized) &&
    /\b(streichen|malen|anstrich|paint|painting)\b/.test(normalized)
  ) {
    return "Wände streichen";
  }
  if (
    /\b(decke|decken)\b/.test(normalized) &&
    /\b(streichen|malen|anstrich|paint|painting)\b/.test(normalized)
  ) {
    return "Decke streichen";
  }
  if (
    /\b(hecke|hecken|hedge)\b/.test(normalized) &&
    /\b(schneiden|schnitt|cut|trim)\b/.test(normalized)
  ) {
    return "Hecke schneiden";
  }
  if (
    /\b(grungut|gruengut|gruenabfall|gartenabfall|green\s+waste)\b/.test(
      normalized,
    )
  ) {
    return "Grüngut entsorgen";
  }
  if (
    /\b(materialpauschale|material|kleinmaterial|kleinzeug|verbrauchsmaterial)\b/.test(
      normalized,
    )
  ) {
    return "Material Kleinzeug";
  }
  if (
    /\b(moebel|mobel|möbel|furniture)\b/.test(normalized) &&
    /\b(umstellen|transport|tragen|verschieben|move|moving)\b/.test(normalized)
  ) {
    return "Möbel umstellen";
  }

  return null;
}

function normalizeFlatServiceNameFromText(value: string): string {
  const canonical = canonicalGermanServiceNameFromText(value);
  if (canonical) return canonical;

  const normalized = normalizeCompare(value);
  if (
    /\b(deplacement|déplacement|trasferta|transferta|travel fee|travel cost|trip fee|viaje|fahrt|fahrtkosten|fahrkosten|anfahrtspauschale|fahrpauschale|wegpauschale|anfahrt)\b/.test(
      normalized,
    )
  ) {
    return "Anfahrt";
  }
  if (/\bmaterialpauschale\b/.test(normalized)) {
    return "Materialpauschale";
  }

  if (
    /\btiefgarage\b/.test(normalized) &&
    /\b(reinigen|reinigung|putzen)\b/.test(normalized)
  ) {
    return "Tiefgarage reinigen";
  }
  if (
    /\bgarage\b/.test(normalized) &&
    /\b(reinigen|reinigung|putzen)\b/.test(normalized)
  ) {
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
    (token) =>
      !/^(?:pauschal|pauschale|fixpreis|festpreis|forfait|flat)$/.test(token),
  );
  const indexes = [
    serviceKey ? normalizedSegment.indexOf(serviceKey) : -1,
    ...anchorTokens.map((token) => normalizedSegment.indexOf(token)),
  ].filter((index) => index >= 0);

  return indexes.length > 0 ? Math.min(...indexes) : -1;
}

function flatSignalIndex(normalizedSegment: string): number {
  const match = normalizedSegment.match(
    /\b(pauschal|pauschale|fixpreis|festpreis|forfait|flat)\b/i,
  );
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

    const detected = chooseBestPriceFromSegmentForItem(segment, item);
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
    if (
      detected.unitType === "flat" &&
      itemUnitType &&
      itemUnitType !== "flat"
    ) {
      continue;
    }
    if (
      itemUnitType &&
      detected.unitType &&
      itemUnitType !== detected.unitType
    ) {
      continue;
    }

    const hasExactServiceAnchor = Boolean(
      serviceKey && normalizedSegment.includes(serviceKey),
    );
    const anchorTokens = tokens.filter(
      (token) =>
        !/^(?:pauschal|pauschale|fixpreis|festpreis|forfait|flat)$/.test(token),
    );
    const serviceTokenHits = anchorTokens.filter((token) =>
      normalizedSegment.includes(token),
    ).length;
    const hasServiceAnchor = hasExactServiceAnchor || serviceTokenHits > 0;
    const hasQuantityAnchor = segmentContainsQuantity(
      segment,
      itemQuantity,
      itemUnitType,
    );

    if (detected.unitType === "flat") {
      const serviceAnchorIndex = earliestServiceAnchorIndex(
        normalizedSegment,
        serviceKey,
        tokens,
      );
      const flatIndex = flatSignalIndex(normalizedSegment);
      if (
        serviceAnchorIndex >= 0 &&
        flatIndex >= 0 &&
        serviceAnchorIndex > flatIndex
      )
        continue;
    }

    // Evidence containment alone is too weak when item evidence contains the
    // whole customer message. Require the segment to match the service OR the
    // quantity/unit of this item.
    if (!hasServiceAnchor && !hasQuantityAnchor) continue;

    let score = 0;

    if (hasExactServiceAnchor) score += 150;
    score += serviceTokenHits * 45;

    if (
      itemEvidence &&
      normalizeCompare(itemEvidence).includes(normalizedSegment)
    ) {
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
    if (
      !/\b(pauschal|pauschale|fixpreis|festpreis|forfait|flat)\b/i.test(
        normalizedSegment,
      )
    )
      continue;

    const detected =
      chooseBestPriceFromSegment(segment) ||
      detectCurrencylessFlatPriceFromSegment(segment, fallbackCurrency);
    if (!detected || detected.unitType !== "flat") continue;

    const hasExactServiceAnchor = Boolean(
      serviceKey && normalizedSegment.includes(serviceKey),
    );
    const anchorTokens = tokens.filter(
      (token) =>
        !/^(?:pauschal|pauschale|fixpreis|festpreis|forfait|flat)$/.test(token),
    );
    const serviceTokenHits = anchorTokens.filter((token) =>
      normalizedSegment.includes(token),
    ).length;
    const hasServiceAnchor = hasExactServiceAnchor || serviceTokenHits > 0;

    // V16.40: A flat price line may only repair the matching flat service.
    // Do not copy "Abdeckarbeiten CHF 90 pauschal" onto "Anfahrt"
    // just because the whole WhatsApp message was present as item evidence.
    if (!hasServiceAnchor) continue;

    const serviceAnchorIndex = earliestServiceAnchorIndex(
      normalizedSegment,
      serviceKey,
      tokens,
    );
    const flatIndex = flatSignalIndex(normalizedSegment);
    if (
      serviceAnchorIndex >= 0 &&
      flatIndex >= 0 &&
      serviceAnchorIndex > flatIndex
    )
      continue;

    let score = 0;
    if (hasExactServiceAnchor) score += 120;
    score += serviceTokenHits * 70;
    if (
      itemEvidence &&
      normalizeCompare(itemEvidence).includes(normalizedSegment)
    )
      score += 30;
    if (segment.length <= 180) score += 20;
    if (segment.length > 320) score -= 80;

    if (score < 70) continue;
    if (!best || score > best.score) best = { detected, score };
  }

  return best?.detected || null;
}

function selectFlatServiceSourceFromSegment(
  segment: string,
  explicitFlatLine: {
    amount: number;
    currency: string | null;
    index: number;
    raw: string;
  } | null,
): string {
  const source = normalizeText(segment);
  if (!source) return source;

  const pieces = source
    .split(/\n+|(?<=[.!?])\s+|;/g)
    .map((piece) => piece.trim())
    .filter(Boolean);

  if (pieces.length <= 1) return source;

  const rawKey = normalizeCompare(explicitFlatLine?.raw || "");
  const flatSignalPattern =
    /\b(pauschal|pauschale|fixpreis|festpreis|forfait|flat)\b/i;

  for (const piece of pieces) {
    const key = normalizeCompare(piece);
    if (!key) continue;

    const hasMatchingPrice =
      explicitFlatLine &&
      (rawKey ? key.includes(rawKey) : true) &&
      hasExplicitCurrencyAmount(piece);

    if (
      (flatSignalPattern.test(key) ||
        isLikelyStandaloneFlatServiceLine(piece) ||
        hasMatchingPrice) &&
      hasExplicitCurrencyAmount(piece)
    ) {
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
    const hasFlatSignal =
      /\b(pauschal|pauschale|fixpreis|festpreis|forfait|flat)\b/i.test(
        normalized,
      );
    const standaloneFlatLine = isLikelyStandaloneFlatServiceLine(segment);

    if (!hasFlatSignal && !standaloneFlatLine) {
      continue;
    }

    const explicitFlatLine = findExplicitFlatPriceInLine(
      segment,
      fallbackCurrency,
    );
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

    const flatServiceSource = selectFlatServiceSourceFromSegment(
      segment,
      explicitFlatLine,
    );
    const flatSourceHasFlatSignal =
      /\b(pauschal|pauschale|fixpreis|festpreis|forfait|flat)\b/i.test(
        normalizeCompare(flatServiceSource),
      );
    const beforeFlat = flatSourceHasFlatSignal
      ? flatServiceSource
          .split(
            /\b(?:pauschal|pauschale|fixpreis|festpreis|forfait|flat)\b/i,
          )[0]
          ?.replace(
            /^\s*(leistung|leistungen|bitte|zusätzlich|zusaetzlich|und|plus|[0-9]+[.)])\s*[:\-–—]?\s*/i,
            "",
          )
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
      return (
        tokens.length > 0 && tokens.some((token) => itemKey.includes(token))
      );
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

function isLikelyTravelFlatCostLine(value?: string | null): boolean {
  const source = normalizeText(value);
  const normalized = normalizeCompare(source);
  if (!source || !normalized) return false;
  if (
    !hasExplicitCurrencyAmount(source) &&
    !detectCurrencylessFlatPriceFromSegment(source, "CHF")
  ) {
    return false;
  }
  if (hasQuantityWithExplicitUnit(source)) return false;

  const canonical = canonicalGermanServiceNameFromText(source);
  if (canonical === "Anfahrt") return true;

  // Deterministic safety-net only: the LLM remains responsible for semantic
  // service detection. This guard catches explicit flat travel/visit-cost rows
  // that were otherwise dropped, but stores only the canonical German service.
  const hasFlatSignal =
    /\b(pauschal|pauschale|forfait|flat|fixpreis|festpreis)\b/i.test(
      normalized,
    );
  const hasTravelConcept =
    /\b(anfahrt|anfahrtspauschale|fahrtkosten|fahrkosten|fahrpauschale|wegpauschale|einsatzpauschale|deplacement|trasferta|transferta|travel\s+(?:fee|costs?)|trip\s+fee|viaje)\b/i.test(
      normalized,
    );
  return hasFlatSignal && hasTravelConcept;
}

function addMissingTravelFlatCostItems(
  originalText: string,
  items: ParsedOrderItemForValidation[],
  fallbackCurrency: IntakeCurrency,
): ParsedOrderItemForValidation[] {
  const existingAnfahrt = items.filter(
    (item) => normalizeCompare(item.serviceName) === "anfahrt",
  );
  const existingAmountKeys = new Set(
    existingAnfahrt
      .filter((item) => Number(item.unitPrice || 0) > 0)
      .map((item) => roundMoney(Number(item.unitPrice || 0))),
  );
  const existingSourceKeys = new Set(
    items
      .flatMap((item) => [item.sourceText, item.evidence, item.description])
      .map((value) => normalizeCompare(value || ""))
      .filter(Boolean),
  );

  const candidateLines = unique([
    ...splitRawIntakeLines(originalText),
    ...splitExplicitServiceLineCandidates(originalText),
  ]);

  let nextItems = items.slice();

  for (const line of candidateLines) {
    const lineKey = normalizeCompare(line);
    if (!lineKey || !isLikelyTravelFlatCostLine(line)) continue;

    const flatPrice =
      findExplicitFlatPriceInLine(line, fallbackCurrency) ||
      detectCurrencylessFlatPriceFromSegment(line, fallbackCurrency);
    if (!flatPrice || flatPrice.currency !== fallbackCurrency) continue;

    const amountKey = roundMoney(flatPrice.amount);
    const sourceAlreadyCaptured = Array.from(existingSourceKeys).some(
      (sourceKey) => sourceKey.includes(lineKey) || lineKey.includes(sourceKey),
    );

    const incompleteExistingIndex = nextItems.findIndex(
      (item) =>
        normalizeCompare(item.serviceName) === "anfahrt" &&
        (Number(item.unitPrice || 0) <= 0 || Number(item.quantity || 0) <= 0),
    );

    if (incompleteExistingIndex >= 0) {
      nextItems[incompleteExistingIndex] = {
        ...nextItems[incompleteExistingIndex],
        serviceName: "Anfahrt",
        description: nextItems[incompleteExistingIndex].description || line,
        quantity: 1,
        unit: "Pauschal",
        unitPrice: flatPrice.amount,
        totalPrice: flatPrice.amount,
        needsReview: false,
        reviewReason: null,
        sourceText: nextItems[incompleteExistingIndex].sourceText || line,
        evidence: nextItems[incompleteExistingIndex].evidence || line,
        detectedCurrency: flatPrice.currency,
      };
      existingAmountKeys.add(amountKey);
      existingSourceKeys.add(lineKey);
      continue;
    }

    if (sourceAlreadyCaptured || existingAmountKeys.has(amountKey)) continue;

    nextItems.push({
      serviceName: "Anfahrt",
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
    existingAmountKeys.add(amountKey);
    existingSourceKeys.add(lineKey);
  }

  return nextItems;
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
  return extractUnitPricesFromSegment(text).some(
    (price) => price.unitType && price.unitType !== "flat",
  );
}

function detectQuantityForUnitTypeFromText(
  text: string,
  unitType: string | null,
): number | null {
  if (unitType === "hour") {
    const explicitHourQuantity = detectExplicitHourQuantityInLine(text);
    if (explicitHourQuantity?.quantity) return explicitHourQuantity.quantity;
  }

  const source = normalizeCompare(text);
  if (!source || !unitType) return null;

  const patterns: Record<string, RegExp[]> = {
    piece: [
      new RegExp(
        `\\b(${QUANTITY_NUMBER_OR_WORD})\\s*(?:stueck|stuck|stk|piece|pieces|pi[eè]ce|pi[eè]ces|vitre|vitres|fenetre|fenetres|window|windows)\\b`,
        "i",
      ),
    ],
    square_meter: [
      new RegExp(
        `\\b(${QUANTITY_NUMBER_OR_WORD})\\s*(?:quadratmeter|qm|m2|m²|sqm)\\b`,
        "i",
      ),
    ],
    cubic_meter: [
      new RegExp(
        `\\b(${QUANTITY_NUMBER_OR_WORD})\\s*(?:kubikmeter|cbm|m3|m³)\\b`,
        "i",
      ),
    ],
    meter: [
      new RegExp(
        `\\b(${QUANTITY_NUMBER_OR_WORD})\\s*(?:laufmeter|lfm|meter|m)\\b`,
        "i",
      ),
    ],
    hour: [
      new RegExp(
        `\\b(${QUANTITY_NUMBER_OR_WORD})\\s*(?:stunde|stunden|std|hour|hours|h)\\b`,
        "i",
      ),
    ],
    day: [
      new RegExp(
        `\\b(${QUANTITY_NUMBER_OR_WORD})\\s*(?:tag|tage|day|days)\\b`,
        "i",
      ),
    ],
  };

  for (const pattern of patterns[unitType] || []) {
    const match = source.match(pattern);
    const parsed = parseQuantityNumber(match?.[1]);
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

    if (
      /\b(nettoyage\s+(?:des\s+)?vitres|nettoyage\s+(?:des\s+)?vitrines|vitres?|vitrines?|fenetres?|windows?|fenster)\b/i.test(
        key,
      )
    ) {
      const ownLineEvidence = [item.description, item.sourceText]
        .map((part) => normalizeText(part))
        .filter(Boolean)
        .join("\n");
      const explicitUnitType = unitTypeFromText(ownLineEvidence);
      const hasOwnExplicitQuantityUnit =
        hasQuantityWithExplicitUnit(ownLineEvidence);
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
    } else if (
      /\b(nettoyage\s+du\s+garage|nettoyage\s+du\s+sol\s+du\s+garage|sol\s+du\s+garage|garage\s+floor|garagenboden|lagerboden)\b/i.test(
        key,
      )
    ) {
      next.serviceName = /\blagerboden\b/i.test(key)
        ? "Lagerboden reinigen"
        : "Garageboden reinigen";
      next.unit = "Quadratmeter";
      targetUnitType = "square_meter";
    } else if (hasFloorCleaningIntentKey(key)) {
      next.serviceName = "Boden reinigen";
      next.unit = "Quadratmeter";
      targetUnitType = "square_meter";
    } else if (
      /\b(nettoyage\s+de\s+l\s*entree|nettoyage\s+de\s+lentree|entrance\s+clean|eingangsbereich)\b/i.test(
        key,
      )
    ) {
      next.serviceName = "Eingangsbereich reinigen";
      next.unit = "Pauschal";
      targetUnitType = "flat";
    } else if (
      /\b(office\s+floor|boden\s+reinigen|floor\s+clean)\b/i.test(key)
    ) {
      next.serviceName = "Boden reinigen";
      next.unit = "Quadratmeter";
      targetUnitType = "square_meter";
    }

    if (!targetUnitType) return item;

    const quantityFromText = detectQuantityForUnitTypeFromText(
      evidence,
      targetUnitType,
    );
    if (quantityFromText) next.quantity = quantityFromText;

    const explicitPrice = detectExplicitUnitPriceForItem(originalText, next);
    if (explicitPrice?.currency === finalCurrency) {
      next.unitPrice = explicitPrice.amount;
    }

    next.totalPrice = calculateSafeLineTotal(next);
    if (next.unitPrice > 0 && next.quantity > 0) {
      next.needsReview = Boolean(
        next.reviewReason &&
        !/price|quantity|unit_price|unbekannte/i.test(next.reviewReason),
      );
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
      const existingUnitType =
        unitTypeFromDisplayUnit(existing.unit) || "unknown";
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
    } else if (
      itemTotal === existingTotal &&
      price > Number(existing.unitPrice || 0)
    ) {
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
        itemTokens.some(
          (token) => otherTokens.includes(token) || otherName.includes(token),
        );
      if (!sameService) return false;

      const otherEvidence = normalizeCompare(
        [other.sourceText, other.evidence, other.description]
          .filter(Boolean)
          .join(" "),
      );

      return (
        hasQuantityWithExplicitUnit(otherEvidence) &&
        Boolean(
          (itemEvidence &&
            otherEvidence &&
            (itemEvidence.includes(otherEvidence) ||
              otherEvidence.includes(itemEvidence))) ||
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

    const explicitFlatLine = findExplicitFlatPriceInLine(
      segmentText,
      fallbackCurrency,
    );
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
  return (
    aTokens.length > 0 &&
    aTokens.some((token) => bTokens.includes(token) || bKey.includes(token))
  );
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
      if (
        Number(other.unitPrice || 0) <= 0 ||
        Number(other.totalPrice || 0) <= 0
      )
        return false;
      return sameServiceDomain(item, other);
    });

    if (!hasMeasuredSameService) return true;

    return hasOwnStandaloneFlatLineForService(
      originalText,
      item,
      fallbackCurrency,
    );
  });
}

function removeFlatItemsDuplicatingTravelPriceWithoutOwnLine(
  originalText: string,
  items: ParsedOrderItemForValidation[],
  fallbackCurrency: IntakeCurrency,
): ParsedOrderItemForValidation[] {
  if (items.length <= 1) return items;

  const travelFlatPrices = items
    .filter((item) => normalizeCompare(item.serviceName) === "anfahrt")
    .filter((item) => isFlatUnit(item.unit))
    .map((item) => roundMoney(Number(item.unitPrice || 0)))
    .filter((amount) => amount > 0);

  if (travelFlatPrices.length === 0) return items;
  const travelPriceSet = new Set(travelFlatPrices);

  return items.filter((item) => {
    if (normalizeCompare(item.serviceName) === "anfahrt") return true;
    if (!isFlatUnit(item.unit)) return true;
    if (roundMoney(Number(item.quantity || 0)) !== 1) return true;
    const price = roundMoney(Number(item.unitPrice || 0));
    if (!travelPriceSet.has(price)) return true;

    // Nur entfernen, wenn diese Pauschalposition keine eigene lokale Preiszeile
    // besitzt. Damit bleibt ein echter zweiter Pauschalauftrag erhalten, aber
    // ein aus der Anfahrtszeile geleakter Boden/Service wird verworfen.
    return hasOwnStandaloneFlatLineForService(
      originalText,
      item,
      fallbackCurrency,
    );
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
      if (
        Number(other.unitPrice || 0) <= 0 ||
        Number(other.totalPrice || 0) <= 0
      )
        return false;
      return sameServiceDomain(item, other);
    });
  });
}

function stripServiceFieldLabelArtifactsV17_47(value: string): string {
  let text = normalizeText(value || "")
    .replace(
      /(?:^|[\s,;:–—-]+)(?:flaeche|fläche|anzahl|menge|preis|einheit|stueckzahl|stückzahl|laenge|länge|dauer|zeit|stueck|stück|quantity|area|amount|price|unit|length|duration|count|piece|pieces)\s*[:=]?\s*$/gi,
      " ",
    )
    .replace(
      /(?:^|[\s,;:–—-]+)(?:flaeche|fläche|anzahl|menge|preis|einheit|stueckzahl|stückzahl|laenge|länge|dauer|zeit|stueck|stück|quantity|area|amount|price|unit|length|duration|count|piece|pieces)\s*[:=]\s*$/gi,
      " ",
    )
    .replace(/^[\s,;:.\-–—+]+|[\s,;:.\-–—+]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();

  // Mehrfach absichern: KI-Übersetzungen können "Name, Fläche:" oder
  // "Name, Anzahl:" erzeugen. Das sind strukturelle Feldlabels, keine
  // Leistungsbestandteile.
  while (
    /(?:^|[\s,;:–—-]+)(?:flaeche|fläche|anzahl|menge|preis|einheit|stueckzahl|stückzahl|laenge|länge|dauer|zeit|stueck|stück|quantity|area|amount|price|unit|length|duration|count|piece|pieces)\s*[:=]?\s*$/i.test(
      text,
    )
  ) {
    text = text
      .replace(
        /(?:^|[\s,;:–—-]+)(?:flaeche|fläche|anzahl|menge|preis|einheit|stueckzahl|stückzahl|laenge|länge|dauer|zeit|stueck|stück|quantity|area|amount|price|unit|length|duration|count|piece|pieces)\s*[:=]?\s*$/i,
        " ",
      )
      .replace(/^[\s,;:.\-–—+]+|[\s,;:.\-–—+]+$/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  return text;
}

function cleanGermanServiceNounArtifactsV17_48(value: string): string {
  return normalizeText(value || "")
    // KI-Übersetzungen können Mengentypen als Substantiv in den Namen ziehen:
    // "Gruppenraum Bodenfläche" meint nicht einen anderen Service, sondern
    // dieselbe Boden-Leistung mit Flächenmenge. Nur diese strukturellen
    // Messwort-Anhängsel werden entfernt; keine Service-Wortliste.
    .replace(/\b(fussboden|fußboden|boden)\s*flaeche\b/gi, "$1")
    .replace(/\b(fussboden|fußboden|boden)fläche\b/gi, "$1")
    .replace(/\b(teppich)\s*flaeche\b/gi, "$1zone")
    .replace(/\b(teppich)fläche\b/gi, "$1zone")
    .replace(/\s+auf\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanValidationServiceDisplayName(value?: string | null): string {
  if (isPriceAnchorOnlyServiceName(value)) return "Unbekannte Leistung";

  const cleaned = cleanGermanServiceNounArtifactsV17_48(
    stripServiceFieldLabelArtifactsV17_47(
      normalizeText(value || "")
      .replace(/^\s*(?:leistung|service|arbeit|position)\s*:?\s*/i, "")
    .replace(
      /\b(?:chf|franken|fr\.?|sfr\.?|stutz|eur|euro|usd|dollar|gbp|pfund)\s*\d+(?:[.,]\d{1,2})?\b/gi,
      " ",
    )
    .replace(
      /\b\d+(?:[.,]\d{1,2})?\s*(?:chf|franken|fr\.?|sfr\.?|stutz|eur|euro|usd|dollar|gbp|pfund)\b/gi,
      " ",
    )
    .replace(
      new RegExp(`\\b${QUANTITY_NUMBER_OR_WORD}\\s*${UNIT_WORDS}\\b`, "gi"),
      " ",
    )
    .replace(
      new RegExp(`\\b(?:pro|je|per|par|à|a|/)\\s*${UNIT_WORDS}\\b`, "gi"),
      " ",
    )
    .replace(/\b(?:zu|für|fuer|pro|je|per|par|à|a)\b\s*[.,;:!?-]*$/i, " ")
    .replace(/\s+(?:a|à)\s*$/i, " ")
    .replace(
      /\b(?:sehr|stark|ziemlich|extrem|mega)?\s*(?:dreckig|verschmutzt|schmutzig|verstaubt|fettig|klebrig)\b.*$/i,
      " ",
    )
    .replace(/\b(?:mal|x)\s*$/i, " ")
    .replace(/\b(?:und|\+)\s+anfahrt\b.*$/i, " ")
    .replace(/\s*\.\-\s*$/g, "")
    .replace(/^[\s,;:.\-–—+]+|[\s,;:.\-–—+]+$/g, "")
      .replace(/\s+/g, " ")
      .trim(),
    ),
  );

  const canonical = canonicalGermanServiceNameFromText(cleaned);
  if (canonical) return canonical;

  const key = normalizeCompare(cleaned);
  if (isPriceAnchorOnlyServiceName(cleaned)) return "Unbekannte Leistung";
  if (/\b(kueche|küche)\b/.test(key) && /\b(boden|floor|sol)\b/.test(key)) {
    return "Küchenboden reinigen";
  }
  if (
    /\b(boden|floor|sol)\b/.test(key) &&
    !/\b(reinigen|reinigung|clean|nettoyage|pulizia|limpieza)\b/.test(key)
  ) {
    return `${cleaned.replace(/^./, (char) => char.toUpperCase())} reinigen`;
  }
  if (
    /\b(fenster|glas|glasflaechen|glasflächen)\b/.test(key) &&
    !hasVisibleGermanWorkActionV17_37(cleaned)
  ) {
    return `${cleaned.replace(/^./, (char) => char.toUpperCase())} reinigen`;
  }

  if (
    !key ||
    key.length < 3 ||
    /^(?:es\s+sind|es\s+ist|das\s+sind|das\s+ist|sind|ist|ca|circa|ungefaehr|ungefahr|etwa|about|approx)$/.test(
      key,
    )
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

    const ownTopics = serviceDomainTopics(item.serviceName).filter(
      (topic) => topic !== "anfahrt",
    );
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
        .replace(
          /^.*?\b(leisti?ung|arbeiten?|zu machen|bitte)\b\s*[:\-–—]?\s*/i,
          "",
        )
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

  const rangeUnits = new Set(
    ranges.map((range) => range.unitType).filter(Boolean),
  );
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
      if (
        itemName &&
        range.segment &&
        normalizeCompare(range.segment).includes(itemName)
      )
        return true;
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
    /\b(preis\s+(?:wie\s+letztes\s+mal|wie\s+immer|wie\s+gehabt|offen|unklar|normal|standard|muss\s+(?:noch\s+)?(?:geprueft|pruefen|abgeklaert|abklaeren)|noch\s+(?:pruefen|abklaeren|offen))|wie\s+letztes\s+mal|wie\s+immer|wie\s+gehabt|gleicher\s+preis|letzter\s+preis|normaler\s+preis|standardpreis|nach\s+aufwand|ungefaehr|ungefahr|ca\.?|circa)\b/i.test(
      source,
    ) ||
    /\b(?:anfahrt|fahrt|deplacement)\s+(?:normal|standard|wie\s+immer|wie\s+gehabt)\b/i.test(
      source,
    ) ||
    /\b(price\s+(?:open|unclear|normal|standard|to\s+check|needs\s+checking)|same\s+as\s+last\s+time|same\s+as\s+always|approx(?:imately)?|about|tbd)\b/i.test(
      source,
    ) ||
    /\b(prix\s+(?:a\s+verifier|ouvert|incertain|normal|standard)|comme\s+la\s+derniere\s+fois|comme\s+d\s+habitude|environ)\b/i.test(
      source,
    )
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
  const explicitFlat = detectExplicitFlatPriceForItem(
    originalText,
    item,
    fallbackCurrency,
  );
  const explicitUnit = detectExplicitUnitPriceForItem(originalText, item);
  if (explicitFlat || explicitUnit) return true;

  const directMeasuredEvidence = [
    item.sourceText,
    item.evidence,
    item.description,
  ]
    .map((part) => normalizeText(part))
    .filter(Boolean);
  if (
    directMeasuredEvidence.some((segment) => {
      const parsed = parseLineLocalMeasuredPrice(segment, fallbackCurrency);
      if (!parsed) return false;
      const sameQuantity =
        Math.abs(Number(item.quantity || 0) - parsed.quantity) < 0.001;
      const samePrice =
        Math.abs(Number(item.unitPrice || 0) - parsed.unitPrice) < 0.01;
      const sameUnit = unitTypeFromDisplayUnit(item.unit) === parsed.unitType;
      return sameQuantity && samePrice && sameUnit;
    })
  ) {
    return true;
  }

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
      Boolean(
        detectCurrencylessFlatPriceFromSegment(segment, fallbackCurrency),
      );

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
  const quantityMatch = line.match(
    new RegExp(`\\b(${QUANTITY_NUMBER_OR_WORD})\\s*(${UNIT_WORDS})(?=\\b|\\s|[.,;:!?)])`, "i"),
  );
  const quantity = parseQuantityNumber(quantityMatch?.[1]);
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
    .replace(
      new RegExp(
        `\\s+(?=${QUANTITY_NUMBER_OR_WORD}\\s*(?:m2|m²|qm|quadratmeter|m3|m³|cbm|stunden?|std\\.?|h|tage?|meter|laufmeter|lfm|stück|stueck|stk|kg|kilogramm|tonnen?|liter|ltr\\.?|piece|pieces|pi[eè]ces?|vitres?|fenetres?|windows?)\\b)`,
        "gi",
      ),
      "\n",
    )
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
    [
      /\bfenster\b|\bvitres?\b|\bwindows?\b|\bfenetres?\b|\bfenêtres?\b/,
      "fenster",
    ],
    [/\bgarage\b|\btiefgarage\b/, "garage"],
    [
      /\beingangsbereich\b|\bentrée\b|\bentree\b|\bentrance\b/,
      "eingangsbereich",
    ],
    [/\banfahrt\b/, "anfahrt"],
    [/\bentsorgung\b|\bmaterial\b/, "entsorgung"],
  ];

  for (const [pattern, topic] of topicPatterns) {
    if (pattern.test(source)) return topic;
  }

  return null;
}

function itemHasUnclearPriceSignal(
  item: ParsedOrderItemForValidation,
): boolean {
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

  if (
    sameUnit &&
    sameQuantity &&
    itemTopic &&
    lineTopic &&
    itemTopic === lineTopic
  ) {
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
  if (sameUnit && sameQuantity && itemName && lineText.includes(itemName))
    return true;

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
      [item.serviceName, item.description, item.sourceText, item.evidence].join(
        " ",
      ),
    );

    if (!itemTopic) return true;

    const hasGuardedSibling = items.some((other, otherIndex) => {
      if (otherIndex === index) return false;
      if (!other.reviewReason?.startsWith("price_unclear:")) return false;

      const otherTopic = weakServiceTopic(
        [
          other.serviceName,
          other.description,
          other.sourceText,
          other.evidence,
        ].join(" "),
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
  const source = normalizeText(preferredSemanticLineSourceV17_41(text));
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
    .replace(
      new RegExp(
        `\\s+(?=${QUANTITY_NUMBER_OR_WORD}\\s*(?:m2|m²|qm|quadratmeter|m3|m³|cbm|stunden?|std\\.?|h|tage?|meter|laufmeter|lfm|stück|stueck|stk|kg|kilogramm|tonnen?|liter|ltr\\.?|piece|pieces|pi[eè]ces?|vitres?|fenetres?|windows?)\\b)`,
        "gi",
      ),
      "\n",
    )
    .split(/\n+|;|\s+•\s+|\s+\|\s+/g)
    .map(cleanup)
    .filter(Boolean);

  const candidateLines = unique([
    ...originalLines,
    ...quantitySplitLines,
  ]).filter((line) => {
    const normalized = normalizeCompare(line);
    if (!normalized || normalized.length < 8) return false;
    if (EXPLICIT_SERVICE_NAME_BLOCKLIST.has(normalized.replace(/\s+/g, "")))
      return false;

    const hasQuantityWithUnit = new RegExp(
      `\\b${QUANTITY_NUMBER_OR_WORD}\\s*${UNIT_WORDS}(?=\\b|\\s|[.,;:!?)])`,
      "i",
    ).test(line);
    const hasFlatSignal =
      /\b(pauschal|pauschale|fixpreis|festpreis|forfait|flat)\b/i.test(line);
    const hasCurrency = new RegExp(CURRENCY_WORDS, "i").test(line);
    const hasCurrencylessUnitPrice =
      new RegExp(
        `${PRICE_NUMBER}\\s*(?:pro|je|per|par|à|a|/)\\s*${UNIT_WORDS}\\b`,
        "i",
      ).test(line) ||
      new RegExp(
        `(?:je|each|à|a|mal|x|\\*)\\s*${PRICE_NUMBER}(?:\\.-)?\\b`,
        "i",
      ).test(line) ||
      new RegExp(
        `\\b${QUANTITY_NUMBER_OR_WORD}\\s*${UNIT_WORDS}\\s*${PRICE_NUMBER}\\s*(?:${CURRENCY_WORDS})?\\b`,
        "i",
      ).test(line);
    const hasCurrencylessFlatPrice =
      hasFlatSignal && /\b\d+(?:[.,]\d{1,2})?\b/i.test(line);
    const hasStandaloneFlatServicePrice =
      isLikelyStandaloneFlatServiceLine(line);
    const hasUnitlessCountUnitPrice = Boolean(
      detectUnitlessCountPriceServiceLineV17_51(line, "CHF") ||
        detectUnitlessCountPriceServiceLineV17_51(line, "EUR"),
    );

    return (
      (hasQuantityWithUnit && (hasCurrency || hasCurrencylessUnitPrice)) ||
      hasUnitlessCountUnitPrice ||
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
      return (
        otherKey.endsWith(key) &&
        /[a-z]/i.test(
          otherKey.slice(0, Math.max(0, otherKey.length - key.length)),
        )
      );
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
    // Highest priority: measured quantity + explicit price marker.
    // This prevents "34 m2 à 7 CHF" from being read as price 34.
    {
      re: new RegExp(
        `\\b${QUANTITY_NUMBER_OR_WORD}\\s*${UNIT_WORDS}\\s*(?:je|each|à|a|zu|mal|x|\\*)\\s*(${CURRENCY_WORDS})\\s*${PRICE_NUMBER}\\b`,
        "i",
      ),
      currencyGroup: 1,
      priceGroup: 2,
    },
    {
      re: new RegExp(
        `\\b${QUANTITY_NUMBER_OR_WORD}\\s*${UNIT_WORDS}\\s*(?:je|each|à|a|zu|mal|x|\\*)\\s*${PRICE_NUMBER}\\s*(${CURRENCY_WORDS})\\b`,
        "i",
      ),
      currencyGroup: 2,
      priceGroup: 1,
    },
    // Line-local measured price without an explicit "je/pro" marker:
    // "Fenster innen 6stk 8 CHF", "Boden 49 m2 7 CHF".
    {
      re: new RegExp(
        `\\b${QUANTITY_NUMBER_OR_WORD}\\s*${UNIT_WORDS}\\s*${PRICE_NUMBER}\\s*(${CURRENCY_WORDS})\\b`,
        "i",
      ),
      currencyGroup: 2,
      priceGroup: 1,
    },
    {
      re: new RegExp(
        `\\b${QUANTITY_NUMBER_OR_WORD}\\s*${UNIT_WORDS}\\s*(${CURRENCY_WORDS})\\s*${PRICE_NUMBER}\\b`,
        "i",
      ),
      currencyGroup: 1,
      priceGroup: 2,
    },
    // Line-local measured price with punctuation after the measured amount:
    // "Boden im Serverraum reinigen, 25 m², CHF 8." / "4 Stück, CHF 9".
    // This is intentionally structural: quantity + unit + price must be on the
    // same line, so prices cannot leak from another service line.
    {
      re: new RegExp(
        `(?:preis|einzelpreis)\\s*(?:pro|je|per|par|à|a|/)\\s*(${UNIT_WORDS})\\s*(${CURRENCY_WORDS})\\s*${PRICE_NUMBER}\\b`,
        "i",
      ),
      currencyGroup: 1,
      priceGroup: 2,
    },
    {
      re: new RegExp(
        `(?:preis|einzelpreis)\\s*(?:pro|je|per|par|à|a|/)\\s*(${UNIT_WORDS})\\s*${PRICE_NUMBER}\\s*(${CURRENCY_WORDS})\\b`,
        "i",
      ),
      currencyGroup: 2,
      priceGroup: 1,
    },
    // Currencyless "à 35.-" / "je 8" on a measured line. The order currency
    // is used as fallback; this is line-local only and never crosses services.
    {
      re: new RegExp(
        `(?:je|each|à|a|mal|x|\\*)\\s*${PRICE_NUMBER}(?:\\.-)?\\b`,
        "i",
      ),
      priceGroup: 1,
    },

    {
      re: new RegExp(
        `(${CURRENCY_WORDS})\\s*${PRICE_NUMBER}\\s*(?:pro|je|per|par|à|a|/)\\s*(${UNIT_WORDS})\\b`,
        "i",
      ),
      currencyGroup: 1,
      priceGroup: 2,
      unitGroup: 3,
    },
    {
      re: new RegExp(
        `${PRICE_NUMBER}\\s*(${CURRENCY_WORDS})\\s*(?:pro|je|per|par|à|a|/)\\s*(${UNIT_WORDS})\\b`,
        "i",
      ),
      currencyGroup: 2,
      priceGroup: 1,
      unitGroup: 3,
    },

    // V16.73: price markers without repeated unit word.
    // Examples: "14 stk je CHF 8", "12 pcs CHF 9 each", "18 Stück je CHF 9".
    {
      re: new RegExp(
        `(?:je|each)\\s*(${CURRENCY_WORDS})\\s*${PRICE_NUMBER}\\b`,
        "i",
      ),
      currencyGroup: 1,
      priceGroup: 2,
    },
    {
      re: new RegExp(
        `(?:je|each)\\s*${PRICE_NUMBER}\\s*(${CURRENCY_WORDS})\\b`,
        "i",
      ),
      currencyGroup: 2,
      priceGroup: 1,
    },
    {
      re: new RegExp(
        `(${CURRENCY_WORDS})\\s*${PRICE_NUMBER}\\s*(?:each|je)\\b`,
        "i",
      ),
      currencyGroup: 1,
      priceGroup: 2,
    },
    {
      re: new RegExp(
        `${PRICE_NUMBER}\\s*(${CURRENCY_WORDS})\\s*(?:each|je)\\b`,
        "i",
      ),
      currencyGroup: 2,
      priceGroup: 1,
    },
    // V16.40: Unit price after a measured quantity without repeated unit:
    // "35 m2 Wände streichen à CHF 18" / "30 m2 Decke streichen zu CHF 22".
    {
      re: new RegExp(
        `(?:à|a|zu|zum\\s+preis\\s+von|zum\\s+preis|preis\\s+von|preis|einzelpreis|ep|=|:)\\s*(${CURRENCY_WORDS})\\s*${PRICE_NUMBER}\\b`,
        "i",
      ),
      currencyGroup: 1,
      priceGroup: 2,
    },
    {
      re: new RegExp(
        `(?:à|a|zu|zum\\s+preis\\s+von|zum\\s+preis|preis\\s+von|preis|einzelpreis|ep|=|:)\\s*${PRICE_NUMBER}\\s*(${CURRENCY_WORDS})\\b`,
        "i",
      ),
      currencyGroup: 2,
      priceGroup: 1,
    },
    {
      re: new RegExp(
        `(?:stundenpreis|stundenansatz|stundensatz|tagessatz|ansatz)\\s*(?:ist|von|zu|=|:)?\\s*(${CURRENCY_WORDS})\\s*${PRICE_NUMBER}\\b`,
        "i",
      ),
      currencyGroup: 1,
      priceGroup: 2,
      unitGroup: undefined,
    },
    {
      re: new RegExp(
        `(?:stundenpreis|stundenansatz|stundensatz|tagessatz|ansatz)\\s*(?:ist|von|zu|=|:)?\\s*${PRICE_NUMBER}\\s*(${CURRENCY_WORDS})\\b`,
        "i",
      ),
      currencyGroup: 2,
      priceGroup: 1,
      unitGroup: undefined,
    },
    // V17.48: KI-Normalisierung schreibt teilweise "Preis pro m² CHF 7".
    // Das ist derselbe line-lokale Einheitspreis wie "36 m² à CHF 7" und
    // darf nicht zum Verlust der gesamten Leistungszeile führen.
    {
      re: new RegExp(
        `(?:preis|einzelpreis)\\s*(?:pro|je|per|par|à|a|/)\\s*(${UNIT_WORDS})\\s*(${CURRENCY_WORDS})\\s*${PRICE_NUMBER}\\b`,
        "i",
      ),
      unitGroup: 1,
      currencyGroup: 2,
      priceGroup: 3,
    },
    {
      re: new RegExp(
        `(?:preis|einzelpreis)\\s*(?:pro|je|per|par|à|a|/)\\s*(${UNIT_WORDS})\\s*${PRICE_NUMBER}\\s*(${CURRENCY_WORDS})\\b`,
        "i",
      ),
      unitGroup: 1,
      currencyGroup: 3,
      priceGroup: 2,
    },

    // 90 pro Stunde / 35 pro m2 / 11 pro Meter.
    // Currency is omitted by the customer; use the already resolved fallback currency.
    {
      re: new RegExp(
        `${PRICE_NUMBER}\\s*(?:pro|je|per|par|à|a|/)\\s*(${UNIT_WORDS})\\b`,
        "i",
      ),
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
    const unitType = pattern.unitGroup
      ? unitTypeFromText(match?.[pattern.unitGroup])
      : null;
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

function findExplicitFlatPriceInLine(
  line: string,
  fallbackCurrency: IntakeCurrency,
): {
  amount: number;
  currency: string | null;
  index: number;
  raw: string;
} | null {
  const allowStandaloneFlatPrice = isLikelyStandaloneFlatServiceLine(line);
  const patterns: Array<{
    re: RegExp;
    currencyGroup?: number;
    priceGroup: number;
  }> = [
    {
      re: new RegExp(
        `\\b(?:pauschal|pauschale|pauschale\\s+fuer|pauschale\\s+für|pauschale\\s+fuer\\s+anfahrt|pauschale\\s+für\\s+anfahrt|fixpreis|festpreis|forfait|flat)\\b(?:\\s+(?:fuer|für|von|zur|zum|fuer\\s+anfahrt|für\\s+anfahrt|anfahrt|reise|reiseaufwand|anfahrtskosten|anfahrts\\s*kosten))*\\s*(?:ist|von|zu|=|:)?\\s*(${CURRENCY_WORDS})\\s*${PRICE_NUMBER}\\b`,
        "i",
      ),
      currencyGroup: 1,
      priceGroup: 2,
    },
    {
      re: new RegExp(
        `\\b(?:pauschal|pauschale|pauschale\\s+fuer|pauschale\\s+für|pauschale\\s+fuer\\s+anfahrt|pauschale\\s+für\\s+anfahrt|fixpreis|festpreis|forfait|flat)\\b(?:\\s+(?:fuer|für|von|zur|zum|fuer\\s+anfahrt|für\\s+anfahrt|anfahrt|reise|reiseaufwand|anfahrtskosten|anfahrts\\s*kosten))*\\s*(?:ist|von|zu|=|:)?\\s*${PRICE_NUMBER}\\s*(${CURRENCY_WORDS})\\b`,
        "i",
      ),
      currencyGroup: 2,
      priceGroup: 1,
    },
    {
      re: new RegExp(
        `(${CURRENCY_WORDS})\\s*${PRICE_NUMBER}\\s*(?:pauschal|pauschale|fixpreis|festpreis|forfait|flat)\\b`,
        "i",
      ),
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

function cleanExplicitServiceNameFromLine(
  line: string,
  parts: {
    quantityRaw?: string | null;
    priceRaw?: string | null;
  },
): string {
  let cleaned = normalizeText(line)
    .replace(
      /^\s*(?:leistung|leistungsübersicht|leistungsuebersicht)\s*:?\s*/i,
      " ",
    )
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
    .replace(
      /\b(?:ungefähr|ungefaehr|ungefahr|ca\.?|circa|approximately|approx\.?|about|environ)\b.*$/i,
      " ",
    )
    .replace(
      /\bpreis\s+(?:wie\s+letztes\s+mal|offen|unklar|muss\s+(?:noch\s+)?(?:geprüft|geprueft|prüfen|pruefen|abgeklärt|abgeklaert|abklären|abklaeren)|noch\s+(?:prüfen|pruefen|abklären|abklaeren|offen)).*$/i,
      " ",
    )
    .replace(
      /\b(?:price\s+(?:open|unclear|to\s+check|needs\s+checking)|same\s+as\s+last\s+time|tbd).*$/i,
      " ",
    )
    .replace(
      /\b(?:prix\s+(?:à\s+vérifier|a\s+verifier|ouvert|incertain)|comme\s+la\s+dernière\s+fois|comme\s+la\s+derniere\s+fois).*$/i,
      " ",
    );

  cleaned = cleaned
    .replace(
      /\b(?:pauschal|pauschale|fixpreis|festpreis|forfait|flat)\b/gi,
      " ",
    )
    .replace(
      new RegExp(`\\b${QUANTITY_NUMBER_OR_WORD}\\s*${UNIT_WORDS}\\b`, "gi"),
      " ",
    )
    .replace(
      new RegExp(`\\b(?:${CURRENCY_WORDS})\\s*\\d+(?:[.,]\\d{1,2})?\\b`, "gi"),
      " ",
    )
    .replace(
      new RegExp(`\\b\\d+(?:[.,]\\d{1,2})?\\s*(?:${CURRENCY_WORDS})\\b`, "gi"),
      " ",
    )
    .replace(
      new RegExp(`\\b(?:pro|je|per|par|à|a|/)\\s*${UNIT_WORDS}\\b`, "gi"),
      " ",
    )
    .replace(new RegExp(`\\b(?:${CURRENCY_WORDS})\\b`, "gi"), " ")
    .replace(/\b(?:zu|für|fuer|pro|je|per|par|à|a)\b\s*[.,;:!?-]*$/i, " ")
    .replace(/\s+(?:a|à)\s*$/i, " ")
    .replace(/(?:^|\s)(?:à|je|each|mal|x|\*)(?=\s|$)/gi, " ")
    .replace(/\b(?:und|\+)\s+anfahrt\b.*$/i, " ")
    .replace(/\s*\.\-\s*$/g, " ")
    .replace(/[.,;:!?-]+$/g, " ")
    // Remove unit prefixes that may remain in the visible service name.
    .replace(
      /^\s*(?:m2|m²|qm|quadratmeter|meter|laufmeter|lfm|stunde|stunden|std\.?|h|stück|stueck|stk|piece|pieces)\s+/gi,
      " ",
    )
    .replace(/\b\d+(?:[.,]\d+)?\b/g, " ")
    .replace(/[;:]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  // Fallback: when the service name was before a flat-price phrase, keep text before that phrase.
  if (!cleaned || normalizeCompare(cleaned).length < 3) {
    const beforeFlat =
      line.split(
        /\b(?:pauschal|pauschale|fixpreis|festpreis|forfait|flat)\b/i,
      )[0] || "";
    cleaned = normalizeText(beforeFlat)
      .replace(/^\s*(?:[-–—•]+|\d+[.)])\s*/, " ")
      .trim();
  }

  const cleanedKey = normalizeCompare(cleaned);
  if (isPriceAnchorOnlyServiceName(cleaned)) return "Unbekannte Leistung";
  if (
    /\b(kueche|küche)\b/.test(cleanedKey) &&
    /\b(boden|floor|sol)\b/.test(cleanedKey)
  ) {
    return "Küchenboden reinigen";
  }
  if (
    !cleaned ||
    cleanedKey.length < 3 ||
    /^(?:es\s+sind|es\s+ist|das\s+sind|das\s+ist|sind|ist|ca|circa|etwa|ungefaehr|ungefahr|ungefähr|approx|approximately|about)$/.test(
      cleanedKey,
    )
  ) {
    return "Unbekannte Leistung";
  }

  const sourceKey = normalizeCompare(line);
  if (
    /\bbuero(?:reinigung)?\b|\bburo(?:reinigung)?\b|\boffice\b/.test(
      sourceKey,
    ) &&
    /\b(stunde|stunden|hour|hours|std|h)\b/.test(sourceKey)
  ) {
    return "Büroreinigung";
  }
  const canonicalServiceName = canonicalGermanServiceNameFromText(line);
  if (canonicalServiceName) {
    return canonicalServiceName;
  }
  if (
    /\btreppenhaus\b/.test(sourceKey) &&
    /\b(reinigen|reinigung|putzen)\b/.test(sourceKey)
  ) {
    return "Treppenhaus reinigen";
  }
  if (/\beingangsbereich\b/.test(sourceKey)) {
    return "Eingangsbereich reinigen";
  }

  return cleaned.replace(/^./, (char) => char.toUpperCase());
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

  if (
    /^(?:\d+(?:[.,]\d+)?\s*)?(?:mitarbeiter(?:innen)?|personen|leute|arbeiter(?:innen)?|techniker(?:innen)?)(?:\s+fuer|\s+fur|\s+für)?\b/i.test(
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
  const source = normalizeText(preferredSemanticLineSourceV17_41(originalText));
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
      /\b(?:fenster|vitres|vitrines|fenetres|windows|ventanas|finestre|janelas)\b/.test(
        normalized,
      ) &&
      /\b(?:reinigen|reinigung|putzen|clean|cleaning|nettoyage|limpieza|limpiar|pulizia|pulire|limpeza)\b/.test(
        normalized,
      )
    ) {
      return "Fenster reinigen";
    }

    if (
      /\b(?:boden|sol|floor|suelo|pavimento|suolo|chao)\b/.test(normalized) &&
      /\b(?:reinigen|reinigung|putzen|clean|cleaning|nettoyage|limpieza|limpiar|pulizia|pulire|limpeza)\b/.test(
        normalized,
      )
    ) {
      return "Boden reinigen";
    }
    if (/\b(moebel|mobel|möbel|furniture)\b/.test(normalized)) {
      return "Möbel umstellen";
    }
    if (/\b(hecke|hecken|hedge)\b/.test(normalized)) {
      return "Hecke schneiden";
    }
    if (/\b(waende|wande|wände|wand)\b/.test(normalized)) {
      return "Wände streichen";
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

function detectWorkerHourQuantityInLine(line: string): {
  quantity: number;
  raw: string;
} | null {
  const source = normalizeText(line);
  if (!source) return null;

  const workerMatch = source.match(
    /\b(\d+(?:[.,]\d+)?)\s*(?:mitarbeiter(?:innen)?|personen|leute|arbeiter(?:innen)?|techniker(?:innen)?|workers?|people|staff)\b/i,
  );
  const hourMatch = source.match(
    /\b(\d+(?:[.,]\d+)?)\s*(?:stunden?|std\.?|h|hours?)\b/i,
  );

  const workers = parsePriceNumber(workerMatch?.[1]);
  const hours = parsePriceNumber(hourMatch?.[1]);
  if (!workers || !hours) return null;

  const start = Math.min(workerMatch?.index ?? 0, hourMatch?.index ?? 0);
  const end = Math.max(
    (workerMatch?.index ?? 0) + (workerMatch?.[0]?.length || 0),
    (hourMatch?.index ?? 0) + (hourMatch?.[0]?.length || 0),
  );

  return {
    quantity: roundMoney(workers * hours),
    raw: source.slice(start, end),
  };
}

function extractExplicitServiceLineItems(
  originalText: string,
  fallbackCurrency: IntakeCurrency,
): ExplicitServiceLineItem[] {
  const lines = splitExplicitServiceLineCandidates(originalText);
  const result: ExplicitServiceLineItem[] = [];

  for (const line of lines) {
    const quantityMatch = line.match(
      new RegExp(`\\b(${QUANTITY_NUMBER_OR_WORD})\\s*(${UNIT_WORDS})(?=\\b|\\s|[.,;:!?)])`, "i"),
    );
    const unitPrice = findExplicitUnitPriceInLine(line, fallbackCurrency);
    const flatPrice = findExplicitFlatPriceInLine(line, fallbackCurrency);
    const measuredQuantity = quantityMatch
      ? parseQuantityNumber(quantityMatch[1]) || 0
      : 0;
    const measuredUnitType = quantityMatch
      ? unitTypeFromText(quantityMatch[2])
      : null;
    const explicitHourQuantity = detectExplicitHourQuantityInLine(line);
    const hasMeasuredQuantityWithFlatPrice = Boolean(
      quantityMatch &&
      flatPrice &&
      measuredQuantity > 0 &&
      measuredUnitType &&
      /\\b(?:pauschal|pauschale|fixpreis|festpreis|forfait|flat)\\b/i.test(
        line,
      ),
    );
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

    const unitlessCountPrice = detectUnitlessCountPriceServiceLineV17_51(
      line,
      fallbackCurrency,
    );

    if (unitlessCountPrice && unitPrice) {
      const serviceName = resolveExplicitServiceNameFromContext(
        originalText,
        line,
        cleanExplicitServiceNameFromLine(line, {
          quantityRaw: unitlessCountPrice.quantityRaw,
          priceRaw: unitPrice.raw,
        }),
      );

      if (normalizeCompare(serviceName) !== "unbekannte leistung") {
        result.push({
          serviceName,
          description: line,
          quantity: unitlessCountPrice.quantity,
          unit: "Stück",
          unitPrice: unitPrice.amount,
          totalPrice: roundMoney(unitlessCountPrice.quantity * unitPrice.amount),
          needsReview: false,
          reviewReason: null,
          sourceText: line,
          evidence: line,
          detectedCurrency: unitPrice.currency,
        });
        continue;
      }
    }

    if ((quantityMatch || explicitHourQuantity) && unitPrice) {
      const workerHourQuantity = detectWorkerHourQuantityInLine(line);
      const textUnitType = quantityMatch
        ? unitTypeFromText(quantityMatch[2])
        : null;
      const quantity =
        workerHourQuantity?.quantity ||
        (explicitHourQuantity && (textUnitType === "hour" || !quantityMatch)
          ? explicitHourQuantity.quantity
          : null) ||
        parseQuantityNumber(quantityMatch?.[1]) ||
        0;
      const quantityUnitType = workerHourQuantity
        ? "hour"
        : explicitHourQuantity && (textUnitType === "hour" || !quantityMatch)
          ? "hour"
          : textUnitType;
      const unitType = quantityUnitType || unitPrice.unitType;
      if (!quantity || !unitType) continue;

      const serviceName = resolveExplicitServiceNameFromContext(
        originalText,
        line,
        cleanExplicitServiceNameFromLine(line, {
          quantityRaw:
            workerHourQuantity?.raw ||
            explicitHourQuantity?.raw ||
            quantityMatch?.[0],
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

    if (
      flatPrice &&
      (/\b(pauschal|pauschale|fixpreis|festpreis|forfait|flat)\b/i.test(line) ||
        isLikelyStandaloneFlatServiceLine(line))
    ) {
      const serviceName = resolveExplicitServiceNameFromContext(
        originalText,
        line,
        cleanExplicitServiceNameFromLine(line, {
          priceRaw: flatPrice.raw,
        }),
      );

      const reviewReason =
        hasMeasuredQuantityWithFlatPrice && measuredUnitType
          ? `unit_mismatch:${serviceName}:${unitTypeToDisplayUnit(measuredUnitType) || "Menge"}:Pauschal:${measuredQuantity}`
          : null;

      result.push({
        serviceName,
        description: line,
        quantity: 1,
        unit: "Pauschal",
        unitPrice: flatPrice.amount,
        totalPrice: flatPrice.amount,
        needsReview: Boolean(reviewReason),
        reviewReason,
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
  const sameUnit =
    !itemUnitType || !explicitUnitType || itemUnitType === explicitUnitType;
  const sameQuantity =
    Math.abs(Number(item.quantity || 0) - Number(explicit.quantity || 0)) <
    0.001;
  const samePrice =
    Math.abs(Number(item.unitPrice || 0) - Number(explicit.unitPrice || 0)) <
    0.01;
  const itemTokens = meaningfulServiceTokens(item.serviceName);
  const explicitTokens = meaningfulServiceTokens(explicit.serviceName);
  const nameTokenOverlap = explicitTokens.filter((token) =>
    itemTokens.includes(token),
  ).length;
  const sourceTokenOverlap = explicitTokens.filter(
    (token) => itemTokens.includes(token) || itemSource.includes(token),
  ).length;

  if (
    explicitSource &&
    itemSource &&
    (itemSource.includes(explicitSource) || explicitSource.includes(itemSource))
  ) {
    // V16.40: Full WhatsApp text in item evidence must not make every item
    // cover every explicit service line. Broad evidence only counts when the
    // item also matches the explicit line by unit/quantity/topic.
    const itemSourceLooksBroad =
      itemSource.length > explicitSource.length + 120 &&
      /\b(?:rechnung|arbeitsort|termin|anfahrt|whatsapp)\b/i.test(itemSource);
    if (!itemSourceLooksBroad) return true;
    if (sameUnit && sameQuantity && nameTokenOverlap > 0) return true;
  }

  if (sameUnit && sameQuantity && samePrice) return true;
  if (sameUnit && sameQuantity && nameTokenOverlap > 0) return true;

  return (
    sameUnit && samePrice && sourceTokenOverlap > 0 && nameTokenOverlap > 0
  );
}

function shouldPreferExplicitServiceName(
  item: ParsedOrderItemForValidation,
  explicit: ExplicitServiceLineItem,
): boolean {
  const itemName = normalizeCompare(item.serviceName);
  const explicitName = normalizeCompare(explicit.serviceName);
  if (!explicitName || explicitName === "unbekannte leistung") return false;
  if (
    !itemName ||
    itemName === "unbekannte leistung" ||
    itemName === "reinigung"
  )
    return true;

  const itemScore = serviceNameQualityScore(item.serviceName);
  const explicitScore = serviceNameQualityScore(explicit.serviceName);

  // Prefer the service name reconstructed from the exact customer line when it
  // is clearly stronger than the current row name. This fixes line-local cases
  // like "Fenster Küche 3 stk je 8 CHF" being attached to the previous kitchen
  // floor row. It is a quality comparison, not a customer-service word list.
  if (explicitScore >= itemScore + 25) return true;

  const itemTokens = meaningfulServiceTokens(item.serviceName);
  const explicitTokens = meaningfulServiceTokens(explicit.serviceName);
  const overlap = explicitTokens.filter((token) =>
    itemTokens.includes(token),
  ).length;

  if (overlap === 0 && explicitTokens.length > 0) return true;

  // A very common catalog failure: a specific floor-cleaning line is mapped to a wrong historic catalog item.
  if (
    /\b(farbreste|farbe|kellerboden)\b/.test(itemName) &&
    !/\b(farbreste|farbe)\b/.test(explicitName)
  ) {
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
  if (
    explicitSource &&
    itemSource &&
    (itemSource.includes(explicitSource) || explicitSource.includes(itemSource))
  ) {
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
  const explicitItems = extractExplicitServiceLineItems(
    originalText,
    finalCurrency,
  );
  if (explicitItems.length === 0) return { items, reviewReasons: [] };

  const reviewReasons: string[] = [];
  const nextItems = [...items];

  for (const explicit of explicitItems) {
    const existingIndex = nextItems.findIndex((item) =>
      itemCoversExplicitLine(item, explicit),
    );
    const supportedCurrency =
      explicit.detectedCurrency === "CHF" ||
      explicit.detectedCurrency === "EUR";
    const currencyMatches =
      supportedCurrency && explicit.detectedCurrency === finalCurrency;
    const explicitNeedsReview =
      Boolean(explicit.needsReview) || Number(explicit.unitPrice || 0) <= 0;
    const explicitReviewReason = explicitNeedsReview
      ? explicit.reviewReason || `price_unclear:${explicit.serviceName}`
      : null;
    const keepAmountWhileReviewing = Boolean(
      currencyMatches &&
      explicitReviewReason &&
      explicitReviewReason.startsWith("unit_mismatch:") &&
      Number(explicit.unitPrice || 0) > 0,
    );
    const explicitAmountIsUsable =
      currencyMatches && (!explicitNeedsReview || keepAmountWhileReviewing);

    const explicitAsItem: ParsedOrderItemForValidation = {
      ...explicit,
      unitPrice: explicitAmountIsUsable ? explicit.unitPrice : 0,
      totalPrice: explicitAmountIsUsable ? calculateSafeLineTotal(explicit) : 0,
      needsReview: !currencyMatches || explicitNeedsReview,
      reviewReason: currencyMatches
        ? explicitReviewReason
        : `item_currency_mismatch:${explicit.serviceName}:${explicit.detectedCurrency || "UNKNOWN"}:${finalCurrency}`,
    };

    if (!currencyMatches) {
      reviewReasons.push(
        "currency_review",
        explicitAsItem.reviewReason as string,
      );
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
        unitPrice: explicitAmountIsUsable ? explicit.unitPrice : 0,
        totalPrice: explicitAmountIsUsable
          ? calculateSafeLineTotal(explicit)
          : 0,
        needsReview: currencyMatches ? explicitNeedsReview : true,
        reviewReason: currencyMatches
          ? explicitReviewReason
          : explicitAsItem.reviewReason,
        sourceText: existing.sourceText || explicit.sourceText,
        evidence: existing.evidence || explicit.evidence,
        detectedCurrency:
          explicit.detectedCurrency || existing.detectedCurrency,
      };

      nextItems[existingIndex] = repaired;
    } else {
      nextItems.push(explicitAsItem);
    }
  }

  return { items: nextItems, reviewReasons: unique(reviewReasons) };
}

function findUnclearTravelReferenceLine(originalText: string): string | null {
  const line = splitRawIntakeLines(originalText).find((candidate) => {
    const normalized = normalizeCompare(candidate);
    if (!normalized) return false;

    return (
      /\b(?:anfahrt|anfahrtspauschale|fahrt|fahrtkosten|fahrpauschale|wegpauschale|deplacement)\b/.test(
        normalized,
      ) &&
      /\b(?:normal|standard|wie\s+immer|wie\s+gehabt|wie\s+letztes\s+mal)\b/.test(
        normalized,
      ) &&
      !hasExplicitCurrencyAmount(candidate) &&
      !detectCurrencylessFlatPriceFromSegment(candidate, "CHF") &&
      extractUnitPricesFromSegment(candidate).length === 0
    );
  });

  return line || null;
}

function repairUnclearTravelItems(
  originalText: string,
  items: ParsedOrderItemForValidation[],
): { items: ParsedOrderItemForValidation[]; reviewReasons: string[] } {
  const travelLine = findUnclearTravelReferenceLine(originalText);
  if (!travelLine) return { items, reviewReasons: [] };

  const reviewReasons: string[] = [];

  const repaired = items.map((item) => {
    const serviceName = normalizeCompare(item.serviceName);
    if (serviceName !== "anfahrt" && serviceName !== "anfahrt pauschal")
      return item;

    reviewReasons.push("price_unclear:Anfahrt", "unit_price_review");

    return {
      ...item,
      serviceName: "Anfahrt",
      description: item.description || travelLine,
      quantity: 1,
      unit: "Pauschal",
      unitPrice: 0,
      totalPrice: 0,
      needsReview: true,
      reviewReason: "price_unclear:Anfahrt",
      sourceText: item.sourceText || travelLine,
      evidence: item.evidence || travelLine,
    };
  });

  return { items: repaired, reviewReasons: unique(reviewReasons) };
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

    if (!itemUnit || itemQuantity <= 0) return true;

    const sameCanonicalCompletedItemExists = items.some((other, otherIndex) => {
      if (otherIndex === index) return false;
      if (
        Number(other.unitPrice || 0) <= 0 ||
        Number(other.totalPrice || 0) <= 0
      )
        return false;
      if (unitTypeFromDisplayUnit(other.unit) !== itemUnit) return false;
      if (Math.abs(Number(other.quantity || 0) - itemQuantity) >= 0.001)
        return false;
      return normalizeCompare(other.serviceName) === itemName;
    });

    if (sameCanonicalCompletedItemExists) return false;
    if (itemTokens.length === 0) return true;

    const isSubsumed = items.some((other, otherIndex) => {
      if (otherIndex === index) return false;
      if (
        Number(other.unitPrice || 0) <= 0 ||
        Number(other.totalPrice || 0) <= 0
      )
        return false;
      if (Math.abs(Number(other.quantity || 0) - itemQuantity) >= 0.001)
        return false;
      if (unitTypeFromDisplayUnit(other.unit) !== itemUnit) return false;

      const otherName = normalizeCompare(other.serviceName);
      const otherTokens = meaningfulServiceTokens(other.serviceName);
      const tokenSubset = itemTokens.every(
        (token) => otherTokens.includes(token) || otherName.includes(token),
      );
      const genericShortName =
        itemTokens.length <= 1 ||
        ["wand", "boden", "stunden", "stunde"].includes(itemName);

      return tokenSubset || genericShortName;
    });

    return !isSubsumed;
  });
}

function addMissingStandaloneFlatLineItems(
  originalText: string,
  items: ParsedOrderItemForValidation[],
  fallbackCurrency: IntakeCurrency,
): ParsedOrderItemForValidation[] {
  const existingSourceKeys = new Set(
    items
      .flatMap((item) => [item.sourceText, item.evidence, item.description])
      .map((value) => normalizeCompare(value || ""))
      .filter(Boolean),
  );
  const existingServiceAmountKeys = new Set(
    items.map(
      (item) =>
        `${normalizeCompare(item.serviceName)}|${roundMoney(Number(item.unitPrice || 0))}`,
    ),
  );

  const candidates = splitExplicitServiceLineCandidates(originalText)
    .flatMap((part) => String(part || "").split(/\n+/g))
    .map((line) => line.trim())
    .filter(Boolean);

  const additions: ParsedOrderItemForValidation[] = [];
  const seenLineKeys = new Set<string>();

  for (const line of candidates) {
    const lineKey = normalizeCompare(line);
    if (!lineKey || seenLineKeys.has(lineKey)) continue;
    seenLineKeys.add(lineKey);

    // Safety-net only: a standalone fixed-price row that the LLM omitted.
    // We do not store foreign wording. The visible service name is normalized.
    const hasFlatSignal =
      /\b(pauschal|pauschale|fixpreis|festpreis|forfait|flat)\b/i.test(lineKey);
    if (!hasFlatSignal && !isLikelyStandaloneFlatServiceLine(line)) continue;

    const flatPrice = findExplicitFlatPriceInLine(line, fallbackCurrency);
    if (!flatPrice || flatPrice.currency !== fallbackCurrency) continue;

    // A measured unit-price row is not a flat cost row.
    if (
      new RegExp(
        `\\b${QUANTITY_NUMBER_OR_WORD}\\s*(${UNIT_WORDS})\\b`,
        "i",
      ).test(line)
    ) {
      continue;
    }

    const rawName = cleanExplicitServiceNameFromLine(line, {
      priceRaw: flatPrice.raw,
    });
    const serviceName = normalizeFlatServiceNameFromText(rawName);
    const serviceKey = normalizeCompare(serviceName);
    if (!serviceKey || serviceKey === "unbekannte leistung") continue;

    const sourceAlreadyCaptured = Array.from(existingSourceKeys).some(
      (sourceKey) => sourceKey.includes(lineKey) || lineKey.includes(sourceKey),
    );
    const serviceAmountKey = `${serviceKey}|${roundMoney(flatPrice.amount)}`;
    if (
      sourceAlreadyCaptured ||
      existingServiceAmountKeys.has(serviceAmountKey)
    ) {
      continue;
    }

    additions.push({
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

    existingSourceKeys.add(lineKey);
    existingServiceAmountKeys.add(serviceAmountKey);
  }

  return additions.length > 0 ? [...items, ...additions] : items;
}

function extractLooseExplicitServiceLineItems(
  originalText: string,
  fallbackCurrency: IntakeCurrency,
): ExplicitServiceLineItem[] {
  const rawLines = splitRawIntakeLines(originalText)
    .flatMap((line) => String(line || "").split(/;|\s+•\s+|\s+\|\s+/g))
    .map((line) =>
      normalizeText(line)
        .replace(
          /^\s*(?:bitte|dann|zusätzlich|zusaetzlich|und|plus)\b\s*[,.:;-]?\s*/i,
          "",
        )
        .trim(),
    )
    .filter(Boolean);

  const result: ExplicitServiceLineItem[] = [];

  for (const line of rawLines) {
    const lineKey = normalizeCompare(line);
    if (!lineKey || lineKey.length < 8) continue;
    if (
      /^(?:rechnung|rechnungsadresse|kunde|arbeitsort|ausfuehrung|ausführung|termin|tel|email|e mail)\b/.test(
        lineKey,
      )
    )
      continue;

    const workerHour = detectWorkerHourQuantityInLine(line);
    const explicitHourQuantity = detectExplicitHourQuantityInLine(line);
    const quantityMatch = line.match(
      new RegExp(
        `\\b(?:ca\\.?|circa|ungefähr|ungefaehr|ungefahr|etwa|approximately|approx\\.?|about)?\\s*(${QUANTITY_NUMBER_OR_WORD})\\s*(${UNIT_WORDS})\\b`,
        "i",
      ),
    );
    const unitPrice = findExplicitUnitPriceInLine(line, fallbackCurrency);

    const unitlessCountPrice = detectUnitlessCountPriceServiceLineV17_51(
      line,
      fallbackCurrency,
    );

    if (unitlessCountPrice && unitPrice && unitPrice.currency === fallbackCurrency) {
      const serviceName = resolveExplicitServiceNameFromContext(
        originalText,
        line,
        cleanExplicitServiceNameFromLine(line, {
          quantityRaw: unitlessCountPrice.quantityRaw,
          priceRaw: unitPrice.raw,
        }),
      );
      if (normalizeCompare(serviceName) !== "unbekannte leistung") {
        result.push({
          serviceName,
          description: line,
          quantity: unitlessCountPrice.quantity,
          unit: "Stück",
          unitPrice: unitPrice.amount,
          totalPrice: roundMoney(unitlessCountPrice.quantity * unitPrice.amount),
          needsReview: false,
          reviewReason: null,
          sourceText: line,
          evidence: line,
          detectedCurrency: unitPrice.currency,
        });
        continue;
      }
    }

    if (
      (workerHour || explicitHourQuantity || quantityMatch) &&
      unitPrice &&
      unitPrice.currency === fallbackCurrency
    ) {
      const textUnitType = quantityMatch
        ? unitTypeFromText(quantityMatch?.[2])
        : null;
      const quantity =
        workerHour?.quantity ||
        (explicitHourQuantity && (textUnitType === "hour" || !quantityMatch)
          ? explicitHourQuantity.quantity
          : null) ||
        parseQuantityNumber(quantityMatch?.[1]) ||
        0;
      const unitType = workerHour
        ? "hour"
        : explicitHourQuantity && (textUnitType === "hour" || !quantityMatch)
          ? "hour"
          : textUnitType;
      if (quantity > 0 && unitType) {
        const serviceName = resolveExplicitServiceNameFromContext(
          originalText,
          line,
          cleanExplicitServiceNameFromLine(line, {
            quantityRaw:
              workerHour?.raw ||
              explicitHourQuantity?.raw ||
              quantityMatch?.[0],
            priceRaw: unitPrice.raw,
          }),
        );

        if (normalizeCompare(serviceName) !== "unbekannte leistung") {
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
      }
    }

    const flatPrice = findExplicitFlatPriceInLine(line, fallbackCurrency);
    const hasFlatSignal =
      /\b(pauschal|pauschale|fixpreis|festpreis|forfait|flat)\b/i.test(lineKey);
    if (
      flatPrice &&
      flatPrice.currency === fallbackCurrency &&
      (hasFlatSignal || isLikelyStandaloneFlatServiceLine(line))
    ) {
      if (
        new RegExp(
          `\\b${QUANTITY_NUMBER_OR_WORD}\\s*(${UNIT_WORDS})\\b`,
          "i",
        ).test(line) &&
        !hasFlatSignal
      ) {
        continue;
      }

      const serviceName = resolveExplicitServiceNameFromContext(
        originalText,
        line,
        cleanExplicitServiceNameFromLine(line, { priceRaw: flatPrice.raw }),
      );
      if (normalizeCompare(serviceName) === "unbekannte leistung") continue;

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

  const bySignature = new Map<string, ExplicitServiceLineItem>();
  for (const item of result) {
    const signature = [
      normalizeCompare(item.serviceName),
      String(item.quantity),
      normalizeCompare(item.unit),
      String(roundMoney(Number(item.unitPrice || 0))),
      item.detectedCurrency || "",
    ].join("|");

    const current = bySignature.get(signature);
    if (!current) {
      bySignature.set(signature, item);
      continue;
    }

    const currentLooksLikeSuffix = /^\s*\d/.test(
      String(current.sourceText || ""),
    );
    const itemLooksLikeSuffix = /^\s*\d/.test(String(item.sourceText || ""));
    const preferItem =
      (currentLooksLikeSuffix && !itemLooksLikeSuffix) ||
      String(item.sourceText || "").length >
        String(current.sourceText || "").length + 8;

    if (preferItem) bySignature.set(signature, item);
  }

  const deduped = Array.from(bySignature.values());
  return deduped.filter((item, index) => {
    const sourceKey = normalizeCompare(
      item.sourceText || item.evidence || item.description || "",
    );
    if (!sourceKey) return true;

    const serviceKey = normalizeCompare(item.serviceName);
    const looksLikeQuantityOnlySuffix =
      /^\s*(?:\d|viertel|halbe|halb|dreiviertel|ein|eine|zwei|drei|vier|fuenf|funf|sechs|sieben|acht|neun|zehn)\b/i.test(
        String(item.sourceText || item.serviceName || ""),
      ) ||
      /^(?:minuten?|stunden?|std|h|viertel|halbe|halb|dreiviertel|\d+\s*(?:min|stunden?|std|h))\b/i.test(
        serviceKey,
      );

    if (!looksLikeQuantityOnlySuffix) return true;

    return !deduped.some((other, otherIndex) => {
      if (otherIndex === index) return false;
      const otherSourceKey = normalizeCompare(
        other.sourceText || other.evidence || other.description || "",
      );
      if (!otherSourceKey || otherSourceKey.length <= sourceKey.length + 4) {
        return false;
      }
      const sameUnit =
        unitTypeFromDisplayUnit(other.unit) ===
        unitTypeFromDisplayUnit(item.unit);
      const sameQuantity =
        Math.abs(Number(other.quantity || 0) - Number(item.quantity || 0)) <
        0.001;
      const samePrice =
        Math.abs(Number(other.unitPrice || 0) - Number(item.unitPrice || 0)) <
        0.01;
      return (
        sameUnit &&
        sameQuantity &&
        samePrice &&
        otherSourceKey.endsWith(sourceKey)
      );
    });
  });
}

function mergeExplicitLineItemList(
  items: ParsedOrderItemForValidation[],
  explicitItems: ExplicitServiceLineItem[],
): ParsedOrderItemForValidation[] {
  if (explicitItems.length === 0) return items;

  const nextItems = items.slice();

  for (const explicit of explicitItems) {
    const explicitKey = normalizeCompare(explicit.serviceName);
    const explicitTokens = meaningfulServiceTokens(explicit.serviceName);
    const explicitAmount = roundMoney(Number(explicit.unitPrice || 0));
    const explicitQuantity = Number(explicit.quantity || 0);
    const explicitUnitType = unitTypeFromDisplayUnit(explicit.unit);

    const existingIndex = nextItems.findIndex((item) => {
      const itemKey = normalizeCompare(item.serviceName);
      const itemTokens = meaningfulServiceTokens(item.serviceName);
      const itemUnitType = unitTypeFromDisplayUnit(item.unit);
      const sameName = itemKey === explicitKey;
      const tokenOverlap = explicitTokens.filter((token) =>
        itemTokens.includes(token),
      ).length;
      const sameUnit =
        !itemUnitType || !explicitUnitType || itemUnitType === explicitUnitType;
      return (
        sameName ||
        (sameUnit && tokenOverlap >= Math.min(2, explicitTokens.length || 2))
      );
    });

    if (existingIndex >= 0) {
      const existing = nextItems[existingIndex];
      const existingLooksWrong =
        Math.abs(Number(existing.unitPrice || 0) - explicitAmount) >= 0.01 ||
        Math.abs(Number(existing.quantity || 0) - explicitQuantity) >= 0.001 ||
        normalizeCompare(existing.serviceName) !== explicitKey;

      if (!existingLooksWrong) continue;

      const existingReason = existing.reviewReason || "";
      const clearableExistingReview =
        existingReason.startsWith("price_unclear:") ||
        existingReason === "unit_price_review" ||
        existingReason === "quantity_review" ||
        existingReason === "manual_flat_service_from_text" ||
        existingReason === "unbekannte_leistung_pruefen";

      nextItems[existingIndex] = {
        ...existing,
        serviceName: explicit.serviceName,
        description: existing.description || explicit.description,
        quantity: explicit.quantity,
        unit: explicit.unit,
        unitPrice: explicit.unitPrice,
        totalPrice: calculateSafeLineTotal(explicit),
        sourceText: existing.sourceText || explicit.sourceText,
        evidence: existing.evidence || explicit.evidence,
        detectedCurrency:
          explicit.detectedCurrency || existing.detectedCurrency,
        needsReview: clearableExistingReview
          ? explicit.needsReview
          : existing.needsReview || explicit.needsReview,
        reviewReason: clearableExistingReview
          ? explicit.reviewReason
          : existing.reviewReason || explicit.reviewReason,
      };
      continue;
    }

    nextItems.push({
      ...explicit,
      totalPrice: calculateSafeLineTotal(explicit),
    });
  }

  return nextItems;
}


function extractStructuredGermanServiceSectionLinesV17_43(
  originalText: string,
): string[] {
  const semanticSource = normalizeText(preferredSemanticLineSourceV17_41(originalText));
  if (!semanticSource) return [];

  const lines = semanticSource
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => normalizeText(line).replace(/^[-–—•]+\s*/, "").trim())
    .filter(Boolean);

  const serviceHeaderRe = /^(?:leistungen|arbeiten|zu\s+erledigen|auszufuehrende\s+arbeiten|ausführende\s+arbeiten|auszuführende\s+arbeiten)\s*:?$/i;
  const stopRe = /^(?:rechnung|rechnungsadresse|kunde|kundendaten|arbeitsort|ausfuehrungsort|ausführungsort|ausfuehrung|ausführung|adresse|hinweise|besonderheiten|kontakt|zugang|termin|notizen|bemerkungen)\b/i;

  const isPricedServiceLine = (line: string) => {
    const key = normalizeCompare(line);
    if (!key || serviceHeaderRe.test(key) || stopRe.test(key)) return false;

    // Do not let operational notes become service rows just because they contain
    // a time, phone number or code.
    if (
      /\b(?:whatsapp|sms|telefon|phone|e\s*mail|email|kontakt|zugang|code|tuercode|türcode|schluessel|schlüssel|hinweis|achtung|warnung|rutschig|hund|kabel|strom|lift|aufzug|parkplatz|anmelden|melden|kommen|beginn|uhr)\b/i.test(
        key,
      ) &&
      !/\b(?:anfahrt|anfahrtskosten|fahrtkosten|reisekosten|travel|deplacement|trasferta)\b/i.test(key)
    ) {
      return false;
    }

    const hasMeasuredQuantity = new RegExp(
      `\\b${QUANTITY_NUMBER_OR_WORD}\\s*${UNIT_WORDS}(?=\\b|\\s|[.,;:!?)])`,
      "i",
    ).test(line);
    const hasCurrencyOrPrice =
      new RegExp(CURRENCY_WORDS, "i").test(line) ||
      /\b(?:preis|pauschal|pauschale|flat|forfait|à|a|zu|je|each)\b/i.test(line);
    const hasFlatPrice = Boolean(findExplicitFlatPriceInLine(line, "CHF"));

    return (hasMeasuredQuantity && hasCurrencyOrPrice) || hasFlatPrice;
  };

  const startIndex = lines.findIndex((line) =>
    serviceHeaderRe.test(normalizeCompare(line)),
  );

  const candidateLines: string[] = [];
  if (startIndex >= 0) {
    for (const line of lines.slice(startIndex + 1)) {
      const key = normalizeCompare(line);
      if (!key) continue;
      if (stopRe.test(key)) break;
      if (isPricedServiceLine(line)) candidateLines.push(line);
    }
  } else {
    // Some normalization answers contain a clean German translation but no
    // explicit "Leistungen:" heading. In that case, take only price-bearing
    // service rows from the translated section. This is structural: quantity,
    // unit and price must be in the same line.
    for (const line of lines) {
      if (isPricedServiceLine(line)) candidateLines.push(line);
    }
  }

  return unique(candidateLines);
}

function cleanStructuredGermanServiceNameV17_43(
  line: string,
  args: { quantityRaw?: string | null; priceRaw?: string | null; flat?: boolean } = {},
): string {
  const quantityIndex = args.quantityRaw
    ? line.toLowerCase().indexOf(String(args.quantityRaw).toLowerCase())
    : -1;
  const priceIndex = args.priceRaw
    ? line.toLowerCase().indexOf(String(args.priceRaw).toLowerCase())
    : -1;
  const cutIndexes = [quantityIndex, priceIndex].filter((index) => index >= 0);
  const cutAt = cutIndexes.length > 0 ? Math.min(...cutIndexes) : -1;

  let name = normalizeText(cutAt >= 0 ? line.slice(0, cutAt) : line)
    .replace(/^[-–—•]+\s*/, "")
    .replace(/\b(?:zum\s+preis\s+von|zum\s+preis|preis\s+von|preis|einzelpreis)\b.*$/i, "")
    .replace(/\b(?:pauschal|pauschale|flat\s+fee|travel\s+flat\s+fee)\b.*$/i, "")
    .replace(/\s+(?:a|à)\s*$/i, "")
    .replace(/[.,;:!?-]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();

  name = cleanGermanServiceNounArtifactsV17_48(
    stripServiceFieldLabelArtifactsV17_47(name),
  );

  const key = normalizeCompare(name);
  if (!key || isPriceAnchorOnlyServiceName(name)) return "Unbekannte Leistung";

  if (
    args.flat ||
    /^(?:anfahrt|anfahrts|anfahrtskosten|anfahrtspauschale|fahrtkosten|fahrkosten|reise|reiseaufwand|reisekosten|reisepauschale|travel|travel\s+flat\s+fee|deplacement|déplacement|trasferta|transferta)\b/i.test(
      key,
    )
  ) {
    return "Anfahrt";
  }

  // Grammatik-Normalisierung aus KI-Übersetzung: keine Service-Wortliste,
  // nur deutsche Nominalform "Reinigung des X" -> "X reinigen".
  name = name
    .replace(/^reinigung\s+(?:des|der|dem|den)\s+(.+)$/i, "$1 reinigen")
    .replace(/^reinigen\s+(?:des|der|dem|den)\s+(.+)$/i, "$1 reinigen")
    .replace(/^putzen\s+(?:des|der|dem|den)\s+(.+)$/i, "$1 reinigen")
    .replace(/\s+/g, " ")
    .trim();

  name = cleanGermanServiceNounArtifactsV17_48(
    stripServiceFieldLabelArtifactsV17_47(name),
  );

  if (normalizeCompare(name) === "anfahrts") return "Anfahrt";
  return name.replace(/^./, (char) => char.toUpperCase());
}

function extractStructuredGermanServiceItemsV17_43(
  originalText: string,
  finalCurrency: IntakeCurrency,
): ExplicitServiceLineItem[] {
  const lines = extractStructuredGermanServiceSectionLinesV17_43(originalText);
  if (lines.length === 0) return [];

  const result: ExplicitServiceLineItem[] = [];
  for (const line of lines) {
    const quantityMatch = line.match(
      new RegExp(`\\b(${QUANTITY_NUMBER_OR_WORD})\\s*(${UNIT_WORDS})(?=\\b|\\s|[.,;:!?)])`, "i"),
    );
    const unitPrice = findExplicitUnitPriceInLine(line, finalCurrency);

    if (quantityMatch && unitPrice) {
      const quantity = parseQuantityNumber(quantityMatch[1]) || 0;
      const unitType = unitTypeFromText(quantityMatch[2]);
      if (!quantity || !unitType) continue;

      const serviceName = cleanStructuredGermanServiceNameV17_43(line, {
        quantityRaw: quantityMatch[0],
        priceRaw: unitPrice.raw,
      });
      if (normalizeCompare(serviceName) === "unbekannte leistung") continue;

      const currencyMatches = unitPrice.currency === finalCurrency;
      result.push({
        serviceName,
        description: line,
        quantity,
        unit: unitTypeToDisplayUnit(unitType) || "Pauschal",
        unitPrice: currencyMatches ? unitPrice.amount : 0,
        totalPrice: currencyMatches ? roundMoney(quantity * unitPrice.amount) : 0,
        needsReview: !currencyMatches,
        reviewReason: currencyMatches
          ? null
          : `item_currency_mismatch:${serviceName}:${unitPrice.currency || "UNKNOWN"}:${finalCurrency}`,
        sourceText: line,
        evidence: line,
        detectedCurrency: unitPrice.currency,
      });
      continue;
    }

    const flatPrice = findExplicitFlatPriceInLine(line, finalCurrency);
    if (!flatPrice) continue;
    const serviceName = cleanStructuredGermanServiceNameV17_43(line, {
      priceRaw: flatPrice.raw,
      flat: true,
    });
    if (normalizeCompare(serviceName) === "unbekannte leistung") continue;

    const currencyMatches = flatPrice.currency === finalCurrency;
    result.push({
      serviceName,
      description: line,
      quantity: 1,
      unit: "Pauschal",
      unitPrice: currencyMatches ? flatPrice.amount : 0,
      totalPrice: currencyMatches ? flatPrice.amount : 0,
      needsReview: !currencyMatches,
      reviewReason: currencyMatches
        ? null
        : `item_currency_mismatch:${serviceName}:${flatPrice.currency || "UNKNOWN"}:${finalCurrency}`,
      sourceText: line,
      evidence: line,
      detectedCurrency: flatPrice.currency,
    });
  }

  const bySignature = new Map<string, ExplicitServiceLineItem>();
  for (const item of result) {
    const signature = [
      normalizeCompare(item.sourceText),
      normalizeCompare(item.serviceName),
      String(item.quantity),
      normalizeCompare(item.unit),
      String(roundMoney(Number(item.unitPrice || 0))),
      item.detectedCurrency || "",
    ].join("|");
    if (!bySignature.has(signature)) bySignature.set(signature, item);
  }

  return Array.from(bySignature.values());
}

function mergeSingleStructuredGermanServiceItemsV17_46(
  items: ParsedOrderItemForValidation[],
  structuredItems: ExplicitServiceLineItem[],
): ParsedOrderItemForValidation[] {
  if (structuredItems.length === 0 || items.length === 0) return items;

  let nextItems = items.slice();

  for (const structured of structuredItems) {
    const structuredName = cleanValidationServiceDisplayName(structured.serviceName);
    if (normalizeCompare(structuredName) === "unbekannte leistung") continue;

    const structuredQuantity = roundMoney(Number(structured.quantity || 0));
    const structuredPrice = roundMoney(Number(structured.unitPrice || 0));
    if (!Number.isFinite(structuredQuantity) || structuredQuantity <= 0) continue;

    const candidates = nextItems
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => {
        const sameQuantity = Math.abs(roundMoney(Number(item.quantity || 0)) - structuredQuantity) < 0.001;
        if (!sameQuantity) return false;

        const itemPrice = roundMoney(Number(item.unitPrice || 0));
        const samePositivePrice = structuredPrice > 0 && Math.abs(itemPrice - structuredPrice) < 0.01;
        const sameBlockedPrice = structuredPrice === 0 && itemPrice === 0 && Boolean(structured.detectedCurrency || item.detectedCurrency);
        return samePositivePrice || sameBlockedPrice;
      });

    if (candidates.length !== 1) continue;

    const { item, index } = candidates[0];
    const currentName = cleanValidationServiceDisplayName(item.serviceName);
    const useStructuredName =
      shouldUseTranslatedServiceNameV17_35(item, structuredName) ||
      visibleServiceNameQualityScoreV17_37(structuredName) >= visibleServiceNameQualityScoreV17_37(currentName) + 15 ||
      normalizeCompare(currentName) === "unbekannte leistung";

    if (!useStructuredName) continue;

    const nextReviewReason = item.reviewReason?.startsWith("price_unclear:")
      ? `price_unclear:${structuredName}`
      : item.reviewReason;

    nextItems[index] = {
      ...item,
      serviceName: structuredName,
      description: item.description || structured.description,
      unit: structured.unit || item.unit,
      sourceText: item.sourceText || structured.sourceText,
      evidence: item.evidence || structured.evidence,
      detectedCurrency: structured.detectedCurrency || item.detectedCurrency,
      reviewReason: nextReviewReason,
    };
  }

  return nextItems;
}

function mergeStructuredWithMissingOriginalMeasuredItemsV17_48(
  originalText: string,
  structuredItems: ExplicitServiceLineItem[],
  finalCurrency: IntakeCurrency,
): ExplicitServiceLineItem[] {
  const originalOnlyText = originalText
    .replace(/\n+---\s*Übersetzung \(automatisch\)\s*---[\s\S]*$/i, "")
    .replace(/\n+---\s*Uebersetzung \(automatisch\)\s*---[\s\S]*$/i, "");
  const originalItems = [
    ...extractHardMeasuredLineItemsFromRawText(originalOnlyText, finalCurrency),
    ...extractExplicitServiceLineItems(originalOnlyText, finalCurrency),
    ...extractLooseExplicitServiceLineItems(originalOnlyText, finalCurrency),
  ];
  if (originalItems.length === 0) return structuredItems;

  const next = structuredItems.slice();
  for (const original of originalItems) {
    const originalQuantity = roundMoney(Number(original.quantity || 0));
    const originalPrice = roundMoney(Number(original.unitPrice || 0));
    const originalUnitType = unitTypeFromDisplayUnit(original.unit);

    const covered = next.some((item) => {
      const sameQuantity =
        Math.abs(roundMoney(Number(item.quantity || 0)) - originalQuantity) < 0.001;
      const samePrice =
        Math.abs(roundMoney(Number(item.unitPrice || 0)) - originalPrice) < 0.01;
      const sameUnit = unitTypeFromDisplayUnit(item.unit) === originalUnitType;
      return sameQuantity && samePrice && sameUnit;
    });
    if (covered) continue;

    const cleanedOriginalName = cleanValidationServiceDisplayName(
      original.serviceName,
    );
    if (
      normalizeCompare(cleanedOriginalName) === "unbekannte leistung" ||
      visibleServiceNameQualityScoreV17_37(cleanedOriginalName) < 50
    ) {
      continue;
    }

    next.push({
      ...original,
      serviceName: cleanedOriginalName,
      totalPrice: calculateSafeLineTotal(original),
      reviewReason: original.reviewReason || "service_added_from_original_line_v17_48",
    });
  }

  return next;
}

function sameMeasuredSignatureV17_50(
  item: ParsedOrderItemForValidation,
  explicit: ExplicitServiceLineItem,
): boolean {
  const itemUnit = unitTypeFromDisplayUnit(item.unit);
  const explicitUnit = unitTypeFromDisplayUnit(explicit.unit);
  if (itemUnit && explicitUnit && itemUnit !== explicitUnit) return false;

  return (
    Math.abs(Number(item.quantity || 0) - Number(explicit.quantity || 0)) < 0.001 &&
    Math.abs(Number(item.unitPrice || 0) - Number(explicit.unitPrice || 0)) < 0.01
  );
}

function shouldPreferLineLocalServiceNameV17_50(
  currentName: string | null | undefined,
  explicitName: string | null | undefined,
): boolean {
  const current = cleanValidationServiceDisplayName(currentName);
  const explicit = cleanValidationServiceDisplayName(explicitName);
  const currentKey = normalizeCompare(current);
  const explicitKey = normalizeCompare(explicit);
  if (!explicitKey || explicitKey === "unbekannte leistung") return false;
  if (!currentKey || currentKey === "unbekannte leistung" || currentKey === "reinigung") return true;
  if (currentKey === explicitKey) return false;
  if (currentKey === "anfahrt" || explicitKey === "anfahrt") return false;

  const currentTokens = meaningfulServiceTokens(current);
  const explicitTokens = meaningfulServiceTokens(explicit);
  if (explicitTokens.length === 0) return false;

  const overlap = explicitTokens.filter((token) => currentTokens.includes(token)).length;
  const currentScore = visibleServiceNameQualityScoreV17_37(current) + serviceNameQualityScore(current);
  const explicitScore = visibleServiceNameQualityScoreV17_37(explicit) + serviceNameQualityScore(explicit);

  // Same quantity/unit/price already binds this explicit line to this row. If
  // the current name shares no meaningful token with the exact evidence line,
  // keep the line-local object instead of the generalized AI label.
  if (overlap === 0 && explicitTokens.length >= Math.max(1, currentTokens.length)) {
    return true;
  }

  if (explicitScore >= currentScore + 18) return true;

  const explicitAddsObjectContext =
    explicitTokens.length > currentTokens.length &&
    explicitTokens.some((token) => !currentTokens.includes(token));
  if (explicitAddsObjectContext && explicitScore >= currentScore - 5) return true;

  return false;
}

function extractLineLocalMeasuredNameCandidatesV17_52(
  originalText: string,
  finalCurrency: IntakeCurrency,
): ExplicitServiceLineItem[] {
  const lines = normalizeText(originalText)
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split(/\n+|;/g)
    .map((line) => line.trim())
    .filter((line) => line.length >= 8);

  const result: ExplicitServiceLineItem[] = [];
  for (const line of lines) {
    const key = normalizeCompare(line);
    if (!key) continue;
    if (/^(?:rechnung|kunde|kundin|adresse|ausfuehrung|ausführung|hinweise|kontakt|telefon|tel|email|e-mail)\b/.test(key)) continue;

    const quantityMatch = line.match(
      new RegExp(`\\b(${QUANTITY_NUMBER_OR_WORD})\\s*(${UNIT_WORDS})(?=\\b|\\s|[.,;:!?)])`, "i"),
    );
    const unitPrice = findExplicitUnitPriceInLine(line, finalCurrency);
    if (!quantityMatch || !unitPrice || unitPrice.currency !== finalCurrency) continue;

    const quantity = parseQuantityNumber(quantityMatch[1]) || 0;
    const unitType = unitTypeFromText(quantityMatch[2]);
    if (!quantity || !unitType) continue;

    let serviceName = cleanStructuredGermanServiceNameV17_43(line, {
      quantityRaw: quantityMatch[0],
      priceRaw: unitPrice.raw,
    });
    const afterQuantity = line.slice((quantityMatch.index || 0) + quantityMatch[0].length);
    if (
      !/\b(?:reinigen|reinigung|putzen|abstauben|abwischen|saugen|entfernen|schneiden|sauber\s+machen)\b/i.test(serviceName) &&
      /\b(?:reinigen|reinigung|putzen|abstauben|abwischen|saugen|entfernen|schneiden|sauber\s+machen|clean|nettoyer|nettoyage|pulizia)\b/i.test(afterQuantity)
    ) {
      serviceName = `${serviceName} reinigen`;
    }
    serviceName = cleanValidationServiceDisplayName(serviceName);
    if (normalizeCompare(serviceName) === "unbekannte leistung") continue;

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
  }

  const bySig = new Map<string, ExplicitServiceLineItem>();
  for (const item of result) {
    const sig = [
      normalizeCompare(item.serviceName),
      String(item.quantity),
      normalizeCompare(item.unit),
      String(roundMoney(Number(item.unitPrice || 0))),
      item.detectedCurrency || "",
    ].join("|");
    if (!bySig.has(sig)) bySig.set(sig, item);
  }
  return Array.from(bySig.values());
}

function preferLineLocalMeasuredServiceNamesV17_50(
  originalText: string,
  items: ParsedOrderItemForValidation[],
  finalCurrency: IntakeCurrency,
): ParsedOrderItemForValidation[] {
  const candidates = [
    ...extractStructuredGermanServiceItemsV17_43(originalText, finalCurrency),
    ...extractLineLocalMeasuredNameCandidatesV17_52(originalText, finalCurrency),
    ...extractExplicitServiceLineItems(originalText, finalCurrency),
    ...extractLooseExplicitServiceLineItems(originalText, finalCurrency),
  ].filter(
    (candidate) =>
      candidate.detectedCurrency === finalCurrency &&
      Number(candidate.quantity || 0) > 0 &&
      Number(candidate.unitPrice || 0) > 0 &&
      normalizeCompare(candidate.serviceName) !== "unbekannte leistung" &&
      normalizeCompare(candidate.serviceName) !== "anfahrt",
  );

  if (candidates.length === 0) return items;

  return items.map((item) => {
    const matching = candidates
      .filter((candidate) => sameMeasuredSignatureV17_50(item, candidate))
      .filter((candidate) =>
        shouldPreferLineLocalServiceNameV17_50(item.serviceName, candidate.serviceName),
      )
      .sort((a, b) =>
        serviceNameQualityScore(b.serviceName) - serviceNameQualityScore(a.serviceName),
      )[0];

    if (!matching) return item;

    return {
      ...item,
      serviceName: cleanValidationServiceDisplayName(matching.serviceName),
      description: item.description || matching.description,
      sourceText: item.sourceText || matching.sourceText,
      evidence: item.evidence || matching.evidence,
    };
  });
}

function isBroadAreaOnlyServiceNameV17_54(value?: string | null): boolean {
  const cleaned = cleanValidationServiceDisplayName(value);
  const key = normalizeCompare(cleaned);
  if (!key || key === "anfahrt" || key === "unbekannte leistung") return false;
  if (!hasVisibleGermanWorkActionV17_37(cleaned)) return false;

  const withoutAction = key
    .replace(/\b(?:reinigen|reinigung|putzen|saeubern|sauber\s+machen|abstauben|abwischen|wischen|saugen|entfernen)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const tokens = withoutAction.split(/\s+/g).filter(Boolean);
  if (tokens.length !== 1) return false;

  // Structural area-only labels are usually summaries created by the model,
  // not the priced work object from the customer line. The exact local line
  // with the same quantity/unit/price may replace them.
  return /(?:bereich|raum|flur|gang)$/.test(tokens[0]);
}

function semanticLineLocalNameScoreV17_53(value?: string | null): number {
  const cleaned = cleanValidationServiceDisplayName(value);
  const key = normalizeCompare(cleaned);
  if (!key || key === "unbekannte leistung" || key === "anfahrt") return -999;

  let score = visibleServiceNameQualityScoreV17_37(cleaned) + serviceNameQualityScore(cleaned);
  const tokens = meaningfulServiceTokens(cleaned);
  score += tokens.length * 12;

  // Penalize labels that describe only a broad area. This is a structural
  // specificity check, not a service-word mapping: the exact priced line wins
  // when it names an object/task more precisely with the same quantity/unit/price.
  if (isBroadAreaOnlyServiceNameV17_54(cleaned)) {
    score -= 55;
  }
  if (!hasVisibleGermanWorkActionV17_37(cleaned) && key !== "anfahrt") score -= 35;
  return score;
}

function forceExactLineLocalMeasuredNamesV17_53(
  originalText: string,
  items: ParsedOrderItemForValidation[],
  finalCurrency: IntakeCurrency,
): ParsedOrderItemForValidation[] {
  const candidates = [
    ...extractLineLocalMeasuredNameCandidatesV17_52(originalText, finalCurrency),
    ...extractStructuredGermanServiceItemsV17_43(originalText, finalCurrency),
    ...extractExplicitServiceLineItems(originalText, finalCurrency),
    ...extractLooseExplicitServiceLineItems(originalText, finalCurrency),
  ].filter((candidate) => {
    if (candidate.detectedCurrency !== finalCurrency) return false;
    if (normalizeCompare(candidate.serviceName) === "anfahrt") return false;
    if (normalizeCompare(candidate.serviceName) === "unbekannte leistung") return false;
    if (Number(candidate.quantity || 0) <= 0 || Number(candidate.unitPrice || 0) <= 0) return false;
    return true;
  });

  if (candidates.length === 0) return items;

  return items.map((item) => {
    if (normalizeCompare(item.serviceName) === "anfahrt") return item;

    const currentScore = semanticLineLocalNameScoreV17_53(item.serviceName);
    const best = candidates
      .filter((candidate) => sameMeasuredSignatureV17_50(item, candidate))
      .map((candidate) => ({
        candidate,
        score: semanticLineLocalNameScoreV17_53(candidate.serviceName),
      }))
      .filter(({ candidate, score }) => {
        const candidateName = cleanValidationServiceDisplayName(candidate.serviceName);
        const candidateKey = normalizeCompare(candidateName);
        const itemKey = normalizeCompare(item.serviceName);
        if (!candidateKey || candidateKey === itemKey) return false;

        const candidateTokens = meaningfulServiceTokens(candidateName);
        const itemTokens = meaningfulServiceTokens(item.serviceName);
        const addsSpecificToken = candidateTokens.some((token) => !itemTokens.includes(token));
        if (!addsSpecificToken) return false;

        // V17.54: if the current label is only a broad area summary
        // (e.g. "Besprechungsbereich reinigen"), the exact local priced line
        // with the same quantity/unit/price is allowed to win even when the
        // model gave the area label a deceptively high score.
        if (isBroadAreaOnlyServiceNameV17_54(item.serviceName)) {
          return score >= 35 && candidateTokens.length >= Math.max(1, itemTokens.length);
        }

        if (score < 60) return false;
        return score >= currentScore - 10;
      })
      .sort((a, b) => b.score - a.score)[0]?.candidate;

    if (!best) return item;

    return {
      ...item,
      serviceName: cleanValidationServiceDisplayName(best.serviceName),
      description: item.description || best.description,
      sourceText: item.sourceText || best.sourceText,
      evidence: item.evidence || best.evidence,
    };
  });
}

function repairLineLocalStandaloneFlatServiceNamesV17_51(
  originalText: string,
  items: ParsedOrderItemForValidation[],
  finalCurrency: IntakeCurrency,
): ParsedOrderItemForValidation[] {
  const flatCandidates = [
    ...extractExplicitServiceLineItems(originalText, finalCurrency),
    ...extractLooseExplicitServiceLineItems(originalText, finalCurrency),
    ...extractStructuredGermanServiceItemsV17_43(originalText, finalCurrency),
  ].filter((candidate) => {
    if (candidate.detectedCurrency !== finalCurrency) return false;
    if (unitTypeFromDisplayUnit(candidate.unit) !== "flat") return false;
    if (Number(candidate.unitPrice || 0) <= 0 || Number(candidate.quantity || 0) !== 1) return false;
    const key = normalizeCompare(candidate.serviceName);
    if (!key || key === "unbekannte leistung" || key === "anfahrt") return false;
    return true;
  });

  if (flatCandidates.length === 0) return items;

  return items.map((item) => {
    if (unitTypeFromDisplayUnit(item.unit) !== "flat") return item;
    const itemAmount = roundMoney(Number(item.unitPrice || 0));
    if (itemAmount <= 0) return item;

    const matching = flatCandidates
      .filter(
        (candidate) =>
          Math.abs(roundMoney(Number(candidate.unitPrice || 0)) - itemAmount) < 0.01,
      )
      .sort(
        (a, b) =>
          serviceNameQualityScore(b.serviceName) - serviceNameQualityScore(a.serviceName),
      )[0];
    if (!matching) return item;

    const itemKey = normalizeCompare(item.serviceName);
    const matchingKey = normalizeCompare(matching.serviceName);
    if (!matchingKey || matchingKey === itemKey) return item;

    const itemLooksGenericTravel =
      itemKey === "anfahrt" ||
      itemKey === "fahrt" ||
      itemKey === "pauschal" ||
      itemKey === "kosten" ||
      itemKey === "unbekannte leistung";
    const nameIsClearlyBetter = shouldPreferLineLocalServiceNameV17_50(
      item.serviceName,
      matching.serviceName,
    );
    if (!itemLooksGenericTravel && !nameIsClearlyBetter) return item;

    return {
      ...item,
      serviceName: cleanValidationServiceDisplayName(matching.serviceName),
      description: item.description || matching.description,
      sourceText: matching.sourceText || item.sourceText,
      evidence: matching.evidence || item.evidence,
      detectedCurrency: matching.detectedCurrency || item.detectedCurrency,
    };
  });
}

function enforceStructuredGermanServiceSectionV17_43(
  originalText: string,
  items: ParsedOrderItemForValidation[],
  finalCurrency: IntakeCurrency,
): { items: ParsedOrderItemForValidation[]; reviewReasons: string[] } {
  let structuredItems = extractStructuredGermanServiceItemsV17_43(
    originalText,
    finalCurrency,
  );
  structuredItems = mergeStructuredWithMissingOriginalMeasuredItemsV17_48(
    originalText,
    structuredItems,
    finalCurrency,
  );

  // V17.46: Auch eine einzelne KI-normalisierte Preiszeile darf einen rohen
  // Fremdsprachen-/Dialekt-Leistungsnamen ersetzen, wenn sie eindeutig über
  // Menge + Preis an genau eine vorhandene Position gebunden ist. Vollersatz
  // der gesamten Positionsliste bleibt erst ab mindestens zwei strukturierten
  // Leistungszeilen aktiv.
  if (structuredItems.length < 2) {
    return {
      items: mergeSingleStructuredGermanServiceItemsV17_46(items, structuredItems),
      reviewReasons: [],
    };
  }

  const pricedStructuredCount = structuredItems.filter(
    (item) => Number(item.quantity || 0) > 0 && (Number(item.unitPrice || 0) > 0 || item.needsReview),
  ).length;
  if (pricedStructuredCount < 2) return { items, reviewReasons: [] };

  const reviewReasons = structuredItems
    .map((item) => item.reviewReason)
    .filter((reason): reason is string => Boolean(reason));

  return {
    items: structuredItems.map((item) => ({
      ...item,
      totalPrice: calculateSafeLineTotal(item),
    })),
    reviewReasons: unique(reviewReasons),
  };
}

function mergeRobustExplicitLineItems(
  originalText: string,
  items: ParsedOrderItemForValidation[],
  finalCurrency: IntakeCurrency,
): ParsedOrderItemForValidation[] {
  const explicitItems = extractExplicitServiceLineItems(
    originalText,
    finalCurrency,
  ).filter(
    (item) =>
      item.detectedCurrency === finalCurrency &&
      Number(item.unitPrice || 0) > 0 &&
      Number(item.quantity || 0) > 0 &&
      normalizeCompare(item.serviceName) !== "unbekannte leistung",
  );

  if (explicitItems.length === 0) return items;

  const nextItems = items.slice();

  for (const explicit of explicitItems) {
    const explicitKey = normalizeCompare(explicit.serviceName);
    const explicitTokens = meaningfulServiceTokens(explicit.serviceName);
    const explicitAmount = roundMoney(Number(explicit.unitPrice || 0));
    const explicitQuantity = Number(explicit.quantity || 0);
    const explicitUnitType = unitTypeFromDisplayUnit(explicit.unit);

    const existingIndex = nextItems.findIndex((item) => {
      const itemKey = normalizeCompare(item.serviceName);
      const itemTokens = meaningfulServiceTokens(item.serviceName);
      const itemUnitType = unitTypeFromDisplayUnit(item.unit);
      const sameName = itemKey === explicitKey;
      const tokenOverlap = explicitTokens.filter((token) =>
        itemTokens.includes(token),
      ).length;
      const sameUnit =
        !itemUnitType || !explicitUnitType || itemUnitType === explicitUnitType;
      return (
        sameName ||
        (sameUnit && tokenOverlap >= Math.min(2, explicitTokens.length || 2))
      );
    });

    if (existingIndex >= 0) {
      const existing = nextItems[existingIndex];
      const existingLooksWrong =
        Math.abs(Number(existing.unitPrice || 0) - explicitAmount) >= 0.01 ||
        Math.abs(Number(existing.quantity || 0) - explicitQuantity) >= 0.001 ||
        normalizeCompare(existing.serviceName) !== explicitKey;

      if (!existingLooksWrong) continue;

      nextItems[existingIndex] = {
        ...existing,
        serviceName: explicit.serviceName,
        description: existing.description || explicit.description,
        quantity: explicit.quantity,
        unit: explicit.unit,
        unitPrice: explicit.unitPrice,
        totalPrice: calculateSafeLineTotal(explicit),
        sourceText: existing.sourceText || explicit.sourceText,
        evidence: existing.evidence || explicit.evidence,
        detectedCurrency:
          explicit.detectedCurrency || existing.detectedCurrency,
        needsReview: existing.needsReview || explicit.needsReview,
        reviewReason: existing.reviewReason || explicit.reviewReason,
      };
      continue;
    }

    nextItems.push({
      ...explicit,
      totalPrice: calculateSafeLineTotal(explicit),
    });
  }

  return nextItems;
}

function removeUnknownItemsCoveredByNamedItems(
  items: ParsedOrderItemForValidation[],
): ParsedOrderItemForValidation[] {
  return items.filter((item, index) => {
    if (normalizeCompare(item.serviceName) !== "unbekannte leistung")
      return true;

    const itemUnitType = unitTypeFromDisplayUnit(item.unit);
    const itemQuantity = Number(item.quantity || 0);
    const itemUnitPrice = Number(item.unitPrice || 0);

    const covered = items.some((other, otherIndex) => {
      if (otherIndex === index) return false;
      if (normalizeCompare(other.serviceName) === "unbekannte leistung")
        return false;

      const otherUnitType = unitTypeFromDisplayUnit(other.unit);
      const sameUnit =
        !itemUnitType || !otherUnitType || itemUnitType === otherUnitType;
      const sameQuantity =
        Math.abs(Number(other.quantity || 0) - itemQuantity) < 0.001;
      const samePrice =
        Math.abs(Number(other.unitPrice || 0) - itemUnitPrice) < 0.01;

      if (sameUnit && sameQuantity && samePrice) return true;

      const itemSource = normalizeCompare(
        item.sourceText || item.evidence || item.description || "",
      );
      const otherSource = normalizeCompare(
        other.sourceText || other.evidence || other.description || "",
      );
      return Boolean(
        itemSource &&
        otherSource &&
        (otherSource.includes(itemSource) || itemSource.includes(otherSource)),
      );
    });

    return !covered;
  });
}

function removeZeroReviewItemsCoveredByPricedItems(
  items: ParsedOrderItemForValidation[],
): ParsedOrderItemForValidation[] {
  if (items.length <= 1) return items;

  return items.filter((item, index) => {
    const itemPrice = roundMoney(Number(item.unitPrice || 0));
    const itemTotal = roundMoney(Number(item.totalPrice || 0));
    const itemQuantity = roundMoney(Number(item.quantity || 0));
    const itemUnit =
      unitTypeFromDisplayUnit(item.unit) || normalizeCompare(item.unit);
    const itemName = normalizeCompare(item.serviceName);

    if (itemPrice > 0 && itemTotal > 0) return true;
    if (itemQuantity <= 0 || !itemUnit || !itemName) return true;

    const coveredByPricedItem = items.some((other, otherIndex) => {
      if (otherIndex === index) return false;
      if (roundMoney(Number(other.unitPrice || 0)) <= 0) return false;
      if (roundMoney(Number(other.totalPrice || 0)) <= 0) return false;

      const otherQuantity = roundMoney(Number(other.quantity || 0));
      if (Math.abs(otherQuantity - itemQuantity) >= 0.001) return false;

      const otherUnit =
        unitTypeFromDisplayUnit(other.unit) || normalizeCompare(other.unit);
      if (otherUnit !== itemUnit) return false;

      return normalizeCompare(other.serviceName) === itemName;
    });

    return !coveredByPricedItem;
  });
}

function isPriceAnchorOnlyServiceName(value?: string | null): boolean {
  const raw = String(value || "").trim();
  const normalized = normalizeCompare(raw);
  if (!normalized) return true;

  // Small structural blocklist only: these are price/linking words, not services.
  // This is intentionally not a trade/service dictionary.
  if (
    /^(?:ansatz|stundenansatz|stundensatz|tagessatz|stundenpreis|preis|einzelpreis|ep|zu|a|à|pro|je|per|par|fuer|für)$/i.test(
      normalized,
    )
  ) {
    return true;
  }

  // Preis-/Rechenfragmente wie "À 6.50", "je 8.-" oder "CHF 35" sind
  // nie fachliche Leistungen. Das ist eine strukturelle Sperre, keine
  // Leistungs-Wortliste.
  if (
    /^[\s+\-–—]*(?:à|a|zu|pro|je|per|par|\/)?\s*(?:chf|fr\.?|sfr\.?|eur|euro|€)?\s*\d+(?:[.,]\d{1,2})?\s*(?:chf|fr\.?|sfr\.?|eur|euro|€)?\s*(?:\.-)?\s*$/i.test(
      raw,
    )
  ) {
    return true;
  }

  if (/^(?:a|à|zu|pro|je|per|par)?\s*\d+(?:\s+\d{1,2})?$/.test(normalized)) {
    return true;
  }

  return false;
}

function serviceNameQualityScore(value?: string | null): number {
  const normalized = normalizeCompare(value);
  if (!normalized) return -100;
  if (isPriceAnchorOnlyServiceName(value)) return -80;

  let score = 0;
  const tokens = meaningfulServiceTokens(value);
  score += tokens.length * 20;
  if (canonicalGermanServiceNameFromText(value)) score += 80;
  if (/[,;:]\s*(?:zu|a|à|pro|je|per|par)\s*$/i.test(String(value || ""))) {
    score -= 80;
  }
  if (/\b(?:preis|ansatz|stundenansatz|stundensatz)\b/i.test(normalized)) {
    score -= 40;
  }
  return score;
}

function explicitLineMatchesItem(
  item: ParsedOrderItemForValidation,
  explicit: ExplicitServiceLineItem,
): boolean {
  const itemName = normalizeCompare(item.serviceName);
  const explicitName = normalizeCompare(explicit.serviceName);
  if (!explicitName || explicitName === "unbekannte leistung") return false;

  if (itemName === explicitName) return true;

  const itemSource = normalizeCompare(
    [item.sourceText, item.evidence, item.description]
      .filter(Boolean)
      .join(" "),
  );
  const explicitSource = normalizeCompare(explicit.sourceText);
  const sameSource = Boolean(
    itemSource &&
    explicitSource &&
    (itemSource.includes(explicitSource) ||
      explicitSource.includes(itemSource)),
  );

  if (!sameSource) return false;

  if (isPriceAnchorOnlyServiceName(item.serviceName)) return true;
  if (/[,;:]\s*(?:zu|a|à|pro|je|per|par)\s*$/i.test(item.serviceName || "")) {
    return true;
  }

  const itemTokens = meaningfulServiceTokens(item.serviceName);
  const explicitTokens = meaningfulServiceTokens(explicit.serviceName);
  const overlap = explicitTokens.filter((token) =>
    itemTokens.includes(token),
  ).length;

  return overlap > 0;
}

function preferExplicitSafeItem(
  current: ParsedOrderItemForValidation,
  explicit: ExplicitServiceLineItem,
): ParsedOrderItemForValidation {
  const explicitTotal = calculateSafeLineTotal(explicit);
  return {
    ...current,
    serviceName: explicit.serviceName,
    description: explicit.sourceText,
    quantity: explicit.quantity,
    unit: explicit.unit,
    unitPrice: explicit.unitPrice,
    totalPrice: explicitTotal,
    needsReview: Boolean(explicit.needsReview),
    reviewReason: explicit.reviewReason || null,
    sourceText: explicit.sourceText,
    evidence: explicit.sourceText,
    detectedCurrency:
      explicit.detectedCurrency || current.detectedCurrency || null,
  };
}

function removeUnsafeExplicitDuplicates(
  items: ParsedOrderItemForValidation[],
): ParsedOrderItemForValidation[] {
  const withoutPriceAnchors = items.filter(
    (item) => !isPriceAnchorOnlyServiceName(item.serviceName),
  );

  const bySourceAmount = new Map<string, ParsedOrderItemForValidation>();

  for (const item of withoutPriceAnchors) {
    const sourceKey = normalizeCompare(
      item.sourceText || item.evidence || item.description || "",
    );
    const unitType =
      unitTypeFromDisplayUnit(item.unit) || normalizeCompare(item.unit);
    const key = `${sourceKey}:${unitType}:${Number(item.quantity || 0)}:${Number(item.unitPrice || 0)}`;

    if (!sourceKey) {
      const fallbackKey = `fallback:${normalizeCompare(item.serviceName)}:${unitType}:${Number(item.quantity || 0)}:${Number(item.unitPrice || 0)}`;
      if (!bySourceAmount.has(fallbackKey))
        bySourceAmount.set(fallbackKey, item);
      continue;
    }

    const existing = bySourceAmount.get(key);
    if (!existing) {
      bySourceAmount.set(key, item);
      continue;
    }

    const existingScore = serviceNameQualityScore(existing.serviceName);
    const itemScore = serviceNameQualityScore(item.serviceName);
    if (itemScore > existingScore) bySourceAmount.set(key, item);
  }

  return Array.from(bySourceAmount.values());
}

function cleanFinalServiceNameArtifacts(
  items: ParsedOrderItemForValidation[],
): ParsedOrderItemForValidation[] {
  return items.map((item) => {
    let serviceName = String(item.serviceName || "")
      .replace(/[,;:]?\s*(?:zu|a|à|pro|je|per|par)\s*$/i, "")
      .replace(/\s*\.\-\s*$/g, "")
      .replace(/\s+/g, " ")
      .trim();

    serviceName = stripServiceFieldLabelArtifactsV17_47(serviceName);

    if (!serviceName) serviceName = item.serviceName;

    const canonical = canonicalGermanServiceNameFromText(serviceName);
    if (canonical) serviceName = canonical;

    return serviceName && serviceName !== item.serviceName
      ? { ...item, serviceName }
      : item;
  });
}


function translatedSectionFromOriginalTextV17_35(value?: string | null): string {
  const source = String(value || "");
  const parts = source.split(/---\s*Übersetzung\s*\(automatisch\)\s*---/i);
  return parts.length > 1 ? parts.slice(1).join("\n") : "";
}

function preferredSemanticLineSourceV17_41(value?: string | null): string {
  const source = String(value || "");
  const translated = translatedSectionFromOriginalTextV17_35(source).trim();
  if (translated) return translated;

  return source
    .replace(/\n+---\s*Übersetzung \(automatisch\)\s*---[\s\S]*$/i, "")
    .replace(/\n+---\s*Uebersetzung \(automatisch\)\s*---[\s\S]*$/i, "")
    .replace(/\n+---\s*Automatic translation\s*---[\s\S]*$/i, "");
}

function numberEvidencePatternV17_35(value: number): RegExp | null {
  if (!Number.isFinite(value) || value <= 0) return null;
  const fixed = Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
  const escaped = fixed.replace(".", "[.,]");
  return new RegExp(`\\b${escaped}(?:[.,]0+)?\\b`, "i");
}

function hasUnitEvidenceForItemV17_35(line: string, item: ParsedOrderItemForValidation): boolean {
  const unit = normalizeCompare(item.unit);
  if (/quadratmeter|m2|qm/.test(unit)) return /\b(?:m2|m²|qm|quadratmeter)\b/i.test(line);
  if (/stueck|stück|stuck/.test(unit)) return /\b(?:stück|stueck|stk|pcs?|pieces?)\b/i.test(line);
  if (/pauschal/.test(unit)) return true;
  return true;
}

function translatedServicePrefixFromLineV17_35(line: string, item: ParsedOrderItemForValidation): string | null {
  const quantity = Number(item.quantity || 0);
  const unitPrice = Number(item.unitPrice || 0);
  const quantityPattern = numberEvidencePatternV17_35(quantity);
  const pricePattern = numberEvidencePatternV17_35(unitPrice);
  if (!quantityPattern || !pricePattern) return null;
  if (!quantityPattern.test(line) || !pricePattern.test(line)) return null;
  if (!hasUnitEvidenceForItemV17_35(line, item)) return null;

  const quantityMatch = line.match(quantityPattern);
  if (!quantityMatch || quantityMatch.index == null || quantityMatch.index <= 0) return null;

  const prefix = line
    .slice(0, quantityMatch.index)
    .replace(/^\s*[-•*]+\s*/, "")
    .replace(/^\s*(?:zu\s*tun|gemacht\s*werden\s*soll|machen|leistungen?)\s*:?\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!prefix || prefix.length < 3 || prefix.length > 80) return null;
  if (/^(?:fahrt|fahrtkosten|anfahrt|rechn(?:ung|ig)|ort|adresse|mail|e-mail)$/i.test(prefix)) return null;
  return prefix;
}

function normalizeTranslatedServicePrefixV17_35(prefix: string): string | null {
  let cleaned = String(prefix || "")
    .replace(/\s*[-–—/]\s*/g, " ")
    .replace(/[.;:,\s]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return null;

  const key = normalizeCompare(cleaned);
  if (/\b(?:anfahrt|fahrt|fahrtkosten)\b/.test(key)) return "Anfahrt";
  if (/\bfenster\b/.test(key)) {
    const windowName = cleaned
      .replace(/\b(?:inneren|im\s+inneren|interne[nrms]?|intern)\b/gi, "innen")
      .replace(/\s+/g, " ")
      .trim();
    return /\breinigen\b/i.test(windowName) ? windowName : `${windowName} reinigen`;
  }
  if (/\b(?:gelaender|geländer)\b/.test(key)) {
    return /\b(?:reinigen|abstauben|abwischen|wischen)\b/i.test(cleaned) ? cleaned : `${cleaned} reinigen`;
  }
  if (/\bboden\b/.test(key)) {
    cleaned = cleaned
      .replace(/^Keller\s+Boden\b/i, "Kellerboden")
      .replace(/^Garage\s+Boden\b/i, "Garagenboden")
      .replace(/^Boden\s+Eingang\b/i, "Boden Eingang")
      .replace(/\s+/g, " ")
      .trim();

    const trailingFloorObject = cleaned.match(/^(.{3,70})\s+Boden$/i);
    if (trailingFloorObject && !/^Boden\b/i.test(cleaned) && !/boden$/i.test(trailingFloorObject[1])) {
      cleaned = `Boden ${trailingFloorObject[1]}`.replace(/\s+/g, " ").trim();
    }

    return /\breinigen\b/i.test(cleaned) ? cleaned : `${cleaned} reinigen`;
  }
  if (/\bteppichzone\b/.test(key)) return "Teppichzone reinigen";

  const canonical = canonicalGermanServiceNameFromText(cleaned);
  if (canonical) return canonical;

  return cleaned.replace(/^./, (char) => char.toUpperCase());
}

function hasVisibleGermanWorkActionV17_37(value?: string | null): boolean {
  const key = normalizeCompare(value);
  if (!key) return false;
  return /\b(?:reinigen|reinigung|putzen|saeubern|abstauben|entfernen|abstauben|abwischen|wischen|arbeiten|anfahrt|fahrtkosten|streichen|malen|schneiden|entsorgen|montieren|demontieren|reparieren|liefern|umstellen)\b/.test(key);
}

function visibleServiceNameQualityScoreV17_37(value?: string | null): number {
  const raw = String(value || "").trim();
  const key = normalizeCompare(raw);
  if (!key) return -999;

  let score = 0;
  if (hasVisibleGermanWorkActionV17_37(raw)) score += 90;
  if (/^[A-ZÄÖÜ]/.test(raw)) score += 10;
  if (key.split(/\s+/g).length >= 2) score += 15;
  if (/\b(?:boden|fenster|teppich|garage|keller|raum|bereich|anfahrt)\b/.test(key)) score += 15;

  if (/\b(?:unbekannte\s+leistung|sonstiges)\b/.test(key)) score -= 160;
  if (/\b(?:chf|eur|usd|gbp|m2|m²|qm|stk|stueck|stück|std|stunden?)\b/.test(key)) score -= 90;
  if (/\b(?:à|a|je|pro|per|mal)\b/.test(raw.toLowerCase())) score -= 60;
  if (!hasVisibleGermanWorkActionV17_37(raw) && key !== "anfahrt") score -= 45;

  return score;
}

function shouldUseTranslatedServiceNameV17_35(item: ParsedOrderItemForValidation, translatedName: string): boolean {
  const current = normalizeCompare(item.serviceName);
  const translated = normalizeCompare(translatedName);
  if (!translated || translated === current) return false;

  const currentScore = visibleServiceNameQualityScoreV17_37(item.serviceName);
  const translatedScore = visibleServiceNameQualityScoreV17_37(translatedName);

  // Die übersetzte Evidence-Zeile wurde bereits über Menge + Einheit + Preis
  // an genau diese Position gebunden. Wenn daraus ein klarerer deutscher
  // Leistungsname entsteht, ersetzt er die rohe Mundart-/Fremdsprachenform.
  if (translatedScore >= currentScore + 25) return true;

  const currentHasAction = hasVisibleGermanWorkActionV17_37(item.serviceName);
  const translatedHasAction = hasVisibleGermanWorkActionV17_37(translatedName);
  if (!currentHasAction && translatedHasAction) return true;

  const currentTokens = current.split(/\s+/g).filter((token) => token.length >= 5);
  const translatedKeepsCurrentMeaning =
    currentTokens.length > 0 &&
    currentTokens.every((token) => translated.includes(token));
  if (translatedHasAction && translatedKeepsCurrentMeaning) return true;

  return false;
}

function normalizeHighGermanServiceNamesFromTranslatedTextV17_35(
  originalText: string,
  items: ParsedOrderItemForValidation[],
): ParsedOrderItemForValidation[] {
  const translated = translatedSectionFromOriginalTextV17_35(originalText);
  if (!translated.trim()) return items;

  const translatedLines = translated
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split(/\n+/g)
    .map((line) => line.trim())
    .filter(Boolean);

  return items.map((item) => {
    const matchingPrefix = translatedLines
      .map((line) => translatedServicePrefixFromLineV17_35(line, item))
      .find(Boolean);
    if (!matchingPrefix) return item;

    const translatedName = normalizeTranslatedServicePrefixV17_35(matchingPrefix);
    if (!translatedName || !shouldUseTranslatedServiceNameV17_35(item, translatedName)) return item;

    return { ...item, serviceName: translatedName };
  });
}


function duplicateTranslationAmountKeyV17_41(
  item: ParsedOrderItemForValidation,
): string | null {
  const quantity = roundMoney(Number(item.quantity || 0));
  const unitPrice = roundMoney(Number(item.unitPrice || 0));
  if (!Number.isFinite(quantity) || !Number.isFinite(unitPrice)) return null;
  if (quantity <= 0 || unitPrice <= 0) return null;

  const unitType = unitTypeFromDisplayUnit(item.unit) || normalizeCompare(item.unit);
  if (!unitType || unitType === "pauschal") return null;

  const currency = normalizeCurrency(item.detectedCurrency || null) || "";
  return [unitType, quantity, unitPrice, currency].join("|");
}

function genericVisibleServiceNameV17_41(value?: string | null): boolean {
  const key = normalizeCompare(value);
  return /^(?:boden reinigen|fenster reinigen|reinigung|leistung pruefen|unbekannte leistung)$/.test(key);
}

function translatedDuplicateKeepScoreV17_41(
  item: ParsedOrderItemForValidation,
): number {
  const raw = String(item.serviceName || "").trim();
  const key = normalizeCompare(raw);
  let score = visibleServiceNameQualityScoreV17_37(raw) + serviceNameQualityScore(raw);

  const tokenCount = key.split(/\s+/g).filter(Boolean).length;
  score += tokenCount * 8;
  score += meaningfulServiceTokens(raw).length * 22;

  if (genericVisibleServiceNameV17_41(raw)) score -= 55;
  if (/[,;:]?\s*(?:zu|a|à|pro|je|per|par)\s*$/i.test(raw)) score -= 140;
  if (/\b(?:chf|eur|m2|m²|qm|stk|stueck|stück|meter)\b/i.test(raw)) score -= 140;
  if (!hasVisibleGermanWorkActionV17_37(raw) && key !== "anfahrt") score -= 35;
  if (Number(item.totalPrice || 0) > 0) score += 10;
  if (!item.needsReview) score += 5;

  return score;
}

function removeOriginalTranslatedAmountDuplicatesV17_41(
  items: ParsedOrderItemForValidation[],
): ParsedOrderItemForValidation[] {
  if (items.length <= 1) return items;

  const groups = new Map<
    string,
    Array<{ item: ParsedOrderItemForValidation; index: number }>
  >();

  items.forEach((item, index) => {
    const key = duplicateTranslationAmountKeyV17_41(item);
    if (!key) return;
    const list = groups.get(key) || [];
    list.push({ item, index });
    groups.set(key, list);
  });

  const remove = new Set<number>();

  for (const group of groups.values()) {
    if (group.length <= 1) continue;

    const distinctNames = new Set(
      group.map(({ item }) => normalizeCompare(item.serviceName)).filter(Boolean),
    );
    if (distinctNames.size <= 1) {
      group.slice(1).forEach((entry) => remove.add(entry.index));
      continue;
    }

    const sorted = group
      .slice()
      .sort(
        (a, b) =>
          translatedDuplicateKeepScoreV17_41(b.item) -
            translatedDuplicateKeepScoreV17_41(a.item) || a.index - b.index,
      );

    const best = sorted[0];
    const bestScore = translatedDuplicateKeepScoreV17_41(best.item);
    const shouldCollapse = sorted.slice(1).some((entry) => {
      const score = translatedDuplicateKeepScoreV17_41(entry.item);
      const name = String(entry.item.serviceName || "");
      return (
        bestScore >= score + 15 ||
        genericVisibleServiceNameV17_41(name) ||
        /[,;:]?\s*(?:zu|a|à|pro|je|per|par)\s*$/i.test(name) ||
        isPriceAnchorOnlyServiceName(name)
      );
    });

    if (!shouldCollapse) continue;

    for (const entry of sorted.slice(1)) {
      remove.add(entry.index);
    }
  }

  if (remove.size === 0) return items;
  return items.filter((_, index) => !remove.has(index));
}

function hasResolvedCompleteItemForReason(
  items: ParsedOrderItemForValidation[],
  reason: string,
): boolean {
  const parts = reason.split(":");
  const serviceName = parts[1] || "";
  if (!serviceName) return false;
  const serviceKey = normalizeCompare(serviceName);
  if (!serviceKey) return false;

  return items.some((item) => {
    if (normalizeCompare(item.serviceName) !== serviceKey) return false;
    if (Number(item.quantity || 0) <= 0) return false;
    if (Number(item.unitPrice || 0) <= 0) return false;
    if (Number(item.totalPrice || 0) <= 0) return false;
    if (item.needsReview && item.reviewReason?.startsWith("price_unclear:")) {
      return false;
    }
    return true;
  });
}

function hasOpenAmountReview(items: ParsedOrderItemForValidation[]): boolean {
  return items.some((item) => {
    if (Number(item.unitPrice || 0) <= 0) return true;
    if (!isFlatUnit(item.unit) && Number(item.quantity || 0) <= 0) return true;
    const reason = item.reviewReason || "";
    return (
      item.needsReview &&
      (reason.startsWith("price_unclear:") ||
        reason === "unit_price_review" ||
        reason === "quantity_review")
    );
  });
}

function hasExplicitServiceLineForName(
  originalText: string,
  serviceName: string,
): boolean {
  const service = normalizeCompare(serviceName);
  const lines = splitRawIntakeLines(originalText);

  return lines.some((line) => {
    const text = normalizeCompare(line);
    if (!text) return false;

    if (/^\s*\[?\s*(?:titel|title)\s*:/i.test(line)) return false;
    if (
      /^(?:ausfuehrung|ausfuehrungsadresse|arbeitsort|einsatzort|adresse travaux|adresse de travail)\b/.test(
        text,
      )
    )
      return false;

    const hasPriceOrQuantity =
      extractUnitPricesFromSegment(line).length > 0 ||
      findExplicitUnitPriceInLine(line, "CHF") ||
      findExplicitFlatPriceInLine(line, "CHF") ||
      new RegExp(`\\b${QUANTITY_NUMBER_OR_WORD}\\s*${UNIT_WORDS}\\b`, "i").test(
        line,
      );

    if (!hasPriceOrQuantity) return false;

    if (service === "eingangsbereich reinigen") {
      // "Eingangsbereich Boden reinigen 50 m2 à CHF 8" is a measured floor
      // cleaning line with a location prefix, not a separate flat entrance job.
      if (hasFloorCleaningIntentKey(text) || hasWindowCleaningIntentKey(text)) {
        return false;
      }

      return (
        /\beingangsbereich\b/.test(text) &&
        /\b(reinigen|reinigung|putzen|clean|nettoyage|limpieza|pulizia)\b/.test(
          text,
        )
      );
    }

    return text.includes(service);
  });
}

function removeWorksiteNameOnlyArtifacts(
  originalText: string,
  items: ParsedOrderItemForValidation[],
): ParsedOrderItemForValidation[] {
  return items.filter((item) => {
    const service = normalizeCompare(item.serviceName);

    // "Haus B, Keller und Eingangsbereich" is an execution-site description,
    // not a billable service. Keep a real Eingangsbereich service only when the
    // customer text has its own priced/quantified service line for it.
    if (service === "eingangsbereich reinigen") {
      return hasExplicitServiceLineForName(originalText, item.serviceName);
    }

    return true;
  });
}

function applyHardExplicitItemConsistencyGuard(
  items: ParsedOrderItemForValidation[],
  originalText: string,
  finalCurrency: IntakeCurrency,
): { items: ParsedOrderItemForValidation[]; reviewReasons: string[] } {
  const explicitItems = extractExplicitServiceLineItems(
    originalText,
    finalCurrency,
  ).filter(
    (explicit) =>
      explicit.detectedCurrency === finalCurrency &&
      !isPriceAnchorOnlyServiceName(explicit.serviceName) &&
      normalizeCompare(explicit.serviceName) !== "unbekannte leistung",
  );

  if (explicitItems.length === 0) {
    return {
      items: removeUnsafeExplicitDuplicates(items),
      reviewReasons: [],
    };
  }

  const reviewReasons: string[] = [];
  let nextItems = items.filter(
    (item) => !isPriceAnchorOnlyServiceName(item.serviceName),
  );

  for (const explicit of explicitItems) {
    const existingIndex = nextItems.findIndex((item) =>
      explicitLineMatchesItem(item, explicit),
    );

    if (existingIndex >= 0) {
      const existing = nextItems[existingIndex];
      const beforeQuantity = Number(existing.quantity || 0);
      const beforePrice = Number(existing.unitPrice || 0);
      const quantityChanged =
        Math.abs(beforeQuantity - Number(explicit.quantity || 0)) >= 0.001;
      const priceChanged =
        Math.abs(beforePrice - Number(explicit.unitPrice || 0)) >= 0.01;

      nextItems[existingIndex] = preferExplicitSafeItem(existing, explicit);

      if (quantityChanged || priceChanged) {
        reviewReasons.push(
          `item_repaired_from_same_text_line:${explicit.serviceName}`,
        );
      }
      continue;
    }

    nextItems.push({
      ...explicit,
      totalPrice: calculateSafeLineTotal(explicit),
      needsReview: Boolean(explicit.needsReview),
      reviewReason: explicit.reviewReason || null,
    });
    reviewReasons.push(
      `item_added_from_same_text_line:${explicit.serviceName}`,
    );
  }

  nextItems = removeUnsafeExplicitDuplicates(nextItems);

  return {
    items: nextItems,
    reviewReasons: unique(reviewReasons),
  };
}

function extractExplicitMeasuredHourLineItems(
  originalText: string,
  finalCurrency: IntakeCurrency,
): ExplicitServiceLineItem[] {
  return extractExplicitServiceLineItems(originalText, finalCurrency).filter(
    (item) =>
      item.detectedCurrency === finalCurrency &&
      unitTypeFromDisplayUnit(item.unit) === "hour" &&
      Number(item.quantity || 0) > 0 &&
      Number(item.unitPrice || 0) > 0 &&
      !isPriceAnchorOnlyServiceName(item.serviceName) &&
      normalizeCompare(item.serviceName) !== "unbekannte leistung",
  );
}

function explicitHourLineMatchesItem(
  item: ParsedOrderItemForValidation,
  explicit: ExplicitServiceLineItem,
): boolean {
  const itemText = normalizeCompare(
    [item.sourceText, item.evidence, item.description, item.serviceName]
      .filter(Boolean)
      .join(" "),
  );
  const explicitText = normalizeCompare(
    [
      explicit.sourceText,
      explicit.evidence,
      explicit.description,
      explicit.serviceName,
    ]
      .filter(Boolean)
      .join(" "),
  );

  const itemSourceOnly = normalizeCompare(
    [item.sourceText, item.evidence, item.description]
      .filter(Boolean)
      .join(" "),
  );
  const explicitSourceOnly = normalizeCompare(
    [explicit.sourceText, explicit.evidence, explicit.description]
      .filter(Boolean)
      .join(" "),
  );

  const sourceMatches = Boolean(
    itemSourceOnly &&
    explicitSourceOnly &&
    (itemSourceOnly.includes(explicitSourceOnly) ||
      explicitSourceOnly.includes(itemSourceOnly)),
  );

  const sameUnit =
    unitTypeFromDisplayUnit(item.unit) ===
    unitTypeFromDisplayUnit(explicit.unit);
  const sameQuantity =
    Math.abs(Number(item.quantity || 0) - Number(explicit.quantity || 0)) <
    0.001;
  const samePrice =
    Math.abs(Number(item.unitPrice || 0) - Number(explicit.unitPrice || 0)) <
    0.01;

  const itemTopic = weakServiceTopic(itemText);
  const explicitTopic = weakServiceTopic(explicitText);
  const sameTopic = Boolean(
    itemTopic && explicitTopic && itemTopic === explicitTopic,
  );
  const sameDomain = sameServiceDomain(item, explicit);

  if (
    sameUnit &&
    sameQuantity &&
    samePrice &&
    (sourceMatches || sameTopic || sameDomain)
  ) {
    return true;
  }

  // Wichtig für den Live-Fehler: Die KI kann aus derselben Textzeile eine
  // Katalogleistung mit falscher Einheit (z. B. m2) erzeugen. Wenn die originale
  // Kundentext-Zeile ausdrücklich Stunden + Stundenpreis enthält, muss diese
  // Zeile die Katalogeinheit übersteuern, statt als zweite Position daneben zu
  // bleiben oder auf 0 gesetzt zu werden.
  if (sourceMatches && (sameTopic || sameDomain)) {
    return true;
  }

  return false;
}

function removeCatalogUnitItemsCoveredByExplicitHours(
  items: ParsedOrderItemForValidation[],
  explicitHours: ExplicitServiceLineItem[],
): ParsedOrderItemForValidation[] {
  if (items.length <= 1 || explicitHours.length === 0) return items;

  return items.filter((item) => {
    if (unitTypeFromDisplayUnit(item.unit) === "hour") return true;

    return !explicitHours.some((explicit) =>
      explicitHourLineMatchesItem(item, explicit),
    );
  });
}

function enforceExplicitMeasuredHourLineItems(
  originalText: string,
  items: ParsedOrderItemForValidation[],
  finalCurrency: IntakeCurrency,
): { items: ParsedOrderItemForValidation[]; reviewReasons: string[] } {
  const explicitHours = extractExplicitMeasuredHourLineItems(
    originalText,
    finalCurrency,
  );

  if (explicitHours.length === 0) {
    return { items, reviewReasons: [] };
  }

  const reviewReasons: string[] = [];
  let nextItems = [...items];

  for (const explicit of explicitHours) {
    const explicitItem: ExplicitServiceLineItem = {
      ...explicit,
      sourceText: explicit.sourceText,
      unit: "Stunde",
      quantity: Number(explicit.quantity || 0),
      unitPrice: Number(explicit.unitPrice || 0),
      totalPrice: calculateSafeLineTotal({
        ...explicit,
        unit: "Stunde",
      }),
      needsReview: Boolean(explicit.needsReview),
      reviewReason: explicit.reviewReason || null,
    };

    const existingIndex = nextItems.findIndex((item) =>
      explicitHourLineMatchesItem(item, explicitItem),
    );

    if (existingIndex >= 0) {
      const before = nextItems[existingIndex];
      const wasDifferent =
        unitTypeFromDisplayUnit(before.unit) !== "hour" ||
        Math.abs(Number(before.quantity || 0) - explicitItem.quantity) >=
          0.001 ||
        Math.abs(Number(before.unitPrice || 0) - explicitItem.unitPrice) >=
          0.01;

      nextItems[existingIndex] = preferExplicitSafeItem(before, explicitItem);

      if (wasDifferent) {
        reviewReasons.push(
          `explicit_hour_item_repaired_from_text:${explicitItem.serviceName}`,
        );
      }
      continue;
    }

    nextItems.push(explicitItem);
    reviewReasons.push(
      `explicit_hour_item_added_from_text:${explicitItem.serviceName}`,
    );
  }

  nextItems = removeCatalogUnitItemsCoveredByExplicitHours(
    nextItems,
    explicitHours,
  );
  nextItems = removeUnsafeExplicitDuplicates(nextItems);
  nextItems = removeUnpricedDuplicateServiceArtifacts(nextItems);
  nextItems = dedupeUnsafeDuplicateItems(nextItems);
  nextItems = removeZeroReviewItemsCoveredByPricedItems(nextItems);

  return {
    items: nextItems,
    reviewReasons: unique(reviewReasons),
  };
}

// V16.93: final hard guard for explicit measured service lines.
// Purpose:
// - protect customer lines like "Boden ... 3.5 Stunden à CHF 72" from catalog-unit overwrite
// - prevent the hour price from leaking into the following piece/m2 line
// This guard is deliberately line-anchored and runs at the end of validation.
function extractHardMeasuredLineItemsFromRawText(
  originalText: string,
  finalCurrency: IntakeCurrency,
): ExplicitServiceLineItem[] {
  const result: ExplicitServiceLineItem[] = [];
  const seen = new Set<string>();

  const lines = normalizeText(preferredSemanticLineSourceV17_41(originalText))
    .split(/\n+|;|\s+•\s+|\s+\|\s+/g)
    .map((line) =>
      normalizeText(line)
        .replace(/^\s*(?:[-–—•]+|\d+[)])\s*/, "")
        .trim(),
    )
    .filter(Boolean)
    .filter((line) => !/^\s*\[?\s*(?:titel|title)\s*:/i.test(line));

  for (const line of lines) {
    const unitPrice = findExplicitUnitPriceInLine(line, finalCurrency);
    if (!unitPrice || unitPrice.currency !== finalCurrency) continue;

    const workerHourQuantity = detectWorkerHourQuantityInLine(line);
    const explicitHourQuantity = detectExplicitHourQuantityInLine(line);
    const quantityMatch = line.match(
      new RegExp(`\\b(${QUANTITY_NUMBER_OR_WORD})\\s*(${UNIT_WORDS})(?=\\b|\\s|[.,;:!?)])`, "i"),
    );

    const textUnitType = quantityMatch
      ? unitTypeFromText(quantityMatch[2])
      : null;
    const quantity =
      workerHourQuantity?.quantity ||
      (explicitHourQuantity && (textUnitType === "hour" || !quantityMatch)
        ? explicitHourQuantity.quantity
        : null) ||
      parseQuantityNumber(quantityMatch?.[1]) ||
      0;
    const quantityUnitType = workerHourQuantity
      ? "hour"
      : explicitHourQuantity && (textUnitType === "hour" || !quantityMatch)
        ? "hour"
        : textUnitType;
    const unitType = quantityUnitType || unitPrice.unitType;

    if (!quantity || quantity <= 0 || !unitType) continue;
    if (unitPrice.unitType && unitPrice.unitType !== unitType) continue;

    const quantityRaw =
      workerHourQuantity?.raw ||
      explicitHourQuantity?.raw ||
      quantityMatch?.[0] ||
      "";
    const serviceName = resolveExplicitServiceNameFromContext(
      originalText,
      line,
      cleanExplicitServiceNameFromLine(line, {
        quantityRaw,
        priceRaw: unitPrice.raw,
      }),
    );

    if (
      !serviceName ||
      isPriceAnchorOnlyServiceName(serviceName) ||
      normalizeCompare(serviceName) === "unbekannte leistung"
    ) {
      continue;
    }

    const item: ExplicitServiceLineItem = {
      serviceName,
      description: line,
      quantity: roundMoney(quantity),
      unit: unitTypeToDisplayUnit(unitType) || "Pauschal",
      unitPrice: unitPrice.amount,
      totalPrice: roundMoney(quantity * unitPrice.amount),
      needsReview: false,
      reviewReason: null,
      sourceText: line,
      evidence: line,
      detectedCurrency: unitPrice.currency,
    };

    const key = `${normalizeCompare(item.sourceText)}:${unitTypeFromDisplayUnit(item.unit)}:${item.quantity}:${item.unitPrice}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }

  return result;
}

function hardMeasuredLineMatchesExistingItem(
  item: ParsedOrderItemForValidation,
  explicit: ExplicitServiceLineItem,
): boolean {
  const itemText = normalizeCompare(
    [item.sourceText, item.evidence, item.description, item.serviceName]
      .filter(Boolean)
      .join(" "),
  );
  const explicitText = normalizeCompare(
    [
      explicit.sourceText,
      explicit.evidence,
      explicit.description,
      explicit.serviceName,
    ]
      .filter(Boolean)
      .join(" "),
  );

  const sourceMatches = Boolean(
    itemText &&
    explicitText &&
    (itemText.includes(explicitText) || explicitText.includes(itemText)),
  );
  const sameUnit =
    unitTypeFromDisplayUnit(item.unit) ===
    unitTypeFromDisplayUnit(explicit.unit);
  const sameQuantity =
    Math.abs(Number(item.quantity || 0) - Number(explicit.quantity || 0)) <
    0.001;
  const samePrice =
    Math.abs(Number(item.unitPrice || 0) - Number(explicit.unitPrice || 0)) <
    0.01;
  const itemTopic = weakServiceTopic(itemText);
  const explicitTopic = weakServiceTopic(explicitText);
  const sameTopic = Boolean(
    itemTopic && explicitTopic && itemTopic === explicitTopic,
  );
  const sameDomain = sameServiceDomain(item, explicit);

  if (sourceMatches && (sameTopic || sameDomain)) return true;
  if (!(sameTopic || sameDomain)) return false;

  // Main repair cases:
  // 1) bad catalog-mismatch row: same service/hour, price present, quantity 0
  // 2) price leak row: same service/unit/quantity, but unit price copied from previous line
  if (
    sameUnit &&
    (sameQuantity || Number(item.quantity || 0) <= 0 || samePrice)
  ) {
    return true;
  }

  // If parser kept the same source/service but wrong unit, the explicit line wins.
  if (
    sourceMatches &&
    (Number(item.totalPrice || 0) <= 0 || item.needsReview)
  ) {
    return true;
  }

  return false;
}

function enforceHardMeasuredLineItemsFromRawText(
  originalText: string,
  items: ParsedOrderItemForValidation[],
  finalCurrency: IntakeCurrency,
): { items: ParsedOrderItemForValidation[]; reviewReasons: string[] } {
  const explicitItems = extractHardMeasuredLineItemsFromRawText(
    originalText,
    finalCurrency,
  );

  if (explicitItems.length === 0) return { items, reviewReasons: [] };

  const reviewReasons: string[] = [];
  let nextItems = [...items];

  for (const explicit of explicitItems) {
    const existingIndex = nextItems.findIndex((item) =>
      hardMeasuredLineMatchesExistingItem(item, explicit),
    );

    if (existingIndex >= 0) {
      const before = nextItems[existingIndex];
      const changed =
        unitTypeFromDisplayUnit(before.unit) !==
          unitTypeFromDisplayUnit(explicit.unit) ||
        Math.abs(
          Number(before.quantity || 0) - Number(explicit.quantity || 0),
        ) >= 0.001 ||
        Math.abs(
          Number(before.unitPrice || 0) - Number(explicit.unitPrice || 0),
        ) >= 0.01;

      nextItems[existingIndex] = preferExplicitSafeItem(before, explicit);
      if (changed) {
        reviewReasons.push(
          `hard_measured_line_repaired:${explicit.serviceName}`,
        );
      }
      continue;
    }

    nextItems.push({
      ...explicit,
      totalPrice: calculateSafeLineTotal(explicit),
      needsReview: false,
      reviewReason: null,
    });
    reviewReasons.push(`hard_measured_line_added:${explicit.serviceName}`);
  }

  nextItems = removeUnsafeExplicitDuplicates(nextItems);
  nextItems = dedupeUnsafeDuplicateItems(nextItems);
  nextItems = removeZeroReviewItemsCoveredByPricedItems(nextItems);

  return { items: nextItems, reviewReasons: unique(reviewReasons) };
}

type UnitlessQuantityPriceLineCandidate = {
  raw: string;
  serviceName: string;
  quantity: number;
  unitPrice: number;
  currency: string | null;
  key: string;
  topic: string | null;
};

function hasKnownUnitAttachedToQuantity(
  line: string,
  quantity: number,
): boolean {
  const source = normalizeCompare(line);
  if (!source || !quantity) return false;
  const quantityLabel = Number.isInteger(quantity)
    ? String(quantity)
    : String(Number(quantity.toFixed(2))).replace(".", "[.,]");
  const unitWords =
    "(?:stueck|stück|stuck|stk|pcs|pc|piece|pieces|pi[eè]ce|pi[eè]ces|vitre|vitres|fenetre|fenetres|window|windows|quadratmeter|qm|m2|m²|sqm|kubikmeter|cbm|m3|m³|laufmeter|lfm|meter|m|stunde|stunden|std|h|hour|hours|tag|tage|day|days|kg|kilogramm|tonne|tonnen|liter|ltr|l|pauschal|pauschale|forfait|flat)";
  return new RegExp(`(^|[^0-9])${quantityLabel}\\s*${unitWords}\\b`, "i").test(
    source,
  );
}

function cleanServiceNameFromUnitlessQuantityPriceLine(
  line: string,
  index: number,
): string {
  let raw = String(line || "").slice(0, Math.max(0, index));
  raw = raw
    .replace(/^\s*(?:leistung|arbeiten|position)\s*:?\s*/i, "")
    .replace(/[:;,.-]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();

  // Do not infer a catalog/service name from room words here.
  // The LLM must do semantic classification. This guard is only allowed to
  // preserve the original local evidence and numeric structure. If it invents
  // "<room> reinigen" here, one customer line can become two charged/reviewed
  // services (e.g. room context + floor work). Keep the raw local label.
  return raw || "Leistung prüfen";
}

function stripAutomaticTranslationBlockForUnitlessGuard(
  value?: string | null,
): string {
  return preferredSemanticLineSourceV17_41(value);
}

function extractUnitlessQuantityPriceLineCandidates(
  originalText: string,
): UnitlessQuantityPriceLineCandidate[] {
  const lines = stripAutomaticTranslationBlockForUnitlessGuard(originalText)
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split(/\n+|;/g)
    .map((line) => line.trim())
    .filter((line) => line.length >= 8)
    .filter((line) => !/^\s*\[?\s*(?:titel|title)\s*:/i.test(line));

  const candidates: UnitlessQuantityPriceLineCandidate[] = [];
  const patterns: Array<{
    regex: RegExp;
    quantityGroup: number;
    currencyGroup?: number;
    priceGroup: number;
  }> = [
    {
      regex: new RegExp(
        `\\b(${QUANTITY_NUMBER_OR_WORD})\\s*(?:à|a|zu|je|pro|per|at|/)\\s*(?:(${CURRENCY_WORDS})\\s*)?${PRICE_NUMBER}\\b`,
        "gi",
      ),
      quantityGroup: 1,
      currencyGroup: 2,
      priceGroup: 3,
    },
    {
      regex: new RegExp(
        `\\b(${QUANTITY_NUMBER_OR_WORD})\\s*(?:à|a|zu|je|pro|per|at|/)\\s*(${PRICE_NUMBER})\\s*(${CURRENCY_WORDS})\\b`,
        "gi",
      ),
      quantityGroup: 1,
      priceGroup: 2,
      currencyGroup: 3,
    },
  ];

  for (const line of lines) {
    // V17.52: Unitless count price line with free service text between
    // quantity and price, e.g. "3 Ölauffangmatten reinigen à CHF 12".
    // This is structural, not service-word based: leading count + local
    // action/object + price anchor.
    const unitlessCountCandidate =
      detectUnitlessCountPriceServiceLineV17_51(line, "CHF") ||
      detectUnitlessCountPriceServiceLineV17_51(line, "EUR");
    if (unitlessCountCandidate) {
      const serviceName = cleanExplicitServiceNameFromLine(line, {
        quantityRaw: unitlessCountCandidate.quantityRaw,
        priceRaw: unitlessCountCandidate.price.raw,
      });
      if (normalizeCompare(serviceName) !== "unbekannte leistung") {
        candidates.push({
          raw: line,
          serviceName,
          quantity: unitlessCountCandidate.quantity,
          unitPrice: unitlessCountCandidate.price.amount,
          currency: unitlessCountCandidate.price.currency,
          key: normalizeCompare(line),
          topic:
            weakUnitlessServiceTopic(line) ||
            weakUnitlessServiceTopic(serviceName),
        });
      }
    }

    for (const pattern of patterns) {
      pattern.regex.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = pattern.regex.exec(line))) {
        const quantity = parseQuantityNumber(match[pattern.quantityGroup]);
        const unitPrice = parsePriceNumber(match[pattern.priceGroup]);
        if (!quantity || !unitPrice) continue;
        if (hasKnownUnitAttachedToQuantity(line, quantity)) continue;

        const serviceName = cleanServiceNameFromUnitlessQuantityPriceLine(
          line,
          match.index ?? 0,
        );
        const currency = pattern.currencyGroup
          ? normalizeCurrency(match[pattern.currencyGroup])
          : null;

        candidates.push({
          raw: line,
          serviceName,
          quantity,
          unitPrice,
          currency,
          key: normalizeCompare(line),
          topic:
            weakUnitlessServiceTopic(line) ||
            weakUnitlessServiceTopic(serviceName),
        });
      }
    }
  }

  const byKey = new Map<string, UnitlessQuantityPriceLineCandidate>();
  for (const candidate of candidates) {
    const key = `${candidate.key}:${candidate.quantity}:${candidate.unitPrice}`;
    if (!byKey.has(key)) byKey.set(key, candidate);
  }
  return Array.from(byKey.values());
}

function weakUnitlessServiceTopic(value?: string | null): string | null {
  const source = normalizeCompare(value);
  if (!source) return null;
  if (/lagerraum|lagerzone|lager\b|storage\s+room|stockroom/.test(source))
    return "lager";
  if (/technikraum|serverraum|technical\s+room|local\s+technique/.test(source))
    return "technik";
  if (/boden|floor|sol\b|paviment|suelo/.test(source)) return "boden";
  if (/fenster|window|vitre|fenetre|vitrin|finestr|ventan/.test(source))
    return "fenster";
  if (/glas|glass|spiegel|miroir/.test(source)) return "glas";
  return weakServiceTopic(value);
}

function tokenSetForUnitlessService(value?: string | null): Set<string> {
  const generic = new Set([
    "reinigen",
    "reinigung",
    "clean",
    "cleaning",
    "nettoyage",
    "pulizia",
    "limpieza",
    "boden",
    "floor",
    "sol",
    "leistung",
    "arbeiten",
    "arbeit",
  ]);
  return new Set(
    normalizeCompare(value)
      .split(/\s+/g)
      .map((token) => token.trim())
      .filter((token) => token.length >= 3)
      .filter((token) => !generic.has(token)),
  );
}

function unitlessCandidateMatchesItem(
  item: ParsedOrderItemForValidation,
  candidate: UnitlessQuantityPriceLineCandidate,
): boolean {
  const itemText = normalizeCompare(
    [item.serviceName, item.description, item.sourceText, item.evidence]
      .filter(Boolean)
      .join(" "),
  );
  const candidateText = normalizeCompare(
    [candidate.raw, candidate.serviceName].join(" "),
  );
  if (!itemText || !candidateText) return false;

  if (
    itemText.includes(candidate.key) ||
    candidate.key.includes(itemText.slice(0, 80))
  ) {
    return true;
  }

  const sameQuantity =
    Math.abs(Number(item.quantity || 0) - Number(candidate.quantity || 0)) <
    0.001;
  const samePrice =
    Math.abs(Number(item.unitPrice || 0) - Number(candidate.unitPrice || 0)) <
    0.01;
  const itemTopic = weakUnitlessServiceTopic(itemText);
  const sameTopic = Boolean(
    itemTopic && candidate.topic && itemTopic === candidate.topic,
  );

  const itemTokens = tokenSetForUnitlessService(itemText);
  const candidateTokens = tokenSetForUnitlessService(candidateText);
  const sharedTokens = Array.from(candidateTokens).filter((token) =>
    itemTokens.has(token),
  );

  return sameQuantity && samePrice && (sameTopic || sharedTokens.length > 0);
}

export function applyUnitlessQuantityPriceLineGuard(
  items: ParsedOrderItemForValidation[],
  originalText: string,
): { items: ParsedOrderItemForValidation[]; reviewReasons: string[] } {
  const candidates = extractUnitlessQuantityPriceLineCandidates(originalText);
  if (candidates.length === 0) return { items, reviewReasons: [] };

  const reviewReasons: string[] = [];
  const guardedItems = items.map((item) => {
    const candidate = candidates.find((entry) =>
      unitlessCandidateMatchesItem(item, entry),
    );
    if (!candidate) return item;

    const serviceName =
      String(
        item.serviceName || candidate.serviceName || "Leistung prüfen",
      ).trim() || "Leistung prüfen";

    // V17.54: A leading count with a local work object and unit price is a
    // countable Stück line, not an unknown unit. Example structure:
    // "3 <object/action> à CHF 12". This remains purely structural; it does
    // not depend on the object name.
    return {
      ...item,
      serviceName,
      description: candidate.raw,
      quantity: candidate.quantity,
      unit: "Stück",
      unitPrice: candidate.unitPrice,
      totalPrice: roundMoney(candidate.quantity * candidate.unitPrice),
      needsReview: false,
      reviewReason: null,
      sourceText: candidate.raw,
      evidence: candidate.raw,
      detectedCurrency: candidate.currency || item.detectedCurrency || null,
    };
  });

  const completedItems = guardedItems.slice();
  for (const candidate of candidates) {
    const covered = completedItems.some((item) =>
      unitlessCandidateMatchesItem(item, candidate) ||
      (Math.abs(Number(item.quantity || 0) - candidate.quantity) < 0.001 &&
        Math.abs(Number(item.unitPrice || 0) - candidate.unitPrice) < 0.01 &&
        normalizeCompare([item.sourceText, item.evidence, item.description].filter(Boolean).join(" ")).includes(candidate.key)),
    );
    if (covered) continue;

    const serviceName = cleanValidationServiceDisplayName(candidate.serviceName);
    if (!serviceName || normalizeCompare(serviceName) === "unbekannte leistung") continue;

    completedItems.push({
      serviceName,
      description: candidate.raw,
      quantity: candidate.quantity,
      unit: "Stück",
      unitPrice: candidate.unitPrice,
      totalPrice: roundMoney(candidate.quantity * candidate.unitPrice),
      needsReview: false,
      reviewReason: null,
      sourceText: candidate.raw,
      evidence: candidate.raw,
      detectedCurrency: candidate.currency || null,
    });
  }

  // Last step inside this guard: once every matching item has the same local
  // evidence line attached, collapse duplicate KI split artifacts immediately.
  // This is intentionally structural only: same evidence + same quantity + same
  // unit price + same unit. It does not use service-word lists.
  return {
    items: removeSameEvidenceQuantityPriceSplitArtifacts(completedItems),
    reviewReasons: unique(reviewReasons),
  };
}

function applyStructuredFailClosedValidation(params: {
  items: ParsedOrderItemForValidation[];
  finalCurrency: IntakeCurrency;
  detectedCurrencies: string[];
  unsupportedDetectedCurrencies: string[];
}): { items: ParsedOrderItemForValidation[]; reviewReasons: string[] } {
  const reviewReasons: string[] = [];
  const globalCurrencyConflict =
    params.detectedCurrencies.length > 1 ||
    params.unsupportedDetectedCurrencies.length > 0;

  const items = params.items.map((item) => {
    const next: ParsedOrderItemForValidation = { ...item };
    const serviceName =
      String(next.serviceName || "Unbekannte Leistung").trim() ||
      "Unbekannte Leistung";
    const quantity = Number(next.quantity || 0);
    const unitPrice = Number(next.unitPrice || 0);
    const normalizedUnit = normalizeCompare(next.unit || "");
    const isFlat = isFlatUnit(next.unit);
    const itemDetectedCurrency = normalizeCurrency(
      next.detectedCurrency || null,
    );
    const itemReasons: string[] = [];

    if (next.reviewReason) itemReasons.push(next.reviewReason);

    const hasUnitMissingReason =
      String(next.reviewReason || "").startsWith("unit_missing_in_text:") ||
      itemReasons.some((reason) => reason.startsWith("unit_missing_in_text:"));

    const unitMissing =
      !isFlat &&
      (hasUnitMissingReason ||
        !normalizedUnit ||
        normalizedUnit === "unbekannt" ||
        normalizedUnit === "unknown" ||
        normalizedUnit === "unklar" ||
        normalizedUnit === "pruefen" ||
        normalizedUnit === "prüfen" ||
        normalizedUnit.includes("pruefen") ||
        normalizedUnit.includes("prüfen"));

    if (unitMissing) {
      itemReasons.push(
        `unit_mismatch:${serviceName}:Unklar:${next.unit || "Unklar"}:0`,
      );
    }

    if (!isFlat && (!Number.isFinite(quantity) || quantity <= 0)) {
      next.quantity = 0;
      itemReasons.push("quantity_review");
    }

    if (!Number.isFinite(unitPrice) || unitPrice <= 0) {
      next.unitPrice = 0;
      itemReasons.push(`price_unclear:${serviceName}`, "unit_price_review");
    }

    if (globalCurrencyConflict) {
      reviewReasons.push("currency_review");

      const unsupportedCurrencyBlocked =
        params.unsupportedDetectedCurrencies.length > 0 &&
        (!itemDetectedCurrency ||
          (itemDetectedCurrency !== "CHF" && itemDetectedCurrency !== "EUR"));
      const mixedCurrencyItemBlocked =
        params.detectedCurrencies.length > 1 &&
        (!itemDetectedCurrency ||
          itemDetectedCurrency !== params.finalCurrency);

      // V17.23: Mischwährung ist ein Auftrags-Banner, aber keine pauschale
      // Sperre für jede Position. Eine EUR-Zeile in einem EUR-Auftrag bleibt
      // berechenbar; nur CHF/UNKNOWN-Zeilen werden rot/0 blockiert.
      if (unsupportedCurrencyBlocked || mixedCurrencyItemBlocked) {
        next.unitPrice = 0;
        itemReasons.push(
          itemDetectedCurrency && itemDetectedCurrency !== params.finalCurrency
            ? `item_currency_mismatch:${serviceName}:${itemDetectedCurrency}:${params.finalCurrency}`
            : `currency_conflict_item:${serviceName}:${itemDetectedCurrency || "UNKNOWN"}:${params.finalCurrency}`,
        );
      }
    } else if (
      itemDetectedCurrency &&
      itemDetectedCurrency !== params.finalCurrency
    ) {
      next.unitPrice = 0;
      itemReasons.push(
        `item_currency_mismatch:${serviceName}:${itemDetectedCurrency}:${params.finalCurrency}`,
        "currency_review",
      );
    }

    if (isFlat && Number(next.unitPrice || 0) > 0) {
      next.quantity = 1;
    }

    if (
      itemReasons.some(
        (reason) =>
          reason === "quantity_review" ||
          reason === "unit_price_review" ||
          reason === "currency_review" ||
          reason.startsWith("price_unclear:") ||
          reason.startsWith("unit_mismatch:") ||
          reason.startsWith("item_currency_mismatch:") ||
          reason.startsWith("currency_conflict_item:"),
      )
    ) {
      next.needsReview = true;
      if (!next.reviewReason) {
        next.reviewReason =
          itemReasons.find(
            (reason) =>
              reason.startsWith("unit_mismatch:") ||
              reason.startsWith("price_unclear:") ||
              reason.startsWith("item_currency_mismatch:") ||
              reason.startsWith("currency_conflict_item:") ||
              reason === "quantity_review" ||
              reason === "unit_price_review" ||
              reason === "currency_review",
          ) ||
          itemReasons[0] ||
          null;
      }
    }

    next.totalPrice = calculateSafeLineTotal(next);
    if (
      next.needsReview &&
      (unitMissing ||
        Number(next.quantity || 0) <= 0 ||
        Number(next.unitPrice || 0) <= 0)
    ) {
      next.totalPrice = 0;
    }

    reviewReasons.push(...itemReasons);
    return next;
  });

  return { items, reviewReasons: unique(reviewReasons) };
}

function applyFinalBlockedLineTotalGuard(params: {
  items: ParsedOrderItemForValidation[];
  detectedCurrencies: string[];
  unsupportedDetectedCurrencies: string[];
  finalCurrency: IntakeCurrency;
}): { items: ParsedOrderItemForValidation[]; reviewReasons: string[] } {
  const globalCurrencyConflict =
    params.detectedCurrencies.length > 1 ||
    params.unsupportedDetectedCurrencies.length > 0;

  const reviewReasons: string[] = [];

  const items = params.items.map((item) => {
    const next: ParsedOrderItemForValidation = { ...item };
    const serviceName =
      String(next.serviceName || "Unbekannte Leistung").trim() ||
      "Unbekannte Leistung";
    const unitKey = normalizeCompare(next.unit || "");
    const reviewText = [
      next.unit,
      next.description,
      next.sourceText,
      next.evidence,
      next.reviewReason,
    ]
      .filter(Boolean)
      .join(" ");
    const reviewKey = normalizeCompare(reviewText);
    const itemDetectedCurrency = normalizeCurrency(
      next.detectedCurrency || null,
    );

    const unitMissingOrUnclear =
      unitKey.includes("pruefen") ||
      unitKey.includes("prüfen") ||
      unitKey === "unklar" ||
      unitKey === "unknown" ||
      unitKey === "unbekannt" ||
      reviewKey.includes("einheit fehlt") ||
      reviewKey.includes("unit missing") ||
      String(next.reviewReason || "").startsWith("unit_missing_in_text:") ||
      String(next.reviewReason || "").startsWith("unit_mismatch:");

    const priceMissingOrUnclear =
      String(next.reviewReason || "").startsWith("price_unclear:") ||
      reviewKey.includes("preis fehlt") ||
      reviewKey.includes("preis unklar") ||
      reviewKey.includes("price missing") ||
      reviewKey.includes("price unclear");

    const unsupportedCurrencyBlocked =
      params.unsupportedDetectedCurrencies.length > 0 &&
      (!itemDetectedCurrency ||
        (itemDetectedCurrency !== "CHF" && itemDetectedCurrency !== "EUR"));
    const mixedCurrencyItemBlocked =
      params.detectedCurrencies.length > 1 &&
      (!itemDetectedCurrency || itemDetectedCurrency !== params.finalCurrency);
    const genericCurrencyReviewBlocked =
      String(next.reviewReason || "") === "currency_review" &&
      (!itemDetectedCurrency || itemDetectedCurrency !== params.finalCurrency);

    const currencyBlocked =
      unsupportedCurrencyBlocked ||
      mixedCurrencyItemBlocked ||
      Boolean(
        itemDetectedCurrency && itemDetectedCurrency !== params.finalCurrency,
      ) ||
      String(next.reviewReason || "").startsWith("item_currency_mismatch:") ||
      String(next.reviewReason || "").startsWith("currency_conflict_item:") ||
      genericCurrencyReviewBlocked;

    const amountBlocked =
      unitMissingOrUnclear ||
      priceMissingOrUnclear ||
      currencyBlocked ||
      (!isFlatUnit(next.unit) && Number(next.quantity || 0) <= 0) ||
      Number(next.unitPrice || 0) <= 0;

    if (!amountBlocked) return next;

    next.needsReview = true;
    next.totalPrice = 0;

    if (currencyBlocked) {
      // Hart blockieren: Bei Mischwährung darf keine Position als sichere
      // EUR/CHF-Summe weiterlaufen. Menge und Einheit bleiben als Hinweis
      // sichtbar, aber der Preis zählt nicht in Netto/MwSt/Total.
      next.unitPrice = 0;
      if (!next.reviewReason || next.reviewReason === "currency_review") {
        next.reviewReason =
          itemDetectedCurrency && itemDetectedCurrency !== params.finalCurrency
            ? `item_currency_mismatch:${serviceName}:${itemDetectedCurrency}:${params.finalCurrency}`
            : `currency_conflict_item:${serviceName}:${itemDetectedCurrency || "UNKNOWN"}:${params.finalCurrency}`;
      }
      reviewReasons.push(
        "currency_review",
        next.reviewReason ||
          `currency_conflict_item:${serviceName}:UNKNOWN:${params.finalCurrency}`,
      );
      return next;
    }

    if (unitMissingOrUnclear) {
      if (!unitKey.includes("pruefen") && !unitKey.includes("prüfen")) {
        next.unit = "Einheit prüfen";
      }
      if (!next.reviewReason)
        next.reviewReason = `unit_missing_in_text:${serviceName}`;
      reviewReasons.push(
        `unit_missing_in_text:${serviceName}`,
        `unit_mismatch:${serviceName}:Unklar:${next.unit || "Einheit prüfen"}:0`,
        "amount_review",
      );
      return next;
    }

    if (priceMissingOrUnclear || Number(next.unitPrice || 0) <= 0) {
      next.unitPrice = 0;
      if (!next.reviewReason)
        next.reviewReason = `price_unclear:${serviceName}`;
      reviewReasons.push(`price_unclear:${serviceName}`, "unit_price_review");
      return next;
    }

    if (!isFlatUnit(next.unit) && Number(next.quantity || 0) <= 0) {
      next.quantity = 0;
      if (!next.reviewReason) next.reviewReason = "quantity_review";
      reviewReasons.push("quantity_review");
    }

    return next;
  });

  return { items, reviewReasons: unique(reviewReasons) };
}

function splitLineLocalEvidenceSegments(value?: string | null): string[] {
  const source = normalizeText(value);
  if (!source) return [];

  return unique(
    source
      .split(/\n+|;|(?<=[.!?])\s+/g)
      .map((segment) => normalizeText(segment))
      .filter((segment) => segment.length >= 6 && segment.length <= 220),
  );
}

function parseLineLocalMeasuredPrice(
  line: string,
  fallbackCurrency: IntakeCurrency,
): {
  quantity: number;
  unit: string;
  unitType: string;
  unitPrice: number;
  currency: string | null;
} | null {
  const source = normalizeText(line);
  if (!source) return null;

  const quantityMatch = source.match(
    new RegExp(`\\b(${QUANTITY_NUMBER_OR_WORD})\\s*(${UNIT_WORDS})(?=\\b|\\s|[.,;:!?)])`, "i"),
  );
  const quantity = parseQuantityNumber(quantityMatch?.[1]);
  const unitType = unitTypeFromText(quantityMatch?.[2]);
  if (!quantity || quantity <= 0 || !unitType) return null;

  const unitPrice = findExplicitUnitPriceInLine(source, fallbackCurrency);
  if (!unitPrice || unitPrice.amount <= 0) return null;
  if (unitPrice.unitType && unitPrice.unitType !== unitType) return null;

  const unit = unitTypeToDisplayUnit(unitType);
  if (!unit) return null;

  return {
    quantity,
    unit,
    unitType,
    unitPrice: unitPrice.amount,
    currency: unitPrice.currency || fallbackCurrency,
  };
}

function itemMatchesLineLocalSegment(
  item: ParsedOrderItemForValidation,
  segment: string,
): boolean {
  const segmentKey = normalizeCompare(segment);
  if (!segmentKey) return false;

  const itemKey = normalizeCompare(item.serviceName);
  if (itemKey && segmentKey.includes(itemKey)) return true;

  const tokens = meaningfulServiceTokens(item.serviceName);
  if (tokens.length === 0) return true;

  return tokens.some((token) => segmentKey.includes(token));
}

function applyLineLocalMeasuredEvidenceGuard(
  items: ParsedOrderItemForValidation[],
  finalCurrency: IntakeCurrency,
): ParsedOrderItemForValidation[] {
  return items.map((item) => {
    const evidenceSegments = unique([
      ...splitLineLocalEvidenceSegments(item.sourceText),
      ...splitLineLocalEvidenceSegments(item.evidence),
      ...splitLineLocalEvidenceSegments(item.description),
    ]);

    const segment = evidenceSegments.find((candidate) =>
      itemMatchesLineLocalSegment(item, candidate),
    );
    if (!segment) return item;

    const parsed = parseLineLocalMeasuredPrice(segment, finalCurrency);
    if (!parsed) return item;

    const supportedCurrency =
      parsed.currency === "CHF" || parsed.currency === "EUR";
    if (supportedCurrency && parsed.currency !== finalCurrency) {
      return {
        ...item,
        unitPrice: 0,
        totalPrice: 0,
        detectedCurrency: parsed.currency,
        needsReview: true,
        reviewReason:
          item.reviewReason ||
          `item_currency_mismatch:${item.serviceName}:${parsed.currency}:${finalCurrency}`,
      };
    }

    const repaired: ParsedOrderItemForValidation = {
      ...item,
      quantity: parsed.quantity,
      unit: parsed.unit,
      unitPrice: parsed.unitPrice,
      detectedCurrency:
        parsed.currency || item.detectedCurrency || finalCurrency,
      sourceText: item.sourceText || segment,
      evidence: item.evidence || segment,
    };

    repaired.totalPrice = calculateSafeLineTotal(repaired);

    const reason = repaired.reviewReason || "";
    if (
      repaired.totalPrice > 0 &&
      (reason.startsWith("price_unclear:") ||
        reason === "unit_price_review" ||
        reason === "quantity_review" ||
        reason.startsWith("price_repaired_from_text:"))
    ) {
      repaired.needsReview = false;
      repaired.reviewReason = null;
    }

    return repaired;
  });
}

function lineSegmentContainsNumberValue(
  segment: string,
  value: number,
): boolean {
  if (!Number.isFinite(value) || value <= 0) return false;

  const normalizedValue = String(roundMoney(value)).replace(/\.0+$/, "");
  const alternatives = new Set<string>([
    normalizedValue,
    normalizedValue.replace(".", ","),
  ]);

  if (Number.isInteger(value)) {
    alternatives.add(String(Math.trunc(value)));
  }

  const source = normalizeText(segment).replace(/'/g, "");
  return Array.from(alternatives).some((candidate) => {
    if (!candidate) return false;
    const escaped = candidate.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(^|[^0-9])${escaped}([^0-9]|$)`, "i").test(source);
  });
}

function bestMeasuredEvidenceKeyForDedupe(
  item: ParsedOrderItemForValidation,
): string {
  const quantity = roundMoney(Number(item.quantity || 0));
  const unitPrice = roundMoney(Number(item.unitPrice || 0));

  const segments = unique([
    ...splitLineLocalEvidenceSegments(item.sourceText),
    ...splitLineLocalEvidenceSegments(item.evidence),
    ...splitLineLocalEvidenceSegments(item.description),
  ]).filter((segment) => {
    return (
      lineSegmentContainsNumberValue(segment, quantity) &&
      lineSegmentContainsNumberValue(segment, unitPrice)
    );
  });

  if (segments.length > 0) {
    return normalizeCompare(segments.sort((a, b) => a.length - b.length)[0]);
  }

  return normalizeCompare(
    item.sourceText || item.evidence || item.description || "",
  );
}

function sameEvidenceQuantityPriceKey(
  item: ParsedOrderItemForValidation,
): string | null {
  const quantity = roundMoney(Number(item.quantity || 0));
  const unitPrice = roundMoney(Number(item.unitPrice || 0));
  if (quantity <= 0 || unitPrice <= 0) return null;

  const sourceKey = bestMeasuredEvidenceKeyForDedupe(item);
  if (!sourceKey || sourceKey.length < 8 || sourceKey.length > 260) return null;

  const unitType = unitTypeFromDisplayUnit(item.unit) || "unknown";

  // Currency is intentionally not part of this duplicate-split key. In mixed
  // or partially repaired rows, one artifact can have detectedCurrency unset
  // while the duplicate row carries CHF/EUR. Same measured evidence + same
  // quantity + same price + same unit is the safer signal.
  return [sourceKey, quantity, unitPrice, unitType].join("|");
}

function sameEvidenceUnitPriceKey(
  item: ParsedOrderItemForValidation,
): string | null {
  const unitPrice = roundMoney(Number(item.unitPrice || 0));
  if (unitPrice <= 0) return null;

  const sourceKey = bestMeasuredEvidenceKeyForDedupe(item);
  if (!sourceKey || sourceKey.length < 8 || sourceKey.length > 260) return null;

  const unitType = unitTypeFromDisplayUnit(item.unit) || "unknown";
  return [sourceKey, unitPrice, unitType].join("|");
}

function itemQuantityIsPresentInOwnEvidence(
  item: ParsedOrderItemForValidation,
): boolean {
  const quantity = roundMoney(Number(item.quantity || 0));
  if (quantity <= 0) return false;

  const segments = unique([
    ...splitLineLocalEvidenceSegments(item.sourceText),
    ...splitLineLocalEvidenceSegments(item.evidence),
    ...splitLineLocalEvidenceSegments(item.description),
  ]);

  return segments.some((segment) =>
    lineSegmentContainsNumberValue(segment, quantity),
  );
}

function sameEvidenceSplitKeepScore(
  item: ParsedOrderItemForValidation,
): number {
  let score = serviceNameQualityScore(item.serviceName);

  // Structural signal, not service vocabulary: keep the row whose displayed
  // quantity is actually present in its own evidence line. This prevents
  // duplicated KI split artifacts from inflating 42 to 126 while still keeping
  // true multi-number lines untouched.
  if (itemQuantityIsPresentInOwnEvidence(item)) score += 220;

  if (Number(item.unitPrice || 0) > 0) score += 20;
  if (Number(item.totalPrice || 0) > 0) score += 10;
  if (normalizeCompare(item.serviceName) === "unbekannte leistung")
    score -= 120;

  return score;
}

function chooseBestSameEvidenceSplitItem(
  group: ParsedOrderItemForValidation[],
): ParsedOrderItemForValidation {
  return [...group].sort(
    (a, b) => sameEvidenceSplitKeepScore(b) - sameEvidenceSplitKeepScore(a),
  )[0];
}

function removeSameEvidenceQuantityPriceSplitArtifacts(
  items: ParsedOrderItemForValidation[],
): ParsedOrderItemForValidation[] {
  const exactGroups = new Map<string, ParsedOrderItemForValidation[]>();

  for (const item of items) {
    const key = sameEvidenceQuantityPriceKey(item);
    if (!key) continue;
    const list = exactGroups.get(key) || [];
    list.push(item);
    exactGroups.set(key, list);
  }

  const toRemove = new Set<ParsedOrderItemForValidation>();

  for (const group of exactGroups.values()) {
    if (group.length <= 1) continue;

    // Structural Prüfer: same evidence + same quantity + same price + same unit
    // means the LLM split one customer line into several positions. Keep the
    // strongest row only. No service-word list; the LLM remains responsible for
    // semantic classification, this pass only removes duplicate evidence rows.
    const keep = chooseBestSameEvidenceSplitItem(group);

    for (const item of group) {
      if (item !== keep) toRemove.add(item);
    }
  }

  const afterExact = items.filter((item) => !toRemove.has(item));
  const looseGroups = new Map<string, ParsedOrderItemForValidation[]>();

  for (const item of afterExact) {
    const key = sameEvidenceUnitPriceKey(item);
    if (!key) continue;
    const list = looseGroups.get(key) || [];
    list.push(item);
    looseGroups.set(key, list);
  }

  for (const group of looseGroups.values()) {
    if (group.length <= 1) continue;

    const withQuantityInEvidence = group.filter((item) =>
      itemQuantityIsPresentInOwnEvidence(item),
    );

    // If one same-evidence/same-price group has one row with a local quantity
    // and other rows with quantities not present in that line, those other rows
    // are artifacts. This is the Albis class of bug, solved structurally:
    // same customer line + same unit price + same unit, but inflated/foreign
    // quantity on a duplicate row.
    if (
      withQuantityInEvidence.length >= 1 &&
      withQuantityInEvidence.length < group.length
    ) {
      const keep = chooseBestSameEvidenceSplitItem(withQuantityInEvidence);
      for (const item of group) {
        if (item !== keep) toRemove.add(item);
      }
      continue;
    }

    // When all duplicates have the same local quantity evidence, still collapse
    // them to the strongest semantic row. This catches two names for the exact
    // same measured line without relying on any fixed service vocabulary.
    const quantitySet = new Set(
      group.map((item) => roundMoney(Number(item.quantity || 0))),
    );
    if (quantitySet.size === 1) {
      const keep = chooseBestSameEvidenceSplitItem(group);
      for (const item of group) {
        if (item !== keep) toRemove.add(item);
      }
    }
  }

  return items.filter((item) => !toRemove.has(item));
}

function alphaTokensBeforeFirstNumber(value?: string | null): string[] {
  const source = normalizeCompare(value || "");
  if (!source) return [];
  const beforeNumber = source.split(/\b\d+(?:[.,]\d+)?\b/)[0] || source;
  return beforeNumber
    .split(/\s+/g)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3)
    .filter(
      (token) =>
        !/^(?:ca|circa|etwa|ungefaehr|ungefahr|ungefähr|bitte|noch|plus|und|mit|der|die|das|im|in|am|an|zu|zum|zur)$/.test(
          token,
        ),
    );
}

function primaryEvidenceLineForAmount(
  item: ParsedOrderItemForValidation,
): string {
  const quantity = roundMoney(Number(item.quantity || 0));
  const unitPrice = roundMoney(Number(item.unitPrice || 0));
  const candidates = unique([
    ...splitLineLocalEvidenceSegments(item.sourceText),
    ...splitLineLocalEvidenceSegments(item.evidence),
    ...splitLineLocalEvidenceSegments(item.description),
  ]);

  const withBothNumbers = candidates.filter(
    (segment) =>
      lineSegmentContainsNumberValue(segment, quantity) &&
      lineSegmentContainsNumberValue(segment, unitPrice),
  );

  if (withBothNumbers.length > 0) {
    return withBothNumbers.sort((a, b) => a.length - b.length)[0];
  }

  const withAnyNumber = candidates.filter(
    (segment) =>
      lineSegmentContainsNumberValue(segment, quantity) ||
      lineSegmentContainsNumberValue(segment, unitPrice),
  );

  if (withAnyNumber.length > 0) {
    return withAnyNumber.sort((a, b) => a.length - b.length)[0];
  }

  return String(
    item.sourceText || item.evidence || item.description || "",
  ).trim();
}

function strictSameEvidenceAmountKey(
  item: ParsedOrderItemForValidation,
): string | null {
  const quantity = roundMoney(Number(item.quantity || 0));
  const unitPrice = roundMoney(Number(item.unitPrice || 0));
  if (
    !Number.isFinite(quantity) ||
    !Number.isFinite(unitPrice) ||
    quantity <= 0 ||
    unitPrice <= 0
  ) {
    return null;
  }

  const evidenceLine = primaryEvidenceLineForAmount(item);
  const evidenceKey = normalizeCompare(evidenceLine);
  if (!evidenceKey || evidenceKey.length < 8) return null;

  return [evidenceKey, quantity, unitPrice].join("|");
}

function scoreDuplicateEvidenceKeeper(
  item: ParsedOrderItemForValidation,
  sourceLine: string,
  index: number,
): number {
  const serviceKey = normalizeCompare(item.serviceName);
  const beforeTokens = alphaTokensBeforeFirstNumber(sourceLine);
  const firstToken = beforeTokens[0] || "";
  const lastToken = beforeTokens[beforeTokens.length - 1] || "";
  let score = 1000 - index; // stable tie-breaker: keep original order

  if (lastToken && serviceKey.includes(lastToken)) score += 80;
  if (firstToken && serviceKey.includes(firstToken)) score += 20;
  if (
    beforeTokens.length >= 2 &&
    firstToken &&
    serviceKey === `${firstToken} reinigen`
  )
    score -= 40;
  if (normalizeCompare(item.serviceName) === "unbekannte leistung")
    score -= 100;
  if (Number(item.totalPrice || 0) > 0) score += 10;
  if (!item.needsReview) score += 5;
  return score;
}

function removeHardSameEvidenceAmountDuplicates(
  items: ParsedOrderItemForValidation[],
): ParsedOrderItemForValidation[] {
  const groups = new Map<
    string,
    Array<{
      item: ParsedOrderItemForValidation;
      index: number;
      sourceLine: string;
    }>
  >();

  items.forEach((item, index) => {
    const key = strictSameEvidenceAmountKey(item);
    if (!key) return;
    const sourceLine = primaryEvidenceLineForAmount(item);
    const list = groups.get(key) || [];
    list.push({ item, index, sourceLine });
    groups.set(key, list);
  });

  const remove = new Set<ParsedOrderItemForValidation>();

  for (const group of groups.values()) {
    if (group.length <= 1) continue;

    const keep = group
      .slice()
      .sort(
        (a, b) =>
          scoreDuplicateEvidenceKeeper(b.item, b.sourceLine, b.index) -
          scoreDuplicateEvidenceKeeper(a.item, a.sourceLine, a.index),
      )[0];

    for (const entry of group) {
      if (entry !== keep) remove.add(entry.item);
    }
  }

  return items.filter((item) => !remove.has(item));
}

type UnitlessQuantityPriceEvidenceLine = {
  line: string;
  quantity: number;
  unitPrice: number;
  currency: string | null;
};

function extractUnitlessQuantityPriceEvidenceLines(
  originalText: string,
  finalCurrency: IntakeCurrency,
): UnitlessQuantityPriceEvidenceLine[] {
  const lines = normalizeText(preferredSemanticLineSourceV17_41(originalText))
    .split(/\n+|;|\s+•\s+|\s+\|\s+/g)
    .map((line) =>
      normalizeText(line)
        .replace(/^\s*(?:[-–—•]+|\d+[)])\s*/, "")
        .trim(),
    )
    .filter(Boolean)
    .filter((line) => !/^\s*\[?\s*(?:titel|title)\s*:/i.test(line));

  const result: UnitlessQuantityPriceEvidenceLine[] = [];
  const seen = new Set<string>();

  for (const line of lines) {
    const unitPrice = findExplicitUnitPriceInLine(line, finalCurrency);
    if (
      !unitPrice ||
      unitPrice.currency !== finalCurrency ||
      unitPrice.amount <= 0
    )
      continue;

    const beforePrice = line.slice(0, Math.max(0, unitPrice.index || 0));
    if (!beforePrice.trim()) continue;

    // This guard is only for unitless quantity/price lines like
    // "Lagerraum Boden 42 à CHF 7". Measured lines such as
    // "34 m2 à 7 CHF" are handled by the measured-line guards.
    if (
      new RegExp(`\\b${QUANTITY_NUMBER_OR_WORD}\\s*${UNIT_WORDS}\\b`, "i").test(
        beforePrice,
      )
    ) {
      continue;
    }

    const quantityMatches = Array.from(
      beforePrice.matchAll(
        new RegExp(`\\b(${QUANTITY_NUMBER_OR_WORD})\\b`, "gi"),
      ),
    );
    if (quantityMatches.length === 0) continue;

    const quantity = parseQuantityNumber(
      quantityMatches[quantityMatches.length - 1]?.[1],
    );
    if (!quantity || quantity <= 0) continue;

    const key = [
      normalizeCompare(line),
      roundMoney(quantity),
      roundMoney(unitPrice.amount),
      unitPrice.currency,
    ].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({
      line,
      quantity: roundMoney(quantity),
      unitPrice: roundMoney(unitPrice.amount),
      currency: unitPrice.currency,
    });
  }

  return result;
}

function itemIsUnitlessReviewCandidate(
  item: ParsedOrderItemForValidation,
): boolean {
  const unitKey = normalizeCompare(item.unit || "");
  const reason = String(item.reviewReason || "");
  return (
    !isFlatUnit(item.unit) &&
    (!unitTypeFromDisplayUnit(item.unit) ||
      unitKey.includes("pruefen") ||
      unitKey.includes("prüfen") ||
      unitKey.includes("unklar") ||
      reason.startsWith("unit_missing_in_text:") ||
      reason.startsWith("unit_mismatch:"))
  );
}

function itemLikelyBelongsToEvidenceLine(
  item: ParsedOrderItemForValidation,
  line: string,
): boolean {
  const lineKey = normalizeCompare(line);
  const itemEvidence = normalizeCompare(
    [item.sourceText, item.evidence, item.description]
      .filter(Boolean)
      .join(" "),
  );
  if (
    itemEvidence &&
    (itemEvidence.includes(lineKey) || lineKey.includes(itemEvidence))
  )
    return true;

  const tokens = meaningfulServiceTokens(item.serviceName);
  if (tokens.length === 0) return false;
  return tokens.some((token) => lineKey.includes(token));
}

function removeUnitlessSameEvidenceSplitArtifacts(
  items: ParsedOrderItemForValidation[],
  originalText: string,
  finalCurrency: IntakeCurrency,
): ParsedOrderItemForValidation[] {
  const evidenceLines = extractUnitlessQuantityPriceEvidenceLines(
    originalText,
    finalCurrency,
  );
  if (evidenceLines.length === 0) return items;

  const removeIndexes = new Set<number>();

  for (const evidence of evidenceLines) {
    const candidates = items
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => {
        if (!itemIsUnitlessReviewCandidate(item)) return false;
        if (Math.abs(Number(item.quantity || 0) - evidence.quantity) >= 0.001)
          return false;
        if (Math.abs(Number(item.unitPrice || 0) - evidence.unitPrice) >= 0.01)
          return false;
        return itemLikelyBelongsToEvidenceLine(item, evidence.line);
      });

    if (candidates.length <= 1) continue;

    const keep = candidates
      .slice()
      .sort(
        (a, b) =>
          scoreDuplicateEvidenceKeeper(b.item, evidence.line, b.index) -
          scoreDuplicateEvidenceKeeper(a.item, evidence.line, a.index),
      )[0];

    for (const candidate of candidates) {
      if (candidate.index !== keep.index) removeIndexes.add(candidate.index);
    }
  }

  if (removeIndexes.size === 0) return items;
  return items.filter((_, index) => !removeIndexes.has(index));
}

function measuredExplicitMatchesItemStrict(
  item: ParsedOrderItemForValidation,
  explicit: ExplicitServiceLineItem,
): boolean {
  const explicitSource = normalizeCompare(
    explicit.sourceText || explicit.evidence || explicit.description || "",
  );
  const itemSource = normalizeCompare(
    [item.sourceText, item.evidence, item.description]
      .filter(Boolean)
      .join(" "),
  );
  if (
    explicitSource &&
    itemSource &&
    (itemSource.includes(explicitSource) || explicitSource.includes(itemSource))
  ) {
    return true;
  }

  const itemName = normalizeCompare(item.serviceName);
  const explicitName = normalizeCompare(explicit.serviceName);
  if (
    itemName &&
    explicitName &&
    (itemName === explicitName ||
      itemName.includes(explicitName) ||
      explicitName.includes(itemName))
  ) {
    return true;
  }

  const itemTokens = meaningfulServiceTokens(item.serviceName);
  const explicitTokens = meaningfulServiceTokens(explicit.serviceName);
  const shared = itemTokens.filter((token) => explicitTokens.includes(token));
  if (shared.length > 0) return true;

  const explicitLineTokens = alphaTokensBeforeFirstNumber(
    explicit.sourceText || explicit.evidence || explicit.description || "",
  );
  return explicitLineTokens.some((token) => itemName.includes(token));
}

function clearResolvedNumericReview(
  item: ParsedOrderItemForValidation,
): ParsedOrderItemForValidation {
  const reason = item.reviewReason || "";
  const clearable =
    reason.startsWith("price_unclear:") ||
    reason.startsWith("price_repaired_from_text:") ||
    reason === "unit_price_review" ||
    reason === "quantity_review";

  if (!clearable) return item;
  if (Number(item.quantity || 0) <= 0 || Number(item.unitPrice || 0) <= 0)
    return item;
  if (!isFlatUnit(item.unit) && !unitTypeFromDisplayUnit(item.unit))
    return item;

  return { ...item, needsReview: false, reviewReason: null };
}

function applyEvidenceBoundMeasuredLineRepair(
  items: ParsedOrderItemForValidation[],
  originalText: string,
  finalCurrency: IntakeCurrency,
): { items: ParsedOrderItemForValidation[]; reviewReasons: string[] } {
  const explicitItems = extractHardMeasuredLineItemsFromRawText(
    originalText,
    finalCurrency,
  );
  if (explicitItems.length === 0) return { items, reviewReasons: [] };

  const reviewReasons: string[] = [];
  const next = items.slice();

  for (const explicit of explicitItems) {
    const explicitUnitType = unitTypeFromDisplayUnit(explicit.unit);
    const explicitQuantity = Number(explicit.quantity || 0);
    const explicitPrice = Number(explicit.unitPrice || 0);

    const existingIndex = next.findIndex((item) =>
      measuredExplicitMatchesItemStrict(item, explicit),
    );

    if (existingIndex >= 0) {
      const before = next[existingIndex];
      const changed =
        unitTypeFromDisplayUnit(before.unit) !== explicitUnitType ||
        Math.abs(Number(before.quantity || 0) - explicitQuantity) >= 0.001 ||
        Math.abs(Number(before.unitPrice || 0) - explicitPrice) >= 0.01;

      const repaired: ParsedOrderItemForValidation = clearResolvedNumericReview(
        {
          ...before,
          // Zahlen kommen immer aus der Beweiszeile. Den Namen behalten wir nur,
          // wenn er fachlich mindestens so stark ist wie der Name aus derselben
          // Kundenzeile. Damit bleibt die KI semantisch führend, aber der Prüfer
          // verhindert, dass eine Nachbarzeile wie "Fenster Küche 3 stk..." am
          // vorherigen Boden-Namen hängen bleibt.
          serviceName:
            isWeakExplicitServiceName(before.serviceName) ||
            shouldPreferExplicitServiceName(before, explicit)
              ? explicit.serviceName
              : before.serviceName,
          description: before.description || explicit.description,
          quantity: explicit.quantity,
          unit: explicit.unit,
          unitPrice: explicit.unitPrice,
          totalPrice: calculateSafeLineTotal(explicit),
          sourceText: explicit.sourceText,
          evidence: explicit.evidence,
          detectedCurrency:
            explicit.detectedCurrency ||
            before.detectedCurrency ||
            finalCurrency,
        },
      );

      next[existingIndex] = repaired;
      if (changed)
        reviewReasons.push(
          `evidence_bound_line_repaired:${explicit.serviceName}`,
        );
      continue;
    }

    next.push({ ...explicit, totalPrice: calculateSafeLineTotal(explicit) });
    reviewReasons.push(`evidence_bound_line_added:${explicit.serviceName}`);
  }

  return {
    items: removeHardSameEvidenceAmountDuplicates(next),
    reviewReasons: unique(reviewReasons),
  };
}

function applyFailClosedSuspiciousNumericGuard(
  items: ParsedOrderItemForValidation[],
  finalCurrency: IntakeCurrency,
): { items: ParsedOrderItemForValidation[]; reviewReasons: string[] } {
  const reviewReasons: string[] = [];

  const guarded = items.map((item) => {
    if (isFlatUnit(item.unit)) return item;
    const evidenceLine = primaryEvidenceLineForAmount(item);
    const parsed = parseLineLocalMeasuredPrice(evidenceLine, finalCurrency);
    if (!parsed) return item;

    const sameQuantity =
      Math.abs(Number(item.quantity || 0) - parsed.quantity) < 0.001;
    const samePrice =
      Math.abs(Number(item.unitPrice || 0) - parsed.unitPrice) < 0.01;
    const sameUnit = unitTypeFromDisplayUnit(item.unit) === parsed.unitType;

    if (sameQuantity && samePrice && sameUnit) return item;

    // If the evidence line clearly contains a measured quantity and unit price,
    // the line wins. This prevents expensive errors like 34×34 instead of 34×7.
    const repaired: ParsedOrderItemForValidation = clearResolvedNumericReview({
      ...item,
      quantity: parsed.quantity,
      unit: parsed.unit,
      unitPrice: parsed.unitPrice,
      totalPrice: roundMoney(parsed.quantity * parsed.unitPrice),
      detectedCurrency:
        parsed.currency || item.detectedCurrency || finalCurrency,
      sourceText: item.sourceText || evidenceLine,
      evidence: item.evidence || evidenceLine,
    });
    reviewReasons.push(`evidence_numeric_repaired:${item.serviceName}`);
    return repaired;
  });

  return { items: guarded, reviewReasons: unique(reviewReasons) };
}

function forceAppendMissingHardMeasuredLineItems(
  originalText: string,
  items: ParsedOrderItemForValidation[],
  finalCurrency: IntakeCurrency,
): ParsedOrderItemForValidation[] {
  const explicitItems = extractHardMeasuredLineItemsFromRawText(
    originalText,
    finalCurrency,
  );
  if (explicitItems.length === 0) return items;

  const next = items.slice();

  for (const explicit of explicitItems) {
    const explicitSource = normalizeCompare(
      explicit.sourceText || explicit.evidence || explicit.description || "",
    );
    const explicitUnitType = unitTypeFromDisplayUnit(explicit.unit);
    const explicitQuantity = Number(explicit.quantity || 0);
    const explicitPrice = Number(explicit.unitPrice || 0);

    const exactIndex = next.findIndex((item) => {
      const itemSource = normalizeCompare(
        item.sourceText || item.evidence || item.description || "",
      );
      const sameSource = Boolean(
        explicitSource &&
        itemSource &&
        (itemSource.includes(explicitSource) ||
          explicitSource.includes(itemSource)),
      );
      if (!sameSource) return false;
      const sameUnit = unitTypeFromDisplayUnit(item.unit) === explicitUnitType;
      const sameQuantity =
        Math.abs(Number(item.quantity || 0) - explicitQuantity) < 0.001;
      const samePrice =
        Math.abs(Number(item.unitPrice || 0) - explicitPrice) < 0.01;
      return sameUnit && sameQuantity && samePrice;
    });

    if (exactIndex >= 0) {
      next[exactIndex] = clearResolvedNumericReview({
        ...next[exactIndex],
        serviceName:
          isWeakExplicitServiceName(next[exactIndex].serviceName) ||
          shouldPreferExplicitServiceName(next[exactIndex], explicit)
            ? explicit.serviceName
            : next[exactIndex].serviceName || explicit.serviceName,
        unit: explicit.unit,
        quantity: explicit.quantity,
        unitPrice: explicit.unitPrice,
        totalPrice: calculateSafeLineTotal(explicit),
        sourceText: explicit.sourceText,
        evidence: explicit.evidence,
        detectedCurrency:
          explicit.detectedCurrency ||
          next[exactIndex].detectedCurrency ||
          finalCurrency,
      });
      continue;
    }

    const staleIndex = next.findIndex((item) => {
      const itemSource = normalizeCompare(
        item.sourceText || item.evidence || item.description || "",
      );
      return Boolean(
        explicitSource &&
        itemSource &&
        (itemSource.includes(explicitSource) ||
          explicitSource.includes(itemSource)),
      );
    });

    if (staleIndex >= 0) {
      next[staleIndex] = clearResolvedNumericReview({
        ...next[staleIndex],
        serviceName:
          isWeakExplicitServiceName(next[staleIndex].serviceName) ||
          shouldPreferExplicitServiceName(next[staleIndex], explicit)
            ? explicit.serviceName
            : next[staleIndex].serviceName || explicit.serviceName,
        description: next[staleIndex].description || explicit.description,
        unit: explicit.unit,
        quantity: explicit.quantity,
        unitPrice: explicit.unitPrice,
        totalPrice: calculateSafeLineTotal(explicit),
        sourceText: explicit.sourceText,
        evidence: explicit.evidence,
        detectedCurrency:
          explicit.detectedCurrency ||
          next[staleIndex].detectedCurrency ||
          finalCurrency,
      });
      continue;
    }

    next.push({
      ...explicit,
      totalPrice: calculateSafeLineTotal(explicit),
    });
  }

  return removeHardSameEvidenceAmountDuplicates(
    removeSameEvidenceQuantityPriceSplitArtifacts(next),
  );
}

function applyFinalEvidenceSafetyPass(
  items: ParsedOrderItemForValidation[],
  originalText: string,
  finalCurrency: IntakeCurrency,
): { items: ParsedOrderItemForValidation[]; reviewReasons: string[] } {
  const reviewReasons: string[] = [];

  const measuredRepair = applyEvidenceBoundMeasuredLineRepair(
    items,
    originalText,
    finalCurrency,
  );
  let next = measuredRepair.items;
  reviewReasons.push(...measuredRepair.reviewReasons);

  const numericGuard = applyFailClosedSuspiciousNumericGuard(
    next,
    finalCurrency,
  );
  next = numericGuard.items;
  reviewReasons.push(...numericGuard.reviewReasons);

  next = removeSameEvidenceQuantityPriceSplitArtifacts(next);
  next = removeHardSameEvidenceAmountDuplicates(next);
  next = dedupeUnsafeDuplicateItems(next);
  next = removeZeroReviewItemsCoveredByPricedItems(next);

  return { items: next, reviewReasons: unique(reviewReasons) };
}

export function validateAndRepairParsedOrderItems(
  input: IntakeValidationInput,
): IntakeValidationResult {
  const reviewReasons: string[] = [];
  const detectedCurrencies = detectCurrenciesInText(input.originalText);
  const supportedDetectedCurrencies = detectedCurrencies.filter(
    (currency): currency is IntakeCurrency =>
      currency === "CHF" || currency === "EUR",
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

  const hasGlobalUnclearPriceReference = hasStandaloneUnclearPriceReference(
    input.originalText,
  );

  let items = coverage.items.map((item) => {
    const quantity = Number(item.quantity || 0);
    const unitPrice = Number(item.unitPrice || 0);
    const next: ParsedOrderItemForValidation = {
      ...item,
      quantity: Number.isFinite(quantity) ? quantity : 0,
      unitPrice: Number.isFinite(unitPrice) ? unitPrice : 0,
    };

    const itemReasons: string[] = [];
    if (next.reviewReason) itemReasons.push(next.reviewReason);

    // Pauschalpreise haben fachlich keine Mengenberechnung. Für die UI und
    // die gespeicherte Summe setzen wir sie intern auf Menge 1, damit nicht
    // fälschlich "Menge prüfen" und Total CHF 0.00 entsteht.
    if (isFlatUnit(next.unit) && next.unitPrice > 0) {
      next.quantity = 1;
      if (
        next.reviewReason &&
        QUANTITY_REVIEW_REASON_PATTERN.test(next.reviewReason)
      ) {
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
        new RegExp(
          `\\b${QUANTITY_NUMBER_OR_WORD}\\s*${UNIT_WORDS}\\b`,
          "i",
        ).test(
          [next.sourceText, next.evidence, next.description]
            .filter(Boolean)
            .join(" "),
        )
      )
    ) {
      next.unit = "Pauschal";
      next.quantity = 1;
      next.unitPrice = explicitFlatPrice.amount;
      next.totalPrice = explicitFlatPrice.amount;
      if (
        next.reviewReason &&
        QUANTITY_REVIEW_REASON_PATTERN.test(next.reviewReason)
      ) {
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
      const supportedCurrency =
        explicitCurrency === "CHF" || explicitCurrency === "EUR";
      const canUseExplicitPrice =
        supportedCurrency && explicitCurrency === finalCurrency;

      if (canUseExplicitPrice) {
        if (
          Math.abs(Number(next.unitPrice || 0) - explicitUnitPrice.amount) >=
          0.01
        ) {
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
      itemReasons.push(
        `price_unclear:${next.serviceName}`,
        "unit_price_review",
      );
    }

    const safeTotal = calculateSafeLineTotal(next);
    next.totalPrice = safeTotal;

    if (next.unitPrice <= 0) itemReasons.push("unit_price_review");
    if (!isFlatUnit(next.unit) && next.quantity <= 0)
      itemReasons.push("quantity_review");
    if (safeTotal > 50000) itemReasons.push("total_unrealistic_check");

    if (itemReasons.length > 0) {
      next.needsReview = true;
      if (!next.reviewReason) next.reviewReason = itemReasons[0];
      reviewReasons.push(...itemReasons);
    }

    return next;
  });

  items = repairCommonMultilingualCleaningItems(
    input.originalText,
    items,
    finalCurrency,
  );

  const missingFlatItems = detectFlatPriceItems(
    input.originalText,
    items,
    finalCurrency,
  );
  if (missingFlatItems.length > 0) {
    items = [...missingFlatItems, ...items];
    reviewReasons.push("manual_flat_service_from_text");
  }

  items = addMissingStandaloneFlatLineItems(
    input.originalText,
    items,
    finalCurrency,
  );

  items = mergeRobustExplicitLineItems(
    input.originalText,
    items,
    finalCurrency,
  );
  items = mergeExplicitLineItemList(
    items,
    extractLooseExplicitServiceLineItems(input.originalText, finalCurrency),
  );

  items = removeItemsUsingForeignFlatPrice(
    input.originalText,
    items,
    finalCurrency,
  );
  items = removeFlatItemsDuplicatingTravelPriceWithoutOwnLine(
    input.originalText,
    items,
    finalCurrency,
  );
  items = normalizeParsedServiceNames(items);
  items = removeCompositeServiceNameArtifacts(items);
  items = dedupeUnsafeDuplicateItems(items);
  items = removeMeasuredFlatDuplicateArtifacts(items);
  items = removeFlatItemsDuplicatingMeasuredServiceWithoutOwnLine(
    input.originalText,
    items,
    finalCurrency,
  );
  items = removeUnpricedDuplicateServiceArtifacts(items);

  items = repairAmbiguousQuantityRangeItems(input.originalText, items).map(
    (item) => {
      if (!isFlatUnit(item.unit) || item.unitPrice <= 0) return item;

      const next = {
        ...item,
        quantity: 1,
        totalPrice: calculateSafeLineTotal({ ...item, quantity: 1 }),
      };

      if (
        next.reviewReason &&
        QUANTITY_REVIEW_REASON_PATTERN.test(next.reviewReason)
      ) {
        next.reviewReason = null;
        next.needsReview = false;
      }

      return next;
    },
  );

  const unclearGuard = applyUnclearPriceLineGuard(items, input.originalText);
  items = normalizeParsedServiceNames(unclearGuard.items);
  items = removeCompositeServiceNameArtifacts(items);
  items = removeFlatItemsDuplicatingMeasuredServiceWithoutOwnLine(
    input.originalText,
    items,
    finalCurrency,
  );
  items = removeUnpricedDuplicateServiceArtifacts(items);
  reviewReasons.push(...unclearGuard.reviewReasons);

  const unclearTravelRepair = repairUnclearTravelItems(
    input.originalText,
    items,
  );
  items = unclearTravelRepair.items;
  reviewReasons.push(...unclearTravelRepair.reviewReasons);

  items = removeSubsumedReviewOnlyItems(items);
  items = addMissingTravelFlatCostItems(
    input.originalText,
    items,
    finalCurrency,
  );
  items = normalizeParsedServiceNames(items);
  items = dedupeUnsafeDuplicateItems(items);
  items = mergeExplicitLineItemList(
    items,
    extractLooseExplicitServiceLineItems(input.originalText, finalCurrency),
  );
  items = normalizeParsedServiceNames(items);
  items = dedupeUnsafeDuplicateItems(items);
  items = removeUnknownItemsCoveredByNamedItems(items);
  items = removeZeroReviewItemsCoveredByPricedItems(items);
  items = removeWorksiteNameOnlyArtifacts(input.originalText, items);

  const hardExplicitGuard = applyHardExplicitItemConsistencyGuard(
    items,
    input.originalText,
    finalCurrency,
  );
  items = removeWorksiteNameOnlyArtifacts(
    input.originalText,
    cleanFinalServiceNameArtifacts(
      normalizeParsedServiceNames(hardExplicitGuard.items),
    ),
  );
  // Finaler Sicherheitsdurchlauf: Der harte Explicit-Guard kann nachgelagert
  // noch Review-/0-Preis-Artefakte erzeugen. Wenn dieselbe fachliche Leistung
  // bereits mit Preis und Menge vorhanden ist, darf keine zusätzliche
  // blockierende 0-Position im Auftrag bleiben.
  items = removeUnpricedDuplicateServiceArtifacts(items);
  items = dedupeUnsafeDuplicateItems(items);
  items = removeZeroReviewItemsCoveredByPricedItems(items);

  const explicitHourGuard = enforceExplicitMeasuredHourLineItems(
    input.originalText,
    items,
    finalCurrency,
  );
  items = explicitHourGuard.items;

  const hardMeasuredLineGuard = enforceHardMeasuredLineItemsFromRawText(
    input.originalText,
    items,
    finalCurrency,
  );
  items = hardMeasuredLineGuard.items;
  items = applyLineLocalMeasuredEvidenceGuard(items, finalCurrency);
  items = removeSameEvidenceQuantityPriceSplitArtifacts(items);

  reviewReasons.push(...hardExplicitGuard.reviewReasons);
  reviewReasons.push(...explicitHourGuard.reviewReasons);
  reviewReasons.push(...hardMeasuredLineGuard.reviewReasons);

  const unitlessQuantityPriceGuard = applyUnitlessQuantityPriceLineGuard(
    items,
    input.originalText,
  );
  items = unitlessQuantityPriceGuard.items;
  items = applyLineLocalMeasuredEvidenceGuard(items, finalCurrency);
  items = removeSameEvidenceQuantityPriceSplitArtifacts(items);
  reviewReasons.push(...unitlessQuantityPriceGuard.reviewReasons);

  const structuredFailClosedGuard = applyStructuredFailClosedValidation({
    items,
    finalCurrency,
    detectedCurrencies,
    unsupportedDetectedCurrencies,
  });
  items = structuredFailClosedGuard.items;
  reviewReasons.push(...structuredFailClosedGuard.reviewReasons);

  const finalBlockedLineTotalGuard = applyFinalBlockedLineTotalGuard({
    items,
    finalCurrency,
    detectedCurrencies,
    unsupportedDetectedCurrencies,
  });
  items = finalBlockedLineTotalGuard.items;
  reviewReasons.push(...finalBlockedLineTotalGuard.reviewReasons);

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
        reason.startsWith("item_currency_mismatch:") ||
        reason.startsWith("currency_conflict_item:")
      ) {
        return { ...item, needsReview: false, reviewReason: null };
      }
      return item;
    });
  }

  items = removeSameEvidenceQuantityPriceSplitArtifacts(
    applyLineLocalMeasuredEvidenceGuard(items, finalCurrency),
  );

  const finalEvidenceSafetyPass = applyFinalEvidenceSafetyPass(
    items,
    input.originalText,
    finalCurrency,
  );
  items = removeUnitlessSameEvidenceSplitArtifacts(
    finalEvidenceSafetyPass.items,
    input.originalText,
    finalCurrency,
  );
  items = forceAppendMissingHardMeasuredLineItems(
    input.originalText,
    items,
    finalCurrency,
  );
  items = removeFlatItemsDuplicatingTravelPriceWithoutOwnLine(
    input.originalText,
    items,
    finalCurrency,
  );
  items = normalizeParsedServiceNames(
    removeUnknownItemsCoveredByNamedItems(items),
  );
  items = normalizeHighGermanServiceNamesFromTranslatedTextV17_35(
    input.originalText,
    items,
  );
  items = removeOriginalTranslatedAmountDuplicatesV17_41(items);
  items = removeSameEvidenceQuantityPriceSplitArtifacts(items);
  items = removeHardSameEvidenceAmountDuplicates(items);

  const structuredGermanServiceSection = enforceStructuredGermanServiceSectionV17_43(
    input.originalText,
    items,
    finalCurrency,
  );
  items = preferLineLocalMeasuredServiceNamesV17_50(
    input.originalText,
    structuredGermanServiceSection.items,
    finalCurrency,
  );
  items = forceExactLineLocalMeasuredNamesV17_53(
    input.originalText,
    items,
    finalCurrency,
  );
  items = repairLineLocalStandaloneFlatServiceNamesV17_51(
    input.originalText,
    items,
    finalCurrency,
  );
  reviewReasons.push(...structuredGermanServiceSection.reviewReasons);

  reviewReasons.push(...finalEvidenceSafetyPass.reviewReasons);

  const finalReviewReasons = unique(reviewReasons)
    .filter(
      (reason) =>
        !reason.startsWith("item_repaired_from_same_text_line:") &&
        !reason.startsWith("item_added_from_same_text_line:") &&
        !reason.startsWith("explicit_hour_item_repaired_from_text:") &&
        !reason.startsWith("explicit_hour_item_added_from_text:") &&
        !reason.startsWith("hard_measured_line_repaired:") &&
        !reason.startsWith("hard_measured_line_added:") &&
        !reason.startsWith("evidence_bound_line_repaired:") &&
        !reason.startsWith("evidence_bound_line_added:") &&
        !reason.startsWith("evidence_numeric_repaired:"),
    )
    .filter((reason) => {
      if (!reason.startsWith("price_repaired_from_text:")) return true;
      return !hasResolvedCompleteItemForReason(items, reason);
    })
    .filter((reason) => {
      if (!reason.startsWith("unit_mismatch:")) return true;
      return !hasResolvedCompleteItemForReason(items, reason);
    })
    .filter((reason) => {
      if (!reason.startsWith("unit_mismatch:")) return true;
      const [, serviceName] = reason.split(":");
      return !priceUnclearServiceNames.has(normalizeCompare(serviceName));
    })
    .filter((reason) => {
      if (!reason.startsWith("price_unclear:")) return true;
      return !hasResolvedCompleteItemForReason(items, reason);
    })
    .filter((reason) => {
      if (reason !== "unit_price_review" && reason !== "quantity_review") {
        return true;
      }
      return hasOpenAmountReview(items);
    })
    .filter((reason) => {
      if (
        reason === "currency_review" ||
        reason === "currency_conflict" ||
        reason === "currency_unsupported" ||
        reason.startsWith("item_currency_mismatch:") ||
        reason.startsWith("currency_conflict_item:")
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
          reason.startsWith("item_currency_mismatch:") ||
          reason.startsWith("currency_conflict_item:"))
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
  /\b(ausführungsadresse|ausfuehrungsadresse|ausführende\s+adresse|ausfuehrende\s+adresse|ausführungsort|ausfuehrungsort|ausführung|ausfuehrung|arbeitsort|auftragsort|uftragsort|arbeitsadresse|einsatzort|baustellenadresse|baustelle|objektadresse|objekt|leistungsadresse|leistungsort|serviceadresse|montageadresse|reinigungsadresse|ort\s+der\s+ausführung|ort\s+der\s+ausfuehrung|adresse\s+vor\s+ort|adresse\s+wo\s+gearbeitet\s+wird|arbeiten\s+(?:bitte\s+)?(?:bei|beim|in|im)|arbeit\s+(?:bitte\s+)?(?:bei|beim|in|im)|work\s+address|job\s+site|job\s+address|service\s+address|site\s+address|location\s+of\s+work|adresse\s+de\s+travail|adresse\s+d[’']intervention|adresse\s+du\s+chantier|lieu\s+d[’']intervention|dirección\s+de\s+trabajo|direccion\s+de\s+trabajo|dirección\s+de\s+obra|direccion\s+de\s+obra|lugar\s+de\s+trabajo|indirizzo\s+di\s+lavoro|indirizzo\s+cantiere|luogo\s+di\s+intervento)\b/i;

const STOP_MARKER =
  /\b(rechnungsadresse|rechnung\s+an|rechnungskunde|rechnungsempfänger|rechnungsempfaenger|auftraggeber|besteller|zahler|factura|fatura|fattura|facture|kunde|kundendaten|kontakt\s+vor\s+ort|kontaktperson|ansprechperson|person\s+vor\s+ort|vor\s+ort\s+(?:ist|öffnet|oeffnet|macht|kommt)|zugang|hauswart|hausmeister|concierge|leistung|leistungen|preis|preise|kosten|telefon|tel\.?|e-mail|email|mail|bemerkung|bemerkungen|hinweis|hinweise|notiz|notizen|termin|datum|mwst|währung|waehrung|kundennachricht|whatsapp|titel|title)\b/i;

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
function parsePlzCity(value: string): {
  plz: string | null;
  city: string | null;
} {
  const text = cleanAddressLine(value);
  const match = text.match(
    /\b(\d{4,5})\s+([A-ZÄÖÜ][A-Za-zÄÖÜäöüß' .\-]{2,60})\b/,
  );
  if (!match) return { plz: null, city: null };

  const rawCity = match[2] || "";
  const city = rawCity
    .replace(EXECUTION_ADDRESS_MARKER, "")
    .replace(STOP_MARKER, "")
    .replace(
      /\b(ausführungsadresse|ausfuehrungsadresse|ausführende|ausfuehrende|adresse|arbeitsort|baustelle|objekt|ort\s+der\s+ausführung|ort\s+der\s+ausfuehrung)\b/gi,
      "",
    )
    // Cut accidental continuation text after a plausible city.
    .replace(
      /\b(leisting|leistung|leistungen|bitte|preis|preise|kosten|fenster|treppenhaus|reinigung|reinigen|farbreste|hecke|garage|tiefgarage|pauschal|arbeiten|kommen|melden|montieren|machen|erledigen|schneiden|streichen|entsorgen)\b.*$/gi,
      "",
    )
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
  /\b(liegenschaft|arbeitsort|arbeitsadresse|arbeit\s+(?:ist|isch|is|wird)|gearbeitet\s+wird|gemacht\s+(?:werden\s+muss|wird|werden)|machen\s+(?:wir|sie)|arbeiten|work\s+location|job\s+location|adresse\s+de\s+travail|lieu\s+du\s+travail|ort\s+der\s+arbeit|sondern\s+(?:in|im|bei|beim))\b/i;

function isLikelyServiceOrPriceLine(value: string): boolean {
  const text = normalizeCompare(value);
  if (!text) return false;

  const hasWorkVerb =
    /\b(reinigen|reinigung|putzen|schneiden|stutzen|entfernen|streichen|malen|maehen|mähen|montieren|demontieren|reparieren|liefern|entsorgen|entsorgung)\b/i.test(
      text,
    );
  const hasQtyOrPrice =
    /\b\d+(?:[.,]\d+)?\s*(?:stueck|stuck|stück|stk|quadratmeter|qm|m2|meter|stunde|stunden|std|h|tag|tage)\b/i.test(
      text,
    ) ||
    /\b(?:preis|ansatz|stutz|chf|eur|euro|usd|dollar|pauschal|pro|per|je)\b/i.test(
      text,
    );

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
    .split(/\b(?:bitte|please|kontakt|contact|contatto|contacter|melden|anrufen|whatsapp|sms|telefon|phone|hinweise?|notizen?|bemerkungen?|notes?|arbeitsbeginn|beginn|anwesenheit|anwesend|kinder|children|kein\s+hund|keine\s+hunde|befindet\s+sich\s+kein|hund\s+(?:vor\s+ort|anwesend|im|in)|lift|aufzug|rutschig|strom|kabel|kommen\s+sie|komm(?:en)?\s+erst|come\s+after|only\s+after|nur\s+nach|erst\s+nach|nicht\s+vor|guests?|gäste|auschecken|checkout)\b/i)[0]
    .replace(/[,;:.\s]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!candidate) return null;

  // Titel-Zeilen sind reine Auftrags-/Karten-Titel und niemals Objekt-/Ortsnamen.
  if (/^\s*\[?\s*(?:titel|title)\s*[:：].*\]?\s*$/i.test(candidate))
    return null;

  candidate = candidate
    .replace(
      /^\s*(?:um\s*)?\d{1,2}[:.]\d{2}\s*(?:uhr)?\s*(?:beim|bei|am|an|im|in)?\s*$/i,
      "",
    )
    .replace(/^\s*(?:beim|bei|am|an|im|in|um|uhr|m)\s*$/i, "")
    .trim();

  if (!candidate) return null;

  candidate = candidate
    .replace(
      /^.*?\bsondern\s+(?:in\s+der|in\s+dem|im|in|bei\s+der|beim|bei|bi\s+de|bi)\s+/i,
      "",
    )
    .replace(
      /^.*?\b(?:liegenschaft|objektadresse|objekt|baustelle|arbeitsort|arbeitsadresse|leistungsort|serviceadresse|job\s+site|job\s+location|work\s+location|lieu\s+du\s+travail)\b\s*(?:ist|isch|is|:)?\s*/i,
      "",
    )
    .replace(
      /^.*?\b(?:arbeit\s+(?:ist|isch|is)|gearbeitet\s+wird)\b\s*(?:aber\s+)?(?:drueben|drüben)?\s*(?:bei\s+der|beim|bei|bi\s+de|bi|in\s+der|in\s+dem|im|in)?\s*/i,
      "",
    )
    .replace(
      /^.*?\b(?:gemacht\s+(?:werden\s+muss|wird|werden)|machen\s+(?:wir|sie))\b\s*(?:es\s+)?(?:draussen|draußen|drinnen|hinten|vorne)?\s*(?:bei\s+der|beim|bei|bi\s+de|bi|in\s+der|in\s+dem|im|in)?\s*/i,
      "",
    )
    .replace(
      /^(?:es\s+(?:geht|goht)\s+um(?:s)?|ist|isch|is|aber|drueben|drüben|bei\s+der|beim|bei|bi\s+de|bi|in\s+der|in\s+dem|im|in|de|der|die|das)\s+/i,
      "",
    )
    .replace(/^[:\-–—]+\s*/, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!candidate) return null;

  const softSplit = candidate.split(
    /\b(?:liegenschaft|objekt|baustelle|arbeitsort|arbeitsadresse|leistungsort|sondern|gemacht\s+(?:werden\s+muss|wird|werden)|machen\s+(?:wir|sie))\b/i,
  );
  candidate = (softSplit[softSplit.length - 1] || candidate)
    .replace(
      /^(?:es\s+)?(?:draussen|draußen|drinnen|hinten|vorne)?\s*(?:bei\s+der|beim|bei|bi\s+de|bi|in\s+der|in\s+dem|im|in)?\s*/i,
      "",
    )
    .replace(
      /^(?:es\s+(?:geht|goht)\s+um(?:s)?|ist|isch|is|in\s+der|in\s+dem|im|in|bei\s+der|beim|bei|bi\s+de|bi|de|der|die|das)\s+/i,
      "",
    )
    .replace(/[,;:.]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();

  candidate = candidate
    .replace(
      /^\s*(?:um\s*)?\d{1,2}[:.]\d{2}\s*(?:uhr)?\s*(?:beim|bei|am|an|im|in)?\s*$/i,
      "",
    )
    .replace(/^\s*(?:beim|bei|am|an|im|in|um|uhr|m)\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim();

  if (
    /\b(kontakt\s+vor\s+ort|vor\s+ort\s+(?:ist|öffnet|oeffnet|macht|kommt)|öffnet\s+|oeffnet\s+|kontaktperson|ansprechperson|person\s+vor\s+ort|hauswart|hausmeister|hausdienst|concierge|tel\.?|telefon|handy|natel)\b/i.test(
      candidate,
    )
  ) {
    return null;
  }
  if (/\+?\d[\d\s()./-]{6,}\d/.test(candidate)) return null;

  return candidate || null;
}

function isSafeSiteNameCandidate(value?: string | null): boolean {
  const candidate = normalizeText(value || "");
  const key = normalizeCompare(candidate);
  if (!candidate || !key) return false;
  if (/^\s*\[?\s*(?:titel|title)\s*[:：].*\]?\s*$/i.test(candidate))
    return false;
  if (candidate.length < 3 || candidate.length > 80) return false;
  if (
    /^\s*(?:um\s*)?\d{1,2}[:.]\d{2}\s*(?:uhr)?\s*(?:beim|bei|am|an|im|in)?\s*$/i.test(
      candidate,
    )
  )
    return false;
  if (/\b\d{4,5}\b/.test(candidate)) return false;
  if (
    /\b\d+(?:[.,]\d+)?\s*(?:stueck|stuck|stück|stk|quadratmeter|qm|m2|meter|stunde|stunden|std|h|tag|tage)\b/i.test(
      key,
    )
  )
    return false;
  if (
    /\b(chf|franken|stutz|eur|euro|usd|dollar|preis|ansatz|pauschal|pro|per|je)\b/i.test(
      key,
    )
  )
    return false;
  if (
    /\b(kontakt\s+vor\s+ort|vor\s+ort\s+(?:ist|öffnet|oeffnet|macht|kommt)|öffnet\s+|oeffnet\s+|kontaktperson|ansprechperson|person\s+vor\s+ort|hauswart|hausmeister|hausdienst|concierge|tel\.?|telefon|handy|natel)\b/i.test(
      key,
    )
  )
    return false;
  if (/\+?\d[\d\s()./-]{6,}\d/.test(candidate)) return false;
  if (
    /\b(reinigen|reinigung|putzen|schneiden|stutzen|entfernen|streichen|malen|maehen|mähen|montieren|demontieren|reparieren|liefern|entsorgen|entsorgung)\b/i.test(
      key,
    )
  )
    return false;
  if (ADDRESS_WORD_PATTERN.test(candidate)) return false;
  if (STOP_MARKER.test(candidate)) return false;
  if (EXECUTION_ADDRESS_MARKER.test(candidate)) return false;
  if (
    /\b(hinweise?|notizen?|bemerkungen?|arbeitsbeginn|beginn|anwesenheit|anwesend|kinder|children|kein\s+hund|keine\s+hunde|befindet\s+sich\s+kein|hund\s+(?:vor\s+ort|anwesend|im|in)|lift|aufzug|rutschig|strom|kabel|whatsapp|sms|telefon|kontakt)\b/i.test(
      key,
    )
  )
    return false;

  const blocked = new Set([
    "ist",
    "isch",
    "is",
    "dort",
    "hier",
    "adresse",
    "nadresse",
    "n adresse",
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
  if (
    !EXECUTION_ADDRESS_MARKER.test(raw) &&
    !SOFT_EXECUTION_ADDRESS_LINE_PATTERN.test(raw)
  ) {
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

  const beforeStreet =
    raw.split(new RegExp(escapeRegExp(siteAddress), "i"))[0] || "";
  const siteNameCandidate = cleanSiteNameCandidate(beforeStreet);
  const siteName = isSafeSiteNameCandidate(siteNameCandidate)
    ? siteNameCandidate
    : null;

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
    [args.extractedAddress, args.extractedPlz, args.extractedCity]
      .filter(Boolean)
      .join(" "),
  );
  const customer = normalizeCompare(
    [args.customerAddress, args.customerPlz, args.customerCity]
      .filter(Boolean)
      .join(" "),
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
    const hasPlzCity = blockLines.some((line) =>
      Boolean(parsePlzCity(line).plz),
    );
    if (hasStreet && hasPlzCity) break;
  }

  return blockLines;
}

function hasSuspiciousStreetPlzMix(
  siteAddress: string | null,
  sitePlz: string | null,
) {
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
      const withoutName = cleaned
        .replace(
          new RegExp(`^\\s*${escapeRegExp(siteName || "")}\\s+`, "i"),
          "",
        )
        .trim();
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

function pickSiteName(
  blockLines: string[],
  siteAddress: string | null,
  sitePlz: string | null,
) {
  const safeDescriptorLines: string[] = [];
  const siteAddressKey = normalizeCompare(siteAddress);

  for (const candidate of blockLines) {
    const cleaned = cleanSiteNameCandidate(stripMarker(candidate));
    if (!cleaned) continue;
    if (siteAddress && normalizeCompare(cleaned) === siteAddressKey) continue;
    if (parsePlzCity(cleaned).plz) continue;
    if (sitePlz && cleaned.includes(sitePlz)) continue;

    const parsedStreet = parseStreet(cleaned);
    if (parsedStreet) {
      const beforeStreet = cleaned
        .replace(new RegExp(`${escapeRegExp(parsedStreet)}.*$`, "i"), "")
        .replace(/[,:;\-–—]+$/g, "")
        .trim();
      const safePrefix = cleanSiteNameCandidate(beforeStreet);
      if (safePrefix && isSafeSiteNameCandidate(safePrefix)) {
        safeDescriptorLines.push(safePrefix);
      }
      continue;
    }

    if (!isSafeSiteNameCandidate(cleaned)) continue;
    safeDescriptorLines.push(cleaned);
  }

  const uniqueDescriptors = Array.from(
    new Map(
      safeDescriptorLines.map((line) => [normalizeCompare(line), line]),
    ).values(),
  ).slice(0, 2);

  return uniqueDescriptors.length > 0 ? uniqueDescriptors.join(", ") : null;
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
  if (
    !source ||
    (!EXECUTION_ADDRESS_MARKER.test(source) &&
      !SOFT_EXECUTION_ADDRESS_LINE_PATTERN.test(source))
  )
    return null;

  const lines = source
    .split(/\n+|(?<=[.!?])\s+/g)
    .map((line) => line.trim())
    .filter(Boolean);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (
      !EXECUTION_ADDRESS_MARKER.test(line) &&
      !SOFT_EXECUTION_ADDRESS_LINE_PATTERN.test(line)
    )
      continue;

    const inlineAddress = extractInlineExecutionAddressCandidate(
      line,
      customer,
    );
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
    const cleanSiteAddress = sanitizeStreetAgainstSiteName(
      siteAddress,
      siteName,
      sitePlz,
    );

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
