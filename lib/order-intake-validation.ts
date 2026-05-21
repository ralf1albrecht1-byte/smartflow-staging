// INTAKE_VALIDATION_ADDRESS_PRICE_FIX_V4
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
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const unique = (values: string[]) => Array.from(new Set(values.filter(Boolean)));

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


type DetectedUnitPrice = {
  amount: number;
  currency: string | null;
  segment: string;
};

const CURRENCY_WORDS =
  "(?:chf|franken|fr\\.?|sfr\\.?|stutz|eur|euro|€|usd|us-dollar|dollar|us\\$|\\$|gbp|pfund|pound|£)";

const UNIT_WORDS =
  "(?:stueck|stück|stk|einheit|piece|quadratmeter|quadratmetern|qm|m2|m²|sqm|kubikmeter|kubikmetern|cbm|meter|laufmeter|lfm|stunde|stunden|std\\.?|hour|hours|tag|tage|day|days|kg|kilogramm|tonne|tonnen|liter|ltr|l)";

const PRICE_NUMBER = "(\\d+(?:[.,]\\d{1,2})?)";

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

const serviceTokens = (serviceName?: string | null) =>
  normalizeCompare(serviceName)
    .split(" ")
    .map((token) => token.trim())
    .filter((token) => token.length >= 4 && !["reinigen", "entfernen", "machen", "bitte"].includes(token));

const buildPriceSegments = (text?: string | null) => {
  const source = normalizeText(text);
  if (!source) return [];

  const rawLines = source
    .split(/\n+/g)
    .map((line) => line.trim())
    .filter(Boolean);

  const segments: string[] = [];

  for (let index = 0; index < rawLines.length; index += 1) {
    const line = rawLines[index];
    segments.push(line);

    const sentenceParts = line
      .split(/(?<=[.!?])\s+|;|\s+•\s+/g)
      .map((part) => part.trim())
      .filter(Boolean);
    segments.push(...sentenceParts);

    const next = rawLines[index + 1];
    if (next) segments.push(`${line} ${next}`);
  }

  return unique(segments);
};

function detectUnitPriceInSegment(segment: string): DetectedUnitPrice | null {
  const source = normalizeText(segment);
  if (!source) return null;

  const patterns: RegExp[] = [
    // CHF 5 pro Stück / USD 6 per piece / EUR 90 je Quadratmeter
    new RegExp(`\\b(${CURRENCY_WORDS})\\s*${PRICE_NUMBER}\\s*(?:pro|je|per|à|a|/)\\s*${UNIT_WORDS}\\b`, "i"),
    // 5 CHF pro Stück / 90 EUR je Quadratmeter
    new RegExp(`\\b${PRICE_NUMBER}\\s*(${CURRENCY_WORDS})\\s*(?:pro|je|per|à|a|/)\\s*${UNIT_WORDS}\\b`, "i"),
    // zu CHF 5 pro Stück / Sonderpreis ist CHF 50 pro Quadratmeter
    new RegExp(`(?:preis|sonderpreis|vereinbart|ansatz|stundensatz|tagessatz|zu|für|fuer|kostet|kosten|ist|=|:)\\s*(?:ist|von|zu|=|:)?\\s*(${CURRENCY_WORDS})\\s*${PRICE_NUMBER}\\s*(?:pro|je|per|à|a|/)\\s*${UNIT_WORDS}\\b`, "i"),
    // zu 5 CHF pro Stück
    new RegExp(`(?:preis|sonderpreis|vereinbart|ansatz|stundensatz|tagessatz|zu|für|fuer|kostet|kosten|ist|=|:)\\s*(?:ist|von|zu|=|:)?\\s*${PRICE_NUMBER}\\s*(${CURRENCY_WORDS})\\s*(?:pro|je|per|à|a|/)\\s*${UNIT_WORDS}\\b`, "i"),
    // Stundensatz CHF 95 / Stundenansatz CHF 95
    new RegExp(`(?:stundenpreis|stundenansatz|stundensatz|tagessatz|quadratmeterpreis|meterpreis|stückpreis|stueckpreis|kilopreis|tonnenpreis|literpreis)\\s*(?:ist|von|zu|=|:)?\\s*(${CURRENCY_WORDS})\\s*${PRICE_NUMBER}\\b`, "i"),
    // Stundensatz 95 CHF
    new RegExp(`(?:stundenpreis|stundenansatz|stundensatz|tagessatz|quadratmeterpreis|meterpreis|stückpreis|stueckpreis|kilopreis|tonnenpreis|literpreis)\\s*(?:ist|von|zu|=|:)?\\s*${PRICE_NUMBER}\\s*(${CURRENCY_WORDS})\\b`, "i"),
  ];

  for (const pattern of patterns) {
    const match = source.match(pattern);
    if (!match) continue;

    // The regex variants either capture currency first + price second or price first + currency second.
    const first = match[1];
    const second = match[2];
    const firstAsCurrency = normalizeCurrency(first);
    const secondAsCurrency = normalizeCurrency(second);
    const currency = firstAsCurrency || secondAsCurrency;
    const amount = firstAsCurrency ? parsePriceNumber(second) : parsePriceNumber(first);

    if (amount && currency) return { amount, currency, segment: source };
  }

  return null;
}

function detectExplicitUnitPriceForService(
  originalText: string,
  serviceName: string,
): DetectedUnitPrice | null {
  const tokens = serviceTokens(serviceName);
  const serviceKey = normalizeCompare(serviceName);
  if (!serviceKey && tokens.length === 0) return null;

  const segments = buildPriceSegments(originalText);
  let best: { detected: DetectedUnitPrice; score: number } | null = null;

  for (const segment of segments) {
    const normalizedSegment = normalizeCompare(segment);
    if (!normalizedSegment) continue;

    const detected = detectUnitPriceInSegment(segment);
    if (!detected) continue;

    let score = 0;
    if (serviceKey && normalizedSegment.includes(serviceKey)) score += 80;

    for (const token of tokens) {
      if (normalizedSegment.includes(token)) score += 35;
    }

    // Prefer shorter, local segments. Large blocks often contain several services and caused price bleed.
    if (segment.length <= 180) score += 15;
    if (segment.length > 320) score -= 40;

    if (score < 35) continue;
    if (!best || score > best.score) best = { detected, score };
  }

  return best?.detected || null;
}

const isFlatUnit = (unit?: string | null) => {
  const value = normalizeCompare(unit);
  return ["pauschal", "pauschale", "fixpreis", "festpreis", "flat"].includes(value);
};

const roundMoney = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

function calculateSafeLineTotal(item: ParsedOrderItemForValidation) {
  const quantity = Number(item.quantity || 0);
  const unitPrice = Number(item.unitPrice || 0);

  if (!Number.isFinite(unitPrice) || unitPrice <= 0) return 0;

  if (isFlatUnit(item.unit)) return roundMoney(unitPrice);
  if (!Number.isFinite(quantity) || quantity <= 0) return 0;

  return roundMoney(quantity * unitPrice);
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

  const items = input.items.map((item) => {
    const quantity = Number(item.quantity || 0);
    const unitPrice = Number(item.unitPrice || 0);
    const next: ParsedOrderItemForValidation = {
      ...item,
      quantity: Number.isFinite(quantity) ? quantity : 0,
      unitPrice: Number.isFinite(unitPrice) ? unitPrice : 0,
    };

    const itemReasons: string[] = [];
    const explicitUnitPrice = detectExplicitUnitPriceForService(
      input.originalText,
      next.serviceName,
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
        // Never store USD/EUR/CHF as the wrong final currency. The user must decide.
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
  /\b(rechnungsadresse|rechnung\s+an|rechnung|kunde|kundendaten|leistung|leistungen|preis|preise|kosten|telefon|tel\.?|e-mail|email|mail|bemerkung|bemerkungen|hinweis|hinweise|notiz|notizen|bitte|termin|datum|mwst|währung|waehrung|kundennachricht|whatsapp)\b/i;

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

function isLikelyAddressStreetLine(value: string): boolean {
  const text = cleanAddressLine(value);
  return ADDRESS_WORD_PATTERN.test(text) && /\d/.test(text);
}

function parseStreet(value: string): string | null {
  const text = cleanAddressLine(value);
  const match = text.match(
    /\b([A-ZÄÖÜ][A-Za-zÄÖÜäöüß' .\-]{1,60}(?:strasse|straße|str\.?|weg|gasse|platz|allee|ring|rain|halde|steig|route|rue|avenue|av\.?|chemin|via|viale|street|road|lane)\s+\d+[a-zA-Z]?(?:\s*[/-]\s*\d+[a-zA-Z]?)?)\b/i,
  );

  return match?.[1]?.replace(/\s+/g, " ").trim() || null;
}

function parsePlzCity(value: string): { plz: string | null; city: string | null } {
  const text = cleanAddressLine(value);
  const match = text.match(/\b(\d{4,5})\s+([A-ZÄÖÜ][A-Za-zÄÖÜäöüß' .\-]{2,40})\b/);

  if (!match) return { plz: null, city: null };

  const rawCity = match[2] || "";
  const city = rawCity
    .replace(EXECUTION_ADDRESS_MARKER, "")
    .replace(STOP_MARKER, "")
    .replace(/\b(ausführungsadresse|ausfuehrungsadresse|ausführende|ausfuehrende|adresse|arbeitsort|baustelle|objekt)\b/gi, "")
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

  if (sameLine) blockLines.push(sameLine);

  for (let offset = 1; offset <= 5; offset += 1) {
    const nextLine = lines[markerIndex + offset];
    if (!nextLine) continue;

    // A second marker means a new address block/evidence block begins. Do not merge it.
    if (EXECUTION_ADDRESS_MARKER.test(nextLine)) break;

    // Stop before service/hint/price text, unless the line itself contains an address pattern.
    if (STOP_MARKER.test(nextLine) && !isLikelyAddressStreetLine(nextLine) && !parsePlzCity(nextLine).plz) {
      break;
    }

    const cleaned = stripMarker(nextLine);
    if (!cleaned) continue;
    blockLines.push(cleaned);

    const hasStreet = Boolean(parseStreet(blockLines.join(" ")));
    const hasPlzCity = Boolean(parsePlzCity(blockLines.join(" ")).plz);
    if (hasStreet && hasPlzCity) break;
  }

  return blockLines;
}

function pickSiteName(blockLines: string[], siteAddress: string | null, sitePlz: string | null) {
  for (const candidate of blockLines) {
    const cleaned = stripMarker(candidate);
    if (!cleaned) continue;
    if (siteAddress && normalizeCompare(cleaned) === normalizeCompare(siteAddress)) continue;
    if (parseStreet(cleaned)) continue;
    if (parsePlzCity(cleaned).plz) continue;
    if (/\d{4,5}/.test(cleaned)) continue;
    if (STOP_MARKER.test(cleaned)) continue;
    if (EXECUTION_ADDRESS_MARKER.test(cleaned)) continue;
    if (cleaned.length >= 3 && cleaned.length <= 80) return cleaned;
  }

  return "Ausführungsadresse";
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
  if (!source || !EXECUTION_ADDRESS_MARKER.test(source)) return null;

  const lines = source
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!EXECUTION_ADDRESS_MARKER.test(line)) continue;

    const blockLines = getExecutionAddressCandidates(lines, index);
    const flatBlock = blockLines.join(" ");

    // Prefer line-based parsing. Parsing the whole block at once can merge
    // object name + street + PLZ into one broken address line.
    const siteAddress =
      blockLines.map((candidate) => parseStreet(candidate)).find(Boolean) ||
      parseStreet(flatBlock);

    const plzCityFromLine = blockLines
      .map((candidate) => parsePlzCity(candidate))
      .find((candidate) => candidate.plz && candidate.city);

    const fallbackPlzCity = parsePlzCity(flatBlock);
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

    return {
      siteName: pickSiteName(blockLines, siteAddress, sitePlz),
      siteAddress,
      sitePlz,
      siteCity,
      siteNote: "Automatisch aus Kundentext erkannt. Bitte prüfen.",
    };
  }

  return null;
}
