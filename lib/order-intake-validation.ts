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

    const safeTotal = calculateSafeLineTotal(next);
    next.totalPrice = safeTotal;

    const itemReasons: string[] = [];

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
  /\b(ausführungsadresse|ausfuehrungsadresse|ausführungsort|ausfuehrungsort|ausführung|ausfuehrung|baustellenadresse|baustelle|arbeitsadresse|arbeitsort|einsatzort|objektadresse)\b/i;

const STOP_MARKER =
  /\b(rechnungsadresse|rechnung|kunde|kundendaten|leistung|leistungen|preis|kosten|telefon|tel\.?|e-mail|email|mail|bemerkung|hinweis|notiz)\b/i;

function parseStreet(value: string): string | null {
  const text = normalizeText(value).replace(/[,;]+/g, " ");
  const match = text.match(
    /\b([A-ZÄÖÜ][A-Za-zÄÖÜäöüß' .\-]{1,60}(?:strasse|straße|str\.?|weg|gasse|platz|allee|ring|rain|halde|steig|route|rue|avenue|av\.?|chemin|via|viale|street|road|lane)\s+\d+[a-zA-Z]?(?:\s*[/-]\s*\d+[a-zA-Z]?)?)\b/i,
  );

  return match?.[1]?.replace(/\s+/g, " ").trim() || null;
}

function parsePlzCity(value: string): { plz: string | null; city: string | null } {
  const text = normalizeText(value).replace(/[,;]+/g, " ");
  const match = text.match(/\b(\d{4,5})\s+([A-ZÄÖÜ][A-Za-zÄÖÜäöüß' .\-]{2,40})\b/);

  if (!match) return { plz: null, city: null };

  return {
    plz: match[1] || null,
    city: match[2]?.replace(/\s+/g, " ").trim() || null,
  };
}

function stripMarker(value: string) {
  return value
    .replace(EXECUTION_ADDRESS_MARKER, "")
    .replace(/^\s*[:\-–—]+\s*/, "")
    .trim();
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

    const blockLines: string[] = [];
    const sameLine = stripMarker(line);
    if (sameLine) blockLines.push(sameLine);

    for (let offset = 1; offset <= 4; offset += 1) {
      const nextLine = lines[index + offset];
      if (!nextLine) continue;
      if (STOP_MARKER.test(nextLine) && !EXECUTION_ADDRESS_MARKER.test(nextLine)) break;
      blockLines.push(nextLine);
    }

    const block = blockLines.join("\n");
    const flatBlock = blockLines.join(" ");
    const siteAddress = parseStreet(flatBlock);
    const { plz: sitePlz, city: siteCity } = parsePlzCity(flatBlock);

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

    const siteNameCandidate = blockLines.find((candidate) => {
      const cleaned = stripMarker(candidate);
      if (!cleaned) return false;
      if (parseStreet(cleaned)) return false;
      if (parsePlzCity(cleaned).plz) return false;
      return cleaned.length >= 3 && cleaned.length <= 80;
    });

    return {
      siteName: siteNameCandidate ? stripMarker(siteNameCandidate) : "Ausführungsadresse",
      siteAddress,
      sitePlz,
      siteCity,
      siteNote: `Automatisch aus Kundentext erkannt. Bitte prüfen.`,
    };
  }

  return null;
}
