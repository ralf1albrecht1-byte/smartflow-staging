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
  // V17.90L24: hard global order gate. The second checker must validate the
  // complete persisted order candidate, not just log customer/address risks.
  orderItems?: ParsedOrderItemForValidation[] | null;
  // V17.90L91: The read-only validator may surface only explicit
  // second-pass candidates produced by the existing validation pipeline.
  // It must not re-parse the complete customer message to invent new roles.
  recognitionCandidates?: ParsedOrderItemForValidation[] | null;
  specialNotes?: string | null;
  finalTotal?: number | null;
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


// V17.90L24: global fail-closed checks for the whole order candidate.
// These checks are intentionally stricter than the normal parser. If the
// candidate looks structurally unsafe, it must be reviewed before document
// creation. We can loosen later; first protect the user from wrong offers.
function splitGlobalRiskSegmentsV17_90L24(value?: string | null): string[] {
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split(/\n+|(?<=[.!?])\s+|;\s+/g)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line.length > 0);
}

function globalPricedServiceLinesV17_90L24(value?: string | null): string[] {
  return splitGlobalRiskSegmentsV17_90L24(value).filter((line) => {
    try {
      return isPricedServiceLine(line);
    } catch {
      return false;
    }
  });
}

function cleanSpecialNoteRiskLineV17_90L24(value?: string | null): string {
  return String(value || "")
    .replace(/^\s*\[(?:GEFAHR|WARNUNG|WARNHINWEIS|HINWEIS|INFO|NOTIZ)\]\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isPollutedSpecialNoteLineV17_90L24(value?: string | null): boolean {
  const line = cleanSpecialNoteRiskLineV17_90L24(value);
  if (!line) return false;
  const key = normalizeRiskText(line);

  if (line.length > 220) return true;
  if (globalPricedServiceLinesV17_90L24(line).length > 0) return true;
  if (/\b(?:rechnung|rechnungsadresse|rechnungskunde|fattura|factura|fatura|facture|invoice|billing|kundennachrichten|whatsapp\s*:|ausfuehrung|ausführung|ausfuehrungsadresse|ausführungsadresse|arbeitsort|einsatzort)\b/.test(key)) return true;
  if (/\b(?:strasse|straße|str\.?|weg|gasse|platz|allee|ring|rue|avenue|via|viale)\b\s+\d+[a-z]?\b/i.test(line)) return true;
  if (/\b\d{4,5}\s+[A-ZÄÖÜ][A-Za-zÄÖÜäöüß' .-]{1,60}\b/.test(line) && !/\b(?:parkieren|parken|parkplatz|termin|sms|whatsapp|schluessel|schlussel|schlüssel|key|code|achtung|warnung|gefahr|nass|rutschig)\b/i.test(line)) return true;

  return false;
}

function hasUselessBareAppointmentNoteV17_90L24(specialNotes?: string | null): boolean {
  return splitGlobalRiskSegmentsV17_90L24(specialNotes).some((line) => /^\s*(?:\[(?:HINWEIS|INFO|NOTIZ)\]\s*)?termin\s*:?\s*$/i.test(line));
}

function appointmentPhrasesInTextV17_90L24(value?: string | null): string[] {
  const source = String(value || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const matches = source.match(/\b(?:bitte\s+)?(?:heute|morgen|uebermorgen|übermorgen)\s+(?:vormittag|nachmittag|abend)\b|\b(?:vormittag|nachmittag|abend)\b|\b\d{1,2}:\d{2}\s*(?:uhr)?\b/gi) || [];
  return Array.from(new Set(matches.map((m) => normalizeRiskText(m)).filter(Boolean)));
}

function appointmentHintMissingV17_90L24(originalText: string, specialNotes?: string | null): boolean {
  const phrases = appointmentPhrasesInTextV17_90L24(originalText).filter((phrase) => /morgen|heute|uebermorgen|ubermorgen|vormittag|nachmittag|abend|uhr/.test(phrase));
  if (phrases.length === 0) return false;
  const notes = normalizeRiskText(specialNotes || "");
  if (!notes) return true;
  return !phrases.some((phrase) => phrase.split(/\s+/g).filter(Boolean).some((word) => word.length >= 5 && notes.includes(word)));
}

function hasBroadItemEvidenceV17_90L24(item: ParsedOrderItemForValidation): boolean {
  try {
    return isBroadPollutedItemEvidenceV17_90L22(item);
  } catch {
    const evidence = [item.sourceText, item.evidence, item.description].filter(Boolean).join("\n");
    return evidence.length > 240 || globalPricedServiceLinesV17_90L24(evidence).length >= 2;
  }
}

function recognitionServiceNamesCompatibleV17_90L69(
  left?: string | null,
  right?: string | null,
): boolean {
  const a = normalizeCompare(left);
  const b = normalizeCompare(right);
  if (!a || !b) return false;
  if (a === b || a.includes(b) || b.includes(a)) return true;

  const ignored = new Set([
    "reinigen",
    "reinigung",
    "komplett",
    "gruendlich",
    "gründlich",
    "innen",
    "aussen",
    "außen",
    "maschinell",
  ]);
  const tokens = (value: string) =>
    value
      .split(/\s+/g)
      .filter((token) => token.length >= 4 && !ignored.has(token));
  const aTokens = tokens(a);
  const bTokens = tokens(b);
  if (aTokens.length === 0 || bTokens.length === 0) return false;
  const shared = aTokens.filter((token) => bTokens.includes(token)).length;
  return shared > 0 && shared / Math.min(aTokens.length, bTokens.length) >= 0.6;
}

function exactExplicitPricedLineCoveredV17_90L24(
  items: ParsedOrderItemForValidation[],
  explicit: ParsedOrderItemForValidation,
): boolean {
  return items.some((item) => {
    const amountAndUnitMatch = (() => {
      try {
        return exactAmountUnitMatchV17_90L22(item, explicit as any);
      } catch {
        return (
          Math.abs(Number(item.quantity || 0) - Number(explicit.quantity || 0)) < 0.001 &&
          Math.abs(Number(item.unitPrice || 0) - Number(explicit.unitPrice || 0)) < 0.01 &&
          String(item.unit || "").trim().toLowerCase() === String(explicit.unit || "").trim().toLowerCase()
        );
      }
    })();

    return (
      amountAndUnitMatch &&
      recognitionServiceNamesCompatibleV17_90L69(
        item.serviceName,
        explicit.serviceName,
      )
    );
  });
}

function preferStrongRecognitionCandidatesV17_90L69(
  explicitItems: ParsedOrderItemForValidation[],
  originalText: string,
): ParsedOrderItemForValidation[] {
  const hasExplicitCurrency = (item: ParsedOrderItemForValidation) =>
    new RegExp(CURRENCY_WORDS, "i").test(
      String(item.sourceText || item.evidence || item.description || ""),
    );
  const signature = (item: ParsedOrderItemForValidation) =>
    [
      unitTypeFromDisplayUnit(item.unit) || normalizeCompare(item.unit),
      Number(item.quantity || 0).toFixed(4),
      Number(item.unitPrice || 0).toFixed(4),
    ].join("|");

  const raw = String(originalText || "");
  const originalOnly = normalizeText(
    raw
      .replace(/\n+---\s*Übersetzung \(automatisch\)\s*---[\s\S]*$/i, "")
      .replace(/\n+---\s*Uebersetzung \(automatisch\)\s*---[\s\S]*$/i, "")
      .replace(/\n+---\s*Automatic translation\s*---[\s\S]*$/i, ""),
  );
  const translatedOnly = normalizeText(
    raw
      .split(
        /---\s*(?:Übersetzung|Uebersetzung) \(automatisch\)\s*---|---\s*Automatic translation\s*---/i,
      )
      .slice(1)
      .join("\n"),
  );
  const normalizedOriginal = normalizeText(originalText);
  const evidenceText = (item: ParsedOrderItemForValidation) =>
    normalizeText(item.sourceText || item.evidence || item.description || "");
  const evidenceOrigin = (
    item: ParsedOrderItemForValidation,
  ): "original" | "translated" | "both" | "unknown" => {
    const evidence = evidenceText(item);
    if (!evidence) return "unknown";
    const inOriginal = Boolean(originalOnly && originalOnly.includes(evidence));
    const inTranslated = Boolean(
      translatedOnly && translatedOnly.includes(evidence),
    );
    if (inOriginal && inTranslated) return "both";
    if (inOriginal) return "original";
    if (inTranslated) return "translated";
    return "unknown";
  };
  const hasExactSourceEvidence = (item: ParsedOrderItemForValidation) => {
    const evidence = evidenceText(item);
    return Boolean(evidence && normalizedOriginal.includes(evidence));
  };

  const filtered = explicitItems.filter((item, index, all) => {
    const sameSignature = all.filter(
      (other, otherIndex) =>
        otherIndex !== index && signature(other) === signature(item),
    );

    // A generated cross-line fragment is weaker than an exact source line
    // with the same numeric signature. This prevents a following amount from
    // being attached to the preceding service label.
    if (
      !hasExactSourceEvidence(item) &&
      sameSignature.some(hasExactSourceEvidence)
    ) {
      return false;
    }

    if (hasExplicitCurrency(item)) return true;
    return !sameSignature.some(hasExplicitCurrency);
  });

  // Identical candidates can be emitted by the raw and semantic extraction
  // paths. Keep one concrete row before comparing original and translation.
  const exactCandidates = new Map<string, ParsedOrderItemForValidation>();
  for (const item of filtered) {
    const key = `${signature(item)}|${normalizeCompare(item.serviceName)}`;
    const existing = exactCandidates.get(key);
    const itemEvidenceLength = evidenceText(item).length;
    const existingEvidenceLength = existing ? evidenceText(existing).length : 0;
    if (
      !existing ||
      (itemEvidenceLength > 0 &&
        (existingEvidenceLength === 0 ||
          itemEvidenceLength < existingEvidenceLength)) ||
      (hasExplicitCurrency(item) && !hasExplicitCurrency(existing))
    ) {
      exactCandidates.set(key, item);
    }
  }

  const candidates = Array.from(exactCandidates.values());
  const groups = new Map<string, ParsedOrderItemForValidation[]>();
  for (const item of candidates) {
    const key = signature(item);
    const group = groups.get(key) || [];
    group.push(item);
    groups.set(key, group);
  }

  const remove = new Set<ParsedOrderItemForValidation>();
  for (const group of groups.values()) {
    // Only collapse an unambiguous raw/translation pair. If more rows share
    // the same amount, they can be distinct services and remain fail-closed.
    if (group.length !== 2) continue;
    const [left, right] = group;
    const leftOrigin = evidenceOrigin(left);
    const rightOrigin = evidenceOrigin(right);
    const isRawTranslationPair =
      (leftOrigin === "original" && rightOrigin === "translated") ||
      (leftOrigin === "translated" && rightOrigin === "original");
    if (!isRawTranslationPair) continue;

    const lastToken = (value?: string | null) =>
      normalizeCompare(value)
        .split(/\s+/g)
        .filter(Boolean)
        .slice(-1)[0] || "";
    const sameActionTail =
      lastToken(left.serviceName).length >= 5 &&
      lastToken(left.serviceName) === lastToken(right.serviceName);
    if (
      !sameActionTail &&
      !recognitionServiceNamesCompatibleV17_90L69(
        left.serviceName,
        right.serviceName,
      )
    ) {
      continue;
    }

    const leftScore = visibleServiceNameQualityScoreV17_37(left.serviceName);
    const rightScore = visibleServiceNameQualityScoreV17_37(right.serviceName);
    const keep =
      rightOrigin === "translated" && rightScore >= leftScore
        ? right
        : leftOrigin === "translated" && leftScore >= rightScore
          ? left
          : rightScore > leftScore
            ? right
            : left;
    remove.add(keep === left ? right : left);
  }

  return candidates.filter((item) => !remove.has(item));
}

type RecognitionReviewPayloadV17_90L69 = {
  kind: "missing_or_mismatched" | "open_price";
  serviceName: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  sourceText: string;
};

function encodeRecognitionReviewWarningV17_90L69(
  explicit: ParsedOrderItemForValidation,
): string {
  const payload: RecognitionReviewPayloadV17_90L69 = {
    kind:
      Number(explicit.unitPrice || 0) > 0
        ? "missing_or_mismatched"
        : "open_price",
    serviceName: String(explicit.serviceName || "Leistung")
      .replace(/[\s,;:.-]+$/g, "")
      .trim(),
    quantity: Number(explicit.quantity || 0),
    unit: String(explicit.unit || "").trim(),
    unitPrice: Number(explicit.unitPrice || 0),
    sourceText: String(
      explicit.sourceText || explicit.evidence || explicit.description || "",
    )
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 320),
  };

  return `recognition_review:${encodeURIComponent(JSON.stringify(payload))}`;
}

// V17.90L98: Fully priced rows discovered only by the legacy whole-message
// checker are diagnostic shadow findings. They may be logged for comparison,
// but they must never create visible review chips or alter the first AI result.
function encodeShadowRecognitionWarningV17_90L98(
  explicit: ParsedOrderItemForValidation,
): string {
  return `shadow_${encodeRecognitionReviewWarningV17_90L69(explicit)}`;
}

function isShadowOnlyRiskWarningV17_90L98(warning: string): boolean {
  return warning.startsWith("shadow_");
}

// V17.90L90: The second checker may surface a plausible service with an
// explicitly open price as a read-only recognition proposal. It must never add
// the service automatically. The user resolves it through Übernehmen or
// Verwerfen in the order editor.
function extractOpenPriceRecognitionItemsV17_90L90(
  originalText: string,
  fallbackCurrency: IntakeCurrency,
): ParsedOrderItemForValidation[] {
  const candidates: ParsedOrderItemForValidation[] = [];

  for (const line of splitRawIntakeLines(originalText)) {
    if (!hasUnclearPriceSignal(line)) continue;

    // A concrete amount belongs to the normal priced-line validator. This
    // path is only for service-like lines whose price is expressly unresolved.
    if (
      hasExplicitCurrencyAmount(line) ||
      extractUnitPricesFromSegment(line).length > 0 ||
      Boolean(detectCurrencylessFlatPriceFromSegment(line, fallbackCurrency))
    ) {
      continue;
    }

    const serviceName = cleanExplicitServiceNameFromLine(line, {});
    const serviceKey = normalizeCompare(serviceName);
    if (
      !serviceName ||
      serviceName === "Unbekannte Leistung" ||
      serviceKey.length < 4 ||
      isPriceAnchorOnlyServiceName(serviceName)
    ) {
      continue;
    }

    candidates.push({
      serviceName,
      description: line,
      quantity: 1,
      unit: "Pauschal",
      unitPrice: 0,
      totalPrice: 0,
      needsReview: true,
      reviewReason: `price_unclear:${serviceName}`,
      sourceText: line,
      evidence: line,
      detectedCurrency: fallbackCurrency,
    });
  }

  // Raw text and automatic translation can describe the same open-price
  // service twice. Keep one semantic candidate, preferring the shorter and
  // therefore more line-local evidence string.
  const byService = new Map<string, ParsedOrderItemForValidation>();
  for (const candidate of candidates) {
    const key = normalizeCompare(candidate.serviceName);
    const existing = byService.get(key);
    const candidateEvidence = normalizeText(
      candidate.sourceText || candidate.evidence || candidate.description,
    );
    const existingEvidence = existing
      ? normalizeText(
          existing.sourceText || existing.evidence || existing.description,
        )
      : "";
    if (
      !existing ||
      (candidateEvidence.length > 0 &&
        (existingEvidence.length === 0 ||
          candidateEvidence.length < existingEvidence.length))
    ) {
      byService.set(key, candidate);
    }
  }

  return Array.from(byService.values());
}

function isSafeSecondaryRecognitionCandidateV17_90L91(
  candidate: ParsedOrderItemForValidation,
): boolean {
  const reviewReason = String(candidate.reviewReason || "").trim();
  if (!reviewReason.startsWith("price_unclear:")) return false;
  if (Number(candidate.unitPrice || 0) > 0) return false;

  const source = normalizeText(
    candidate.sourceText || candidate.evidence || candidate.description,
  );
  const serviceName = String(candidate.serviceName || "")
    .replace(/[\s,;:.-]+$/g, "")
    .trim();
  const sourceKey = normalizeCompare(source);
  const serviceKey = normalizeCompare(serviceName);

  if (
    !source ||
    source.length > 240 ||
    !serviceName ||
    serviceName === "Unbekannte Leistung" ||
    serviceKey.length < 4 ||
    isPriceAnchorOnlyServiceName(serviceName)
  ) {
    return false;
  }

  // L91: only explicit unresolved-price statements may become proposals.
  // Generic approximation words such as "ungefähr" are intentionally not
  // sufficient because they commonly describe arrival times, weights or
  // durations rather than a service price.
  const openPriceSignalPattern =
    /\b(?:preis\s+(?:noch\s+)?(?:offen|unklar|unbekannt|folgt|zu\s+pruefen|muss\s+(?:noch\s+)?(?:geprueft|abgeklaert)\s+werden)|nach\s+aufwand|price\s+(?:open|unclear|tbd|to\s+check)|prix\s+(?:ouvert|incertain|a\s+verifier)|prezzo\s+(?:aperto|da\s+definire))\b/i;
  const openPriceMatch = sourceKey.match(openPriceSignalPattern);
  if (!openPriceMatch) return false;

  // A safe proposal must describe one line-local service. A comma/semicolon
  // list of several already parsed services followed by one open-price phrase
  // is a broad summary, not evidence for a single missing position.
  const openSignalIndex = openPriceMatch.index ?? sourceKey.length;
  const serviceScope = sourceKey.slice(0, openSignalIndex);
  const structuralSeparators = serviceScope.match(/[,;|]/g)?.length || 0;
  const nameSeparators = serviceName.match(/[,;|]/g)?.length || 0;
  if (structuralSeparators >= 2 || nameSeparators >= 2) return false;

  // Structural role guard: a proposed service line must not be a phone,
  // e-mail, date/time or address sentence. This does not use service-word
  // mappings; it only blocks non-service data types.
  if (
    /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(source) ||
    /\+?\d[\d\s()./-]{6,}\d/.test(source) ||
    /\b\d{1,2}[./-]\d{1,2}(?:[./-]\d{2,4})?\b/.test(source) ||
    /\b(?:[01]?\d|2[0-3]):[0-5]\d\b/.test(source) ||
    /\b\d{4,5}\s+[A-ZÄÖÜÀ-ÖØ-Þ][\p{L}'’ .-]{2,}\b/u.test(source)
  ) {
    return false;
  }

  return true;
}

function openPriceRecognitionCoveredV17_90L90(
  items: ParsedOrderItemForValidation[],
  candidate: ParsedOrderItemForValidation,
): boolean {
  const candidateEvidence = normalizeCompare(
    candidate.sourceText || candidate.evidence || candidate.description,
  );

  return items.some((item) => {
    if (
      !recognitionServiceNamesCompatibleV17_90L69(
        item.serviceName,
        candidate.serviceName,
      )
    ) {
      return false;
    }

    const itemEvidence = normalizeCompare(
      item.sourceText || item.evidence || item.description,
    );
    if (!candidateEvidence || !itemEvidence) return true;

    return (
      candidateEvidence === itemEvidence ||
      candidateEvidence.includes(itemEvidence) ||
      itemEvidence.includes(candidateEvidence) ||
      normalizeCompare(item.serviceName) ===
        normalizeCompare(candidate.serviceName)
    );
  });
}

function globalOrderGateWarningsV17_90L24(input: ReadOnlyIntakeRiskValidatorInput): string[] {
  const warnings: string[] = [];
  const items = Array.isArray(input.orderItems) ? input.orderItems : [];
  const specialNotes = input.specialNotes || "";
  const finalCurrency: IntakeCurrency = input.finalCurrency === "EUR" ? "EUR" : "CHF";

  const pollutedSpecialNotes = splitGlobalRiskSegmentsV17_90L24(specialNotes).filter(isPollutedSpecialNoteLineV17_90L24);
  if (pollutedSpecialNotes.length > 0) warnings.push("special_notes_polluted");
  if (hasUselessBareAppointmentNoteV17_90L24(specialNotes)) warnings.push("appointment_note_incomplete");
  if (appointmentHintMissingV17_90L24(input.originalText, specialNotes)) warnings.push("appointment_hint_missing");

  if (items.some(hasBroadItemEvidenceV17_90L24)) warnings.push("item_evidence_not_line_local");
  if (items.some((item) => normalizeRiskText(item.serviceName || "") === "leistung pruefen" || normalizeRiskText(item.serviceName || "") === "unbekannte leistung")) warnings.push("service_name_unresolved");
  if (items.some((item) => Number(item.unitPrice || 0) > 0 && Number(item.quantity || 0) > 0 && Number(item.totalPrice || 0) <= 0)) warnings.push("priced_item_total_blocked");

  const explicitItems = normalizeHighGermanServiceNamesFromTranslatedTextV17_35(
    input.originalText,
    preferStrongRecognitionCandidatesV17_90L69(
      [
        ...extractStrictLineLocalPricedItemsV17_90L22(
          input.originalText,
          finalCurrency,
        ),
        ...extractCountOnlyPricedRecognitionItemsV17_90L69(
          input.originalText,
          finalCurrency,
        ),
        ...extractExplicitFlatFeeServiceItemsV17_90L95(
          input.originalText,
          finalCurrency,
        ),
      ],
      input.originalText,
    ),
  );
  if (explicitItems.length >= 2) {
    const uncoveredExplicitItems = explicitItems.filter(
      (explicit) =>
        !exactExplicitPricedLineCoveredV17_90L24(items, explicit),
    );

    if (uncoveredExplicitItems.length > 0) {
      // L98 shadow mode: the old whole-message checker remains observable in
      // logs, but it can no longer challenge or duplicate a complete first-AI
      // result. Only explicit open-price candidates from the validated
      // secondary-candidate channel remain user-actionable below.
      warnings.push("shadow_priced_service_line_missing_or_mismatched");
      warnings.push(
        ...uncoveredExplicitItems
          .slice(0, 12)
          .map(encodeShadowRecognitionWarningV17_90L98),
      );
    }
  }

  // V17.90L91: Open-price proposals are no longer reconstructed from the
  // complete customer message. The caller supplies only explicit candidates
  // already produced by the second validation pass. This closes the path that
  // previously converted contact/appointment text into fake services.
  const openPriceCandidates = (
    Array.isArray(input.recognitionCandidates)
      ? input.recognitionCandidates
      : []
  ).filter(isSafeSecondaryRecognitionCandidateV17_90L91);
  const uncoveredOpenPriceCandidates = openPriceCandidates.filter(
    (candidate) => !openPriceRecognitionCoveredV17_90L90(items, candidate),
  );
  if (uncoveredOpenPriceCandidates.length > 0) {
    warnings.push("priced_service_line_missing_or_mismatched");
    warnings.push(
      ...uncoveredOpenPriceCandidates
        .slice(0, 12)
        .map(encodeRecognitionReviewWarningV17_90L69),
    );
  }

  const calculatedTotal = items.reduce((sum, item) => sum + Number(item.totalPrice || 0), 0);
  const finalTotal = Number(input.finalTotal || 0);
  if (Number.isFinite(finalTotal) && finalTotal > 0 && Math.abs(finalTotal - calculatedTotal) > 0.05) {
    warnings.push("order_total_mismatch");
  }

  return unique(warnings);
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

  warnings.push(...globalOrderGateWarningsV17_90L24(input));

  const actionableWarnings = warnings.filter(
    (warning) => !isShadowOnlyRiskWarningV17_90L98(warning),
  );
  const riskLevel: ReadOnlyIntakeRiskValidatorResult["riskLevel"] =
    hasMultipleCurrencies || hasUnsupportedCurrency || actionableWarnings.some((warning) =>
      /^(special_notes_polluted|appointment_note_incomplete|appointment_hint_missing|item_evidence_not_line_local|service_name_unresolved|priced_item_total_blocked|priced_service_line_missing_or_mismatched|recognition_review:|order_total_mismatch)/.test(warning),
    )
      ? "critical"
      : actionableWarnings.length > 0
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

// V17.90L95: pricing-language marker only, not a service vocabulary. It lets
// the read-only completeness check understand flat-fee rows across languages
// without guessing the service itself.
const FLAT_FEE_PRICE_MARKER_V17_90L95 =
  String.raw`(?:pauschal(?:e)?|fixpreis|festpreis|flat\s*(?:fee|rate|price)?|fixed\s*(?:fee|rate|price)|forfait(?:aire)?|prezzo\s+fisso|tarifa\s+(?:fija|plana))`;

const UNIT_WORDS =
  "(?:stueck|stück|stuck|stk|pcs|pc|pezzi|pezzo|pezza|pezze|einheit|einheiten|garnitur|garnituren|set|sets|piece|pieces|pi[eè]ce|pi[eè]ces|vitre|vitres|fenetre|fenetres|window|windows|quadratmeter|quadratmetern|qm|m2|m²|sqm|kubikmeter|kubikmetern|cbm|laufende\\s+meter|laufenden\\s+meter|laufmeter|lfm|meter|stunde|stunden|std\\.?|hour|hours|tag|tage|day|days|kg|kilogramm|tonne|tonnen|liter|ltr|l)";

const PRICE_NUMBER = "(\\d+(?:[.,]\\d{1,2})?)";

const QUANTITY_NUMBER_OR_WORD =
  "(?:\\d+(?:[.,]\\d+)?|ein|eine|einen|einem|einer|eins|viertel|halbe|halb|dreiviertel|anderthalb|eineinhalb|zweieinhalb|dreieinhalb|viereinhalb|fuenfeinhalb|funfeinhalb|sechseinhalb|siebeneinhalb|achteinhalb|neuneinhalb|zwei|drei|vier|fuenf|funf|sechs|sieben|acht|neun|zehn)";


function isPricedServiceLine(line: string): boolean {
  const key = normalizeCompare(line);
  if (!key) return false;

  if (/^(?:rechnung|invoice|facture|fattura|kunde|kundin|adresse|ausfuehrung|ausführung|execution|exécution|esecuzione|hinweis|hinweise|kontakt|telefon|tel|email|e-mail|zugang|besonderheiten)\b/i.test(key)) {
    return false;
  }

  if (
    /\b(?:whatsapp|sms|telefon|phone|e\s*mail|email|kontakt|zugang|code|tuercode|türcode|schluessel|schlüssel|hinweis|achtung|warnung|rutschig|hund|kabel|strom|lift|aufzug|parkplatz|anmelden|melden|kommen|beginn|uhr)\b/i.test(key) &&
    !/\b(?:anfahrt|anfahrtskosten|fahrtkosten|reisekosten|travel|deplacement|déplacement|trasferta)\b/i.test(key)
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
}

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
    /\b(stueck|stuck|stück|stk|pcs|pc|pezzi|pezzo|pezza|pezze|piece|pieces|piece|pi[eè]ce|pi[eè]ces|vitre|vitres|fenetre|fenetres|window|windows|einheit|einheiten|garnitur|garnituren|set|sets)\b/i.test(
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
        `(${CURRENCY_WORDS})\\s*${PRICE_NUMBER}\\s*(?:pro|je|per|par|at|à|a|/)\\s*(${UNIT_WORDS})\\b`,
        "gi",
      ),
      currencyGroup: 1,
      priceGroup: 2,
      unitGroup: 3,
    },
    {
      re: new RegExp(
        `${PRICE_NUMBER}\\s*(${CURRENCY_WORDS})\\s*(?:pro|je|per|par|at|à|a|/)\\s*(${UNIT_WORDS})\\b`,
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
        `(?:preis|sonderpreis|vereinbart|ansatz|stundensatz|stundenansatz|tagessatz|zu|für|fuer|kostet|kosten|ist|=|:)\\s*(?:ist|von|zu|=|:)?\\s*(${CURRENCY_WORDS})\\s*${PRICE_NUMBER}\\s*(?:pro|je|per|par|at|à|a|/)\\s*(${UNIT_WORDS})\\b`,
        "gi",
      ),
      currencyGroup: 1,
      priceGroup: 2,
      unitGroup: 3,
    },
    {
      re: new RegExp(
        `(?:preis|sonderpreis|vereinbart|ansatz|stundensatz|stundenansatz|tagessatz|zu|für|fuer|kostet|kosten|ist|=|:)\\s*(?:ist|von|zu|=|:)?\\s*${PRICE_NUMBER}\\s*(${CURRENCY_WORDS})\\s*(?:pro|je|per|par|at|à|a|/)\\s*(${UNIT_WORDS})\\b`,
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

  // V17.90L30: multilingual, line-local service normalization.
  // These are semantic service/action patterns, not customer-specific word lists.
  if (
    /\b(?:local\s+technique|technikraum|technical\s+room|serverraum)\b/.test(normalized) &&
    /\b(?:depoussier|dépoussier|abstaub|entstaub|dust)\b/.test(normalized)
  ) {
    return "Technikraum abstauben";
  }
  if (
    /\b(?:tables?\s+(?:terrasse|terasse)|tische?\s+(?:auf\s+)?(?:der\s+)?terrasse)\b/.test(normalized) ||
    (/\bterrasse\b/.test(normalized) && /\b(?:tables?|tische?)\b/.test(normalized))
  ) {
    return "Tische auf Terrasse reinigen";
  }
  if (
    (/\b(?:tapis|teppiche?)\b/.test(normalized) && /\b(?:couloir|gang|flur)\b/.test(normalized))
  ) {
    return "Teppiche im Gang reinigen";
  }
  if (
    /\b(?:lavanderia|waescherei|wascherei|wäsche|waesche)\b/.test(normalized) &&
    /\b(?:pavimento|boden|floor|sol)\b/.test(normalized)
  ) {
    return "Wäschereiboden reinigen";
  }
  if (/\b(?:glastuer|glastur|glastür|porte\s+vitree|vetri\s+porta|glastuer\s+eingang)\b/.test(normalized)) {
    return "Glastür reinigen";
  }

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

    const selectedFlatServiceSource = selectFlatServiceSourceFromSegment(
      segment,
      explicitFlatLine,
    );
    const unclearIndexV17_90L79 =
      unclearPriceSignalIndexV17_90L79(selectedFlatServiceSource);
    const flatServiceSource =
      unclearIndexV17_90L79 > 0
        ? selectedFlatServiceSource.slice(0, unclearIndexV17_90L79).trim()
        : selectedFlatServiceSource;
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


function cleanLineLocalServiceLabelGrammarV17_60(value?: string | null): string {
  return normalizeText(value || "")
    .replace(/\s+/g, " ")
    .replace(/\s*[,;:]\s*(?=[A-Za-zÀ-ÖØ-öø-ÿÄÖÜäöüß]{3,}(?:en|ern|eln)\b\s*$)/giu, " ")
    .replace(/\bsauber\s+machen\s+reinigen\b/gi, "sauber machen")
    .replace(/\bsaubermachen\s+reinigen\b/gi, "saubermachen")
    .replace(/\s*[\(\[\{]+\s*$/g, "")
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
      new RegExp(`\\b(?:pro|je|per|par|at|à|a|/)\\s*${UNIT_WORDS}\\b`, "gi"),
      " ",
    )
    .replace(/\s*[,;:\-–—]?\s*(?:ca\.?|circa|ungefähr|ungefaehr|etwa|approx\.?)\s*$/iu, " ")
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

  const contextCleaned = cleanServiceLabelContextNoiseV17_90L27(cleaned);
  const grammarCleaned = cleanLineLocalServiceLabelGrammarV17_60(contextCleaned);

  const earlyCanonical = canonicalGermanServiceNameFromText(grammarCleaned);
  if (earlyCanonical) return earlyCanonical;

  const hasSpecificLineLocalAction = hasVisibleGermanWorkActionV17_37(grammarCleaned) && meaningfulServiceTokens(grammarCleaned).length >= 3;
  if (hasSpecificLineLocalAction) {
    return grammarCleaned.replace(/^./, (char) => char.toUpperCase());
  }

  const canonical = canonicalGermanServiceNameFromText(grammarCleaned);
  if (canonical) return canonical;

  const key = normalizeCompare(grammarCleaned);
  if (isPriceAnchorOnlyServiceName(grammarCleaned)) return "Unbekannte Leistung";
  if (/\b(kueche|küche)\b/.test(key) && /\b(boden|floor|sol)\b/.test(key)) {
    return "Küchenboden reinigen";
  }
  if (
    /\b(boden|floor|sol)\b/.test(key) &&
    !/\b(reinigen|reinigung|clean|nettoyage|pulizia|limpieza)\b/.test(key)
  ) {
    return `${grammarCleaned.replace(/^./, (char) => char.toUpperCase())} reinigen`;
  }
  if (
    /\b(fenster|glas|glasflaechen|glasflächen)\b/.test(key) &&
    !hasVisibleGermanWorkActionV17_37(cleaned)
  ) {
    return `${grammarCleaned.replace(/^./, (char) => char.toUpperCase())} reinigen`;
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

  return grammarCleaned.replace(/^./, (char) => char.toUpperCase());
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


// V17.90: Fail-closed service-name safety guard.
// Zweck: Die KI darf Leistungsnamen vorschlagen, aber sichtbare Satzreste,
// Termin-/Kontakt-/Zugangshinweise oder Rohsprache dürfen nicht gespeichert
// werden. Wenn ein sauberer line-local Name aus derselben Mengen-/Preis-Evidence
// ableitbar ist, wird repariert. Wenn nicht, wird hart auf "Leistung prüfen"
// blockiert. Keine Service-Wortliste: geprüft wird Struktur/Evidence/Sprache.
function automaticTranslationBlockV17_90(originalText: string): string {
  const source = String(originalText || "");
  const marker = source.match(/\n+---\s*(?:Übersetzung \(automatisch\)|Uebersetzung \(automatisch\)|Automatic translation)\s*---\s*\n/i);
  if (!marker || marker.index == null) return "";
  return source.slice(marker.index + marker[0].length).trim();
}

function serviceNameSafetyKeyV17_90(value?: string | null): string {
  return normalizeCompare(value || "")
    .replace(/\b(?:chf|eur|franken|euro|stutz)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function serviceNameHasForbiddenSentencePartsV17_90(value?: string | null): boolean {
  const raw = normalizeText(value || "");
  const key = serviceNameSafetyKeyV17_90(raw);
  if (!key) return true;

  if (/\b(?:menge|anzahl|preis|einheit)\s*:/i.test(raw)) return true;
  if (/\b(?:pro|je|per|par|à|a)\s*(?:m2|m²|qm|quadratmeter|stk|stück|stueck|pcs|pauschal)\b/i.test(raw)) return true;
  if (raw.length > 90 || key.split(/\s+/g).filter(Boolean).length > 10) return true;

  // Meta-/Hinweis-/Termin-/Kontakt-/Zugangssprache. Das ist keine Service-
  // Wortliste, sondern verbietet Kategorien, die nie sichtbare Leistung sind.
  if (
    /\b(?:bitte|merci|please|morgen|heute|vormittag|nachmittag|abend|uhr|termin|erledigen|ausfuehren|ausführen|kommen|vorbeikommen|vorher|vorankündigung|vorankuendigung|melden|anrufen|schreiben|sms|whatsapp|telefon|e\s*mail|email|mail|torcode|zugang|schluessel|schlüssel|code|rechnung|facture|factura|fattura|adresse|ausfuehrung|ausführung|chantier|exécution|execution)\b/.test(key)
  ) {
    return true;
  }

  // Ein sichtbarer Name darf nicht wie ein ganzer Kundensatz aussehen.
  if (/[.!?]\s+/.test(raw) || /,\s*(?:menge|preis|pro|je|à|a)\b/i.test(raw)) return true;

  return false;
}

function serviceNameLooksLikeUntranslatedRawV17_90(value?: string | null): boolean {
  const key = serviceNameSafetyKeyV17_90(value || "");
  if (!key) return true;
  // Sprach-/Rohmarker, keine fachliche Service-Wortliste. Wenn eine deutsche
  // Arbeitsfassung existiert, sollen diese Rohformen nicht sichtbar bleiben.
  return /\b(?:cave|vitres?|fenetres?|fenêtres?|couloir|sol|nettoyage|deplacement|déplacement|local\s+technique|immeuble|chantier|pcs|piece|pieces|pi[eè]ces)\b/.test(key);
}

function lineHasSameQuantityAndPriceV17_90(
  line: string,
  item: ParsedOrderItemForValidation,
): boolean {
  const quantity = Number(item.quantity || 0);
  const price = Number(item.unitPrice || 0);
  if (!Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(price) || price <= 0) {
    return false;
  }

  const normalized = normalizeCompare(line);
  if (!normalized) return false;

  const quantityPatterns = [
    new RegExp(`\\b${String(quantity).replace('.', '[.,]')}\\b`),
    new RegExp(`\\b${Math.trunc(quantity)}\\b`),
  ];
  const pricePatterns = [
    new RegExp(`\\b${String(price).replace('.', '[.,]')}\\b`),
    new RegExp(`\\b${Math.trunc(price)}(?:[.,]00)?\\b`),
  ];

  return quantityPatterns.some((pattern) => pattern.test(normalized)) &&
    pricePatterns.some((pattern) => pattern.test(normalized));
}

function candidateServiceNameFromLineV17_90(line: string): string {
  const candidate = cleanValidationServiceDisplayName(line);
  if (!candidate || normalizeCompare(candidate) === "unbekannte leistung") return "";
  if (serviceNameHasForbiddenSentencePartsV17_90(candidate)) return "";
  return candidate;
}

function safeServiceNameFromOwnEvidenceV17_90(
  item: ParsedOrderItemForValidation,
): string {
  const source = [item.sourceText, item.evidence, item.description]
    .map((part) => normalizeText(part))
    .filter(Boolean)
    .join("\n");
  if (!source) return "";

  const lines = source
    .split(/\n+/g)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => lineHasSameQuantityAndPriceV17_90(line, item));

  for (const line of lines) {
    const candidate = candidateServiceNameFromLineV17_90(line);
    if (candidate) return candidate;
  }

  return "";
}

function safeServiceNameFromTranslatedEvidenceV17_90(
  originalText: string,
  item: ParsedOrderItemForValidation,
): string {
  const translated = automaticTranslationBlockV17_90(originalText);
  if (!translated) return "";

  const lines = translated
    .split(/\n+/g)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => lineHasSameQuantityAndPriceV17_90(line, item));

  for (const line of lines) {
    const candidate = candidateServiceNameFromLineV17_90(line);
    if (candidate) return candidate;
  }

  return "";
}

function applyFailClosedServiceNameSafetyGuardV17_90(
  originalText: string,
  items: ParsedOrderItemForValidation[],
): { items: ParsedOrderItemForValidation[]; reviewReasons: string[] } {
  const reviewReasons: string[] = [];
  const hasTranslation = Boolean(automaticTranslationBlockV17_90(originalText));

  const guarded = items.map((item) => {
    const cleanedCurrent = cleanValidationServiceDisplayName(item.serviceName);
    const translatedCandidate = safeServiceNameFromTranslatedEvidenceV17_90(originalText, item);
    const ownCandidate = safeServiceNameFromOwnEvidenceV17_90(item);

    const currentUnsafe =
      serviceNameHasForbiddenSentencePartsV17_90(cleanedCurrent) ||
      normalizeCompare(cleanedCurrent) === "unbekannte leistung" ||
      (hasTranslation && serviceNameLooksLikeUntranslatedRawV17_90(cleanedCurrent));

    if (!currentUnsafe) {
      return { ...item, serviceName: cleanedCurrent };
    }

    const repairedName = translatedCandidate || ownCandidate;
    if (repairedName) {
      return {
        ...item,
        serviceName: repairedName,
        reviewReason: item.reviewReason?.startsWith("price_unclear:")
          ? `price_unclear:${repairedName}`
          : item.reviewReason,
      };
    }

    const blockedReason = `service_name_review:${cleanedCurrent || "unknown"}`;
    reviewReasons.push(blockedReason, "service_name_review");
    return {
      ...item,
      serviceName: "Leistung prüfen",
      totalPrice: 0,
      needsReview: true,
      reviewReason: blockedReason,
    };
  });

  return { items: guarded, reviewReasons: unique(reviewReasons) };
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
    /\b(preis\s+(?:wie\s+letztes\s+mal|wie\s+immer|wie\s+gehabt|offen|unklar|unbekannt|folgt|erst\s+nach\s+besichtigung|nach\s+besichtigung|normal|standard|muss\s+(?:noch\s+)?(?:geprueft|pruefen|abgeklaert|abklaeren)|noch\s+(?:pruefen|abklaeren|offen))|wie\s+letztes\s+mal|wie\s+immer|wie\s+gehabt|gleicher\s+preis|letzter\s+preis|normaler\s+preis|standardpreis|nach\s+aufwand|ungefaehr|ungefahr|ca\.?|circa)\b/i.test(
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


// V17.90L79: Locate the actual unclear-price phrase. This prevents a later
// "Material nach Aufwand" fragment in a chaotic one-line message from
// invalidating an earlier fully priced service.
function unclearPriceSignalIndexV17_90L79(value?: string | null): number {
  const source = normalizeText(value);
  const match = source.match(
    /\b(?:preis\s+(?:offen|unklar|unbekannt|folgt|erst\s+nach\s+besichtigung|nach\s+besichtigung|noch\s+(?:pruefen|prüfen|abklaeren|abklären|offen))|nach\s+aufwand|tbd|price\s+(?:open|unclear|unknown)|prix\s+(?:ouvert|incertain|inconnu))\b/i,
  );
  return match?.index ?? -1;
}

function findQuantityOnlyUnclearLine(line: string): {
  quantity: number;
  unitType: string;
  quantityRaw: string;
} | null {
  if (!hasUnclearPriceSignal(line)) return null;
  const unclearIndex = unclearPriceSignalIndexV17_90L79(line);
  if (unclearIndex > 0) {
    const beforeUnclear = line.slice(0, unclearIndex);
    const unclearTail = line.slice(unclearIndex);
    const tailHasOwnQuantity = new RegExp(
      `\\b${QUANTITY_NUMBER_OR_WORD}\\s*${UNIT_WORDS}\\b`,
      "i",
    ).test(unclearTail);
    if (
      !tailHasOwnQuantity &&
      (hasExplicitCurrencyAmount(beforeUnclear) ||
        extractUnitPricesFromSegment(beforeUnclear).length > 0)
    ) {
      return null;
    }
  }
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

// V17.90L37: Einzeilige WhatsApp-Texte können mehrere vollständig bepreiste
// Leistungen ohne Zeilenumbruch enthalten, z. B.
// "Boden ... CHF 8 Fenster ... CHF 9 Travel cost EUR 35".
// Die bisherige Mengenaufteilung verlor dabei den Leistungsanfang der zweiten
// Position und liess die letzte Fremdwährungsposition unsichtbar.
// Diese strukturelle Aufteilung trennt ausschliesslich an aufeinanderfolgenden
// Währungs-/Betragsankern. Sie kennt keine Leistungswortliste.
function splitSequentialCurrencyPricedSegmentsV17_90L37(
  value?: string | null,
): string[] {
  const source = normalizeText(value);
  if (!source) return [];

  const result: string[] = [];
  const logicalLines = source
    .split(/\n+|;|\s+•\s+|\s+\|\s+/g)
    .map((line) => normalizeText(line))
    .filter(Boolean);

  const amountAnchor =
    /(?:\b(?:CHF|EUR|USD|GBP)\b|[€$£])\s*\d+(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?\s*(?:\b(?:CHF|EUR|USD|GBP)\b|[€$£])/gi;

  for (const line of logicalLines) {
    const anchors: Array<{ index: number; end: number }> = [];
    amountAnchor.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = amountAnchor.exec(line)) !== null) {
      anchors.push({ index: match.index, end: match.index + match[0].length });
    }

    if (anchors.length < 2) continue;

    let start = 0;
    for (const anchor of anchors) {
      const segment = line
        .slice(start, anchor.end)
        .replace(/^\s*(?:[,.;:|+]|und\b|and\b|et\b|e\b)+\s*/i, "")
        .replace(/\s+/g, " ")
        .trim();
      start = anchor.end;

      if (segment.length < 4 || !/[A-Za-zÀ-ÖØ-öø-ÿÄÖÜäöüß]/.test(segment))
        continue;
      result.push(segment);
    }
  }

  return unique(result);
}

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

  const sequentialCurrencyPricedSegments =
    splitSequentialCurrencyPricedSegmentsV17_90L37(source);

  const candidateLines = unique([
    ...originalLines,
    ...quantitySplitLines,
    ...sequentialCurrencyPricedSegments,
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
        `${PRICE_NUMBER}\\s*(?:pro|je|per|par|at|à|a|/)\\s*${UNIT_WORDS}\\b`,
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

  // If a full original line exists, drop only a generated quantity-only
  // suffix. Semantically complete suffixes such as "Travel cost EUR 35" must
  // remain, otherwise the only foreign-currency position becomes invisible.
  return candidateLines.filter((line) => {
    const key = normalizeCompare(line);
    if (!key) return false;

    const startsWithBareQuantityAndUnit = new RegExp(
      `^${QUANTITY_NUMBER_OR_WORD}\\s*${UNIT_WORDS}(?=\\b|\\s|[.,;:!?)])`,
      "i",
    ).test(line);
    if (!startsWithBareQuantityAndUnit) return true;

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
        `(?:preis|einzelpreis)\\s*(?:pro|je|per|par|at|à|a|/)\\s*(${UNIT_WORDS})\\s*(${CURRENCY_WORDS})\\s*${PRICE_NUMBER}\\b`,
        "i",
      ),
      currencyGroup: 1,
      priceGroup: 2,
    },
    {
      re: new RegExp(
        `(?:preis|einzelpreis)\\s*(?:pro|je|per|par|at|à|a|/)\\s*(${UNIT_WORDS})\\s*${PRICE_NUMBER}\\s*(${CURRENCY_WORDS})\\b`,
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
        `(${CURRENCY_WORDS})\\s*${PRICE_NUMBER}\\s*(?:pro|je|per|par|at|à|a|/)\\s*(${UNIT_WORDS})\\b`,
        "i",
      ),
      currencyGroup: 1,
      priceGroup: 2,
      unitGroup: 3,
    },
    {
      re: new RegExp(
        `${PRICE_NUMBER}\\s*(${CURRENCY_WORDS})\\s*(?:pro|je|per|par|at|à|a|/)\\s*(${UNIT_WORDS})\\b`,
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
        `(?:preis|einzelpreis)\\s*(?:pro|je|per|par|at|à|a|/)\\s*(${UNIT_WORDS})\\s*(${CURRENCY_WORDS})\\s*${PRICE_NUMBER}\\b`,
        "i",
      ),
      unitGroup: 1,
      currencyGroup: 2,
      priceGroup: 3,
    },
    {
      re: new RegExp(
        `(?:preis|einzelpreis)\\s*(?:pro|je|per|par|at|à|a|/)\\s*(${UNIT_WORDS})\\s*${PRICE_NUMBER}\\s*(${CURRENCY_WORDS})\\b`,
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
        `${PRICE_NUMBER}\\s*(?:pro|je|per|par|at|à|a|/)\\s*(${UNIT_WORDS})\\b`,
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
  const marker = FLAT_FEE_PRICE_MARKER_V17_90L95;
  const patterns: Array<{
    re: RegExp;
    currencyGroup?: number;
    priceGroup: number;
  }> = [
    {
      re: new RegExp(
        `\\b${marker}\\b[^\\n.;|]{0,32}?(?:ist|von|zu|=|:)?\\s*(${CURRENCY_WORDS})\\s*${PRICE_NUMBER}\\b`,
        "i",
      ),
      currencyGroup: 1,
      priceGroup: 2,
    },
    {
      re: new RegExp(
        `\\b${marker}\\b[^\\n.;|]{0,32}?(?:ist|von|zu|=|:)?\\s*${PRICE_NUMBER}\\s*(${CURRENCY_WORDS})\\b`,
        "i",
      ),
      currencyGroup: 2,
      priceGroup: 1,
    },
    {
      re: new RegExp(
        `(${CURRENCY_WORDS})\\s*${PRICE_NUMBER}\\s*${marker}\\b`,
        "i",
      ),
      currencyGroup: 1,
      priceGroup: 2,
    },
    {
      re: new RegExp(
        `\\b${marker}\\b\\s*(?:ist|von|zu|=|:)?\\s*${PRICE_NUMBER}\\b`,
        "i",
      ),
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
      new RegExp(`\\b(?:pro|je|per|par|at|à|a|/)\\s*${UNIT_WORDS}\\b`, "gi"),
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

  cleaned = cleanServiceLabelContextNoiseV17_90L27(cleaned);
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

// V17.90L37: Letzte Absicherung für explizite Fremdwährungsbeträge. Manche
// spätere semantische Aufräumpässe entfernen eine bereits erkannte 0-Preis-
// Position wieder. Vor dem Persistieren wird deshalb jede klar bepreiste
// Fremdwährungszeile nochmals als eigene, bearbeitbare Prüfposition ergänzt.
function appendMissingForeignCurrencyReviewItemsV17_90L37(
  originalText: string,
  items: ParsedOrderItemForValidation[],
  finalCurrency: IntakeCurrency,
): { items: ParsedOrderItemForValidation[]; reviewReasons: string[] } {
  const explicitForeignItems = extractExplicitServiceLineItems(
    originalText,
    finalCurrency,
  ).filter((item) => {
    const currency = String(item.detectedCurrency || "").toUpperCase();
    return Boolean(currency && currency !== finalCurrency);
  });
  if (explicitForeignItems.length === 0) {
    return { items, reviewReasons: [] };
  }

  const next = [...items];
  const reviewReasons: string[] = [];

  for (const explicit of explicitForeignItems) {
    const currency = String(explicit.detectedCurrency || "UNKNOWN").toUpperCase();
    const evidenceKey = normalizeCompare(
      explicit.sourceText || explicit.evidence || explicit.description,
    );
    const serviceName =
      String(explicit.serviceName || "").trim() || "Leistung prüfen";
    const alreadyRepresented = next.some((item) => {
      const itemCurrency = String(item.detectedCurrency || "").toUpperCase();
      const itemEvidence = normalizeCompare(
        [item.sourceText, item.evidence, item.description].filter(Boolean).join(" "),
      );
      return Boolean(
        itemCurrency === currency &&
          evidenceKey &&
          itemEvidence &&
          (itemEvidence.includes(evidenceKey) || evidenceKey.includes(itemEvidence)),
      );
    });
    if (alreadyRepresented) continue;

    const reason = `item_currency_mismatch:${serviceName}:${currency}:${finalCurrency}`;
    next.push({
      ...explicit,
      serviceName,
      quantity: Number(explicit.quantity || 0) > 0 ? Number(explicit.quantity) : 1,
      unit: explicit.unit || "Pauschal",
      unitPrice: 0,
      totalPrice: 0,
      needsReview: true,
      reviewReason: reason,
      description: explicit.sourceText || explicit.description,
      sourceText: explicit.sourceText || explicit.description,
      evidence: explicit.evidence || explicit.sourceText || explicit.description,
      detectedCurrency: currency,
    });
    reviewReasons.push("currency_review", "currency_conflict", reason);
  }

  return { items: next, reviewReasons: unique(reviewReasons) };
}


// V17.90L39: Finaler deterministischer Konsolidierer für Mischwährungen.
// Ziel: genau eine bearbeitbare Position pro expliziter Fremdwährungszeile,
// keine zusätzliche leere "Leistung prüfen"-Zeile und strikt zeilenlokale
// Evidence für die korrekten Positionen.
function isGenericOpenReviewServiceNameV17_90L39(
  value?: string | null,
): boolean {
  const key = normalizeCompare(value || "");
  return (
    !key ||
    key === "leistung pruefen" ||
    key === "leistung prufen" ||
    key === "unbekannte leistung" ||
    key === "unklare leistung" ||
    key.includes("leistung suchen") ||
    key.includes("leistung eingeben")
  );
}

function itemEvidenceKeyV17_90L39(
  item: ParsedOrderItemForValidation,
): string {
  return normalizeCompare(
    [item.sourceText, item.evidence, item.description]
      .filter(Boolean)
      .join(" "),
  );
}


function trimExplicitEvidenceToServiceLineV17_90L39(
  sourceText?: string | null,
  serviceName?: string | null,
): string {
  const source = normalizeText(sourceText || "");
  const words = String(serviceName || "")
    .replace(/[^A-Za-zÀ-ÖØ-öø-ÿÄÖÜäöüß0-9]+/g, " ")
    .split(/\s+/g)
    .filter(Boolean);
  if (!source || words.length === 0) return source;

  const pattern = new RegExp(
    words
      .map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join("\\s+"),
    "ig",
  );
  const matches = Array.from(source.matchAll(pattern));
  const last = matches[matches.length - 1];
  if (!last || last.index == null) return source;
  return source.slice(last.index).replace(/^\s*[,;:\-–—]+\s*/, "").trim();
}

function explicitLineMatchesNumericItemV17_90L39(
  item: ParsedOrderItemForValidation,
  explicit: ExplicitServiceLineItem,
): boolean {
  const quantityMatches =
    Math.abs(Number(item.quantity || 0) - Number(explicit.quantity || 0)) <
    0.001;
  const priceMatches =
    Math.abs(Number(item.unitPrice || 0) - Number(explicit.unitPrice || 0)) <
    0.01;
  const itemUnit = unitTypeFromDisplayUnit(item.unit);
  const explicitUnit = unitTypeFromDisplayUnit(explicit.unit);
  return Boolean(
    quantityMatches &&
      priceMatches &&
      (!itemUnit || !explicitUnit || itemUnit === explicitUnit),
  );
}

function finalizeForeignCurrencyReviewItemsV17_90L39(
  originalText: string,
  items: ParsedOrderItemForValidation[],
  finalCurrency: IntakeCurrency,
): ParsedOrderItemForValidation[] {
  const explicitItems = extractExplicitServiceLineItems(
    originalText,
    finalCurrency,
  );
  if (explicitItems.length === 0) return items;

  // 1) Zeilenlokale Evidence für vollständige Positionen erzwingen.
  let next = items.map((item) => {
    if (Number(item.unitPrice || 0) <= 0 || Number(item.quantity || 0) <= 0) {
      return item;
    }

    const matching = explicitItems.filter((explicit) => {
      const currency = String(explicit.detectedCurrency || "").toUpperCase();
      return (
        currency === finalCurrency &&
        explicitLineMatchesNumericItemV17_90L39(item, explicit)
      );
    });
    if (matching.length === 0) return item;

    const itemName = normalizeCompare(item.serviceName);
    const ranked = matching
      .map((explicit) => {
        const explicitName = normalizeCompare(explicit.serviceName);
        const explicitEvidence = normalizeCompare(explicit.sourceText);
        const currentEvidence = itemEvidenceKeyV17_90L39(item);
        let score = 0;
        if (itemName && explicitName && itemName === explicitName) score += 50;
        if (
          itemName &&
          explicitName &&
          (itemName.includes(explicitName) || explicitName.includes(itemName))
        ) {
          score += 25;
        }
        if (
          explicitEvidence &&
          currentEvidence &&
          (currentEvidence.includes(explicitEvidence) ||
            explicitEvidence.includes(currentEvidence))
        ) {
          score += 20;
        }
        return {
          explicit,
          score,
          length: normalizeText(explicit.sourceText).length,
        };
      })
      .sort((a, b) => b.score - a.score || a.length - b.length);

    const exact = ranked[0]?.explicit;
    if (!exact) return item;

    const reason = String(item.reviewReason || "");
    const numericReviewResolved =
      reason.startsWith("price_unclear:") ||
      reason === "unit_price_review" ||
      reason === "quantity_review";

    const lineLocalEvidence = trimExplicitEvidenceToServiceLineV17_90L39(
      exact.sourceText,
      item.serviceName || exact.serviceName,
    );

    return {
      ...item,
      description: lineLocalEvidence,
      sourceText: lineLocalEvidence,
      evidence: lineLocalEvidence,
      detectedCurrency: finalCurrency,
      needsReview: numericReviewResolved ? false : item.needsReview,
      reviewReason: numericReviewResolved ? null : item.reviewReason,
    };
  });

  const foreignExplicitCandidates = explicitItems.filter((explicit) => {
    const currency = String(explicit.detectedCurrency || "").toUpperCase();
    return Boolean(currency && currency !== finalCurrency);
  });

  // V17.90L42: Eine konkrete Fremdwährungsquelle darf nur einmal verarbeitet
  // werden. KI-Original, automatische Übersetzung und späterer Validator können
  // dieselbe Kostenposition unterschiedlich benennen; entscheidend sind hier
  // ausschließlich Quellposition, Betrag und Währung, nicht eine Wortliste.
  const rawForeignAnchors = extractRawForeignCurrencyAmountsV17_90L41(
    originalText,
    finalCurrency,
  );
  const usedForeignCandidateIndexes = new Set<number>();
  const foreignExplicitItems = rawForeignAnchors
    .map((anchor) => {
      const ranked = foreignExplicitCandidates
        .map((explicit, index) => {
          if (usedForeignCandidateIndexes.has(index)) return null;
          const currency = String(explicit.detectedCurrency || "")
            .trim()
            .toUpperCase();
          if (currency !== anchor.currency) return null;

          const evidence = normalizeText(
            [explicit.sourceText, explicit.evidence, explicit.description]
              .filter(Boolean)
              .join(" "),
          );
          if (
            explicitCurrencyForExactItemPriceV17_90L41(
              evidence,
              anchor.amount,
            ) !== anchor.currency
          ) {
            return null;
          }

          const evidenceKey = normalizeCompare(evidence);
          const anchorKey = normalizeCompare(anchor.evidence);
          let score = 0;
          if (
            evidenceKey &&
            anchorKey &&
            (evidenceKey.includes(anchorKey) ||
              anchorKey.includes(evidenceKey))
          ) {
            score += 100;
          }
          if (!isGenericOpenReviewServiceNameV17_90L39(explicit.serviceName)) {
            score += 20;
          }

          return { explicit, index, score, length: evidence.length };
        })
        .filter(
          (entry): entry is {
            explicit: ExplicitServiceLineItem;
            index: number;
            score: number;
            length: number;
          } => Boolean(entry),
        )
        .sort((a, b) => b.score - a.score || a.length - b.length);

      const selected = ranked[0];
      if (!selected) return null;
      usedForeignCandidateIndexes.add(selected.index);
      return selected.explicit;
    })
    .filter(
      (item): item is ExplicitServiceLineItem => Boolean(item),
    );

  // Fallback für ältere Texte, bei denen kein stabiler Rohanker erzeugt werden
  // konnte: identische Evidence weiterhin nur einmal verwenden.
  const effectiveForeignExplicitItems =
    foreignExplicitItems.length > 0
      ? foreignExplicitItems
      : Array.from(
          new Map(
            foreignExplicitCandidates.map((item) => [
              `${String(item.detectedCurrency || "").toUpperCase()}:${normalizeCompare(
                item.sourceText || item.evidence || item.description,
              )}`,
              item,
            ]),
          ).values(),
        );

  if (effectiveForeignExplicitItems.length === 0) return next;

  const keepForeignIndexes = new Set<number>();

  for (const explicit of effectiveForeignExplicitItems) {
    const currency = String(explicit.detectedCurrency || "UNKNOWN").toUpperCase();
    const explicitEvidence = normalizeCompare(explicit.sourceText);
    const normalizedExplicit = normalizeParsedServiceNames([explicit])[0] || explicit;
    const serviceName =
      String(normalizedExplicit.serviceName || explicit.serviceName || "").trim() ||
      "Leistung prüfen";

    const candidates = next
      .map((item, index) => {
        if (keepForeignIndexes.has(index)) return null;
        const itemCurrency = String(item.detectedCurrency || "").toUpperCase();
        const itemReason = String(item.reviewReason || "");
        const evidence = itemEvidenceKeyV17_90L39(item);
        const itemName = normalizeCompare(item.serviceName);
        const explicitName = normalizeCompare(serviceName);
        const isCurrencyReview =
          itemCurrency === currency ||
          itemReason.startsWith("item_currency_mismatch:") ||
          itemReason.startsWith("currency_conflict_item:");
        if (!isCurrencyReview) return null;

        let score = 0;
        if (itemCurrency === currency) score += 40;
        if (
          explicitEvidence &&
          evidence &&
          (evidence.includes(explicitEvidence) ||
            explicitEvidence.includes(evidence))
        ) {
          score += 100;
        }
        if (!isGenericOpenReviewServiceNameV17_90L39(item.serviceName)) {
          score += 20;
        }
        if (
          itemName &&
          explicitName &&
          (itemName === explicitName ||
            itemName.includes(explicitName) ||
            explicitName.includes(itemName))
        ) {
          score += 30;
        }
        return { index, score };
      })
      .filter((candidate): candidate is { index: number; score: number } =>
        Boolean(candidate),
      )
      .sort((a, b) => b.score - a.score);

    let selectedIndex = candidates[0]?.index ?? -1;
    const reason = `item_currency_mismatch:${serviceName}:${currency}:${finalCurrency}`;
    const reviewItem: ParsedOrderItemForValidation = {
      ...explicit,
      serviceName,
      description: explicit.sourceText,
      sourceText: explicit.sourceText,
      evidence: explicit.sourceText,
      quantity: Number(explicit.quantity || 0) > 0 ? Number(explicit.quantity) : 1,
      unit: explicit.unit || "Pauschal",
      unitPrice: 0,
      totalPrice: 0,
      needsReview: true,
      reviewReason: reason,
      detectedCurrency: currency,
    };

    if (selectedIndex >= 0) {
      next[selectedIndex] = { ...next[selectedIndex], ...reviewItem };
    } else {
      selectedIndex = next.length;
      next.push(reviewItem);
    }
    keepForeignIndexes.add(selectedIndex);
  }

  // 2) Doppelte Fremdwährungsartefakte und leere generische Prüfzeilen entfernen.
  return next.filter((item, index) => {
    if (keepForeignIndexes.has(index)) return true;

    const itemCurrency = String(item.detectedCurrency || "").toUpperCase();
    const reason = String(item.reviewReason || "");
    const isForeignReview =
      (itemCurrency && itemCurrency !== finalCurrency) ||
      reason.startsWith("item_currency_mismatch:") ||
      reason.startsWith("currency_conflict_item:");
    if (isForeignReview) return false;

    const genericEvidence = itemEvidenceKeyV17_90L39(item);
    const genericEvidenceIsOnlyUiWarning =
      !genericEvidence ||
      /^(?:leistung|einheit|preis|menge)(?: oder | und )?.*(?:unklar|pruefen|prufen)|^(?:vor angebot rechnung pruefen|diese position wird nicht in netto|preis fehlt oder ist unsicher)/.test(
        genericEvidence,
      );
    const genericEvidenceDuplicatesForeignLine = effectiveForeignExplicitItems.some(
      (explicit) => {
        const foreignEvidence = normalizeCompare(explicit.sourceText);
        return Boolean(
          genericEvidence &&
            foreignEvidence &&
            (genericEvidence.includes(foreignEvidence) ||
              foreignEvidence.includes(genericEvidence)),
        );
      },
    );
    const isEmptyGenericReview =
      isGenericOpenReviewServiceNameV17_90L39(item.serviceName) &&
      Number(item.unitPrice || 0) <= 0 &&
      Number(item.totalPrice || 0) <= 0 &&
      (genericEvidenceIsOnlyUiWarning || genericEvidenceDuplicatesForeignLine);
    if (isEmptyGenericReview) return false;

    return true;
  });
}


// V17.90L41: Letzte positionsbezogene Währungsabsicherung. Wenn exakt der
// gespeicherte Positionspreis in derselben Evidence mit einer anderen Währung
// steht, darf dieser Betrag niemals still als Auftragswährung berechnet werden.
// Beispiel: Auftrag CHF, Evidence "Anfahrt 35 Euro" -> Preis bleibt 0 und die
// Position wird als Währung prüfen gespeichert. Andere CHF-Positionen im selben
// chaotischen Einzeiler bleiben unberührt, weil nur der exakt gebundene Betrag
// geprüft wird.
function explicitCurrencyForExactItemPriceV17_90L41(
  evidence: string,
  unitPrice: number,
): string | null {
  if (!evidence || !Number.isFinite(unitPrice) || unitPrice <= 0) return null;

  const normalizedAmount = String(unitPrice)
    .replace(/\.0+$/, "")
    .replace(/(\.\d*?)0+$/, "$1");
  const amountPattern = escapeRegExp(normalizedAmount).replace("\\.", "[.,]");
  const currencyPatterns: Array<[string, string]> = [
    ["CHF", "(?:chf|franken|fr\\.?|sfr\\.?|stutz)"],
    ["EUR", "(?:eur|euro|€)"],
    ["USD", "(?:usd|us-dollar|dollar|us\\$|\\$)"],
    ["GBP", "(?:gbp|pfund|pound|£)"],
  ];

  for (const [currency, token] of currencyPatterns) {
    const pattern = new RegExp(
      `(?:\\b${token}\\b\\s*${amountPattern}\\b|\\b${amountPattern}\\s*${token}\\b)`,
      "i",
    );
    if (pattern.test(evidence)) return currency;
  }

  return null;
}


type RawForeignCurrencyAmountV17_90L41 = {
  currency: string;
  amount: number;
  index: number;
  evidence: string;
};

function extractRawForeignCurrencyAmountsV17_90L41(
  originalText: string,
  finalCurrency: IntakeCurrency,
): RawForeignCurrencyAmountV17_90L41[] {
  const source = normalizeText(originalText || "");
  if (!source) return [];

  const currencyPatterns: Array<[string, string]> = [
    ["CHF", "(?:chf|franken|fr\\.?|sfr\\.?|stutz)"],
    ["EUR", "(?:eur|euro|€)"],
    ["USD", "(?:usd|us-dollar|dollar|us\\$|\\$)"],
    ["GBP", "(?:gbp|pfund|pound|£)"],
  ];
  const found: RawForeignCurrencyAmountV17_90L41[] = [];

  const add = (currency: string, rawAmount: string, index: number) => {
    if (currency === finalCurrency) return;
    const amount = Number(String(rawAmount || "").replace("'", "").replace(",", "."));
    if (!Number.isFinite(amount) || amount <= 0) return;
    const start = Math.max(0, index - 90);
    const end = Math.min(source.length, index + 90);
    const evidence = source
      .slice(start, end)
      .replace(/^.*?(?:\n|;|\.)\s*/s, "")
      .replace(/\s+/g, " ")
      .trim();
    const key = `${currency}:${amount}:${index}`;
    if (found.some((entry) => `${entry.currency}:${entry.amount}:${entry.index}` === key)) return;
    found.push({ currency, amount, index, evidence });
  };

  for (const [currency, token] of currencyPatterns) {
    const before = new RegExp(`\\b${token}\\b\\s*(${PRICE_NUMBER})`, "gi");
    for (const match of source.matchAll(before)) {
      if (match.index == null) continue;
      add(currency, match[1], match.index);
    }
    const after = new RegExp(`(${PRICE_NUMBER})\\s*${token}\\b`, "gi");
    for (const match of source.matchAll(after)) {
      if (match.index == null) continue;
      add(currency, match[1], match.index);
    }
  }

  return found.sort((a, b) => a.index - b.index);
}

function appendRawForeignCurrencyReviewItemsV17_90L41(
  originalText: string,
  originalItems: ParsedOrderItemForValidation[],
  currentItems: ParsedOrderItemForValidation[],
  finalCurrency: IntakeCurrency,
): { items: ParsedOrderItemForValidation[]; reviewReasons: string[] } {
  const rawForeign = extractRawForeignCurrencyAmountsV17_90L41(
    originalText,
    finalCurrency,
  );
  if (rawForeign.length === 0) return { items: currentItems, reviewReasons: [] };

  const next = [...currentItems];
  const reviewReasons: string[] = [];

  for (const foreign of rawForeign) {
    const candidate = originalItems.find((item) => {
      const price = Number(item.unitPrice || 0);
      if (Math.abs(price - foreign.amount) >= 0.01) return false;
      const evidence = normalizeText(
        Array.from(
          new Set(
            [item.sourceText, item.evidence, item.description]
              .map((value) => String(value || "").trim())
              .filter(Boolean),
          ),
        ).join(" "),
      );
      return (
        explicitCurrencyForExactItemPriceV17_90L41(evidence, price) ===
        foreign.currency
      );
    });

    const candidateEvidence = normalizeText(
      Array.from(
        new Set(
          [candidate?.sourceText, candidate?.evidence, candidate?.description]
            .map((value) => String(value || "").trim())
            .filter(Boolean),
        ),
      ).join(" "),
    );
    const evidence = candidateEvidence || foreign.evidence;
    const evidenceKey = normalizeCompare(evidence);
    const alreadyRepresentedByEvidence = next.some((item) => {
      const reason = String(item.reviewReason || "");
      const currency = String(item.detectedCurrency || "").toUpperCase();
      const itemEvidence = itemEvidenceKeyV17_90L39(item);
      return Boolean(
        (currency === foreign.currency ||
          reason.startsWith("item_currency_mismatch:") ||
          reason.startsWith("currency_conflict_item:")) &&
          itemEvidence &&
          evidenceKey &&
          (itemEvidence.includes(evidenceKey) || evidenceKey.includes(itemEvidence)),
      );
    });

    // V17.90L42: Wenn für dieselbe Währung bereits genauso viele konkrete
    // Prüfpositionen existieren wie Rohquellen im Kundentext, darf der Fallback
    // keine weitere übersetzte/anders benannte Position anhängen. So werden
    // beispielsweise KI-Label und deutsche Normalisierung derselben Quelle
    // nicht als zwei Leistungen gespeichert.
    const rawSourceCountForCurrency = rawForeign.filter(
      (entry) => entry.currency === foreign.currency,
    ).length;
    const representedSourceCountForCurrency = next.filter((item) => {
      const reason = String(item.reviewReason || "");
      const currency = String(item.detectedCurrency || "")
        .trim()
        .toUpperCase();
      return Boolean(
        currency === foreign.currency ||
          (reason.startsWith("item_currency_mismatch:") &&
            reason.split(":")[2]?.toUpperCase() === foreign.currency) ||
          (reason.startsWith("currency_conflict_item:") &&
            reason.split(":")[2]?.toUpperCase() === foreign.currency),
      );
    }).length;

    if (
      alreadyRepresentedByEvidence ||
      (rawSourceCountForCurrency > 0 &&
        representedSourceCountForCurrency >= rawSourceCountForCurrency)
    ) {
      continue;
    }

    const serviceName =
      String(candidate?.serviceName || "").trim() || "Leistung prüfen";
    const reason = `item_currency_mismatch:${serviceName}:${foreign.currency}:${finalCurrency}`;
    next.push({
      serviceName,
      description: evidence,
      quantity: Number(candidate?.quantity || 0) > 0 ? Number(candidate?.quantity) : 1,
      unit: candidate?.unit || "Pauschal",
      unitPrice: 0,
      totalPrice: 0,
      needsReview: true,
      reviewReason: reason,
      sourceText: evidence,
      evidence,
      detectedCurrency: foreign.currency,
    });
    reviewReasons.push("currency_review", "currency_conflict", reason);
  }

  return { items: next, reviewReasons: unique(reviewReasons) };
}

function enforceExactItemCurrencyBindingV17_90L41(
  items: ParsedOrderItemForValidation[],
  finalCurrency: IntakeCurrency,
): { items: ParsedOrderItemForValidation[]; reviewReasons: string[] } {
  const reviewReasons: string[] = [];
  const guarded = items.map((item) => {
    const unitPrice = Number(item.unitPrice || 0);
    const evidence = normalizeText(
      Array.from(
        new Set(
          [item.sourceText, item.evidence, item.description]
            .map((value) => String(value || "").trim())
            .filter(Boolean),
        ),
      ).join(" "),
    );
    const explicitCurrency = explicitCurrencyForExactItemPriceV17_90L41(
      evidence,
      unitPrice,
    );

    if (!explicitCurrency || explicitCurrency === finalCurrency) return item;

    const serviceName =
      String(item.serviceName || "").trim() || "Leistung prüfen";
    const reason = `item_currency_mismatch:${serviceName}:${explicitCurrency}:${finalCurrency}`;
    reviewReasons.push("currency_review", "currency_conflict", reason);

    return {
      ...item,
      unitPrice: 0,
      totalPrice: 0,
      needsReview: true,
      reviewReason: reason,
      detectedCurrency: explicitCurrency,
      description: item.sourceText || item.evidence || item.description,
    };
  });

  const concreteForeignReviews = guarded.filter((item) => {
    const reason = String(item.reviewReason || "");
    const currency = String(item.detectedCurrency || "").toUpperCase();
    return Boolean(
      (currency && currency !== finalCurrency) ||
        reason.startsWith("item_currency_mismatch:") ||
        reason.startsWith("currency_conflict_item:"),
    );
  });

  if (concreteForeignReviews.length === 0) {
    return { items: guarded, reviewReasons: unique(reviewReasons) };
  }

  const foreignEvidence = concreteForeignReviews
    .map((item) => itemEvidenceKeyV17_90L39(item))
    .filter(Boolean);
  const seenForeignEvidence = new Set<string>();

  const consolidated = guarded.filter((item) => {
    const reason = String(item.reviewReason || "");
    const currency = String(item.detectedCurrency || "").toUpperCase();
    const isForeignReview = Boolean(
      (currency && currency !== finalCurrency) ||
        reason.startsWith("item_currency_mismatch:") ||
        reason.startsWith("currency_conflict_item:"),
    );
    const evidence = itemEvidenceKeyV17_90L39(item);

    if (isForeignReview && evidence) {
      const key = `${currency || "FOREIGN"}:${evidence}`;
      if (seenForeignEvidence.has(key)) return false;
      seenForeignEvidence.add(key);
      return true;
    }

    if (
      isGenericOpenReviewServiceNameV17_90L39(item.serviceName) &&
      Number(item.unitPrice || 0) <= 0 &&
      Number(item.totalPrice || 0) <= 0
    ) {
      const genericBoilerplate =
        !evidence ||
        /^(?:leistung|einheit|preis|menge|vor angebot rechnung|diese position wird nicht).*(?:unklar|pruefen|prufen|netto|total)?$/.test(
          evidence,
        );
      const duplicatesForeign = foreignEvidence.some((foreign) =>
        Boolean(
          evidence &&
            foreign &&
            (evidence.includes(foreign) || foreign.includes(evidence)),
        ),
      );
      if (genericBoilerplate || duplicatesForeign) return false;
    }

    return true;
  });

  return { items: consolidated, reviewReasons: unique(reviewReasons) };
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


function extractFinalMeasuredNameCandidatesV17_55(
  originalText: string,
  finalCurrency: IntakeCurrency,
): ExplicitServiceLineItem[] {
  const lines = normalizeText(originalText || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split(/\n+|;/g)
    .map((line) => line.trim())
    .filter((line) => line.length >= 8);

  const candidates: ExplicitServiceLineItem[] = [];
  for (const line of lines) {
    const key = normalizeCompare(line);
    if (!key) continue;
    if (/^(?:rechnung|invoice|facture|fattura|kunde|kundin|adresse|ausfuehrung|ausführung|execution|exécution|esecuzione|hinweis|hinweise|kontakt|telefon|tel|email|e-mail)\b/.test(key)) {
      continue;
    }
    if (!isPricedServiceLine(line)) continue;

    const quantityMatch = line.match(
      new RegExp(`\\b(${QUANTITY_NUMBER_OR_WORD})\\s*(${UNIT_WORDS})(?=\\b|\\s|[.,;:!?)])`, "i"),
    );
    if (!quantityMatch) continue;

    const unitPrice = findExplicitUnitPriceInLine(line, finalCurrency);
    if (!unitPrice || unitPrice.currency !== finalCurrency) continue;

    const quantity = parseQuantityNumber(quantityMatch[1]) || 0;
    const unitType = unitTypeFromText(quantityMatch[2]);
    if (!quantity || !unitType) continue;

    let serviceName = cleanMeasuredLineServiceNameV17_55(line, {
      quantityRaw: quantityMatch[0],
      priceRaw: unitPrice.raw,
    });

    if (normalizeCompare(serviceName) === "unbekannte leistung") continue;
    if (normalizeCompare(serviceName) === "anfahrt") continue;

    candidates.push({
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

  const bySignature = new Map<string, ExplicitServiceLineItem>();
  for (const candidate of candidates) {
    const signature = [
      roundMoney(candidate.quantity),
      unitTypeFromDisplayUnit(candidate.unit) || "",
      roundMoney(candidate.unitPrice),
      candidate.detectedCurrency || "",
      normalizeCompare(candidate.serviceName),
    ].join("|");
    const existing = bySignature.get(signature);
    if (!existing || semanticLineLocalNameScoreV17_53(candidate.serviceName) > semanticLineLocalNameScoreV17_53(existing.serviceName)) {
      bySignature.set(signature, candidate);
    }
  }

  return Array.from(bySignature.values());
}

function cleanMeasuredLineServiceNameV17_55(
  line: string,
  args: { quantityRaw?: string | null; priceRaw?: string | null },
): string {
  let name = normalizeText(line || "")
    .replace(/^[-–—•]+\s*/, "")
    .replace(/^\s*(?:leistungen?|arbeiten?|position|service)\s*:?\s*/i, " ");

  if (args.priceRaw) {
    name = name.replace(new RegExp(escapeRegExp(String(args.priceRaw)), "i"), " ");
  }
  if (args.quantityRaw) {
    name = name.replace(new RegExp(escapeRegExp(String(args.quantityRaw)), "i"), " ");
  }

  name = name
    .replace(/\b(?:zum\s+preis\s+von|zum\s+preis|preis\s+von|preis|einzelpreis|kosten)\b\s*:?/gi, " ")
    .replace(/\b(?:zu|für|fuer|par|per|pro|je|a|à)\b\s*$/gi, " ")
    .replace(/\b(?:zu|für|fuer|par|per|pro|je|a|à)\b\s*[.,;:!?-]*(?=\s*$)/gi, " ")
    .replace(/[.,;:!?-]+$/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  name = cleanGermanServiceNounArtifactsV17_48(
    stripServiceFieldLabelArtifactsV17_47(name),
  );
  name = cleanServiceLabelContextNoiseV17_90L27(name);
  name = cleanValidationServiceDisplayName(name);

  const key = normalizeCompare(name);
  if (!key || isPriceAnchorOnlyServiceName(name)) return "Unbekannte Leistung";
  return name.replace(/^./, (char) => char.toUpperCase());
}

function finalMeasuredCandidateShouldReplaceNameV17_55(
  item: ParsedOrderItemForValidation,
  candidate: ExplicitServiceLineItem,
): boolean {
  if (!sameMeasuredSignatureV17_50(item, candidate)) return false;

  const current = cleanValidationServiceDisplayName(item.serviceName);
  const proposed = cleanValidationServiceDisplayName(candidate.serviceName);
  const currentKey = normalizeCompare(current);
  const proposedKey = normalizeCompare(proposed);
  if (!proposedKey || proposedKey === "unbekannte leistung" || proposedKey === "anfahrt") return false;
  if (!currentKey || currentKey === "unbekannte leistung" || currentKey === "reinigung") return true;
  if (currentKey === proposedKey) return false;
  if (currentKey === "anfahrt") return false;

  const currentTokens = meaningfulServiceTokens(current);
  const proposedTokens = meaningfulServiceTokens(proposed);
  if (proposedTokens.length === 0) return false;

  const proposedAddsConcreteContext = proposedTokens.some((token) => !currentTokens.includes(token));
  if (!proposedAddsConcreteContext && !hasVisibleGermanWorkActionV17_37(proposed)) return false;

  const currentScore = semanticLineLocalNameScoreV17_53(current);
  const proposedScore = semanticLineLocalNameScoreV17_53(proposed);

  if (isBroadAreaOnlyServiceNameV17_54(current)) {
    return proposedScore >= 25;
  }

  if (!hasVisibleGermanWorkActionV17_37(current) && hasVisibleGermanWorkActionV17_37(proposed)) {
    return true;
  }

  if (proposedTokens.length > currentTokens.length && proposedScore >= currentScore - 25) {
    return true;
  }

  return proposedScore >= currentScore + 10;
}

function forceFinalMeasuredLineLocalNamesV17_55(
  originalText: string,
  items: ParsedOrderItemForValidation[],
  finalCurrency: IntakeCurrency,
): ParsedOrderItemForValidation[] {
  const candidates = extractFinalMeasuredNameCandidatesV17_55(originalText, finalCurrency);
  if (candidates.length === 0) return items;

  return items.map((item) => {
    if (normalizeCompare(item.serviceName) === "anfahrt") return item;

    const best = candidates
      .filter((candidate) => finalMeasuredCandidateShouldReplaceNameV17_55(item, candidate))
      .sort((a, b) => semanticLineLocalNameScoreV17_53(b.serviceName) - semanticLineLocalNameScoreV17_53(a.serviceName))[0];

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

function splitSemanticMeasuredNameSourcesV17_56(originalText: string): string[] {
  const translated = translatedSectionFromOriginalTextV17_35(originalText).trim();
  const primary = translated || originalText || "";

  return normalizeText(primary)
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split(/\n+|;/g)
    .map((line) => line.trim())
    .filter((line) => line.length >= 8);
}

function cleanExactMeasuredLineServiceNameV17_56(
  line: string,
  args: {
    quantityRaw?: string | null;
    priceRaw?: string | null;
    unitType?: string | null;
  },
): string {
  let name = normalizeText(line || "")
    .replace(/^[-–—•]+\s*/, "")
    .replace(/^\s*(?:leistungen?|arbeiten?|position|service)\s*:?\s*/i, " ");

  if (args.priceRaw) {
    name = name.replace(new RegExp(escapeRegExp(String(args.priceRaw)), "i"), " ");
  }
  if (args.quantityRaw) {
    name = name.replace(new RegExp(escapeRegExp(String(args.quantityRaw)), "i"), " ");
  }

  name = name
    .replace(/\b(?:zum\s+preis\s+von|zum\s+preis|preis\s+von|preis|einzelpreis|kosten)\b\s*:?/gi, " ")
    .replace(/\b(?:zu|für|fuer|par|per|pro|je|each|a|à|mal|x)\b\s*[.,;:!?-]*(?=\s*$)/gi, " ")
    .replace(/(?:^|\s)(?:à|je|each|mal|x|\*)(?=\s|$)/gi, " ")
    .replace(/[.,;:!?-]+$/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  name = cleanGermanServiceNounArtifactsV17_48(
    stripServiceFieldLabelArtifactsV17_47(name),
  );

  if (!name || isPriceAnchorOnlyServiceName(name)) return "Unbekannte Leistung";

  // V17.56: Exact line-local names must not be collapsed through the generic
  // catalog canonicalizer (for example "Kellerboden reinigen" -> "Boden reinigen").
  // This helper only removes structural amount/price fragments and keeps the
  // object/context wording from the priced line itself.
  const key = normalizeCompare(name);
  if (!key || key.length < 3) return "Unbekannte Leistung";
  if (normalizeCompare(name) === "anfahrts") return "Anfahrt";

  if (!hasVisibleGermanWorkActionV17_37(name) && key !== "anfahrt") {
    name = `${name} reinigen`;
  }

  // V17.57: avoid double action tails from exact measured lines such as
  // "Dachrinne hinten 14 Meter à CHF 9 sauber machen". The line-local
  // action "sauber machen" is already the work action; do not append
  // another generic "reinigen" behind it.
  name = name.replace(/\bsauber\s+machen\s+reinigen\b/gi, "sauber machen");

  name = cleanLineLocalServiceLabelGrammarV17_60(name);

  return normalizeText(name).replace(/^./, (char) => char.toUpperCase());
}

function extractExactSemanticMeasuredLineCandidatesV17_56(
  originalText: string,
  finalCurrency: IntakeCurrency,
): ExplicitServiceLineItem[] {
  const lines = splitSemanticMeasuredNameSourcesV17_56(originalText);
  const candidates: ExplicitServiceLineItem[] = [];

  for (const line of lines) {
    const key = normalizeCompare(line);
    if (!key) continue;
    if (/^(?:rechnung|invoice|facture|fattura|kunde|kundin|adresse|ausfuehrung|ausführung|execution|exécution|esecuzione|hinweis|hinweise|kontakt|telefon|tel|email|e-mail|whatsapp|sms|zugang|besonderheiten|schluessel|schlüssel)\b/.test(key)) {
      continue;
    }

    const quantityMatch = line.match(
      new RegExp(`\\b(${QUANTITY_NUMBER_OR_WORD})\\s*(${UNIT_WORDS})(?=\\b|\\s|[.,;:!?)])`, "i"),
    );
    if (!quantityMatch) continue;

    const unitPrice = findExplicitUnitPriceInLine(line, finalCurrency);
    if (!unitPrice || unitPrice.currency !== finalCurrency) continue;

    const quantity = parseQuantityNumber(quantityMatch[1]) || 0;
    const unitType = unitTypeFromText(quantityMatch[2]);
    if (!quantity || !unitType) continue;

    const serviceName = cleanExactMeasuredLineServiceNameV17_56(line, {
      quantityRaw: quantityMatch[0],
      priceRaw: unitPrice.raw,
      unitType,
    });
    if (normalizeCompare(serviceName) === "unbekannte leistung") continue;
    if (normalizeCompare(serviceName) === "anfahrt") continue;

    candidates.push({
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

  const bySignature = new Map<string, ExplicitServiceLineItem>();
  for (const candidate of candidates) {
    const signature = [
      roundMoney(candidate.quantity),
      unitTypeFromDisplayUnit(candidate.unit) || "",
      roundMoney(candidate.unitPrice),
      candidate.detectedCurrency || "",
      normalizeCompare(candidate.serviceName),
    ].join("|");
    const existing = bySignature.get(signature);
    if (!existing || semanticLineLocalNameScoreV17_53(candidate.serviceName) > semanticLineLocalNameScoreV17_53(existing.serviceName)) {
      bySignature.set(signature, candidate);
    }
  }

  return Array.from(bySignature.values());
}

function shouldForceExactSemanticMeasuredNameV17_56(
  item: ParsedOrderItemForValidation,
  candidate: ExplicitServiceLineItem,
): boolean {
  if (!sameMeasuredSignatureV17_50(item, candidate)) return false;

  const current = cleanValidationServiceDisplayName(item.serviceName);
  const proposed = cleanExactMeasuredLineServiceNameV17_56(candidate.serviceName, {});
  const currentKey = normalizeCompare(current);
  const proposedKey = normalizeCompare(proposed);
  if (!proposedKey || proposedKey === "unbekannte leistung" || proposedKey === "anfahrt") return false;
  if (currentKey === proposedKey) return false;
  if (!currentKey || currentKey === "unbekannte leistung" || currentKey === "reinigung") return true;
  if (currentKey === "anfahrt") return false;

  const currentTokens = meaningfulServiceTokens(current);
  const proposedTokens = meaningfulServiceTokens(proposed);
  if (proposedTokens.length === 0) return false;

  const overlap = proposedTokens.filter((token) => currentTokens.includes(token)).length;
  const currentScore = semanticLineLocalNameScoreV17_53(current);
  const proposedScore = semanticLineLocalNameScoreV17_53(proposed);

  if (isBroadAreaOnlyServiceNameV17_54(current)) return true;
  if (overlap === 0 && proposedTokens.length >= Math.max(1, currentTokens.length)) return true;
  if (!hasVisibleGermanWorkActionV17_37(current) && hasVisibleGermanWorkActionV17_37(proposed)) return true;
  if (proposedTokens.length > currentTokens.length && proposedScore >= currentScore - 35) return true;

  return proposedScore >= currentScore + 5;
}

function forceExactSemanticMeasuredLineNamesV17_56(
  originalText: string,
  items: ParsedOrderItemForValidation[],
  finalCurrency: IntakeCurrency,
): ParsedOrderItemForValidation[] {
  const candidates = extractExactSemanticMeasuredLineCandidatesV17_56(
    originalText,
    finalCurrency,
  );
  if (candidates.length === 0) return items;

  return items.map((item) => {
    if (normalizeCompare(item.serviceName) === "anfahrt") return item;

    const best = candidates
      .filter((candidate) => shouldForceExactSemanticMeasuredNameV17_56(item, candidate))
      .sort((a, b) => semanticLineLocalNameScoreV17_53(b.serviceName) - semanticLineLocalNameScoreV17_53(a.serviceName))[0];

    if (!best) return item;

    return {
      ...item,
      serviceName: cleanExactMeasuredLineServiceNameV17_56(best.serviceName, {}),
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
  // V17.90L72: structural unit matching only. Countable synonyms such as
  // Garnitur/Set remain the same unit type as Stück. This is not a service-word
  // list; it only binds the translated line to the same numeric item safely.
  const expectedUnitType = unitTypeFromDisplayUnit(item.unit);
  if (!expectedUnitType || expectedUnitType === "flat") return true;

  const translatedLineUnitType = unitTypeFromText(line);
  if (!translatedLineUnitType) return false;
  return translatedLineUnitType === expectedUnitType;
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
  return /\b(?:reinigen|reinigung|putzen|saeubern|sauber\s+machen|saubermachen|abstauben|entfernen|abstauben|abwischen|wischen|arbeiten|anfahrt|fahrtkosten|streichen|malen|schneiden|entsorgen|montieren|demontieren|reparieren|liefern|umstellen)\b/.test(key);
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

  // V17.90L72: the dedicated normalisation line is already bound to this
  // exact quantity, structural unit type and unit price. Prefer its complete
  // German label when it is not less informative than the current label. This
  // removes mixed forms such as "la salle ... reinigen" without a service
  // vocabulary list and still protects more specific existing German names.
  const currentInformationTokens = current
    .split(/\s+/g)
    .filter((token) => token.length >= 4);
  const translatedInformationTokens = translated
    .split(/\s+/g)
    .filter((token) => token.length >= 4);
  if (
    translatedHasAction &&
    translatedScore >= currentScore - 5 &&
    translatedInformationTokens.length >= currentInformationTokens.length
  ) {
    return true;
  }

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

    const cleanedServiceName = cleanValidationServiceDisplayName(candidate.serviceName);
    if (!cleanedServiceName || normalizeCompare(cleanedServiceName) === "unbekannte leistung") continue;
    const serviceName = isUnsafeGenericAreaMakeLineV17_90F(
      cleanedServiceName,
      candidate.raw,
    )
      ? "Leistung prüfen"
      : cleanedServiceName;

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


function originalCustomerTextOnlyV17_79(value?: string | null): string {
  return String(value || "")
    .replace(/\n+---\s*Übersetzung \(automatisch\)\s*---[\s\S]*$/i, "")
    .replace(/\n+---\s*Uebersetzung \(automatisch\)\s*---[\s\S]*$/i, "")
    .replace(/\n+---\s*Automatic translation\s*---[\s\S]*$/i, "")
    .trim();
}

type UnitlessTrailingQuantityPriceCandidateV17_79 = {
  raw: string;
  serviceName: string;
  quantity: number;
  unitPrice: number;
  currency: string | null;
  topic: string | null;
};

function extractUnitlessTrailingQuantityPriceCandidatesV17_79(
  originalText: string,
): UnitlessTrailingQuantityPriceCandidateV17_79[] {
  const source = originalCustomerTextOnlyV17_79(originalText);
  if (!source) return [];

  const lines = source
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split(/\n+|;/g)
    .map((line) => line.trim())
    .filter((line) => line.length >= 8)
    .filter((line) => !/^\s*\[?\s*(?:titel|title)\s*:/i.test(line));

  const candidates: UnitlessTrailingQuantityPriceCandidateV17_79[] = [];

  const patterns: Array<{
    regex: RegExp;
    serviceGroup: number;
    quantityGroup: number;
    currencyGroup?: number;
    priceGroup: number;
  }> = [
    {
      regex: new RegExp(
        `^\\s*(?!${QUANTITY_NUMBER_OR_WORD}\\s)(.{3,160}?)\\s+(${QUANTITY_NUMBER_OR_WORD})\\s*(?:à|a|zu|je|pro|per|at|/)\\s*(?:(${CURRENCY_WORDS})\\s*)?${PRICE_NUMBER}\\s*[.。!?)\\]]*\\s*$`,
        "i",
      ),
      serviceGroup: 1,
      quantityGroup: 2,
      currencyGroup: 3,
      priceGroup: 4,
    },
    {
      regex: new RegExp(
        `^\\s*(?!${QUANTITY_NUMBER_OR_WORD}\\s)(.{3,160}?)\\s+(${QUANTITY_NUMBER_OR_WORD})\\s*(?:à|a|zu|je|pro|per|at|/)\\s*${PRICE_NUMBER}\\s*(${CURRENCY_WORDS})\\s*[.。!?)\\]]*\\s*$`,
        "i",
      ),
      serviceGroup: 1,
      quantityGroup: 2,
      priceGroup: 3,
      currencyGroup: 4,
    },
  ];

  for (const line of lines) {
    if (hasQuantityWithExplicitUnit(line)) continue;
    if (isLikelyTravelFlatCostLine(line)) continue;

    for (const pattern of patterns) {
      const match = line.match(pattern.regex);
      if (!match) continue;

      const quantity = parseQuantityNumber(match[pattern.quantityGroup]);
      const unitPrice = parsePriceNumber(match[pattern.priceGroup]);
      if (!quantity || !unitPrice) continue;

      const serviceName = cleanExplicitServiceNameFromLine(line, {
        quantityRaw: match[pattern.quantityGroup],
        priceRaw: match[0],
      });

      const cleanName = cleanValidationServiceDisplayName(serviceName);
      if (!cleanName || normalizeCompare(cleanName) === "unbekannte leistung") continue;

      candidates.push({
        raw: line,
        serviceName: cleanName,
        quantity,
        unitPrice,
        currency: pattern.currencyGroup ? normalizeCurrency(match[pattern.currencyGroup]) : null,
        topic: weakUnitlessServiceTopic(line) || weakUnitlessServiceTopic(cleanName),
      });
    }
  }

  const byKey = new Map<string, UnitlessTrailingQuantityPriceCandidateV17_79>();
  for (const candidate of candidates) {
    const key = `${normalizeCompare(candidate.raw)}:${candidate.quantity}:${candidate.unitPrice}`;
    if (!byKey.has(key)) byKey.set(key, candidate);
  }
  return Array.from(byKey.values());
}

function unitlessTrailingCandidateMatchesItemV17_79(
  item: ParsedOrderItemForValidation,
  candidate: UnitlessTrailingQuantityPriceCandidateV17_79,
): boolean {
  const sameQuantity =
    Math.abs(Number(item.quantity || 0) - candidate.quantity) < 0.001;
  const samePrice =
    Math.abs(Number(item.unitPrice || 0) - candidate.unitPrice) < 0.01;
  if (!sameQuantity || !samePrice) return false;

  const itemText = normalizeCompare(
    [item.serviceName, item.description, item.sourceText, item.evidence]
      .filter(Boolean)
      .join(" "),
  );
  const candidateText = normalizeCompare([candidate.raw, candidate.serviceName].join(" "));
  if (!itemText || !candidateText) return false;

  if (itemText.includes(candidateText) || candidateText.includes(itemText)) return true;

  const itemTopic = weakUnitlessServiceTopic(itemText);
  const sameTopic = Boolean(itemTopic && candidate.topic && itemTopic === candidate.topic);
  if (sameTopic) return true;

  const itemTokens = tokenSetForUnitlessService(itemText);
  const candidateTokens = tokenSetForUnitlessService(candidateText);
  const sharedTokens = Array.from(candidateTokens).filter((token) => itemTokens.has(token));

  return sharedTokens.length > 0;
}

function isUnsafeGenericAreaMakeLineV17_90F(
  serviceName?: string | null,
  rawLine?: string | null,
): boolean {
  const serviceKey = normalizeCompare(serviceName || "");
  const rawKey = normalizeCompare(rawLine || "");
  const combined = normalizeCompare([serviceName, rawLine].filter(Boolean).join(" "));

  if (!combined) return false;

  // Strukturregel, keine Service-Wortliste: Zeilen wie
  // "Dort hinten alles sauber machen 15 à CHF 6" oder
  // "Kleine Sachen beim Eingang 4 à CHF 9" nennen keinen konkreten
  // Arbeitsgegenstand. Die KI darf daraus nicht nachträglich
  // "Boden reinigen" oder eine andere Leistung erfinden.
  const rawHasGenericOnlyObject =
    /\b(?:bereich|zone|stelle|ecke|teil|ort|dort|da|hinten|vorne|links|rechts|nebenraum|alles|sachen|kleine\s+sachen|kleinigkeiten|zeug)\b/.test(rawKey);
  const rawOnlySaysMake =
    /\b(?:machen|gemacht|erledigen|tun|zu\s+machen|sauber\s+machen|putzen)\b/.test(rawKey);
  const rawHasConcreteWorkObject =
    /\b(?:boden|fenster|tuere|tuer|tür|glas|regal|tisch|stuhl|teppich|matte|gel[aä]nder|dunstabzug|maschine|fassade|wand|decke|kueche|küche|lagerraum|archiv|serverraum|technikraum|schrank|schraenke|schränke|oelmatte|ölmatte|kabelgestell|parkdeck|treppenhaus|veloraum)\b/.test(rawKey);

  const hasGenericAreaOnly =
    /\b(?:bereich|zone|stelle|ecke|teil|ort|dort|da|hinten|vorne|links|rechts|nebenraum|alles|sachen|kleine\s+sachen|kleinigkeiten|zeug)\b/.test(combined);
  const serviceNameOnlyGenericCleaning =
    /^bereich(?:\s+(?:hinten|vorne|links|rechts|dort|da))*\s+reinigen$/.test(serviceKey) ||
    /^nebenraum(?:\s+.+)?\s+reinigen$/.test(serviceKey) ||
    /^boden\s+reinigen$/.test(serviceKey) && rawHasGenericOnlyObject && !rawHasConcreteWorkObject;

  return (
    (rawHasGenericOnlyObject && (rawOnlySaysMake || /\b(?:à|a|zu|je|pro|per|at|\/)\b/.test(rawKey)) && !rawHasConcreteWorkObject) ||
    (hasGenericAreaOnly && rawOnlySaysMake && !rawHasConcreteWorkObject) ||
    serviceNameOnlyGenericCleaning
  );
}

function blockedUnitlessReviewItemFromCandidateV17_90G(
  candidate: UnitlessTrailingQuantityPriceCandidateV17_79,
): ParsedOrderItemForValidation {
  const reason = "service_name_review:unitless_unclear_line";
  return {
    serviceName: "Leistung prüfen",
    description: candidate.raw,
    quantity: candidate.quantity,
    unit: "prüfen",
    unitPrice: candidate.unitPrice,
    totalPrice: 0,
    needsReview: true,
    reviewReason: reason,
    sourceText: candidate.raw,
    evidence: candidate.raw,
    detectedCurrency: candidate.currency || null,
  };
}

function applyUnitlessTrailingQuantityPriceFailClosedV17_79(
  items: ParsedOrderItemForValidation[],
  originalText: string,
): { items: ParsedOrderItemForValidation[]; reviewReasons: string[] } {
  const candidates = extractUnitlessTrailingQuantityPriceCandidatesV17_79(originalText);
  if (candidates.length === 0) return { items, reviewReasons: [] };

  const reviewReasons: string[] = [];
  const usedCandidateKeys = new Set<string>();

  const nextItems = items.map((item) => {
    if (isFlatUnit(item.unit)) return item;

    const candidate = candidates.find((entry) =>
      unitlessTrailingCandidateMatchesItemV17_79(item, entry),
    );
    if (!candidate) return item;

    const proposedServiceName =
      String(item.serviceName || candidate.serviceName || "Leistung prüfen").trim() ||
      "Leistung prüfen";
    const unsafe = isUnsafeGenericAreaMakeLineV17_90F(
      proposedServiceName,
      candidate.raw,
    );
    const serviceName = unsafe ? "Leistung prüfen" : proposedServiceName;
    const reason = unsafe
      ? "service_name_review:unitless_unclear_line"
      : `unit_missing_in_text:${serviceName}`;
    reviewReasons.push(
      reason,
      "service_name_review",
      `unit_mismatch:${serviceName}:Unklar:${item.unit || "Unklar"}:0`,
    );
    usedCandidateKeys.add(`${normalizeCompare(candidate.raw)}|${candidate.quantity}|${roundMoney(candidate.unitPrice)}`);

    return {
      ...item,
      serviceName,
      description: candidate.raw,
      sourceText: candidate.raw,
      evidence: candidate.raw,
      quantity: candidate.quantity,
      unit: "prüfen",
      unitPrice: candidate.unitPrice,
      totalPrice: 0,
      needsReview: true,
      reviewReason: reason,
      detectedCurrency: candidate.currency || item.detectedCurrency || null,
    };
  });

  // V17.90G: Wenn der erste KI-Pass eine zweite unsichere Zeile komplett
  // verschluckt hat, wird sie hier als eigene Prüfposition ergänzt. So gehen
  // Menge/Preis nicht verloren, aber es wird keine Fantasie-Leistung gespeichert.
  for (const candidate of candidates) {
    const key = `${normalizeCompare(candidate.raw)}|${candidate.quantity}|${roundMoney(candidate.unitPrice)}`;
    if (usedCandidateKeys.has(key)) continue;
    if (!isUnsafeGenericAreaMakeLineV17_90F(candidate.serviceName, candidate.raw)) continue;

    const alreadyCovered = nextItems.some((item) => {
      const itemKey = normalizeCompare([item.sourceText, item.evidence, item.description].filter(Boolean).join(" "));
      return itemKey && (itemKey.includes(normalizeCompare(candidate.raw)) || normalizeCompare(candidate.raw).includes(itemKey));
    });
    if (alreadyCovered) continue;

    nextItems.push(blockedUnitlessReviewItemFromCandidateV17_90G(candidate));
    reviewReasons.push("service_name_review:unitless_unclear_line", "service_name_review", "unit_price_review", "quantity_review");
  }

  return { items: nextItems, reviewReasons: unique(reviewReasons) };
}

function addMissingSemanticFlatCostItemsV17_79(
  originalText: string,
  items: ParsedOrderItemForValidation[],
  fallbackCurrency: IntakeCurrency,
): ParsedOrderItemForValidation[] {
  const existingAmountKeys = new Set(
    items
      .filter((item) => normalizeCompare(item.serviceName) === "anfahrt")
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
    ...splitRawIntakeLines(preferredSemanticLineSourceV17_41(originalText)),
    ...splitRawIntakeLines(originalCustomerTextOnlyV17_79(originalText)),
  ]);

  const nextItems = items.slice();

  for (const line of candidateLines) {
    const lineKey = normalizeCompare(line);
    if (!lineKey || hasQuantityWithExplicitUnit(line)) continue;

    const canonical = canonicalGermanServiceNameFromText(line);
    if (canonical !== "Anfahrt" && !isLikelyTravelFlatCostLine(line)) continue;

    const flatPrice =
      findExplicitFlatPriceInLine(line, fallbackCurrency) ||
      detectCurrencylessFlatPriceFromSegment(line, fallbackCurrency);
    if (!flatPrice || flatPrice.currency !== fallbackCurrency) continue;

    const amountKey = roundMoney(flatPrice.amount);
    const sourceAlreadyCaptured = Array.from(existingSourceKeys).some(
      (sourceKey) => sourceKey.includes(lineKey) || lineKey.includes(sourceKey),
    );
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


// V17.90L22: final structural integrity guard for messy one-line WhatsApp texts.
// Goal: every amount-bearing service line must stay line-local. If the LLM or an
// older repair pass copied the whole customer text into item evidence and then
// shifted quantities/prices to neighbouring services, rebuild the amount-bearing
// rows from the exact local customer clauses. This is deliberately structural:
// it uses quantity/unit/price/evidence locality, not fixed customer service lists.
function pricedEvidenceCountV17_90L22(value?: string | null): number {
  const source = normalizeText(value);
  if (!source) return 0;
  const measured = source.match(
    new RegExp(`\\b${QUANTITY_NUMBER_OR_WORD}\\s*${UNIT_WORDS}\\b.{0,45}?(?:${CURRENCY_WORDS}|\\b(?:à|a|zu|je|pro|per|each|at)\\b).{0,25}?\\d+(?:[.,]\\d{1,2})?`, "gi"),
  ) || [];
  const flat = source.match(
    new RegExp(`\\b(?:anfahrt|fahrtkosten|fahrt|fahrpauschale|wegpauschale|reisepauschale|trasferta|deplacement|déplacement|frais\s+de\s+deplacement|frais\s+de\s+déplacement|travel|trip|transport)\\b.{0,50}?(?:${CURRENCY_WORDS}\\s*\\d|\\d+(?:[.,]\\d{1,2})?\\s*${CURRENCY_WORDS})`, "gi"),
  ) || [];
  return measured.length + flat.length;
}

function itemEvidenceBlobV17_90L22(item: ParsedOrderItemForValidation): string {
  return [item.sourceText, item.evidence, item.description]
    .map((part) => normalizeText(part))
    .filter(Boolean)
    .join("\n");
}

function isBroadPollutedItemEvidenceV17_90L22(
  item: ParsedOrderItemForValidation,
): boolean {
  const evidence = itemEvidenceBlobV17_90L22(item);
  if (!evidence) return false;
  const key = normalizeCompare(evidence);
  return (
    evidence.length > 240 ||
    pricedEvidenceCountV17_90L22(evidence) >= 2 ||
    (/\b(?:rechnung|rechnungsadresse|fattura|factura|invoice|billing|ausfuehrung|ausführung|arbeitsort|whatsapp|kundennachrichten)\b/.test(key) &&
      pricedEvidenceCountV17_90L22(evidence) >= 1)
  );
}


// V17.90L27: visible service labels must contain only the work, not access,
// contact, hazard or address fragments that sit before the local price line.
function serviceLabelHasWorkIntentV17_90L27(value?: string | null): boolean {
  const key = normalizeCompare(value || "");
  if (!key) return false;
  return /\b(?:reinig|putz|pulire|clean|nettoyer|limpieza|wisch|abwisch|abstaub|staub|saug|polier|desinfiz|entfern|schneid|streichen|malen|montier|reparier)\b/.test(key) ||
    /\b(?:boden|floor|sol|paviment|pavimento|waschraumboden|kuechenboden|küchenboden|fenster|scheiben|glas|glastuer|glastur|glastür|tische|tavoli|regale|reifenregale|rollstuehle|rollstühle|kofferwagen|gelaender|geländer)\b/.test(key);
}

function serviceLabelContextClauseV17_90L27(value?: string | null): boolean {
  const key = normalizeCompare(value || "");
  if (!key) return false;
  return /\b(?:empfang|reception|werkstattleiter|kuechenchef|küchenchef|koch|cuoco|hauswart|huuswart|chef|nachbar|patientenzimmer|schluessel|schlüssel|key|code|sms|whatsapp|telefon|anruf|rueckruf|rückruf|email|mail|achtung|vorsicht|oprez|attention|hund|pas|dog|oel|öl|kabel|strom|rutschig|scivoloso|nass|mouill|nicht|kein|keine|betreten|kommen|eintreten|rezeption|hauptrezeption|buero|büro|office|bahnhofplatz|strasse|straße|weg|gasse|platz|ring|allee|route|rue|via|viale|avenue|luzern|zuerich|zürich|baden|dietikon|lugano|basel|aarau|lausanne)\b/.test(key) || /\b\d{4,5}\b/.test(key);
}

function cleanServiceLabelContextNoiseV17_90L27(value?: string | null): string {
  let text = normalizeText(value || "").replace(/\s+/g, " ").trim();
  if (!text) return "";

  // Quantity stays in the quantity field, never in the visible service name.
  text = text
    .replace(/^\s*\d+(?:[.,]\d+)?\s*(?:m2|m²|qm|quadratmeter|meter|laufmeter|lfm|stück|stueck|stk|pcs?|pieces?|pi[eè]ces?|pezzi|hours?|stunden?|std\.?)\b\s*/i, "")
    .replace(/^\s*\d+(?:[.,]\d+)?\s+(?=[A-Za-zÀ-ÖØ-öø-ÿÄÖÜäöüß])/u, "")
    .replace(/\s*,\s*\d+(?:[.,]\d+)?\s*(?:m2|m²|qm|quadratmeter|meter|laufmeter|lfm|stück|stueck|stk|pcs?|pieces?|pi[eè]ces?|pezzi|hours?|stunden?|std\.?)\b.*$/i, "")
    .replace(/\s+\d+(?:[.,]\d+)?\s*(?:m2|m²|qm|quadratmeter|meter|laufmeter|lfm|stück|stueck|stk|pcs?|pieces?|pi[eè]ces?|pezzi|hours?|stunden?|std\.?)\b.*$/i, "")
    .replace(/\s+(?:à|a|zu|je|pro|per|each|at|x|\*)\s*(?:chf|eur|fr\.?|franken|stutz)?\s*\d+(?:[.,]\d{1,2})?.*$/i, "")
    .replace(/\s*[,;:\-–—]?\s*(?:ca\.?|circa|ungefähr|ungefaehr|etwa|approx\.?)\s*$/iu, "")
    .replace(/\s+/g, " ")
    .trim();

  const dash = text.match(/^(.{2,90}?)[\s,]*[-–—]\s*(.{3,})$/);
  if (dash && serviceLabelContextClauseV17_90L27(dash[1]) && serviceLabelHasWorkIntentV17_90L27(dash[2])) {
    text = dash[2].trim();
  }

  const commaParts = text.split(/\s*,\s*/g).map((part) => part.trim()).filter(Boolean);
  if (commaParts.length > 1) {
    for (let i = commaParts.length - 1; i >= 1; i -= 1) {
      const right = commaParts.slice(i).join(", ");
      const left = commaParts.slice(0, i).join(", ");
      if (serviceLabelHasWorkIntentV17_90L27(right) && serviceLabelContextClauseV17_90L27(left)) {
        text = right;
        break;
      }
    }
  }

  // Remove short leading context words that may still sit directly before the service.
  for (let pass = 0; pass < 3; pass += 1) {
    const before = text;
    text = text
      .replace(/^(?:empfang|reception|werkstattleiter|kuechenchef|küchenchef|koch|cuoco|hauswart|huuswart|chef|patientenzimmer|schluessel|schlüssel|key|code|buero|büro|office|bahnhofplatz|luzern|zuerich|zürich|baden|dietikon|lugano|basel|aarau|lausanne)\b\s*[,;:-]?\s*/i, "")
      .replace(/^(?:bitte|nur|kein|keine|nicht|vorher|ankuendigen|ankündigen|sms|whatsapp|telefon|anruf|rueckruf|rückruf|achtung|vorsicht|oprez|attention|hund|pas|dog|oelspur|ölspur|kabel|strom|rutschig|scivoloso|nass)\b\s*[,;:-]?\s*/i, "")
      .trim();
    if (text === before) break;
  }

  return text.replace(/^[-–—•,;:\s]+/, "").replace(/\s+/g, " ").trim();
}

function lineLocalPrefixTailV17_90L22(prefix: string): string {
  let text = normalizeText(prefix).replace(/\s+/g, " ").trim();
  if (!text) return "";

  const lastHardDelimiter = Math.max(
    text.lastIndexOf("."),
    text.lastIndexOf(";"),
    text.lastIndexOf("|"),
    text.lastIndexOf("\n"),
  );
  if (lastHardDelimiter >= 0) {
    text = text.slice(lastHardDelimiter + 1).trim();
  }

  text = text
    .replace(/^[-–—•,;:\s]+/, "")
    .replace(/^(?:und|plus|dann|danach|zusätzlich|zusaetzlich)\b\s*[,;:-]?\s*/i, "")
    .replace(/^.*\b(?:leistungen?|arbeiten|da(?:nn)?|bitte)\s*[:：]\s*/i, "")
    .trim();

  text = cleanServiceLabelContextNoiseV17_90L27(text);

  // V17.90L25: if the price line is written as one long WhatsApp sentence,
  // contact/access/warning text can sit directly before the actual service.
  // Keep the short local service label immediately before the amount and strip
  // leading warning/contact words from that label.
  const pollution = /\b(?:sms|whats\s*app|whatsapp|telefon|anruf|rueckruf|ruckruf|email|e-mail|mail|schluessel|schlussel|schlüssel|key|code|hauswart|huuswart|reception|empfang|koch|cuoco|hund|pas|dog|hof|oprez|vorsicht|achtung|attention|scivoloso|rutschig|mouille|mouill[eé]|nass|zugang|tor|parkieren|parken)\b/i;
  const words = text.split(/\s+/g).filter(Boolean);
  if (words.length > 8 || pollution.test(text)) {
    text = words.slice(-6).join(" ");
  }

  text = text
    .replace(/^(?:sms|whats\s*app|whatsapp|telefon|anruf|rueckruf|ruckruf|email|e-mail|mail|schluessel|schlussel|schlüssel|key|code|hauswart|huuswart|reception|empfang|koch|cuoco|hund|pas|dog|hof|oprez|vorsicht|achtung|attention|scivoloso|rutschig|mouille|mouill[eé]|nass|zugang|tor|parkieren|parken)\b\s*/i, "")
    .replace(/^(?:im|in|beim|bei|am|an|der|die|das|dem|den|und|kein|keine|nema|molim|samo|nur|pas|u|je|ist|liegt|vor|ankunft)\b\s*/i, "")
    .trim();

  // If the label is still contaminated, keep a very short action-local tail.
  if (pollution.test(text)) {
    const tail = text.split(/\s+/g).filter(Boolean).slice(-3).join(" ");
    text = tail
      .replace(/^(?:vorsicht|achtung|attention|oprez|hund|pas|hof|rutschig|scivoloso|nass)\b\s*/i, "")
      .trim();
  }

  return text.replace(/^[-–—•,;:\s]+/, "").replace(/\s+/g, " ").trim();
}

function extractStrictLineLocalPricedItemsV17_90L22(
  originalText: string,
  fallbackCurrency: IntakeCurrency,
): ExplicitServiceLineItem[] {
  // V17.90L25: do not trust the automatic translation alone. Some translated
  // blocks can swap quantities or drop lines. Extract from the original text
  // without the translation block AND from the semantic working text; the local
  // priced lines with the strongest coverage win later by amount/source key.
  const originalOnlySource = normalizeText(
    String(originalText || "")
      .replace(/\n+---\s*Übersetzung \(automatisch\)\s*---[\s\S]*$/i, "")
      .replace(/\n+---\s*Uebersetzung \(automatisch\)\s*---[\s\S]*$/i, "")
      .replace(/\n+---\s*Automatic translation\s*---[\s\S]*$/i, ""),
  );
  const semanticSource = normalizeText(preferredSemanticLineSourceV17_41(originalText) || "");
  const sources = unique([originalOnlySource, semanticSource]).filter(Boolean);
  if (sources.length === 0) return [];

  const bases = unique(
    sources.flatMap((source) => [
      ...source.split(/\n+/g),
      ...source.split(/(?<=[.!?])\s+/g),
    ]),
  )
    .map((line) => normalizeText(line))
    .filter((line) => line.length >= 8);

  const result: ExplicitServiceLineItem[] = [];

  const measuredPattern = new RegExp(
    `\\b(${QUANTITY_NUMBER_OR_WORD})\\s*(${UNIT_WORDS})(?=\\b|\\s|[.,;:!?)])\\s*(?:à|a|zu|je|pro|per|each|at|x)?\\s*(?:(?:${CURRENCY_WORDS})\\s*)?${PRICE_NUMBER}(?:\\s*(?:${CURRENCY_WORDS}))?\\b`,
    "gi",
  );

  for (const base of bases) {
    const matches = Array.from(base.matchAll(measuredPattern));
    if (matches.length === 0) continue;

    let previousEnd = 0;
    for (const match of matches) {
      const matchText = match[0] || "";
      const matchStart = match.index ?? 0;
      const matchEnd = matchStart + matchText.length;
      const localPrefix = lineLocalPrefixTailV17_90L22(base.slice(previousEnd, matchStart));
      previousEnd = matchEnd;

      if (!localPrefix || localPrefix.length < 3) continue;
      if (/^(?:rechnung|rechnungsadresse|kunde|fattura|factura|invoice|billing|ausfuehrung|ausführung|arbeitsort|email|e-mail)$/i.test(localPrefix)) continue;

      const segment = `${localPrefix} ${matchText}`.replace(/\s+/g, " ").trim();
      const quantity = parseQuantityNumber(match[1]);
      const unitType = unitTypeFromText(match[2]);
      const unitPrice = findExplicitUnitPriceInLine(segment, fallbackCurrency);
      if (!quantity || quantity <= 0 || !unitType || !unitPrice || unitPrice.amount <= 0) continue;
      if (unitPrice.currency !== fallbackCurrency) continue;
      if (unitPrice.unitType && unitPrice.unitType !== unitType) continue;

      const serviceName = resolveExplicitServiceNameFromContext(
        originalText,
        segment,
        cleanExplicitServiceNameFromLine(segment, {
          quantityRaw: match[1] && match[2] ? `${match[1]} ${match[2]}` : matchText,
          priceRaw: unitPrice.raw,
        }),
      );
      if (!serviceName || normalizeCompare(serviceName) === "unbekannte leistung") continue;

      const unit = unitTypeToDisplayUnit(unitType);
      if (!unit) continue;

      result.push({
        serviceName,
        description: segment,
        quantity,
        unit,
        unitPrice: unitPrice.amount,
        totalPrice: roundMoney(quantity * unitPrice.amount),
        needsReview: false,
        reviewReason: null,
        sourceText: segment,
        evidence: segment,
        detectedCurrency: unitPrice.currency,
      });
    }

    const flatPattern = new RegExp(
      `\\b(?:anfahrt|fahrtkosten|fahrt|fahrpauschale|wegpauschale|reisepauschale|trasferta|deplacement|déplacement|travel|trip|transport)\\b[^\\n.;|]{0,70}?(?:(?:${CURRENCY_WORDS})\\s*${PRICE_NUMBER}|${PRICE_NUMBER}\\s*(?:${CURRENCY_WORDS}))\\b`,
      "gi",
    );

    for (const match of base.matchAll(flatPattern)) {
      const segment = normalizeText(match[0]);
      if (!segment) continue;
      const flatPrice = findExplicitFlatPriceInLine(segment, fallbackCurrency);
      if (!flatPrice || flatPrice.amount <= 0 || flatPrice.currency !== fallbackCurrency) continue;
      // This branch is entered only by the travel/arrival flat-fee pattern
      // above. Keep the canonical role instead of exposing language variants
      // such as "Travel" as a second, apparently missing service.
      const serviceName = "Anfahrt";
      result.push({
        serviceName,
        description: segment,
        quantity: 1,
        unit: "Pauschal",
        unitPrice: flatPrice.amount,
        totalPrice: flatPrice.amount,
        needsReview: false,
        reviewReason: null,
        sourceText: segment,
        evidence: segment,
        detectedCurrency: flatPrice.currency,
      });
    }
  }

  const byKey = new Map<string, ExplicitServiceLineItem>();
  for (const item of result) {
    const key = [
      normalizeCompare(item.sourceText || item.description),
      unitTypeFromDisplayUnit(item.unit) || "",
      String(Number(item.quantity || 0)),
      String(roundMoney(Number(item.unitPrice || 0))),
      item.detectedCurrency || "",
    ].join("|");
    const existing = byKey.get(key);
    if (!existing || String(item.sourceText || "").length > String(existing.sourceText || "").length) {
      byKey.set(key, item);
    }
  }

  return Array.from(byKey.values());
}


// V17.90L95: Detect explicit flat-fee service rows that the first AI may have
// omitted. This is a read-only completeness check. It never creates or edits an
// order item; an uncovered row becomes the existing red recognition proposal.
// The parser is structural: local service label + flat-fee marker + one amount.
function extractExplicitFlatFeeServiceItemsV17_90L95(
  originalText: string,
  fallbackCurrency: IntakeCurrency,
): ExplicitServiceLineItem[] {
  const raw = String(originalText || "");
  const originalOnly = raw
    .replace(/\n+---\s*Übersetzung \(automatisch\)\s*---[\s\S]*$/i, "")
    .replace(/\n+---\s*Uebersetzung \(automatisch\)\s*---[\s\S]*$/i, "")
    .replace(/\n+---\s*Automatic translation\s*---[\s\S]*$/i, "");
  const translated = raw
    .split(/---\s*(?:Übersetzung|Uebersetzung) \(automatisch\)\s*---/i)
    .slice(1)
    .join("\n");
  const sources = unique([
    normalizeText(originalOnly),
    normalizeText(translated),
    normalizeText(preferredSemanticLineSourceV17_41(raw)),
  ]).filter(Boolean);

  const marker = FLAT_FEE_PRICE_MARKER_V17_90L95;
  const patterns: Array<{
    re: RegExp;
    currencyGroup: number;
    priceGroup: number;
  }> = [
    {
      re: new RegExp(
        `\\b${marker}\\b[^\\n.;|]{0,24}?(${CURRENCY_WORDS})\\s*${PRICE_NUMBER}\\b`,
        "gi",
      ),
      currencyGroup: 1,
      priceGroup: 2,
    },
    {
      re: new RegExp(
        `\\b${marker}\\b[^\\n.;|]{0,24}?${PRICE_NUMBER}\\s*(${CURRENCY_WORDS})\\b`,
        "gi",
      ),
      currencyGroup: 2,
      priceGroup: 1,
    },
    {
      re: new RegExp(
        `(${CURRENCY_WORDS})\\s*${PRICE_NUMBER}\\s*${marker}\\b`,
        "gi",
      ),
      currencyGroup: 1,
      priceGroup: 2,
    },
  ];

  const result: ExplicitServiceLineItem[] = [];
  for (const source of sources) {
    const lines = unique([
      ...splitRawIntakeLines(source),
      ...source.split(/\n+|;|\s+•\s+|\s+\|\s+/g).map(normalizeText),
    ]).filter((line) => line.length >= 6);

    for (const line of lines) {
      for (const pattern of patterns) {
        pattern.re.lastIndex = 0;
        for (const match of line.matchAll(pattern.re)) {
          const matchStart = match.index ?? 0;
          const rawPrefix = normalizeText(line.slice(0, matchStart));
          let boundary = 0;
          const priorAmountPattern = new RegExp(
            `(?:${CURRENCY_WORDS})\\s*${PRICE_NUMBER}|${PRICE_NUMBER}\\s*(?:${CURRENCY_WORDS})`,
            "gi",
          );
          for (const prior of rawPrefix.matchAll(priorAmountPattern)) {
            boundary = Math.max(
              boundary,
              (prior.index ?? 0) + String(prior[0] || "").length,
            );
          }
          const afterAmount = rawPrefix.slice(boundary);
          const hardParts = afterAmount.split(/[.!?;|]+/g);
          let localPrefix = normalizeText(hardParts[hardParts.length - 1] || "")
            .replace(/^\s*(?:and|und|plus|then|dann|danach|services?|leistungen?)\s*[:：,;+-]?\s*/i, "")
            .replace(/^\d+(?:[.,]\d+)?\s+(?=[A-Za-zÀ-ÖØ-öø-ÿÄÖÜäöüß])/u, "")
            .replace(/^[-–—•,;:\s]+/, "")
            .trim();
          const localWords = localPrefix.split(/\s+/g).filter(Boolean);
          if (localWords.length > 10) {
            localPrefix = localWords.slice(-10).join(" ");
          }
          if (!localPrefix || localPrefix.length < 3) continue;

          const amount = parsePriceNumber(match[pattern.priceGroup]);
          const currency = normalizeExplicitCurrency(match[pattern.currencyGroup]);
          if (!amount || amount <= 0 || !currency) continue;
          if (currency !== fallbackCurrency) continue;

          const segment = normalizeText(`${localPrefix} ${match[0]}`);
          const cleaned = cleanExplicitServiceNameFromLine(segment, {
            priceRaw: match[0],
          });
          const localLabel = normalizeText(localPrefix)
            .replace(/^[-–—•,;:\s]+/, "")
            .replace(/\s+/g, " ")
            .trim();
          const cleanedKey = normalizeCompare(cleaned);
          const localKey = normalizeCompare(localLabel);
          const preserveBoundedLocalLabel = Boolean(
            localLabel &&
              localLabel.length <= 100 &&
              cleanedKey &&
              localKey.endsWith(cleanedKey) &&
              localKey !== cleanedKey,
          );
          const serviceName = resolveExplicitServiceNameFromContext(
            originalText,
            segment,
            preserveBoundedLocalLabel ? localLabel : cleaned,
          );
          const serviceKey = normalizeCompare(serviceName);
          const isTravelFlatFee =
            /\b(?:anfahrt|fahrtkosten|fahrkosten|fahrpauschale|wegpauschale|reisepauschale|deplacement|déplacement|travel|trip|transport|trasferta|viaje)\b/i.test(
              serviceKey,
            );
          if (
            !serviceName ||
            serviceName === "Unbekannte Leistung" ||
            serviceKey.length < 4 ||
            isTravelFlatFee ||
            isPriceAnchorOnlyServiceName(serviceName) ||
            /^(?:rechnung|invoice|facture|fattura|adresse|address|kontakt|contact|termin|appointment|datum|date|telefon|phone|email|e mail|hinweis|note|zugang|access|schluessel|schlüssel|key|parkplatz|parking)\b/i.test(serviceKey)
          ) {
            continue;
          }

          result.push({
            serviceName,
            description: segment,
            quantity: 1,
            unit: "Pauschal",
            unitPrice: amount,
            totalPrice: roundMoney(amount),
            needsReview: false,
            reviewReason: null,
            sourceText: segment,
            evidence: segment,
            detectedCurrency: currency,
          });
        }
      }
    }
  }

  const byKey = new Map<string, ExplicitServiceLineItem>();
  for (const item of result) {
    const key = [
      normalizeCompare(item.serviceName),
      Number(item.unitPrice || 0).toFixed(4),
      item.detectedCurrency || fallbackCurrency,
    ].join("|");
    const existing = byKey.get(key);
    if (!existing || String(item.sourceText || "").length < String(existing.sourceText || "").length) {
      byKey.set(key, item);
    }
  }

  return Array.from(byKey.values());
}

function extractCountOnlyPricedRecognitionItemsV17_90L69(
  originalText: string,
  fallbackCurrency: IntakeCurrency,
): ExplicitServiceLineItem[] {
  const raw = String(originalText || "");
  const originalOnly = raw
    .replace(/\n+---\s*Übersetzung \(automatisch\)\s*---[\s\S]*$/i, "")
    .replace(/\n+---\s*Uebersetzung \(automatisch\)\s*---[\s\S]*$/i, "");
  const translated = raw
    .split(/---\s*(?:Übersetzung|Uebersetzung) \(automatisch\)\s*---/i)
    .slice(1)
    .join("\n");
  const sources = unique([
    normalizeText(originalOnly),
    normalizeText(translated),
    normalizeText(preferredSemanticLineSourceV17_41(raw)),
  ]).filter(Boolean);
  const result: ExplicitServiceLineItem[] = [];

  const pattern = new RegExp(
    `^\\s*[-–—•]*\\s*(${QUANTITY_NUMBER_OR_WORD})\\s+(.{3,140}?)\\s*,?\\s*(?:je|each|à|a|po|pro|per|x|mal)\\s*(?:(${CURRENCY_WORDS})\\s*)?(\\d+(?:[.,]\\d{1,2})?)(?:\\s*(${CURRENCY_WORDS}))?\\b`,
    "i",
  );

  for (const source of sources) {
    const lines = source
      .split(/\n+|;|\s+•\s+|\s+\|\s+/g)
      .map((line) => normalizeText(line))
      .filter(Boolean);

    for (const line of lines) {
      const match = line.match(pattern);
      if (!match) continue;
      if (
        new RegExp(
          `^${QUANTITY_NUMBER_OR_WORD}\\s*${UNIT_WORDS}\\b`,
          "i",
        ).test(line)
      )
        continue;

      const quantity = parseQuantityNumber(match[1]);
      const unitPrice = parsePriceNumber(match[4]);
      const detectedCurrency = normalizeExplicitCurrency(match[3] || match[5]);
      if (!quantity || quantity <= 0 || !unitPrice || unitPrice <= 0) continue;
      if (detectedCurrency && detectedCurrency !== fallbackCurrency) continue;

      const rawLabel = String(match[2] || "")
        .replace(/[\s,;:.-]+$/g, "")
        .trim();
      if (!rawLabel || rawLabel.length < 3) continue;

      const serviceName =
        cleanExplicitServiceNameFromLine(rawLabel, {}) || rawLabel;
      if (
        !serviceName ||
        normalizeCompare(serviceName) === "unbekannte leistung"
      )
        continue;

      result.push({
        serviceName,
        description: line,
        quantity,
        unit: "Stück",
        unitPrice,
        totalPrice: roundMoney(quantity * unitPrice),
        needsReview: false,
        reviewReason: null,
        sourceText: line,
        evidence: line,
        detectedCurrency: detectedCurrency || fallbackCurrency,
      });
    }
  }

  const byKey = new Map<string, ExplicitServiceLineItem>();
  for (const item of result) {
    const key = [
      normalizeCompare(item.serviceName),
      Number(item.quantity || 0).toFixed(4),
      Number(item.unitPrice || 0).toFixed(4),
    ].join("|");
    if (!byKey.has(key)) byKey.set(key, item);
  }
  return Array.from(byKey.values());
}

function extractBareFlatTravelEvidenceV17_90L70(
  originalText: string,
  fallbackCurrency: IntakeCurrency,
): ExplicitServiceLineItem[] {
  const raw = String(originalText || "");
  const originalOnly = raw
    .replace(/\n+---\s*Übersetzung \(automatisch\)\s*---[\s\S]*$/i, "")
    .replace(/\n+---\s*Uebersetzung \(automatisch\)\s*---[\s\S]*$/i, "");
  const translated = raw
    .split(/---\s*(?:Übersetzung|Uebersetzung) \(automatisch\)\s*---/i)
    .slice(1)
    .join("\n");
  const sources = unique([normalizeText(originalOnly), normalizeText(translated)]).filter(Boolean);
  const result: ExplicitServiceLineItem[] = [];
  const travelWord =
    String.raw`(?:anfahrt|fahrtkosten|fahrt|fahrpauschale|wegpauschale|reisekosten|reisepauschale|deplacement|déplacement|travel\s+costs?|travel\s+fee|trip\s+fee|transport\s+fee)`;
  const pattern = new RegExp(
    String.raw`\b(${travelWord}(?:\s+pauschal)?)\s*(?:(${CURRENCY_WORDS})\s*)?(\d+(?:[.,]\d{1,2})?)(?:\s*\.-)?(?:\s*(${CURRENCY_WORDS}))?\b`,
    "gi",
  );

  for (const source of sources) {
    for (const match of source.matchAll(pattern)) {
      const segment = normalizeText(match[0]);
      const unitPrice = parsePriceNumber(match[3]);
      const detectedCurrency = normalizeExplicitCurrency(match[2] || match[4]);
      if (!segment || !unitPrice || unitPrice <= 0) continue;
      if (detectedCurrency && detectedCurrency !== fallbackCurrency) continue;
      result.push({
        serviceName: "Anfahrt",
        description: segment,
        quantity: 1,
        unit: "Pauschal",
        unitPrice,
        totalPrice: roundMoney(unitPrice),
        needsReview: false,
        reviewReason: null,
        sourceText: segment,
        evidence: segment,
        detectedCurrency: detectedCurrency || fallbackCurrency,
      });
    }
  }

  const byKey = new Map<string, ExplicitServiceLineItem>();
  for (const item of result) {
    const key = `${Number(item.unitPrice || 0).toFixed(4)}|${item.detectedCurrency || fallbackCurrency}`;
    if (!byKey.has(key)) byKey.set(key, item);
  }
  return Array.from(byKey.values());
}

function exactAmountUnitMatchV17_90L22(
  item: ParsedOrderItemForValidation,
  explicit: ExplicitServiceLineItem,
): boolean {
  return (
    unitTypeFromDisplayUnit(item.unit) === unitTypeFromDisplayUnit(explicit.unit) &&
    Math.abs(Number(item.quantity || 0) - Number(explicit.quantity || 0)) < 0.001 &&
    Math.abs(Number(item.unitPrice || 0) - Number(explicit.unitPrice || 0)) < 0.01
  );
}

function applyLineLocalIntegrityGuardV17_90L22(
  items: ParsedOrderItemForValidation[],
  originalText: string,
  finalCurrency: IntakeCurrency,
): { items: ParsedOrderItemForValidation[]; reviewReasons: string[] } {
  const explicitItems = extractStrictLineLocalPricedItemsV17_90L22(originalText, finalCurrency);
  if (explicitItems.length < 2) return { items, reviewReasons: [] };

  const reviewReasons: string[] = [];
  const consumedExplicit = new Set<number>();
  const next: ParsedOrderItemForValidation[] = [];

  for (const item of items) {
    const broad = isBroadPollutedItemEvidenceV17_90L22(item);
    const exactIndex = explicitItems.findIndex((explicit, index) => {
      if (consumedExplicit.has(index)) return false;
      return exactAmountUnitMatchV17_90L22(item, explicit);
    });

    if (exactIndex >= 0) {
      const explicit = explicitItems[exactIndex];
      consumedExplicit.add(exactIndex);
      const shouldOverwriteName =
        broad || shouldPreferExplicitServiceName(item, explicit) ||
        normalizeCompare(item.serviceName) !== normalizeCompare(explicit.serviceName);
      next.push(
        clearResolvedNumericReview({
          ...item,
          serviceName: shouldOverwriteName ? explicit.serviceName : item.serviceName || explicit.serviceName,
          description: explicit.description,
          quantity: explicit.quantity,
          unit: explicit.unit,
          unitPrice: explicit.unitPrice,
          totalPrice: calculateSafeLineTotal(explicit),
          needsReview: false,
          reviewReason: null,
          sourceText: explicit.sourceText,
          evidence: explicit.evidence,
          detectedCurrency: explicit.detectedCurrency || finalCurrency,
        }),
      );
      if (broad || shouldOverwriteName) reviewReasons.push("line_local_integrity_repaired");
      continue;
    }

    // Drop polluted amount-bearing rows from broad evidence when the exact local
    // priced lines are available. These are the dangerous rows where quantities
    // or prices drifted to the wrong service, e.g. Anfahrt CHF 6 from a m² line.
    if (
      broad &&
      Number(item.unitPrice || 0) > 0 &&
      Number(item.quantity || 0) > 0 &&
      pricedEvidenceCountV17_90L22(itemEvidenceBlobV17_90L22(item)) >= 2
    ) {
      reviewReasons.push("line_local_polluted_amount_row_removed");
      continue;
    }

    next.push(item);
  }

  for (let index = 0; index < explicitItems.length; index += 1) {
    if (consumedExplicit.has(index)) continue;
    const explicit = explicitItems[index];
    const alreadyCovered = next.some((item) => exactAmountUnitMatchV17_90L22(item, explicit));
    if (alreadyCovered) continue;
    next.push({
      ...explicit,
      totalPrice: calculateSafeLineTotal(explicit),
      needsReview: false,
      reviewReason: null,
    });
    reviewReasons.push(`line_local_integrity_added:${explicit.serviceName}`);
  }

  return {
    items: removeHardSameEvidenceAmountDuplicates(
      removeSameEvidenceQuantityPriceSplitArtifacts(next),
    ),
    reviewReasons: unique(reviewReasons),
  };
}



// V17.90L23: final deterministic rebuild for explicit amount-bearing texts.
// If a message contains several clear local price lines, these lines are the
// source of truth. This prevents old AI/post-processing rows from surviving with
// broad evidence, shifted quantities or blocked m² rows like "Boden Lager".
function cleanTrailingAmountFromServiceNameV17_90L23(value?: string | null): string {
  let name = normalizeText(value || "")
    // V17.90L26: quantities/counts belong into Menge/Einheit, never into the
    // visible service name. Handles translation output like
    // "18 Tische im Saal reinigen" and "5 Eingangsscheiben reinigen".
    .replace(/^\s*\d+(?:[.,]\d+)?\s*(?:m2|m²|qm|quadratmeter|meter|laufmeter|lfm|stück|stueck|stk|pcs?|pieces?|pi[eè]ces?|pezzi|hours?|stunden?|std\.?)\b\s*/i, "")
    .replace(/^\s*\d+(?:[.,]\d+)?\s+(?=[A-Za-zÀ-ÖØ-öø-ÿÄÖÜäöüß])/u, "")
    .replace(/\s*,\s*\d+(?:[.,]\d+)?\s*(?:m2|m²|qm|quadratmeter|meter|laufmeter|lfm|stück|stueck|stk|pcs?|pieces?|pi[eè]ces?|pezzi|hours?|stunden?|std\.?)\b.*$/i, "")
    .replace(/\s+\d+(?:[.,]\d+)?\s*(?:m2|m²|qm|quadratmeter|meter|laufmeter|lfm|stück|stueck|stk|pcs?|pieces?|pi[eè]ces?|pezzi|hours?|stunden?|std\.?)\b.*$/i, "")
    .replace(/\s+(?:à|a|zu|je|pro|per|each|at|x|\*)\s*(?:chf|eur|fr\.?|franken|stutz)?\s*\d+(?:[.,]\d{1,2})?.*$/i, "")
    .replace(/\s*[,;:\-–—]?\s*(?:ca\.?|circa|ungefähr|ungefaehr|etwa|approx\.?)\s*$/iu, "")
    .replace(/\s+/g, " ")
    .trim();

  name = cleanServiceLabelContextNoiseV17_90L27(name);
  name = cleanValidationServiceDisplayName(name);
  return normalizeText(name).replace(/^./, (char) => char.toUpperCase());
}


// V17.90L70: Menge/Einheit/Preis gehören nie in den sichtbaren Leistungsnamen.
// Diese Bereinigung ist rein strukturell und kennt keine Leistungsbegriffe.
// Sie entfernt nur eindeutige Zahlen-/Einheiten-Suffixe wie
// ", 6 Garnituren à CHF 38" oder "3 Stück je CHF 12".
function cleanFinalServiceAmountSuffixV17_90L70(
  value?: string | null,
): string {
  const countUnit =
    String.raw`(?:garnituren?|sets?|gruppen?|anlagen?|raeume|räume|zimmer|objekte?|einheiten?|stueck|stück|stk\.?|pcs?|pieces?|pi[eè]ces?|pezzi|meter|laufmeter|lfm|m2|m²|qm|quadratmeter|stunden?|std\.?|tage?|pauschalen?)`;

  let cleaned = normalizeText(value || "")
    .replace(
      new RegExp(
        String.raw`^\s*\d+(?:[.,]\d+)?\s*${countUnit}\b\s*`,
        "iu",
      ),
      "",
    )
    .replace(
      new RegExp(
        String.raw`\s*[,;:\-–—]?\s*\d+(?:[.,]\d+)?\s*${countUnit}\b(?:\s*(?:à|a|je|po|pro|per|x|mal)\s*(?:(?:CHF|EUR|Fr\.?|Franken|Euro)\s*)?\d+(?:[.,]\d{1,2})?)?.*$`,
        "iu",
      ),
      "",
    )
    .replace(
      /\s+(?:à|a|je|po|pro|per|x|mal)\s*(?:(?:CHF|EUR|Fr\.?|Franken|Euro)\s*)?\d+(?:[.,]\d{1,2})?.*$/iu,
      "",
    )
    .replace(/\s*[,;:\-–—]?\s*(?:ca\.?|circa|ungefähr|ungefaehr|etwa|approx\.?)\s*$/iu, "")
    .replace(/[\s,;:\-–—]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();

  cleaned = cleanValidationServiceDisplayName(cleaned);
  return cleaned || normalizeText(value || "");
}

function applyFinalServiceAmountSuffixCleanupV17_90L70(
  items: ParsedOrderItemForValidation[],
): ParsedOrderItemForValidation[] {
  return items.map((item) => {
    const serviceName = cleanFinalServiceAmountSuffixV17_90L70(
      item.serviceName,
    );
    if (!serviceName || serviceName === item.serviceName) return item;
    return {
      ...item,
      serviceName,
      reviewReason: String(item.reviewReason || "").startsWith("price_unclear:")
        ? `price_unclear:${serviceName}`
        : item.reviewReason,
    };
  });
}

function canonicalLineLocalItemV17_90L23(
  item: ExplicitServiceLineItem,
): ExplicitServiceLineItem {
  const serviceName = cleanTrailingAmountFromServiceNameV17_90L23(item.serviceName);
  return {
    ...item,
    serviceName: serviceName || item.serviceName || "Leistung prüfen",
    description: item.sourceText || item.description,
    totalPrice: calculateSafeLineTotal(item),
    needsReview: false,
    reviewReason: null,
    evidence: item.sourceText || item.evidence || item.description,
  };
}

function itemHasOpenLineLocalAmountProblemV17_90L23(
  item: ParsedOrderItemForValidation,
): boolean {
  const reason = String(item.reviewReason || "");
  const nameKey = normalizeCompare(item.serviceName);
  const unitKey = normalizeCompare(item.unit);
  return (
    Number(item.totalPrice || 0) <= 0 ||
    Number(item.unitPrice || 0) <= 0 ||
    (!isFlatUnit(item.unit) && Number(item.quantity || 0) <= 0) ||
    !unitKey ||
    nameKey === "leistung pruefen" ||
    nameKey === "unbekannte leistung" ||
    reason.startsWith("service_name_review:") ||
    reason.startsWith("unit_mismatch:") ||
    reason === "unit_price_review" ||
    reason === "quantity_review"
  );
}

function sameLineLocalAmountKeyV17_90L23(
  item: ParsedOrderItemForValidation,
): string {
  return [
    unitTypeFromDisplayUnit(item.unit) || normalizeCompare(item.unit),
    String(Number(item.quantity || 0)),
    String(roundMoney(Number(item.unitPrice || 0))),
    normalizeCurrency(item.detectedCurrency) || "",
  ].join("|");
}

function shouldDeterministicallyRebuildFromLineLocalItemsV17_90L23(
  items: ParsedOrderItemForValidation[],
  explicitItems: ExplicitServiceLineItem[],
): boolean {
  if (explicitItems.length < 2) return false;
  if (explicitItems.length > items.length) return true;
  if (items.some(itemHasOpenLineLocalAmountProblemV17_90L23)) return true;
  if (items.some(isBroadPollutedItemEvidenceV17_90L22)) return true;

  const explicitKeys = new Set(explicitItems.map(sameLineLocalAmountKeyV17_90L23));
  const covered = items.filter((item) => explicitKeys.has(sameLineLocalAmountKeyV17_90L23(item))).length;
  return covered < explicitItems.length;
}

function applyDeterministicLineLocalRebuildV17_90L23(
  items: ParsedOrderItemForValidation[],
  originalText: string,
  finalCurrency: IntakeCurrency,
): { items: ParsedOrderItemForValidation[]; reviewReasons: string[] } {
  const explicitItems = extractStrictLineLocalPricedItemsV17_90L22(originalText, finalCurrency)
    .map(canonicalLineLocalItemV17_90L23);
  if (!shouldDeterministicallyRebuildFromLineLocalItemsV17_90L23(items, explicitItems)) {
    return { items, reviewReasons: [] };
  }

  const byAmount = new Map<string, ExplicitServiceLineItem>();
  for (const item of explicitItems) {
    const key = sameLineLocalAmountKeyV17_90L23(item);
    const existing = byAmount.get(key);
    if (!existing || String(item.sourceText || "").length > String(existing.sourceText || "").length) {
      byAmount.set(key, item);
    }
  }

  return {
    items: Array.from(byAmount.values()).map((item) => ({
      ...item,
      totalPrice: calculateSafeLineTotal(item),
      needsReview: false,
      reviewReason: null,
    })),
    reviewReasons: ["line_local_deterministic_rebuild"],
  };
}


// V17.90L82: If the AI bound the correct quantity and price to the correct
// service but guessed the wrong unit, the exact local source line is the safer
// source of truth. Name + quantity + price must agree; numbers alone never
// change a service.
function findLineLocalExplicitRepairMatchIndexV17_90L82(
  item: ParsedOrderItemForValidation,
  explicitItems: ExplicitServiceLineItem[],
  used: Set<number>,
): number {
  const exactIndex = explicitItems.findIndex((explicit, index) => {
    if (used.has(index)) return false;
    return exactAmountUnitMatchV17_90L22(item, explicit);
  });
  if (exactIndex >= 0) return exactIndex;

  const itemCurrency = normalizeCurrency(item.detectedCurrency || null);
  const candidates = explicitItems
    .map((explicit, index) => ({ explicit, index }))
    .filter(({ explicit, index }) => {
      if (used.has(index)) return false;
      const explicitCurrency = normalizeCurrency(explicit.detectedCurrency || null);
      if (itemCurrency && explicitCurrency && itemCurrency !== explicitCurrency)
        return false;
      if (
        Math.abs(Number(item.quantity || 0) - Number(explicit.quantity || 0)) >=
        0.001
      )
        return false;
      if (
        Math.abs(Number(item.unitPrice || 0) - Number(explicit.unitPrice || 0)) >=
        0.01
      )
        return false;
      return recognitionServiceNamesCompatibleV17_90L69(
        cleanTrailingAmountFromServiceNameV17_90L23(item.serviceName),
        cleanTrailingAmountFromServiceNameV17_90L23(explicit.serviceName),
      );
    });

  return candidates.length === 1 ? candidates[0].index : -1;
}

// V17.90L26: final local evidence/name cleanup. Even when numeric values are
// already correct, old AI rows may still carry the whole WhatsApp text as item
// description/evidence. Replace those visible proof texts with the exact local
// price line and remove quantity fragments from the service name.
function applyLineLocalEvidenceDescriptionCleanupV17_90L26(
  items: ParsedOrderItemForValidation[],
  originalText: string,
  finalCurrency: IntakeCurrency,
): { items: ParsedOrderItemForValidation[]; reviewReasons: string[] } {
  const explicitItems = preferStrongRecognitionCandidatesV17_90L69(
    [
      ...extractStrictLineLocalPricedItemsV17_90L22(
        originalText,
        finalCurrency,
      ),
      ...extractCountOnlyPricedRecognitionItemsV17_90L69(
        originalText,
        finalCurrency,
      ),
      ...extractExplicitFlatFeeServiceItemsV17_90L95(
        originalText,
        finalCurrency,
      ),
      ...extractBareFlatTravelEvidenceV17_90L70(
        originalText,
        finalCurrency,
      ),
    ],
    originalText,
  ).map((item): ExplicitServiceLineItem =>
    canonicalLineLocalItemV17_90L23({
      ...item,
      sourceText: String(
        item.sourceText || item.evidence || item.description || "",
      ),
    }),
  );
  if (explicitItems.length === 0) {
    return {
      items: items.map((item) => ({
        ...item,
        serviceName: cleanTrailingAmountFromServiceNameV17_90L23(item.serviceName) || item.serviceName,
      })),
      reviewReasons: [],
    };
  }

  const used = new Set<number>();
  const reviewReasons: string[] = [];

  const next = items.map((item) => {
    const matchIndex = findLineLocalExplicitRepairMatchIndexV17_90L82(
      item,
      explicitItems,
      used,
    );

    const cleanedCurrentName = cleanTrailingAmountFromServiceNameV17_90L23(item.serviceName) || item.serviceName;
    if (matchIndex < 0) {
      return { ...item, serviceName: cleanedCurrentName };
    }

    const explicit = explicitItems[matchIndex];
    used.add(matchIndex);
    const explicitLine = explicit.sourceText || explicit.evidence || explicit.description;
    const currentEvidence = itemEvidenceBlobV17_90L22(item);
    const broad = isBroadPollutedItemEvidenceV17_90L22(item);
    const cleanedExplicitName = cleanTrailingAmountFromServiceNameV17_90L23(explicit.serviceName) || explicit.serviceName;
    const currentNameKey = normalizeCompare(cleanedCurrentName);
    const explicitNameKey = normalizeCompare(cleanedExplicitName);
    const explicitWouldReduceSpecificity = Boolean(
      currentNameKey &&
        explicitNameKey &&
        currentNameKey !== explicitNameKey &&
        currentNameKey.includes(explicitNameKey) &&
        explicitNameKey.length >= 4,
    );
    const shouldUseExplicitName =
      !explicitWouldReduceSpecificity &&
      (broad ||
        !cleanedCurrentName ||
        normalizeCompare(cleanedCurrentName) === "unbekannte leistung" ||
        /^\d/.test(normalizeText(item.serviceName || "")) ||
        /\b\d+(?:[.,]\d+)?\s*(?:m2|m²|qm|stück|stueck|stk|pcs?|pezzi|meter)\b/i.test(String(item.serviceName || "")));

    if (broad || currentEvidence !== explicitLine || shouldUseExplicitName) {
      reviewReasons.push("line_local_evidence_cleaned");
    }

    return clearResolvedNumericReview({
      ...item,
      serviceName: shouldUseExplicitName ? cleanedExplicitName : cleanedCurrentName,
      description: explicitLine,
      sourceText: explicitLine,
      evidence: explicitLine,
      quantity: explicit.quantity,
      unit: explicit.unit,
      unitPrice: explicit.unitPrice,
      totalPrice: calculateSafeLineTotal(explicit),
      detectedCurrency: explicit.detectedCurrency || item.detectedCurrency || finalCurrency,
    });
  });

  return { items: next, reviewReasons: unique(reviewReasons) };
}


// V17.90L82: A service followed directly by its currency-bound price has
// quantity one when no quantity/unit/rate expression is attached to that same
// service segment. This repairs one-line messages such as
// "Boiler Jahresservice CHF 280 Lecksuche 2 Stunden à CHF 135" without
// borrowing the following quantity. Counted/measured rows remain untouched.
function repairStandaloneCurrencyPriceItemsV17_90L82(
  items: ParsedOrderItemForValidation[],
  originalText: string,
  finalCurrency: IntakeCurrency,
): ParsedOrderItemForValidation[] {
  const originalOnly = String(originalText || "")
    .replace(/\n+---\s*Übersetzung \(automatisch\)\s*---[\s\S]*$/i, "")
    .replace(/\n+---\s*Uebersetzung \(automatisch\)\s*---[\s\S]*$/i, "")
    .replace(/\n+---\s*Automatic translation\s*---[\s\S]*$/i, "");
  if (!originalOnly.trim()) return items;

  const currencyBefore =
    finalCurrency === "EUR"
      ? String.raw`(?:EUR|Euro)`
      : String.raw`(?:CHF|SFR\.?|Fr\.?|Franken|Stutz)`;
  const currencyAfter = currencyBefore;
  const measuredBridge =
    /\b(?:\d+(?:[.,]\d+)?|ein(?:e|en|er|es)?|zwei|drei|vier|fuenf|fünf|sechs|sieben|acht|neun|zehn)\s*(?:m2|m²|qm|quadratmeter|meter|laufmeter|lfm|stück|stueck|stk\.?|pcs?|pieces?|stunden?|std\.?|h|tage?|kg|liter|kubikmeter|m3|m³)\b|\b(?:à|je|pro|per|each|po|x|mal)\b/i;
  const immediateQuantityBefore =
    /(?:^|\s)(\d+(?:[.,]\d+)?|ein(?:e|en|er|es)?|zwei|drei|vier|fuenf|fünf|sechs|sieben|acht|neun|zehn)\s*(m2|m²|qm|quadratmeter|meter|laufmeter|lfm|stück|stueck|stk\.?|pcs?|pieces?|stunden?|std\.?|h|tage?|kg|liter|kubikmeter|m3|m³)?\s*$/i;

  return items.map((item) => {
    const unitPrice = Number(item.unitPrice || 0);
    if (!Number.isFinite(unitPrice) || unitPrice <= 0) return item;
    if (Number(item.quantity || 0) === 1 && isFlatUnit(item.unit)) return item;

    const cleanedName =
      cleanTrailingAmountFromServiceNameV17_90L23(item.serviceName) ||
      normalizeText(item.serviceName);
    const nameParts = cleanedName
      .split(/\s+/g)
      .map((part) => part.trim())
      .filter((part) => part.length >= 2);
    if (nameParts.length === 0) return item;

    const servicePattern = new RegExp(
      nameParts.map((part) => escapeRegExp(part)).join(String.raw`\s+`),
      "giu",
    );
    const integerPrice = Number.isInteger(unitPrice);
    const fixedPrice = integerPrice
      ? `${Math.trunc(unitPrice)}(?:[.,]0+)?`
      : unitPrice
          .toFixed(2)
          .replace(/0+$/, "")
          .replace(".", "[.,]");
    const pricePattern = new RegExp(
      String.raw`(?:${currencyBefore}\s*${fixedPrice}|${fixedPrice}\s*${currencyAfter})(?:\s*\.-)?`,
      "iu",
    );

    const matches = Array.from(originalOnly.matchAll(servicePattern));
    const safeMatches: Array<{ evidence: string }> = [];
    for (const match of matches) {
      if (match.index == null) continue;
      const serviceEnd = match.index + match[0].length;
      const tail = originalOnly.slice(serviceEnd, serviceEnd + 90);
      const priceMatch = tail.match(pricePattern);
      if (!priceMatch || priceMatch.index == null || priceMatch.index > 45)
        continue;

      const bridge = tail.slice(0, priceMatch.index);
      if (measuredBridge.test(bridge)) continue;
      if (/\b(?:total|gesamt|summe|subtotal|budget|circa|ungefähr|ungefaehr|etwa|around|approximately)\b/i.test(bridge))
        continue;
      const bridgeRemainder = bridge
        .replace(/\b(?:pauschal|preis|kostet|kosten|price|flat)\b/gi, " ")
        .replace(/[,;:()\[\].\-–—\s]+/g, "")
        .trim();
      if (bridgeRemainder) continue;

      const prefix = originalOnly.slice(Math.max(0, match.index - 35), match.index);
      const quantityBeforeMatch = prefix.match(immediateQuantityBefore);
      if (quantityBeforeMatch) {
        const hasMeasuredUnit = Boolean(quantityBeforeMatch[2]);
        const beforeQuantity = prefix.slice(0, quantityBeforeMatch.index || 0);
        const belongsToPreviousRate =
          /\b(?:à|je|pro|per|each|po|x|mal|CHF|EUR|Franken|Euro)\s*$/i.test(
            beforeQuantity,
          );
        if (hasMeasuredUnit || !belongsToPreviousRate) continue;
      }

      const evidence = normalizeText(
        originalOnly.slice(
          match.index,
          serviceEnd + priceMatch.index + priceMatch[0].length,
        ),
      );
      if (evidence) safeMatches.push({ evidence });
    }

    if (safeMatches.length !== 1) return item;
    const explicitLine = safeMatches[0].evidence;
    return clearResolvedNumericReview({
      ...item,
      serviceName: cleanedName,
      description: explicitLine,
      sourceText: explicitLine,
      evidence: explicitLine,
      quantity: 1,
      unit: "Pauschal",
      unitPrice,
      totalPrice: roundMoney(unitPrice),
      detectedCurrency:
        normalizeCurrency(item.detectedCurrency || null) || finalCurrency,
    });
  });
}

// V17.90L79: A complete structured AI row with short line-local evidence may
// be marked for review, but it must not be silently deleted by later repair
// passes. Restore only rows whose name, quantity, unit and price are all bound
// to the same compact evidence line.
function lineLocalStructuredEvidenceV17_90L79(
  item: ParsedOrderItemForValidation,
): string | null {
  const serviceKey = normalizeCompare(item.serviceName);
  const price = Number(item.unitPrice || 0);
  if (!serviceKey || price <= 0) return null;
  const strongestServiceToken = serviceKey
    .split(/\s+/g)
    .filter((token) => token.length >= 5)
    .sort((left, right) => right.length - left.length)[0] || "";
  const priceText = Number.isInteger(price)
    ? `${price}(?:[.,]0+)?`
    : `${String(price).split(".")[0]}[.,]${String(price).split(".")[1]}0*`;
  const pricePattern = new RegExp(`(^|\\D)${priceText}(?=\\D|$)`, "i");
  const quantity = Number(item.quantity || 0);
  const quantityText = Number.isInteger(quantity)
    ? `${quantity}(?:[.,]0+)?`
    : `${String(quantity).split(".")[0]}[.,]${String(quantity).split(".")[1]}0*`;
  const quantityPattern = new RegExp(
    `(^|\\D)${quantityText}(?=\\D|$)`,
    "i",
  );

  return (
    [item.evidence, item.description, item.sourceText]
      .map((value) => normalizeText(value))
      .filter(
        (line) =>
          Boolean(line) &&
          line.length <= 260 &&
          pricePattern.test(line) &&
          (recognitionServiceNamesCompatibleV17_90L69(
            item.serviceName,
            line,
          ) ||
            (strongestServiceToken &&
              normalizeCompare(line).includes(strongestServiceToken)) ||
            quantityPattern.test(line)),
      )
      .sort((a, b) => a.length - b.length)[0] || null
  );
}

function restoreCompleteStructuredInputItemsV17_90L79(
  currentItems: ParsedOrderItemForValidation[],
  originalItems: ParsedOrderItemForValidation[],
  finalCurrency: IntakeCurrency,
): ParsedOrderItemForValidation[] {
  const trusted = originalItems
    .map((item) => {
      const evidence = lineLocalStructuredEvidenceV17_90L79(item);
      const quantity = isFlatUnit(item.unit) ? 1 : Number(item.quantity || 0);
      const unitPrice = Number(item.unitPrice || 0);
      const currency = normalizeCurrency(item.detectedCurrency) || finalCurrency;
      const nameKey = normalizeCompare(item.serviceName);
      if (
        !evidence ||
        quantity <= 0 ||
        unitPrice <= 0 ||
        currency !== finalCurrency ||
        !nameKey ||
        nameKey === "leistung pruefen" ||
        nameKey === "unbekannte leistung"
      ) {
        return null;
      }
      return {
        ...item,
        description: evidence,
        sourceText: evidence,
        evidence,
        quantity,
        totalPrice: calculateSafeLineTotal({ ...item, quantity, unitPrice }),
        detectedCurrency: finalCurrency,
      };
    })
    .filter(Boolean) as ParsedOrderItemForValidation[];

  if (trusted.length === 0) return currentItems;
  const used = new Set<number>();
  const result: ParsedOrderItemForValidation[] = [];

  for (const candidate of trusted) {
    const candidateEvidence = normalizeCompare(candidate.sourceText || "");
    const matchIndex = currentItems.findIndex((item, index) => {
      if (used.has(index)) return false;
      const sameNumbers =
        unitTypeFromDisplayUnit(item.unit) ===
          unitTypeFromDisplayUnit(candidate.unit) &&
        Math.abs(Number(item.quantity || 0) - Number(candidate.quantity || 0)) <
          0.001 &&
        Math.abs(Number(item.unitPrice || 0) - Number(candidate.unitPrice || 0)) <
          0.01;
      const sameService = recognitionServiceNamesCompatibleV17_90L69(
        item.serviceName,
        candidate.serviceName,
      );
      const itemEvidence = normalizeCompare(
        [item.sourceText, item.evidence, item.description]
          .filter(Boolean)
          .join(" "),
      );
      return Boolean(
        (candidateEvidence &&
          itemEvidence &&
          (itemEvidence.includes(candidateEvidence) ||
            candidateEvidence.includes(itemEvidence))) ||
          (sameNumbers && sameService),
      );
    });

    if (matchIndex >= 0) used.add(matchIndex);
    result.push(candidate);
  }

  currentItems.forEach((item, index) => {
    if (!used.has(index)) result.push(item);
  });

  const byKey = new Map<string, ParsedOrderItemForValidation>();
  for (const item of result) {
    const key = [
      normalizeCompare(item.serviceName),
      unitTypeFromDisplayUnit(item.unit) || normalizeCompare(item.unit),
      Number(item.quantity || 0).toFixed(4),
      Number(item.unitPrice || 0).toFixed(4),
      normalizeCurrency(item.detectedCurrency) || "",
    ].join("|");
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, item);
    } else {
      byKey.set(key, {
        ...existing,
        needsReview: Boolean(existing.needsReview || item.needsReview),
        reviewReason: existing.reviewReason || item.reviewReason || null,
      });
    }
  }
  return Array.from(byKey.values());
}

function appendStructuredUnpricedItemsV17_90L79(
  originalText: string,
  items: ParsedOrderItemForValidation[],
): { items: ParsedOrderItemForValidation[]; reviewReasons: string[] } {
  const source = preferredSemanticLineSourceV17_41(originalText)
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
  const block = source.match(
    /\b(?:leistungen|arbeiten)\s*:\s*([\s\S]*?)(?=\n\s*(?:hinweise|besonderheiten|kontakt|zugang|termin|notizen|bemerkungen)\s*:|$)/i,
  )?.[1];
  if (!block) return { items, reviewReasons: [] };

  const next = [...items];
  const reviewReasons: string[] = [];
  for (const rawLine of block.split("\n")) {
    const line = normalizeText(rawLine).replace(/^[-–—•*]+\s*/, "").trim();
    if (!line || !hasUnclearPriceSignal(line)) continue;
    if (
      hasExplicitCurrencyAmount(line) ||
      extractUnitPricesFromSegment(line).length > 0 ||
      detectCurrencylessFlatPriceFromSegment(line, "CHF")
    ) {
      continue;
    }
    const serviceName = line
      .replace(/\bpreis\s+(?:noch\s+)?(?:offen|unklar|unbekannt|folgt|erst\s+nach\s+besichtigung|nach\s+besichtigung).*$/i, "")
      .replace(/[.,;:!?-]+$/g, "")
      .trim();
    const visibleName = serviceName || line;
    const key = normalizeCompare(visibleName);
    if (!key || next.some((item) => normalizeCompare(item.serviceName) === key)) {
      continue;
    }
    const reason = `price_unclear:${visibleName}`;
    next.push({
      serviceName: visibleName,
      description: line,
      quantity: 1,
      unit: "Pauschal",
      unitPrice: 0,
      totalPrice: 0,
      needsReview: true,
      reviewReason: reason,
      sourceText: line,
      evidence: line,
      detectedCurrency: null,
    });
    reviewReasons.push(reason, "unit_price_review");
  }
  return { items: next, reviewReasons: unique(reviewReasons) };
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
  const structuredInputSnapshotV17_90L79 = input.items.map((item) => ({
    ...item,
  }));
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
  items = addMissingSemanticFlatCostItemsV17_79(
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

  // V17.90L37: Ein globaler Währungsblocker darf nur aus einer tatsächlich
  // gespeicherten/bearbeitbaren Position entstehen. Eine bloss im Rohtext
  // erwähnte Fremdwährung darf nicht Angebot/Rechnung sperren, wenn keine
  // eigene Prüfposition dafür existiert. Durch die strukturelle Segmentierung
  // oben wird eine erkennbare Fremdwährungsposition als eigene Zeile angelegt.
  let hasRealCurrencyProblem = items.some((item) => {
    const rawDetectedCurrency = String(item.detectedCurrency || "")
      .trim()
      .toUpperCase();
    const reason = String(item.reviewReason || "");
    return Boolean(
      (rawDetectedCurrency && rawDetectedCurrency !== finalCurrency) ||
        reason === "currency_review" ||
        reason === "currency_conflict" ||
        reason === "currency_unsupported" ||
        reason.startsWith("item_currency_mismatch:") ||
        reason.startsWith("currency_conflict_item:"),
    );
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
  items = forceFinalMeasuredLineLocalNamesV17_55(
    input.originalText,
    items,
    finalCurrency,
  );
  items = forceExactSemanticMeasuredLineNamesV17_56(
    input.originalText,
    items,
    finalCurrency,
  );
  items = repairLineLocalStandaloneFlatServiceNamesV17_51(
    input.originalText,
    items,
    finalCurrency,
  );

  const lineLocalIntegrityGuard = applyLineLocalIntegrityGuardV17_90L22(
    items,
    input.originalText,
    finalCurrency,
  );
  items = lineLocalIntegrityGuard.items;
  reviewReasons.push(...lineLocalIntegrityGuard.reviewReasons);

  const deterministicLineLocalRebuild = applyDeterministicLineLocalRebuildV17_90L23(
    items,
    input.originalText,
    finalCurrency,
  );
  items = deterministicLineLocalRebuild.items;
  reviewReasons.push(...deterministicLineLocalRebuild.reviewReasons);

  // V17.80: Wenn eine Position nach der semantischen Reparatur vollständig ist
  // (Menge + Einheit + Preis + Total), darf kein alter price_unclear-Hinweis
  // als sichtbarer falscher Text stehen bleiben. Beispiel: "Window inside
  // 4 pcs at CHF 9" wird korrekt 4 Stück × CHF 9; der Preis ist dann nicht
  // mehr unklar.
  items = items.map(clearResolvedNumericReview);

  const serviceNameSafetyGuard = applyFailClosedServiceNameSafetyGuardV17_90(
    input.originalText,
    items,
  );
  items = serviceNameSafetyGuard.items;
  reviewReasons.push(...serviceNameSafetyGuard.reviewReasons);

  const lineLocalEvidenceCleanupV17_90L26 = applyLineLocalEvidenceDescriptionCleanupV17_90L26(
    items,
    input.originalText,
    finalCurrency,
  );
  items = lineLocalEvidenceCleanupV17_90L26.items;
  reviewReasons.push(...lineLocalEvidenceCleanupV17_90L26.reviewReasons);

  const unitlessTrailingFailClosed = applyUnitlessTrailingQuantityPriceFailClosedV17_79(
    items,
    input.originalText,
  );
  items = unitlessTrailingFailClosed.items;
  reviewReasons.push(...unitlessTrailingFailClosed.reviewReasons);

  reviewReasons.push(...structuredGermanServiceSection.reviewReasons);

  reviewReasons.push(...finalEvidenceSafetyPass.reviewReasons);

  const finalForeignCurrencyReviewV17_90L37 =
    appendMissingForeignCurrencyReviewItemsV17_90L37(
      input.originalText,
      items,
      finalCurrency,
    );
  items = finalForeignCurrencyReviewV17_90L37.items;
  reviewReasons.push(...finalForeignCurrencyReviewV17_90L37.reviewReasons);
  items = finalizeForeignCurrencyReviewItemsV17_90L39(
    input.originalText,
    items,
    finalCurrency,
  );
  const exactCurrencyBindingV17_90L41 =
    enforceExactItemCurrencyBindingV17_90L41(items, finalCurrency);
  items = exactCurrencyBindingV17_90L41.items;
  reviewReasons.push(...exactCurrencyBindingV17_90L41.reviewReasons);
  const rawForeignCurrencyFallbackV17_90L41 =
    appendRawForeignCurrencyReviewItemsV17_90L41(
      input.originalText,
      input.items,
      items,
      finalCurrency,
    );
  items = rawForeignCurrencyFallbackV17_90L41.items;
  reviewReasons.push(...rawForeignCurrencyFallbackV17_90L41.reviewReasons);
  items = applyFinalServiceAmountSuffixCleanupV17_90L70(items);
  // V17.90L72: final language-only pass after every line-local repair. Later
  // cleanup steps may restore a raw/mixed source label even when the German
  // translation was already available. Re-bind by the same quantity, unit
  // type and price so only the visible name changes; amounts and evidence stay
  // untouched.
  items = normalizeHighGermanServiceNamesFromTranslatedTextV17_35(
    input.originalText,
    items,
  );
  items = restoreCompleteStructuredInputItemsV17_90L79(
    items,
    structuredInputSnapshotV17_90L79,
    finalCurrency,
  );

  // V17.90L82: the V17.90L79 restore pass can intentionally reinsert the
  // structured row. Re-apply the deterministic local evidence binding once at
  // the final priced-item boundary so wrong AI units/quantities cannot return.
  const finalLineLocalCleanupV17_90L82 =
    applyLineLocalEvidenceDescriptionCleanupV17_90L26(
      items,
      input.originalText,
      finalCurrency,
    );
  items = finalLineLocalCleanupV17_90L82.items;
  reviewReasons.push(...finalLineLocalCleanupV17_90L82.reviewReasons);
  items = repairStandaloneCurrencyPriceItemsV17_90L82(
    items,
    input.originalText,
    finalCurrency,
  );

  const unpricedStructuredV17_90L79 = appendStructuredUnpricedItemsV17_90L79(
    input.originalText,
    items,
  );
  items = unpricedStructuredV17_90L79.items;
  reviewReasons.push(...unpricedStructuredV17_90L79.reviewReasons);

  hasRealCurrencyProblem = items.some((item) => {
    const rawDetectedCurrency = String(item.detectedCurrency || "")
      .trim()
      .toUpperCase();
    const reason = String(item.reviewReason || "");
    return Boolean(
      (rawDetectedCurrency && rawDetectedCurrency !== finalCurrency) ||
        reason === "currency_review" ||
        reason === "currency_conflict" ||
        reason === "currency_unsupported" ||
        reason.startsWith("item_currency_mismatch:") ||
        reason.startsWith("currency_conflict_item:"),
    );
  });

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
        !reason.startsWith("evidence_numeric_repaired:") &&
        !reason.startsWith("line_local_integrity_added:") &&
        reason !== "line_local_integrity_repaired" &&
        reason !== "line_local_polluted_amount_row_removed" &&
        reason !== "line_local_deterministic_rebuild" &&
        reason !== "line_local_evidence_cleaned" &&
        reason !== "service_added_from_original_line_v17_48",
    )
    .filter((reason) => {
      if (reason === "manual_flat_service_from_text") {
        return items.some(
          (item) => item.reviewReason === "manual_flat_service_from_text",
        );
      }
      if (!reason.startsWith("price_repaired_from_text:")) return true;
      const [, serviceName = ""] = reason.split(":");
      const serviceKey = normalizeCompare(serviceName);
      const currentItemIsCurrencyReview = items.some((item) => {
        const itemKey = normalizeCompare(item.serviceName);
        const itemReason = String(item.reviewReason || "");
        return (
          itemKey === serviceKey &&
          (itemReason.startsWith("item_currency_mismatch:") ||
            itemReason.startsWith("currency_conflict_item:"))
        );
      });
      if (currentItemIsCurrencyReview) return false;
      return !hasResolvedCompleteItemForReason(items, reason);
    })
    // V17.90L39: Nur positionsbezogene Gründe behalten, die nach der finalen
    // Konsolidierung tatsächlich noch an einer gespeicherten Position hängen.
    // Alte Gründe wie Reisekosten/Prüfen dürfen keinen Phantom-Chip erzeugen,
    // wenn die einzige echte Prüfposition inzwischen "Anfahrt" ist.
    .filter((reason) => {
      if (
        !reason.startsWith("price_unclear:") &&
        !reason.startsWith("unit_mismatch:") &&
        !reason.startsWith("unit_missing_in_text:") &&
        !reason.startsWith("item_currency_mismatch:") &&
        !reason.startsWith("currency_conflict_item:")
      ) {
        return true;
      }
      return items.some((item) => String(item.reviewReason || "") === reason);
    })
    .filter((reason) => {
      if (
        reason !== "service_name_review" &&
        !reason.startsWith("service_name_review:")
      ) {
        return true;
      }
      return items.some((item) => {
        const itemReason = String(item.reviewReason || "");
        return (
          itemReason === reason ||
          (reason === "service_name_review" &&
            (itemReason.startsWith("service_name_review:") ||
              isGenericOpenReviewServiceNameV17_90L39(item.serviceName)))
        );
      });
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
  /\b(ausführungsadresse|ausfuehrungsadresse|ausführende\s+adresse|ausfuehrende\s+adresse|ausführungsort|ausfuehrungsort|ausführung|ausfuehrung|arbeitsort|auftragsort|uftragsort|arbeitsadresse|einsatzort|baustellenadresse|baustelle|objektadresse|objekt|leistungsadresse|leistungsort|serviceadresse|montageadresse|reinigungsadresse|ort\s+der\s+ausführung|ort\s+der\s+ausfuehrung|adresse\s+vor\s+ort|adresse\s+wo\s+gearbeitet\s+wird|arbeiten\s+(?:bitte\s+)?(?:bei|beim|in|im)|arbeit\s+(?:bitte\s+)?(?:bei|beim|in|im)|work\s+address|work\s+site|work\s+location|job\s+site|job\s+address|job\s+location|service\s+address|site\s+address|location\s+of\s+work|adresse\s+de\s+travail|adresse\s+d[’']intervention|adresse\s+du\s+chantier|lieu\s+d[’']intervention|dirección\s+de\s+trabajo|direccion\s+de\s+trabajo|dirección\s+de\s+obra|direccion\s+de\s+obra|lugar\s+de\s+trabajo|indirizzo\s+di\s+lavoro|indirizzo\s+cantiere|luogo\s+di\s+intervento)\b/i;

const STOP_MARKER =
  /\b(rechnungsadresse|rechnung\s+an|rechnungskunde|rechnungsempfänger|rechnungsempfaenger|auftraggeber|besteller|zahler|factura|fatura|fattura|facture|kunde|kundendaten|kontakt\s+vor\s+ort|kontaktperson|ansprechperson|person\s+vor\s+ort|on[-\s]?site(?:\s+contact)?|vor\s+ort\s+(?:ist|öffnet|oeffnet|macht|kommt)|zugang|hauswart|hausmeister|concierge|leistung|leistungen|preis|preise|kosten|telefon|tel\.?|e-mail|email|mail|bemerkung|bemerkungen|hinweis|hinweise|notiz|notizen|termin|datum|mwst|währung|waehrung|kundennachricht|whatsapp|titel|title)\b/i;

// V17.90L39: Deterministische Grenze zwischen Adresse und operativen Hinweisen.
// Diese Begriffe sind keine Service-Wortliste, sondern strukturierte Kategorien
// für Zugang/Kontakt/Termin. Sie dürfen nie in Strasse, Ort oder Objektname
// gespeichert werden; die Information bleibt im Originaltext/Besonderheiten.
const EXECUTION_ADDRESS_OPERATIONAL_BOUNDARY_V17_90L39 =
  /\b(?:schlüssel|schluessel|schlussel|key|zugang|zutritt|eingang|vor\s+ort|rezeption|reception|(?:beim|am|zum)\s+empfang|empfang\s+(?:schlüssel|schluessel|schlussel|key|code|kontakt|telefon)|on[-\s]?site(?:\s+contact)?|concierge|hauswart|hausmeister|code|torcode|zugangscode|schlüsselbox|schluesselbox|briefkasten|parkieren|parken|parkplatz|parking|termin|datum|uhrzeit|kontakt(?:person)?|ansprechperson|telefon|tel\.?|handy|natel|whatsapp|sms|e-?mail)\b/i;

function stripOperationalAddressTailV17_90L39(value?: string | null): string {
  const text = normalizeText(value || "");
  if (!text) return "";
  const match = text.match(EXECUTION_ADDRESS_OPERATIONAL_BOUNDARY_V17_90L39);
  if (!match || match.index == null) return text;
  return text
    .slice(0, match.index)
    .replace(/[,;:\-–—\s]+$/g, "")
    .trim();
}

const ADDRESS_WORD_PATTERN =
  /(?:strasse|straße|str\.?|weg|gasse|platz|allee|ring|rain|halde|steig|route|rue|avenue|av\.?|chemin|quai|boulevard|bd\.?|place|cours|promenade|impasse|passage|via|viale|calle|camino|street|road|lane)/i;

function cleanAddressLine(value: string): string {
  return stripOperationalAddressTailV17_90L39(value)
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

  // Mehrsprachige, strukturierte Strassennamen: "Rue du Lac 18",
  // "Quai du Mont-Blanc 24", "Avenue des Fleurs 9", "Via Roma 4".
  const foreignStreet = new RegExp(
    `\\b((?:rue|avenue|av\\.?|chemin|quai|boulevard|bd\\.?|place|cours|promenade|impasse|passage|route|via|viale|calle|camino)\\s+[A-ZÄÖÜÀ-ÖØ-öø-ÿa-zäöüß][A-Za-zÄÖÜÀ-ÖØ-öø-ÿäöüß'’.-]*(?:\\s+(?:de|des|du|del|della|la|le|les|l['’]?|d['’]?|[A-ZÄÖÜÀ-ÖØ-öø-ÿa-zäöüß][A-Za-zÄÖÜÀ-ÖØ-öø-ÿäöüß'’.-]*)){0,8}\\s+${houseNumber})\\b`,
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
      /\b(eingang|vor\s+ort|on[-\s]?site|contact|kontakt|ansprechperson|zugang|leisting|leistung|leistungen|bitte|preis|preise|kosten|fenster|treppenhaus|reinigung|reinigen|farbreste|hecke|garage|tiefgarage|pauschal|arbeiten|kommen|melden|montieren|machen|erledigen|schneiden|streichen|entsorgen)\b.*$/gi,
      "",
    )
    .replace(/\s+/g, " ")
    .trim();

  return {
    plz: match[1] || null,
    city: city || null,
  };
}


function cleanExecutionCityInstructionTailV17_90L41(
  value?: string | null,
): string | null {
  const cleaned = stripOperationalAddressTailV17_90L39(value || "")
    .replace(
      /\s+\b(?:bitte|zuerst|vorher|danach|anschliessend|anschließend|nachher|erst\s+noch)\b.*$/i,
      "",
    )
    .replace(/[\s,;:.\-–—]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return null;
  if (/\b(?:beim|bei|am|an|im|in|zum|zur)\s*$/i.test(cleaned)) return null;
  return cleaned;
}

function parseCityWithoutPlz(value: string): string | null {
  const source = normalizeText(value);
  if (!source) return null;

  const candidates = source
    .split(/[,;\n]+/g)
    .map((part) =>
      stripOperationalAddressTailV17_90L39(part)
        .replace(EXECUTION_ADDRESS_MARKER, " ")
        .replace(STOP_MARKER, " ")
        .replace(/[.\s]+$/g, "")
        .replace(/^[:\-–—\s]+/g, "")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .filter(Boolean)
    .reverse();

  for (const candidate of candidates) {
    if (candidate.length < 2 || candidate.length > 60) continue;
    if (/\d/.test(candidate)) continue;
    if (!/[A-Za-zÄÖÜÀ-ÖØ-öø-ÿäöüß]/.test(candidate)) continue;
    if (ADDRESS_WORD_PATTERN.test(candidate)) continue;
    if (
      /\b(?:reinigen|reinigung|putzen|schneiden|entfernen|streichen|montieren|reparieren|chf|eur|euro|preis|kosten|telefon|whatsapp|sms)\b/i.test(
        candidate,
      )
    )
      continue;
    const cleanedCity = cleanExecutionCityInstructionTailV17_90L41(candidate);
    if (cleanedCity) return cleanedCity;
  }

  return null;
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
  let candidate = stripOperationalAddressTailV17_90L39(value)
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
  if (EXECUTION_ADDRESS_OPERATIONAL_BOUNDARY_V17_90L39.test(candidate))
    return false;
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


function extractExecutionAccessNoteV17_90L70(
  value?: string | null,
): string | null {
  const source = normalizeText(value || "");
  if (!source) return null;

  const match = source.match(
    /\b(eingang\s+(?:bei|beim|am|an|ueber|über)\s+(?:(?:der|dem|den)\s+)?[A-ZÄÖÜÀ-ÖØ-Þ][A-Za-zÄÖÜÀ-ÖØ-öø-ÿß'’.-]*(?:\s+(?!(?:kontakt|vor\s+ort|telefon|tel\.?|whatsapp|sms|leistung|termin|schlüssel|schluessel|code)\b)[A-Za-zÄÖÜÀ-ÖØ-öø-ÿß'’.-]+){0,2}?)(?=\s*(?:[,;.]|\bkontakt\b|\bvor\s+ort\b|\btelefon\b|\btel\.?\b|\bwhatsapp\b|\bsms\b|\bleistungen?\b|\btermin\b|\bschlüssel\b|\bschluessel\b|\bcode\b|$))/iu,
  );
  if (!match?.[1]) return null;
  return match[1].replace(/\s+/g, " ").trim();
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

  const executionMarkerIndex = raw.search(EXECUTION_ADDRESS_MARKER);
  const executionRaw =
    executionMarkerIndex >= 0 ? raw.slice(executionMarkerIndex) : raw;
  const siteAddress = parseStreet(executionRaw);
  if (!siteAddress) return null;

  const afterStreet =
    executionRaw
      .split(new RegExp(escapeRegExp(siteAddress), "i"))
      .slice(1)
      .join(" ") || "";
  const plzCity = parsePlzCity(afterStreet);
  const immediatePlaceSegment = afterStreet
    .split(/[,;\n]+/g)[0]
    ?.replace(/^[:\-–—\s]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  let sitePlz = plzCity.plz;
  let siteCity = cleanExecutionCityInstructionTailV17_90L41(
    plzCity.city ||
      parseCityWithoutPlz(immediatePlaceSegment) ||
      parseCityWithoutPlz(afterStreet),
  );

  // V17.90L38/L39: Fehlende PLZ oder fehlender Ort dürfen nicht still aus
  // der Rechnungsadresse ergänzt werden. Eine ausdrücklich markierte, sicher
  // erkannte Strasse bleibt trotzdem als bearbeitbarer Teilvorschlag erhalten.
  // Dadurch zeigt die rote Prüfung konkret, welche Felder noch fehlen, statt
  // nur einen nicht bearbeitbaren Chip zu erzeugen.

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

  const beforeStreetRaw =
    executionRaw.split(new RegExp(escapeRegExp(siteAddress), "i"))[0] || "";
  const beforeStreet = beforeStreetRaw
    .replace(/^.*\b(?:baustelle|arbeitsort|ausfuehrung|ausführung|objekt|einsatzort|arbeit)\b\s*:?[\s-]*/i, "")
    .trim() || beforeStreetRaw;
  const siteNameCandidate = cleanSiteNameCandidate(beforeStreet);
  const siteName = isSafeSiteNameCandidate(siteNameCandidate)
    ? siteNameCandidate
    : null;

  // Ein räumlicher Objekt-/Bereichsteil darf nicht gleichzeitig als Ort
  // gespeichert werden. Das verhindert z. B. "Etage und Terrasse hinten" als
  // Stadt, wenn nach der Strasse nur noch ein Schlüsselhinweis folgt.
  if (
    siteCity &&
    (EXECUTION_ADDRESS_OPERATIONAL_BOUNDARY_V17_90L39.test(siteCity) ||
      /\b(?:etage|stock|geschoss|terrasse|gang|flur|raum|trakt|innenhof|hinterhof|hinten|vorne|oben|unten)\b/i.test(
        siteCity,
      ) ||
      (siteName &&
        normalizeCompare(siteName).includes(normalizeCompare(siteCity))))
  ) {
    siteCity = null;
  }

  return {
    siteName,
    siteAddress,
    sitePlz,
    siteCity,
    siteNote: extractExecutionAccessNoteV17_90L70(executionRaw),
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

  // V17.90L83: Scope the first candidate to the explicit execution marker.
  // A compact message can contain the billing address before "work location"
  // on the same line. Keeping that prefix allowed the billing street/name to
  // win over the later, correct execution address.
  const hardMarkerIndex = markerLine.search(EXECUTION_ADDRESS_MARKER);
  const softMarkerIndex = markerLine.search(SOFT_EXECUTION_ADDRESS_LINE_PATTERN);
  const scopedMarkerIndex =
    hardMarkerIndex >= 0
      ? hardMarkerIndex
      : softMarkerIndex >= 0
        ? softMarkerIndex
        : 0;
  const markerScopedLine = markerLine.slice(scopedMarkerIndex);
  const sameLine = stripMarker(markerScopedLine);

  if (sameLine && !STOP_MARKER.test(sameLine)) blockLines.push(sameLine);

  for (let offset = 1; offset <= 5; offset += 1) {
    const nextLine = lines[markerIndex + offset];
    if (!nextLine) continue;
    if (EXECUTION_ADDRESS_MARKER.test(nextLine)) break;

    const rawHasOperationalBoundary =
      EXECUTION_ADDRESS_OPERATIONAL_BOUNDARY_V17_90L39.test(nextLine);
    const rawHasAddressEvidence =
      isLikelyAddressStreetLine(nextLine) || Boolean(parsePlzCity(nextLine).plz);
    if (rawHasOperationalBoundary && !rawHasAddressEvidence) {
      break;
    }

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

  // V17.90L83: Protect ordinal floor notation such as "4. Stock" from the
  // sentence splitter. Otherwise a one-line work-location block is cut before
  // its street, and the fallback can accidentally reuse the earlier billing
  // address from the same message.
  const protectedOrdinalMarker = "__EXECUTION_ORDINAL_DOT_V17_90L83__";
  const protectedSource = source.replace(
    /\b(\d{1,2})\.\s+(?=(?:stock|etage|geschoss|ober(?:geschoss)?|unter(?:geschoss)?|og|ug)\b)/giu,
    `$1${protectedOrdinalMarker} `,
  );
  const lines = protectedSource
    .split(/\n+|(?<=[.!?])\s+/g)
    .map((line) =>
      line
        .split(protectedOrdinalMarker).join(".")
        .trim(),
    )
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
    let sitePlz = plzCityFromLine?.plz || fallbackPlzCity.plz;
    let siteCity = cleanExecutionCityInstructionTailV17_90L41(
      plzCityFromLine?.city ||
        fallbackPlzCity.city ||
        parseCityWithoutPlz(blockLines.join(", ")),
    );

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
    if (
      siteCity &&
      (EXECUTION_ADDRESS_OPERATIONAL_BOUNDARY_V17_90L39.test(siteCity) ||
        /\b(?:etage|stock|geschoss|terrasse|gang|flur|raum|trakt|innenhof|hinterhof|hinten|vorne|oben|unten)\b/i.test(
          siteCity,
        ) ||
        (siteName &&
          normalizeCompare(siteName).includes(normalizeCompare(siteCity))))
    ) {
      siteCity = null;
    }

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
      siteNote: extractExecutionAccessNoteV17_90L70(blockLines.join(" ")),
    };
  }

  return null;
}
