/**
 * Intelligente Auftragserfassung mit KI-gestütztem Kundenabgleich
 * Wird von Telegram- und WhatsApp-Webhooks verwendet.
 */
import { prisma } from "@/lib/prisma";
import { ensureAddressSplit } from "@/lib/address-parser";
import { logAuditAsync } from "@/lib/audit";
import {
  verifyCustomerMatch,
  type MatchVerdict,
} from "@/lib/customer-matching";
import { sanitizeNewCustomerFields } from "@/lib/intake-sanitize";
import {
  findExactDeterministicMatch,
  findNearExactDeterministicMatch,
} from "@/lib/exact-customer-match";
import { maskPhoneForLog } from "@/lib/phone";
import { buildSpecialNotes } from "@/lib/special-notes-utils";
import { repairZeroQuantityHourItemsFromText } from "@/lib/order-hour-line-repair";
import {
  applyUnitlessQuantityPriceLineGuard,
  extractExecutionAddressFromText,
  runReadOnlyIntakeRiskValidator,
  validateAndRepairParsedOrderItems,
} from "@/lib/order-intake-validation";

// ─────────────────────────────────────────────────────────────────────────
// Block R — Self-introduction safety-net for voice/text intake.
//
// When the LLM returns kunde.name = null/empty AND the raw incoming text
// contains a clear self-introduction pattern ("mein Name ist X" /
// "Ich heisse X" / "Ich bin X"), extract the name from the text as a
// post-LLM fallback.
//
// Greift NUR wenn:
//   - kunde.name leer/null ist (überschreibt NIE eine LLM-Extraktion)
//   - eine eindeutige Selbstvorstellung im Text steht (Regex)
//
// Dies löst den Fall, in dem der WhatsApp-ProfileName mit dem im Audio
// genannten Endkunden-Namen identisch ist und der Prompt deshalb die
// Name-Extraktion unterdrückt.
// ─────────────────────────────────────────────────────────────────────────
function extractSelfIntroductionName(
  rawText: string | null | undefined,
): string | null {
  if (!rawText || typeof rawText !== "string") return null;
  const text = rawText.trim();
  if (!text) return null;

  // Tolerant gegen Transkript-Quirks: "Mein Name ist", "Ich heisse/heiße", "Ich bin",
  // "Hier spricht", "Hier ist", "Mein Vorname ist", "Mein Nachname ist".
  // Erlaubt 1-2 Namensteile (Vor- und/oder Nachname), 2-30 Zeichen pro Teil.
  // Buchstaben/Umlaute/Bindestriche, optional Apostroph für O'Brien etc.
  const pattern =
    /(?:mein\s+(?:name|vorname|nachname)\s+(?:ist|lautet)|ich\s+hei[sß]+e|ich\s+bin|hier\s+spricht|hier\s+ist)\s+([A-Za-zÄÖÜäöüß][A-Za-zÄÖÜäöüß'\-]{1,30}(?:\s+[A-Za-zÄÖÜäöüß][A-Za-zÄÖÜäöüß'\-]{1,30})?)/iu;
  const m = text.match(pattern);
  if (!m || !m[1]) return null;

  const candidate = m[1].trim();
  // Ausschliessen: triviale Wörter die häufig nach "Ich bin" stehen aber kein Name sind
  const blocklist = new Set([
    "der",
    "die",
    "das",
    "ein",
    "eine",
    "einer",
    "sehr",
    "gut",
    "schon",
    "noch",
    "auch",
    "hier",
    "dort",
    "jetzt",
    "heute",
    "morgen",
    "gestern",
    "froh",
    "gerade",
    "nicht",
    "kein",
    "keine",
    "okay",
    "super",
  ]);
  const firstToken = candidate.split(/\s+/)[0]?.toLowerCase() || "";
  if (blocklist.has(firstToken)) return null;
  // Mindestens 2 Zeichen, max 60 Zeichen Gesamtname
  if (candidate.length < 2 || candidate.length > 60) return null;
  return candidate;
}

// INTAKE_SEMANTIC_ENGINE_V12
// V16.38: Shared billing-marker vocabulary for messy WhatsApp texts.
// Covers German, English, French, Spanish/Portuguese and Italian invoice labels
// without accepting execution-site labels as billing customer names.
const BILLING_MARKER_PATTERN =
  "kunde\\s*,?\\s*der\\s+die\\s+rechnung\\s+bekommt\\s+und\\s+bezahlt|" +
  "kunde\\s*/\\s*rechnungsadresse|rechnungskunde|rechnungsempfänger|rechnungsempfaenger|" +
  "rechnungsempfängerin|rechnungsempfaengerin|rechnungsadresse|" +
  "bitte\\s+(?:die\\s+)?rechnung\\s+(?:schicken|senden|mailen)\\s+an|" +
  "rechnung\\s+bitte\\s+(?:schicken|senden|mailen)\\s+an|rechnung\\s+bitte\\s+an|" +
  "rechnung\\s+(?:schicken|senden|mailen)\\s+an|rechnung\\s+per\\s+(?:mail|email)\\s+an|" +
  "rechnung\\s+(?:geht\\s+)?an|rechnung\\s+bekommt|rechnung\\s+ist\\s+(?:für|fuer)|rechnung\\s+(?:für|fuer)|" +
  "auftraggeber(?:in)?|besteller(?:in)?|zahler|zahlende\\s+stelle|chef(?:\\s+zahlt)?|" +
  "firma|company|client\\s*/\\s*facturation|client|billing\\s+customer|billing\\s+address|invoice\\s+customer|invoice\\s+address|bill\\s+to|" +
  "facturation|facture\\s*(?:à|a)|(?:la\\s+)?facture\\s+(?:va\\s+)?(?:à|a|pour)|" +
  "factura\\s+(?:para|a|à)|fatura\\s+(?:para|a|à)|facturacion|facturación|" +
  "fattura\\s+(?:a|per)|fatturazione|cliente|pagador|payer";

const BILLING_LABEL_PREFIX_REGEX = new RegExp(
  `^\\s*(?:${BILLING_MARKER_PATTERN})\\s*(?:ist|isch|is|lautet|heisst|heißt|geht\\s+an|geht\\s+auf|va\\s+(?:à|a)|para|per|pour|a|à|=|:)?\\s*`,
  "i",
);

// V16.32: harte Vorbereinigung für Namen aus KI/Transkript.
// Ziel: keine Satzreste wie "ist Meier Renovationen AG", "Mail reicht"
// oder "Es geht um kleine Bauarbeiten" als Rechnungskunde speichern.
function stripNonNameLeadIn(value: string): string {
  let candidate = String(value || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split(/\n+/)[0]
    .replace(/^\s*(?:TEXT\s*\d+\s*)$/i, "")
    .replace(/^\s*(?:TEXT\s*\d+\s*)/i, "")
    .replace(/^\s*(?:der\s+|die\s+|das\s+)?/i, "")
    .replace(/^\s*[:\-–—]+\s*/, "")
    .replace(/\s+/g, " ")
    .trim();

  const leadInPatterns = [
    BILLING_LABEL_PREFIX_REGEX,
    /^\s*(?:das\s+ist|dies\s+ist|es\s+ist|c['’]?est|it\s+is|ist|isch|is)\s+/i,
    /^\s*(?:für|fuer|an|bei)\s+(?:den|die|das|der|dem)?\s*/i,
    /^\s*(?:la\s+)?facture\s+(?:va\s+)?(?:à|a|pour)\s*:?\s*/i,
    /^\s*(?:factura|fatura)\s+(?:para|a|à)\s*:?\s*/i,
    /^\s*fattura\s+(?:a|per)\s*:?\s*/i,
    /^\s*(?:auftraggeber(?:in)?|besteller(?:in)?|zahler|zahlende\s+stelle|chef(?:\s+zahlt)?|pagador|payer)\s*(?:ist|isch|is|lautet|heisst|heißt|=|:)?\s*/i,
  ];

  for (let pass = 0; pass < 3; pass += 1) {
    const before = candidate;
    for (const pattern of leadInPatterns) {
      candidate = candidate.replace(pattern, "");
    }
    candidate = candidate
      .replace(/^\s*[:\-–—]+\s*/, "")
      .replace(/\s+/g, " ")
      .trim();
    if (candidate === before) break;
  }

  return candidate;
}
function isForbiddenBillingNameSentence(
  value: string | null | undefined,
): boolean {
  const normalized = normalizeUnitText(value || "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!normalized) return true;

  const exact = new Set([
    "mail",
    "email",
    "e mail",
    "mail reicht",
    "email reicht",
    "e mail reicht",
    "sms",
    "whatsapp",
    "morgen",
    "heute",
    "adresse",
    "adresse wie letztes mal",
    "wie letztes mal",
    "unbekannt",
    "auftraggeber",
    "auftraggeber ist",
    "besteller",
    "zahler",
    "chef",
    "chef zahlt",
    "zahlt",
    "bezahlt",
    "factura para",
    "fatura para",
    "fattura a",
    "fattura per",
    "la facture va a",
    "la facture va à",
    "facture a",
    "facture à",
    "facture pour",
    "pagador",
    "payer",
  ]);
  if (exact.has(normalized)) return true;

  const forbiddenStarts =
    /^(?:mail\s+reicht|e\s*mail\s+reicht|email\s+reicht|per\s+mail|bitte\s+per\s+mail|bitte\s+mail|sms\s+reicht|whatsapp\s+reicht|telefon\s+reicht|kein\s+anruf|nicht\s+anrufen|adresse\s+wie|wie\s+letztes\s+mal|es\s+(?:geht|goht|handelt)\s+(?:um|sich)|kleine\s+bauarbeiten|neuer\s+auftrag|auftrag\b|auftraggeber\b|besteller\b|zahler\b|chef\b|zahlt\b|bezahlt\b|factura\s+(?:para|a)|fatura\s+(?:para|a)|fattura\s+(?:a|per)|(?:la\s+)?facture\s+(?:va\s+)?(?:a|à|pour)|pagador\b|payer\b|termin\b|morgen\b|heute\b)/i;
  if (forbiddenStarts.test(normalized)) return true;

  return false;
}

function cleanBillingCustomerNameCandidate(
  value: string | null | undefined,
): string | null {
  let candidate =
    String(value || "")
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n")
      .split(/\n+/)[0] || "";

  candidate = candidate
    .replace(/^["'“”‘’\s:,\-–—]+/g, "")
    .replace(/["'“”‘’\s:,\-–—.]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();

  candidate = stripNonNameLeadIn(candidate);

  if (!candidate) return null;
  if (isForbiddenBillingNameSentence(candidate)) return null;

  // Bei "Name, Strasse 12, 8000 Ort" nur den Namen behalten.
  candidate = candidate.split(/[,;]/)[0]?.trim() || candidate;

  // Bei gesprochenen Einzeilern ohne Komma: "Name Strasse 12 in 8000 Ort"
  // ab der Strasse abschneiden, damit keine Adressdaten als Name gespeichert werden.
  candidate = candidate
    .replace(
      /\s+[A-ZÄÖÜa-zäöüß' .\-]*?(?:strasse|straße|str\.?|weg|gasse|platz|allee|ring|rain|halde|steig|route|rue|avenue|av\.?|chemin|via|viale|street|road|lane)\s+\d+[a-zA-Z]?.*$/i,
      "",
    )
    .replace(/\s+\bin\s+\d{4,5}\b.*$/i, "")
    .replace(/\s+\d{4,5}\b.*$/i, "")
    .replace(/\s+/g, " ")
    .trim();

  candidate = stripNonNameLeadIn(candidate);
  if (!candidate) return null;
  if (isForbiddenBillingNameSentence(candidate)) return null;

  const normalized = normalizeUnitText(candidate);
  const hasStrongCompanySuffix =
    /\b(?:ag|gmbh|sarl|sa|s\.?a\.?|ltd\.?|limited|inc\.?|kg|kgaa|gmbh\s*&\s*co|verein|stiftung)\b/i.test(
      candidate,
    );

  if (candidate.length < 2 || candidate.length > 80) return null;
  if (!/[A-Za-zÄÖÜäöüß]/.test(candidate)) return null;
  if (/\d/.test(candidate)) return null;

  // INTAKE_CUSTOMER_NAME_SAFE_EMPTY_V12
  // Lieber leer lassen als Füllwörter oder Satzreste als Kundenname speichern.
  const blockedExact = new Set([
    "ist",
    "isch",
    "is",
    "sind",
    "geht",
    "gehe",
    "an",
    "bei",
    "für",
    "fuer",
    "von",
    "mit",
    "und",
    "oder",
    "bitte",
    "kunde",
    "rechnungsadresse",
    "rechnung",
    "mail",
    "email",
    "mail reicht",
    "email reicht",
    "sms",
    "whatsapp",
    "morgen",
    "heute",
    "rechnungskunde",
    "rechnungsempfänger",
    "rechnungsempfaenger",
    "facturation",
    "billing",
    "invoice",
    "name",
    "unbekannt",
    "auftraggeber",
    "besteller",
    "zahler",
    "chef",
    "zahlt",
    "bezahlt",
    "factura",
    "fatura",
    "fattura",
    "facture",
    "pagador",
    "payer",
    "weiss",
    "weiß",
    "weis",
    "nicht",
  ]);
  if (blockedExact.has(normalized)) return null;

  // Keine Arbeitssätze / Hinweis-Sätze als Namen speichern.
  const blockedStarts = [
    "hat",
    "haben",
    "will",
    "wollen",
    "möchte",
    "moechte",
    "soll",
    "sollen",
    "braucht",
    "bitte",
    "dort",
    "hier",
    "die arbeit",
    "arbeit",
    "leistung",
    "leistungen",
    "es geht",
    "es handelt",
    "zugang",
    "zufahrt",
    "termin",
    "schlüssel",
    "schluessel",
    "parkplatz",
    "garage",
    "lagerhalle",
    "eingang",
    "mail",
    "email",
    "sms",
    "whatsapp",
    "adresse wie",
    "wie letztes",
    "neuer auftrag",
    "auftraggeber",
    "besteller",
    "zahler",
    "chef",
    "zahlt",
    "bezahlt",
    "factura",
    "fatura",
    "fattura",
    "facture",
    "pagador",
    "payer",
  ];
  if (
    !hasStrongCompanySuffix &&
    blockedStarts.some((start) => normalized.startsWith(start))
  )
    return null;

  const blockedContained =
    /\b(reinigen|reinigung|schneiden|entfernen|streichen|malen|montieren|prüfen|pruefen|ersetzen|entsorgen|auftrag|leistung|leistungen|preis|preise|währung|waehrung|fenster|treppenhaus|garage|tiefgarage|baustelle|arbeitsort|ausführungsadresse|ausfuehrungsadresse|kundentext|rechnungskunde|rechnungsempfänger|rechnungsempfaenger|mail|email|whatsapp|sms|zugang|zufahrt|seitentor|schlüssel|schluessel|parkplatz|termin|bauarbeiten)\b/i;
  if (!hasStrongCompanySuffix && blockedContained.test(normalized)) return null;

  // Reine Adresszeilen sind kein Name.
  const addressLike =
    /\b(strasse|straße|str\.?|weg|gasse|platz|allee|ring|rain|halde|steig|route|rue|avenue|av\.?|chemin|via|viale|street|road|lane)\b/i;
  if (addressLike.test(normalized)) return null;

  return candidate;
}

function extractBillingCustomerNameFallback(
  rawText: string | null | undefined,
): string | null {
  const source = String(rawText || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!source) return null;

  const marker =
    "(?:kunde\\s*/\\s*rechnungsadresse|rechnungskunde|rechnungsempfänger|rechnungsempfaenger|rechnungsadresse|bitte\\s+rechnung\\s+(?:schicken|senden|mailen)\\s+an|rechnung\\s+bitte\\s+an|rechnung\\s+(?:schicken|senden|mailen)\\s+an|rechnung\\s+per\\s+(?:mail|email)\\s+an|rechnung\\s+geht\\s+an|rechnung\\s+an|rechnung\\s+bekommt|rechnung\\s+(?:für|fuer)|kunde\\s+ist|kunde|invoice\\s+customer\\s+is|invoice\\s+customer|billing\\s+customer\\s+is|billing\\s+customer|billing\\s+address|bill\\s+to)";

  // 1) Einzeiler: "Rechnung geht an Swiss Facility Service AG, Badenerstrasse 90 in 8004 Zürich."
  const inlinePattern = new RegExp(
    `(?:^|[\\n.!?]\\s*)${marker}\\s*:?\\s+([^\\n]+)`,
    "gi",
  );
  for (const match of source.matchAll(inlinePattern)) {
    const candidate = cleanBillingCustomerNameCandidate(match[1]);
    if (candidate) return candidate;
  }

  // 2) Blockform:
  //    Kunde / Rechnungsadresse:
  //    Swiss Facility Service AG
  //    Badenerstrasse 90
  //    8004 Zürich
  const lines = source
    .split(/\n+/g)
    .map((line) => line.trim())
    .filter(Boolean);

  const markerLinePattern = new RegExp(`^\\s*${marker}\\s*:?\\s*$`, "i");
  const markerWithValuePattern = new RegExp(
    `^\\s*${marker}\\s*:?\\s+(.+)$`,
    "i",
  );

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];

    const sameLine = line.match(markerWithValuePattern);
    if (sameLine?.[1]) {
      const candidate = cleanBillingCustomerNameCandidate(sameLine[1]);
      if (candidate) return candidate;
    }

    if (markerLinePattern.test(line)) {
      const nextLine = lines[index + 1] || "";
      const candidate = cleanBillingCustomerNameCandidate(nextLine);
      if (candidate) return candidate;
    }
  }

  // 3) Unlabelled fallback: first plausible billing/customer block before
  // Arbeitsort/Kontakt/Besonderheiten/Leistungen. This keeps flexible messages
  // working without assuming that the customer is always line 1.
  const sectionStopPattern =
    /^(?:arbeitsort|objekt|ausführungsadresse|ausfuehrungsadresse|kontakt\s+vor\s+ort|kontaktperson\s+vor\s+ort|ansprechperson\s+vor\s+ort|person\s+vor\s+ort|hauswart|hausmeister|concierge|caretaker|gardien|besonderheiten|leistungsübersicht|leistungsuebersicht|leistungen|titel)\s*:?/i;
  const addressPattern =
    /\b(?:strasse|straße|str\.?|weg|gasse|platz|allee|ring|rain|halde|steig|route|rue|avenue|av\.?|chemin|via|viale|street|road|lane)\b/i;
  const zipCityPattern = /\b\d{4,5}\s+[A-Za-zÄÖÜäöüß' .\-]+\b/i;
  const companySuffixPattern =
    /\b(?:ag|gmbh|sarl|sa|s\.?a\.?|ltd\.?|limited|inc\.?|kg|kgaa|gmbh\s*&\s*co|verein|stiftung)\b/i;
  const greetingOrIntroPattern =
    /^(?:hallo|guten\s+tag|grüezi|gruezi|salut|bonjour|bitte|neuer\s+auftrag|auftrag|anbei|hier|ich\s+brauche|wir\s+brauchen)\b/i;

  const upperCandidateLines: string[] = [];
  for (const line of lines) {
    if (sectionStopPattern.test(line) && !companySuffixPattern.test(line))
      break;
    upperCandidateLines.push(line);
  }

  for (let index = 0; index < upperCandidateLines.length; index += 1) {
    const line = upperCandidateLines[index];
    if (!line || greetingOrIntroPattern.test(line)) continue;
    if (
      /^(?:tel\.?|telefon|phone|mobile|handy|natel|e-?mail)\b/i.test(line) &&
      !companySuffixPattern.test(line)
    )
      continue;
    if (addressPattern.test(line) || zipCityPattern.test(line)) continue;

    const candidate = cleanBillingCustomerNameCandidate(line);
    if (!candidate) continue;

    const next1 = upperCandidateLines[index + 1] || "";
    const next2 = upperCandidateLines[index + 2] || "";
    const hasAddressAfter =
      addressPattern.test(next1) || addressPattern.test(next2);
    const hasZipAfter =
      zipCityPattern.test(next1) || zipCityPattern.test(next2);
    const hasCompanySuffix = companySuffixPattern.test(candidate);

    if (hasCompanySuffix || (hasAddressAfter && hasZipAfter)) {
      return candidate;
    }
  }

  return null;
}

type SafeBillingCustomerEvidence = {
  source: "ai" | "labeled" | "inline" | "top" | "none";
  hasReliableCustomerBlock: boolean;
  name: string | null;
  street: string | null;
  plz: string | null;
  city: string | null;
  phone: string | null;
  email: string | null;
};

function normalizeIntakeSourceText(value: string | null | undefined): string {
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function splitIntakeLines(value: string | null | undefined): string[] {
  return normalizeIntakeSourceText(value)
    .split(/\n+/g)
    .map((line) => line.trim())
    .filter(Boolean);
}

function stripBillingLabelPrefix(line: string): string {
  return String(line || "")
    .replace(BILLING_LABEL_PREFIX_REGEX, "")
    .trim();
}
function hasBillingCompanySuffix(value: string | null | undefined): boolean {
  return /\b(?:ag|gmbh|sarl|sa|s\.?a\.?|ltd\.?|limited|inc\.?|kg|kgaa|gmbh\s*&\s*co|verein|stiftung)\b/i.test(
    String(value || ""),
  );
}

function isBillingStopLine(line: string): boolean {
  const trimmed = String(line || "").trim();
  if (!trimmed) return false;

  // Firmen können zufällig mit einem Stop-Wort beginnen:
  // "Arbeitsort Reihenfolge Test GmbH", "Objekt Service AG" usw.
  // Solche Zeilen sind echte Rechnungskunden und dürfen den Billing-Block
  // nicht abbrechen.
  if (hasBillingCompanySuffix(trimmed)) return false;

  return getBillingBlockStopRegex().test(trimmed);
}

function isBillingPhoneOrMailLine(line: string): boolean {
  const trimmed = String(line || "").trim();
  if (!trimmed) return false;

  // Firmennamen wie "Telefon Trennung AG" oder "Mobile Clean GmbH"
  // sind keine Telefon-/Mail-Zeilen.
  if (
    hasBillingCompanySuffix(trimmed) &&
    !extractPhoneFromText(trimmed) &&
    !/@/.test(trimmed)
  ) {
    return false;
  }

  return (
    /^\s*(?:tel\.?|telefon|phone|mobile|handy|natel)\b\s*[:.]?\s*(?:$|\+?\d|\()/i.test(
      trimmed,
    ) || /^\s*(?:e-?mail|email)\b\s*[:.]?\s*(?:$|[^\s]+@)/i.test(trimmed)
  );
}

function parseBillingStreetLine(line: string): string | null {
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
  const germanSuffix =
    "(?:strasse|straße|str\\.?|weg|gasse|platz|allee|ring|rain|halde|steig|route|street|road|lane)";

  const patterns = [
    // Bahnhofstrasse 44, Badenerstrasse 90, Zentralstrasse 5
    new RegExp(
      `\\b((?:${word}\\s+){0,3}${word}${germanSuffix}\\s+${houseNumber})\\b`,
      "i",
    ),
    // Untere Gasse 4, Alte Gasse 7, Im Weg 2
    new RegExp(
      `\\b((?:${word}\\s+){1,4}${germanSuffix}\\s+${houseNumber})\\b`,
      "i",
    ),
    // Rütistrasse 9 / Rue de Lausanne 10 / Via Roma 3
    new RegExp(
      `\\b((?:rue|avenue|av\\.?|chemin|via|viale)\\s+${word}(?:\\s+(?:de|des|du|del|della|la|le|les|l['’]?|d['’]?|${word})){0,6}\\s+${houseNumber})\\b`,
      "i",
    ),
  ];

  for (const pattern of patterns) {
    const match = raw.match(pattern);
    if (!match?.[1]) continue;

    const street = match[1]
      .replace(
        /^\s*(?:beim|bei|an|am|in|zur|zum)\s+(?:der|dem|den|das)?\s*/i,
        "",
      )
      .replace(/\s+/g, " ")
      .trim();

    if (street && !/^[-–—]+$/.test(street)) return street;
  }

  return null;
}

function parseBillingStreetFromBlock(
  value: string | null | undefined,
): string | null {
  const lines = splitIntakeLines(value);

  // Strict first pass: street must be on its own line or in a real address line.
  // This prevents "Fixcheck AG Bahnhofstrasse 18" from becoming the street.
  for (const line of lines) {
    const cleaned = stripBillingLabelPrefix(line);
    if (
      !cleaned ||
      isBillingStopLine(cleaned) ||
      isBillingPhoneOrMailLine(cleaned)
    )
      continue;
    const street = parseBillingStreetLine(cleaned);
    if (street) return street;
  }

  // Last fallback for spoken one-liners only. Remove the parsed customer name
  // before looking for the street, otherwise company names can be swallowed.
  const source = normalizeIntakeSourceText(value);
  const name = parseBillingNameFromBlock(source);
  const withoutName = name
    ? source.replace(
        new RegExp(`^\\s*${escapeRegExpLocal(name)}\\s*[,;]?\\s*`, "i"),
        "",
      )
    : source;
  return parseBillingStreetLine(withoutName);
}

function parseBillingPlzCityFromLine(line: string): {
  plz: string | null;
  city: string | null;
} {
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
}

function parseBillingPlzCityFromBlock(value: string | null | undefined): {
  plz: string | null;
  city: string | null;
} {
  const lines = splitIntakeLines(value);

  for (const line of lines) {
    const result = parseBillingPlzCityFromLine(stripBillingLabelPrefix(line));
    if (result.plz && result.city) return result;
  }

  return parseBillingPlzCityFromLine(normalizeIntakeSourceText(value));
}

function parseBillingNameFromBlock(
  value: string | null | undefined,
): string | null {
  const lines = splitIntakeLines(value);
  for (const line of lines) {
    const stripped = stripBillingLabelPrefix(line)
      .replace(/^\s*(?:name|firma|company|société|societe)\s*:?\s*/i, "")
      .trim();

    const cleaned = isBillingPhoneOrMailLine(stripped) ? "" : stripped;

    if (!cleaned) continue;
    if (isBillingStopLine(cleaned)) continue;
    if (parseBillingStreetLine(cleaned)) continue;
    if (parseBillingPlzCityFromLine(cleaned).plz) continue;
    if (
      /\b(?:strasse|straße|str\.?|weg|gasse|platz|allee|ring|rain|halde|steig|route|rue|avenue|av\.?|chemin|via|street|road|lane)\b/i.test(
        cleaned,
      )
    )
      continue;

    const candidate = cleanBillingCustomerNameCandidate(cleaned);
    if (candidate) return candidate;
  }

  return null;
}

function getBillingBlockStopRegex(): RegExp {
  return /^(?:arbeitsort|objekt|ausführungsadresse|ausfuehrungsadresse|arbeitsadresse|einsatzort|ausführen\s+in\b.*|ausfuehren\s+in\b.*|arbeiten\s+(?:bitte\s+)?(?:bei|beim|in|im)\b.*|arbeit\s+(?:bitte\s+)?(?:bei|beim|in|im)\b.*|adresse\s+de\s+travail|lieu\s+d['’]?intervention|work\s+address|job\s+site|kontakt\s+vor\s+ort|kontaktperson|ansprechperson|person\s+vor\s+ort|contact\s+sur\s+place|concierge|hauswart|hausmeister|besonderheiten|bemerkungen|remarques|hinweise|leistungen|leistungsübersicht|leistungsuebersicht|service|services|titel)\b/i;
}

function hasNamelessBillingAddressEvidence(
  block: string | null | undefined,
): boolean {
  const source = normalizeIntakeSourceText(block);
  if (!source) return false;

  const street = parseBillingStreetFromBlock(source);
  const { plz, city } = parseBillingPlzCityFromBlock(source);
  const phone = extractPhoneFromText(source);
  const email = extractEmailFromText(source);

  const hasFullAddress = Boolean(street && plz && city);
  const hasPartialAddressWithPhone = Boolean(
    (street || (plz && city)) && phone,
  );
  const hasPartialAddressWithEmail = Boolean(
    (street || (plz && city)) && email,
  );

  // Nur für explizit gelabelte Rechnungs-/Billing-Blöcke:
  // Wenn der Name fehlt, dürfen echte Adress-/Telefon-/E-Mail-Daten trotzdem nicht
  // verworfen werden. Der Auftrag bleibt prüfpflichtig, aber die Daten bleiben
  // in der Kundenkarte sichtbar.
  return (
    hasFullAddress || hasPartialAddressWithPhone || hasPartialAddressWithEmail
  );
}

function extractLabeledBillingBlock(lines: string[]): string | null {
  const billingMarker = new RegExp(
    `^\\s*(?:${BILLING_MARKER_PATTERN})\\s*(?:ist|isch|is|lautet|heisst|heißt|=|:)?\\s*(.*)$`,
    "i",
  );
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(billingMarker);
    if (!match) continue;

    const blockLines: string[] = [];
    if (match[1]?.trim()) blockLines.push(match[1].trim());

    for (let offset = 1; offset <= 7; offset += 1) {
      const line = lines[index + offset];
      if (!line) break;
      if (isBillingStopLine(line)) break;
      blockLines.push(line);
    }

    const block = blockLines.join("\n").trim();
    if (
      block &&
      (parseBillingNameFromBlock(block) ||
        hasNamelessBillingAddressEvidence(block))
    ) {
      return block;
    }
  }

  return null;
}

function extractInlineBillingBlock(source: string): string | null {
  const patterns = [
    new RegExp(
      `(?:${BILLING_MARKER_PATTERN})\\s*(?:ist|isch|is|lautet|heisst|heißt|=|:)?\\s+([\\s\\S]{4,260}?)(?=\\s*[.!?]?\\s*\\b(?:gearbeitet\\s+wird|arbeitsort|ausführungsadresse|ausfuehrungsadresse|arbeiten\\s+(?:bitte\\s+)?(?:bei|beim|in|im)|arbeit\\s+(?:bitte\\s+)?(?:bei|beim|in|im)|adresse\\s+de\\s+travail|lieu\\s+d['’]?intervention|indirizzo\\s+(?:di\\s+lavoro|cantiere)|lugar\\s+de\\s+trabajo|kontakt\\s+vor\\s+ort|vor\\s+ort|besonderheiten|termin|rendez-vous|appuntamento|leistungsübersicht|leistungsuebersicht|leistungen|services?)\\b|$)`,
      "i",
    ),
  ];
  for (const pattern of patterns) {
    const match = source.match(pattern);
    if (!match?.[1]) continue;
    const block = match[1]
      .replace(/[,;]\s*/g, "\n")
      .replace(
        /\b(?:adresse|anschrift|telefonnummer|telefon|tel\.?|phone|mobile|handy|natel)\s*:?/gi,
        "\n$& ",
      )
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    if (
      block &&
      (parseBillingNameFromBlock(block) ||
        hasNamelessBillingAddressEvidence(block))
    ) {
      return block;
    }
  }

  return null;
}

function extractTopBillingBlock(lines: string[]): string | null {
  const blockLines: string[] = [];

  for (const line of lines) {
    if (isBillingStopLine(line)) break;
    if (
      /^(?:hallo|guten\s+tag|grüezi|gruezi|salut|bonjour|bitte\b|neuer\s+auftrag|auftrag\s+erfassen|anbei|hier\s+ist|es\s+geht\s+um|es\s+handelt\s+sich|zugang\s+über|zugang\s+ueber|termin|schlüssel|schluessel)/i.test(
        line,
      )
    )
      continue;
    if (
      /^(?:whats\s*app|whatsapp|sms|mail|e-?mail|telegram)\s*:?\s*$/i.test(line)
    )
      continue;
    if (/^\[Titel\s*:/i.test(line)) continue;
    blockLines.push(line);
    if (blockLines.length >= 5) break;
  }

  const block = blockLines.join("\n").trim();
  if (!block) return null;

  const name = parseBillingNameFromBlock(block);
  const street = parseBillingStreetFromBlock(block);
  const { plz, city } = parseBillingPlzCityFromBlock(block);
  const hasZipCity = !!plz && !!city;
  const hasCompany =
    /\b(?:ag|gmbh|sarl|sa|s\.?a\.?|ltd\.?|limited|inc\.?|kg|kgaa|verein|stiftung)\b/i.test(
      name || "",
    );

  // Unlabelled customer data is accepted only when it is a real top customer
  // block. A later Arbeitsort/Kontakt block must never become customer data.
  if (name && (hasCompany || (street && hasZipCity))) return block;
  return null;
}

function escapeRegExpLocal(value: string): string {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// V16.36: Final hard guard for explicit nameless billing-address blocks.
// This is intentionally stricter and simpler than the general customer parser:
// labels like "Rechnung an:" / "Rechnungsadresse:" are trusted as billing
// section markers, even when no customer name exists. If street + ZIP/city are
// present, persist those fields and keep the order/customer in review state.
function extractHardLabeledBillingAddressEvidenceV1634(
  rawText: string | null | undefined,
): SafeBillingCustomerEvidence | null {
  const lines = splitIntakeLines(rawText);
  if (lines.length === 0) return null;

  const markerRegex = new RegExp(
    `^\\s*(?:${BILLING_MARKER_PATTERN})\\s*(?:ist|isch|is|lautet|heisst|heißt|=|:)?\\s*(.*)$`,
    "i",
  );
  const stopRegex =
    /^\s*(?:arbeitsort|objekt|einsatzort|einsatzadresse|ausführungsadresse|ausfuehrungsadresse|ausführungsort|ausfuehrungsort|arbeitsadresse|baustelle|montageort|serviceadresse|ausführen\s+in\b.*|ausfuehren\s+in\b.*|arbeiten\s+(?:bitte\s+)?(?:bei|beim|in|im)\b.*|arbeit\s+(?:bitte\s+)?(?:bei|beim|in|im)\b.*|adresse\s+de\s+travail|lieu\s+d['’]?intervention|work\s+address|job\s+site|kontakt\s+vor\s+ort|kontaktperson|ansprechperson|person\s+vor\s+ort|besonderheiten|bemerkungen|hinweise|leistungen|leistungsübersicht|leistungsuebersicht|termin|datum)\s*:?/i;

  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(markerRegex);
    if (!match) continue;

    const blockLines: string[] = [];
    if (match[1]?.trim()) blockLines.push(match[1].trim());

    for (let offset = 1; offset <= 8; offset += 1) {
      const line = lines[index + offset];
      if (!line) break;
      if (stopRegex.test(line)) break;
      if (/^\[Titel\s*:/i.test(line)) break;
      blockLines.push(line);
    }

    const block = blockLines.join("\n").trim();
    if (!block) continue;

    const name = parseBillingNameFromBlock(block);
    const street = parseBillingStreetFromBlock(block);
    const { plz, city } = parseBillingPlzCityFromBlock(block);
    const phone = extractPhoneFromText(block);
    const email = extractEmailFromText(block);

    const hasFullAddress = Boolean(street && plz && city);
    const hasPartialAddressWithContact = Boolean(
      (street || (plz && city)) && (phone || email),
    );

    if (!name && !hasFullAddress && !hasPartialAddressWithContact) continue;

    return {
      source: "labeled",
      hasReliableCustomerBlock: true,
      name: name || null,
      street: street || null,
      plz: plz || null,
      city: city || null,
      phone: phone || null,
      email: email || null,
    };
  }

  return null;
}

// V16.37: Ultra-direct fallback for explicit nameless billing blocks.
// Grund: Der allgemeine Parser darf weiterhin streng bleiben, aber ein klarer
// Block "Rechnung an:" mit Strasse + PLZ/Ort darf nicht verloren gehen, nur
// weil kein Name vorhanden ist. Diese Funktion liest nur den explizit gelabelten
// Rechnungsblock bis zum nächsten Arbeitsort-/Leistungs-/Termin-Marker.
function extractDirectNamelessBillingAddressV1637(
  rawText: string | null | undefined,
): {
  street: string | null;
  plz: string | null;
  city: string | null;
  phone: string | null;
  email: string | null;
} | null {
  const lines = splitIntakeLines(rawText);
  if (lines.length === 0) return null;

  const markerRegex = new RegExp(
    `^\\s*(?:${BILLING_MARKER_PATTERN})\\s*(?:ist|isch|is|lautet|heisst|heißt|=|:)?\\s*(.*)$`,
    "i",
  );
  const stopRegex =
    /^\s*(?:arbeitsort|objekt|einsatzort|einsatzadresse|ausführungsadresse|ausfuehrungsadresse|ausführungsort|ausfuehrungsort|arbeitsadresse|baustelle|montageort|serviceadresse|ausführen\s+in\b.*|ausfuehren\s+in\b.*|arbeiten\s+(?:bitte\s+)?(?:bei|beim|in|im)\b.*|arbeit\s+(?:bitte\s+)?(?:bei|beim|in|im)\b.*|adresse\s+de\s+travail|lieu\s+d['’]?intervention|work\s+address|job\s+site|kontakt\s+vor\s+ort|kontaktperson|ansprechperson|person\s+vor\s+ort|besonderheiten|bemerkungen|hinweise|leistungen|leistungsübersicht|leistungsuebersicht|termin|datum)\s*:?/i;

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

    for (const rawLine of blockLines) {
      const line = rawLine.trim();
      if (!line || isBillingPhoneOrMailLine(line)) continue;

      const parsedStreet = parseBillingStreetLine(line);
      if (!street && parsedStreet) {
        street = parsedStreet;
      }

      const parsedPlzCity = parseBillingPlzCityFromLine(line);
      if (!plz && parsedPlzCity.plz) plz = parsedPlzCity.plz;
      if (!city && parsedPlzCity.city) city = parsedPlzCity.city;
    }

    // Fallback: parse the whole block in case the user wrote it as one line.
    if (!street) street = parseBillingStreetLine(block);
    if (!plz || !city) {
      const parsedWholePlzCity = parseBillingPlzCityFromLine(block);
      if (!plz && parsedWholePlzCity.plz) plz = parsedWholePlzCity.plz;
      if (!city && parsedWholePlzCity.city) city = parsedWholePlzCity.city;
    }

    const phone = extractPhoneFromText(block);
    const email = extractEmailFromText(block);

    const hasSafeAddress = Boolean(street && plz && city);
    const hasSafePartialWithContact = Boolean(
      (street || (plz && city)) && (phone || email),
    );

    if (!hasSafeAddress && !hasSafePartialWithContact) continue;

    return {
      street,
      plz,
      city,
      phone,
      email,
    };
  }

  return null;
}

// V16.39: AI-first address intake.
// The LLM must sort billing customer and execution site up front. The code below
// only validates already structured fields and deliberately does NOT infer
// billing/execution roles from multilingual marker vocabularies.
function normalizeStructuredTextField(value: any): string | null {
  const cleaned = String(value ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split(/\n+/)[0]
    .replace(/^[\s,;:.\-–—]+|[\s,;:.\-–—]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned || /^[-–—]+$/.test(cleaned)) return null;
  if (
    /^(?:null|undefined|none|keine|kein|fehlt|missing|unknown|unbekannt)$/i.test(
      cleaned,
    )
  )
    return null;
  return cleaned;
}

function normalizeStructuredTextBlock(value: any): string | null {
  const cleaned = String(value ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^[\s,;:.\-–—]+|[\s,;:.\-–—]+$/g, "")
    .trim();

  if (!cleaned || /^[-–—]+$/.test(cleaned)) return null;
  if (
    /^(?:null|undefined|none|keine|kein|fehlt|missing|unknown|unbekannt)$/i.test(
      cleaned,
    )
  )
    return null;
  return cleaned;
}

function normalizeStructuredConfidenceLevel(
  value: any,
): "hoch" | "mittel" | "niedrig" | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    if (value >= 0.85) return "hoch";
    if (value >= 0.65) return "mittel";
    return "niedrig";
  }

  const normalized = normalizeUnitText(value || "");
  if (!normalized) return null;
  if (
    ["hoch", "high", "sicher", "certain", "eindeutig", "clear"].includes(
      normalized,
    )
  )
    return "hoch";
  if (
    ["mittel", "medium", "wahrscheinlich", "probably", "plausibel"].includes(
      normalized,
    )
  )
    return "mittel";
  if (
    ["niedrig", "low", "unsicher", "uncertain", "unklar"].includes(normalized)
  )
    return "niedrig";
  return null;
}

function normalizedEvidenceKey(value: string | null | undefined): string {
  return normalizeUnitText(value || "")
    .replace(/[^a-z0-9@.+\s/-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function structuredEvidenceMatchesOriginalText(
  evidence: string | null,
  originalText: string | null | undefined,
): boolean {
  const evidenceKey = normalizedEvidenceKey(evidence);
  if (!evidenceKey || evidenceKey.length < 3) return false;

  const originalKey = normalizedEvidenceKey(originalText || "");

  // Bei Bild-only-Nachrichten gibt es keinen vollständigen Rohtext, aber die KI
  // kann sichtbare Daten aus dem Bild extrahieren. Dann reicht vorhandene
  // Evidence, weil sie nicht gegen messageText gegengeprüft werden kann.
  if (!originalKey) return true;

  if (originalKey.includes(evidenceKey)) return true;

  const evidenceTokens = evidenceKey
    .split(" ")
    .map((token) => token.trim())
    .filter(
      (token) =>
        token.length >= 4 || /@/.test(token) || /^\d{4,5}$/.test(token),
    );

  if (evidenceTokens.length === 0) return false;

  const matchingTokens = evidenceTokens.filter((token) =>
    originalKey.includes(token),
  );
  return matchingTokens.length >= Math.min(3, evidenceTokens.length);
}

function hasUsableStructuredBillingEvidence(args: {
  kundeData: any;
  originalText: string | null | undefined;
  hasAnyExtractedBillingData: boolean;
}): boolean {
  if (!args.hasAnyExtractedBillingData) return false;

  const confidence = normalizeStructuredConfidenceLevel(
    args.kundeData?.confidence ??
      args.kundeData?.confidence_level ??
      args.kundeData?.kunde_confidence ??
      args.kundeData?.billingConfidence,
  );

  const evidence = normalizeStructuredTextBlock(
    args.kundeData?.evidence ??
      args.kundeData?.sourceText ??
      args.kundeData?.source_text ??
      args.kundeData?.quelle,
  );

  // Fail closed: Ohne Confidence + Evidence wird der Kundenblock nicht als
  // sicherer Rechnungskunde behandelt. Dann bleibt der Auftrag prüfpflichtig,
  // statt falsche Kundendaten in den Kundenstamm zu schreiben.
  if (!confidence || confidence === "niedrig") return false;
  if (!evidence) return false;
  if (!structuredEvidenceMatchesOriginalText(evidence, args.originalText))
    return false;

  return true;
}

function normalizeStructuredPlz(value: any): string | null {
  const match = String(value ?? "").match(/\b(\d{4,5})\b/);
  return match?.[1] || null;
}

function cleanAiStructuredBillingName(value: any): string | null {
  let candidate = normalizeStructuredTextField(value);
  if (!candidate) return null;

  if (/@/.test(candidate)) return null;
  if (/\d/.test(candidate)) return null;
  if (
    /\b(?:kontakt\s+vor\s+ort|kontaktperson|ansprechperson|person\s+vor\s+ort|vor\s+ort\s+(?:öffnet|oeffnet|ist|macht|kommt)|öffnet\s+|oeffnet\s+|hausdienst|hauswart|hausmeister|concierge|tel\.?|telefon|handy|natel)\b/i.test(
      candidate,
    )
  ) {
    return null;
  }

  if (parseBillingStreetLine(candidate)) return null;
  if (parseBillingPlzCityFromLine(candidate).plz) return null;

  candidate = candidate
    .replace(/^['"“”‘’]+|['"“”‘’]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();

  // If the model returns a phrase with a company suffix plus trailing words,
  // keep only the company name up to the legal suffix. This is structural, not a
  // billing-marker lookup.
  const company = candidate.match(
    /^(.+?\b(?:AG|GmbH|Sàrl|SARL|SA|S\.?A\.?|Ltd\.?|Limited|Inc\.?|KG|KGaA|Verein|Stiftung)\b)/i,
  )?.[1];
  if (company) {
    const cleanedCompany = company.replace(/\s+/g, " ").trim();
    return cleanedCompany.length >= 2 && cleanedCompany.length <= 80
      ? cleanedCompany
      : null;
  }

  const tokens = candidate.split(/\s+/).filter(Boolean);
  if (tokens.length < 2 || tokens.length > 4) return null;

  const looksLikePersonName = tokens.every((token) =>
    /^[A-ZÄÖÜ][A-Za-zÄÖÜäöüß'’.-]{1,40}$/.test(token),
  );
  if (!looksLikePersonName) return null;

  return candidate.length <= 80 ? candidate : null;
}

function extractAiStructuredBillingEvidence(
  kundeData: any,
  originalText?: string | null,
): SafeBillingCustomerEvidence {
  const rawStreet = [
    normalizeStructuredTextField(kundeData?.strasse),
    normalizeStructuredTextField(kundeData?.hausnummer),
  ]
    .filter(Boolean)
    .join(" ");

  const street = rawStreet
    ? parseBillingStreetLine(rawStreet) ||
      cleanExecutionStreetCandidate(rawStreet)
    : null;
  const plz = normalizeStructuredPlz(kundeData?.plz);
  const city = cleanIntakeCityCandidate(
    normalizeStructuredTextField(kundeData?.ort),
  );
  const evidence = normalizeStructuredTextBlock(
    kundeData?.evidence ??
      kundeData?.sourceText ??
      kundeData?.source_text ??
      kundeData?.quelle,
  );
  const phone =
    extractPhoneFromText(normalizeStructuredTextField(kundeData?.telefon)) ||
    extractPhoneFromText(evidence);
  let email =
    extractEmailFromText(normalizeStructuredTextField(kundeData?.email)) ||
    extractEmailFromText(evidence);
  const name = cleanAiStructuredBillingName(kundeData?.name);

  const allOriginalEmails = Array.from(
    String(originalText || "").matchAll(
      /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,
    ),
  )
    .map((match) => match[0]?.trim())
    .filter(Boolean);

  const hasFullAddress = Boolean(street && plz && city);
  if (!email && hasFullAddress && allOriginalEmails.length === 1) {
    email = allOriginalEmails[0];
  }
  const hasPartialAddressWithContact = Boolean(
    (street || (plz && city)) && (phone || email),
  );
  const hasAnyExtractedBillingData = Boolean(
    name || hasFullAddress || hasPartialAddressWithContact,
  );

  const hasReliableCustomerBlock = hasUsableStructuredBillingEvidence({
    kundeData,
    originalText,
    hasAnyExtractedBillingData,
  });

  return {
    source: "ai",
    hasReliableCustomerBlock,
    name: hasReliableCustomerBlock ? name : null,
    street: hasReliableCustomerBlock ? street : null,
    plz: hasReliableCustomerBlock ? plz : null,
    city: hasReliableCustomerBlock ? city : null,
    phone: hasReliableCustomerBlock ? phone : null,
    email: hasReliableCustomerBlock ? email : null,
  };
}

function sameStructuredAddress(args: {
  aStreet?: string | null;
  aPlz?: string | null;
  aCity?: string | null;
  bStreet?: string | null;
  bPlz?: string | null;
  bCity?: string | null;
}): boolean {
  const a = normalizeUnitText(
    [args.aStreet, args.aPlz, args.aCity].filter(Boolean).join(" "),
  );
  const b = normalizeUnitText(
    [args.bStreet, args.bPlz, args.bCity].filter(Boolean).join(" "),
  );
  return Boolean(a && b && a === b);
}

function extractAiStructuredExecutionAddress(
  aiExecutionAddress: any,
  customer?: {
    customerAddress?: string | null;
    customerPlz?: string | null;
    customerCity?: string | null;
  },
  originalText?: string | null,
): {
  siteName: string | null;
  siteAddress: string | null;
  sitePlz: string | null;
  siteCity: string | null;
  siteNote: string | null;
} | null {
  if (!aiExecutionAddress || aiExecutionAddress.ist_abweichend !== true)
    return null;

  const confidence = normalizeStructuredConfidenceLevel(
    aiExecutionAddress.confidence ??
      aiExecutionAddress.confidence_level ??
      aiExecutionAddress.address_confidence ??
      aiExecutionAddress.executionConfidence,
  );
  if (confidence === "niedrig") return null;

  const siteName = cleanExecutionSiteNameCandidate(
    normalizeStructuredTextField(aiExecutionAddress.name),
  );
  const rawExecutionStreet = normalizeStructuredTextField(
    aiExecutionAddress.strasse,
  );
  const rawExecutionHouseNumber = normalizeStructuredTextField(
    aiExecutionAddress.hausnummer,
  );
  const rawExecutionAddress = rawExecutionStreet
    ? [
        rawExecutionStreet,
        rawExecutionHouseNumber &&
        !new RegExp(`\b${escapeRegExpLocal(rawExecutionHouseNumber)}\b`).test(
          rawExecutionStreet,
        )
          ? rawExecutionHouseNumber
          : null,
      ]
        .filter(Boolean)
        .join(" ")
    : null;

  const siteAddress = cleanExecutionStreetCandidate(rawExecutionAddress);
  const sitePlz = normalizeStructuredPlz(aiExecutionAddress.plz);
  const siteCity = cleanIntakeCityCandidate(
    normalizeStructuredTextField(aiExecutionAddress.ort),
  );

  const hasUsableAddress = Boolean(siteAddress && sitePlz && siteCity);
  if (!hasUsableAddress) return null;

  const evidence = normalizeStructuredTextBlock(
    aiExecutionAddress.evidence ??
      aiExecutionAddress.sourceText ??
      aiExecutionAddress.source_text ??
      aiExecutionAddress.quelle,
  );
  const originalKey = normalizedEvidenceKey(originalText || "");
  if (originalKey) {
    const addressParts = [siteAddress, sitePlz, siteCity].filter(
      Boolean,
    ) as string[];
    const everyAddressPartInOriginal = addressParts.every((part) => {
      const partKey = normalizedEvidenceKey(part);
      return partKey.length >= 2 && originalKey.includes(partKey);
    });

    // Fail closed: Wenn die KI eine Ausführungsadresse liefert, müssen die
    // Kerndaten der Adresse tatsächlich im Eingangstext stehen. Sonst lieber
    // keine Ausführungsadresse speichern als eine erfundene oder vermischte.
    if (!everyAddressPartInOriginal) return null;

    if (
      evidence &&
      !structuredEvidenceMatchesOriginalText(evidence, originalText)
    ) {
      return null;
    }
  }

  if (
    sameStructuredAddress({
      aStreet: siteAddress,
      aPlz: sitePlz,
      aCity: siteCity,
      bStreet: customer?.customerAddress,
      bPlz: customer?.customerPlz,
      bCity: customer?.customerCity,
    })
  ) {
    // Gleiche Strasse/PLZ/Ort ist keine abweichende Ausführungsadresse.
    // Ein Objektbereich wie "Küche hinten" oder "Veloraum" bleibt im
    // Kundentext/Besonderheiten, darf aber keinen separaten Ausführungsort
    // und keinen Ausführungsadresse-Chip erzeugen.
    return null;
  }

  return {
    siteName,
    siteAddress,
    sitePlz,
    siteCity,
    siteNote: null,
  };
}

function extractSafeBillingCustomerEvidence(
  rawText: string | null | undefined,
): SafeBillingCustomerEvidence {
  const source = normalizeIntakeSourceText(rawText);
  const empty: SafeBillingCustomerEvidence = {
    source: "none",
    hasReliableCustomerBlock: false,
    name: null,
    street: null,
    plz: null,
    city: null,
    phone: null,
    email: null,
  };
  if (!source) return empty;

  const lines = splitIntakeLines(source);
  const labeledBlock = extractLabeledBillingBlock(lines);
  const inlineBlock = extractInlineBillingBlock(source);
  const topBlock = extractTopBillingBlock(lines);

  const block = labeledBlock || inlineBlock || topBlock;
  if (!block) return empty;

  const name = parseBillingNameFromBlock(block);
  const street = parseBillingStreetFromBlock(block);
  const { plz, city } = parseBillingPlzCityFromBlock(block);
  const phone = extractPhoneFromText(block);
  const email = extractEmailFromText(block);
  const hasCompany =
    /\b(?:ag|gmbh|sarl|sa|s\.?a\.?|ltd\.?|limited|inc\.?|kg|kgaa|verein|stiftung)\b/i.test(
      name || "",
    );
  const hasAddress = Boolean(street || (plz && city));
  const hasFullAddress = Boolean(street && plz && city);
  const hasPartialAddressWithPhone = Boolean(
    (street || (plz && city)) && phone,
  );
  const hasPartialAddressWithEmail = Boolean(
    (street || (plz && city)) && email,
  );

  const sourceKind: SafeBillingCustomerEvidence["source"] = labeledBlock
    ? "labeled"
    : inlineBlock
      ? "inline"
      : "top";
  const hasReliableCustomerBlock = Boolean(
    (name &&
      ((sourceKind === "top" && (hasCompany || hasAddress)) ||
        (sourceKind !== "top" && (hasCompany || hasAddress || phone)))) ||
    // Explizit gelabelte Rechnungsadresse ohne Name:
    // Adresse/Telefon übernehmen, aber weiterhin Kunde prüfen erzwingen.
    (sourceKind !== "top" &&
      !name &&
      (hasFullAddress ||
        hasPartialAddressWithPhone ||
        hasPartialAddressWithEmail)),
  );

  return {
    source: sourceKind,
    hasReliableCustomerBlock,
    name: hasReliableCustomerBlock ? name : null,
    street: hasReliableCustomerBlock ? street : null,
    plz: hasReliableCustomerBlock ? plz : null,
    city: hasReliableCustomerBlock ? city : null,
    phone: hasReliableCustomerBlock ? phone : null,
    email: hasReliableCustomerBlock ? email : null,
  };
}

function directNamelessBillingAddressToEvidence(
  value: ReturnType<typeof extractDirectNamelessBillingAddressV1637>,
): SafeBillingCustomerEvidence | null {
  if (!value) return null;
  const hasAnyBillingData = Boolean(
    value.street || value.plz || value.city || value.phone || value.email,
  );
  if (!hasAnyBillingData) return null;

  return {
    source: "labeled",
    hasReliableCustomerBlock: true,
    name: null,
    street: value.street || null,
    plz: value.plz || null,
    city: value.city || null,
    phone: value.phone || null,
    email: value.email || null,
  };
}

function billingEvidenceValuesCompatible(
  primary?: string | null,
  fallback?: string | null,
): boolean {
  const a = normalizeUnitText(primary || "");
  const b = normalizeUnitText(fallback || "");
  return !a || !b || a === b;
}

function billingEvidenceAddressCompatible(
  primary: SafeBillingCustomerEvidence,
  fallback: SafeBillingCustomerEvidence,
): boolean {
  return (
    billingEvidenceValuesCompatible(primary.street, fallback.street) &&
    billingEvidenceValuesCompatible(primary.plz, fallback.plz) &&
    billingEvidenceValuesCompatible(primary.city, fallback.city)
  );
}

function extractDeterministicBillingEvidence(
  rawText: string | null | undefined,
): SafeBillingCustomerEvidence | null {
  const hardEvidence = extractHardLabeledBillingAddressEvidenceV1634(rawText);
  if (hardEvidence?.hasReliableCustomerBlock) return hardEvidence;

  const directEvidence = directNamelessBillingAddressToEvidence(
    extractDirectNamelessBillingAddressV1637(rawText),
  );
  if (directEvidence?.hasReliableCustomerBlock) return directEvidence;

  const safeEvidence = extractSafeBillingCustomerEvidence(rawText);
  return safeEvidence.hasReliableCustomerBlock ? safeEvidence : null;
}

function supplementAiBillingEvidence(
  aiEvidence: SafeBillingCustomerEvidence,
  fallbackEvidence: SafeBillingCustomerEvidence | null,
): SafeBillingCustomerEvidence {
  if (!fallbackEvidence?.hasReliableCustomerBlock) return aiEvidence;
  if (!aiEvidence.hasReliableCustomerBlock) return fallbackEvidence;
  if (!billingEvidenceAddressCompatible(aiEvidence, fallbackEvidence))
    return aiEvidence;

  return {
    ...aiEvidence,
    hasReliableCustomerBlock: true,
    name: aiEvidence.name || fallbackEvidence.name || null,
    street: aiEvidence.street || fallbackEvidence.street || null,
    plz: aiEvidence.plz || fallbackEvidence.plz || null,
    city: aiEvidence.city || fallbackEvidence.city || null,
    phone: aiEvidence.phone || fallbackEvidence.phone || null,
    email: aiEvidence.email || fallbackEvidence.email || null,
  };
}

function cleanIntakeCityCandidate(
  value: string | null | undefined,
): string | null {
  const city = String(value || "")
    .replace(
      /\b(?:kommen|arbeiten|reinigen|melden|montieren|prüfen|pruefen|machen|erledigen)\b.*$/i,
      "",
    )
    .replace(/^[\s,;:.\-–—]+|[\s,;:.\-–—]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!city || /^[-–—]+$/.test(city)) return null;
  return city;
}

function cleanExecutionStreetCandidate(
  value: string | null | undefined,
): string | null {
  const raw = String(value || "")
    .replace(/^[\s,;:.\-–—]+|[\s,;:.\-–—]+$/g, "")
    .replace(/^\s*(?:beim|bei|an|am|in|zur|zum)\s+(?:der|dem|den|das)?\s*/i, "")
    .replace(
      /\b(?:kommen|arbeiten|reinigen|melden|montieren|prüfen|pruefen|machen|erledigen)\b.*$/i,
      "",
    )
    .replace(/\s+/g, " ")
    .trim();

  if (!raw || /^[-–—]+$/.test(raw)) return null;

  const parsedStreet = parseBillingStreetLine(raw);
  return parsedStreet || raw;
}

function cleanExecutionSiteNameCandidate(
  value: string | null | undefined,
): string | null {
  let candidate = String(value || "")
    .replace(/^[\s,;:.\-–—]+|[\s,;:.\-–—]+$/g, "")
    .replace(
      /^\s*(?:arbeitsort|auftragsort|uftragsort|objektadresse|objekt|einsatzort|ausführungsadresse|ausfuehrungsadresse|arbeitsadresse)\s*:?\s*/i,
      "",
    )
    .replace(/^\s*(?:bei|beim|am|an|in|zur|zum)\s+(?:der|dem|den|das)?\s*/i, "")
    .replace(
      /^\s*um\s*\d{1,2}[:.]\d{2}\s+(?:uhr\s*)?(?:beim|bei|am|an|in)?\s*/i,
      "",
    )
    .replace(/\s+/g, " ")
    .trim();

  if (!candidate || /^[-–—]+$/.test(candidate)) return null;

  candidate = candidate
    .split(/\b(?:hinweise?|notes?|bemerkungen?|besonderheiten|bitte|please|kontakt|contact|contatto|contacter|melden|anrufen|whatsapp|sms|telefon|phone|kommen\s+sie|komm(?:en)?\s+erst|come\s+after|only\s+after|nur\s+nach|erst\s+nach|nicht\s+vor|guests?|gäste|auschecken|checkout)\b/i)[0]
    .replace(/[,;:.\s]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!candidate || /^[-–—]+$/.test(candidate)) return null;

  // Titel-Zeilen sind reine Auftrags-/Karten-Titel und niemals Objekt-/Ortsnamen.
  // Beispiel: "[Titel: Fenster Kontakt vor Ort]" darf nicht als Ausführungsadresse-Label gespeichert werden.
  if (/^\s*\[?\s*(?:titel|title)\s*[:：].*\]?\s*$/i.test(candidate))
    return null;

  candidate = candidate
    .replace(
      /^\s*(?:um\s*)?\d{1,2}[:.]\d{2}\s*(?:uhr)?\s*(?:beim|bei|am|an|im|in)?\s*$/i,
      "",
    )
    .replace(/^\s*(?:beim|bei|am|an|im|in|um|uhr|m)\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!candidate || /^[-–—]+$/.test(candidate)) return null;
  if (/^\s*\[?\s*(?:titel|title)\s*[:：].*\]?\s*$/i.test(candidate))
    return null;
  if (candidate.length < 3 || candidate.length > 80) return null;

  const normalized = normalizeUnitText(candidate);
  const blockedExact = new Set([
    "rechnungskunde",
    "rechnungsempfaenger",
    "rechnungsadresse",
    "kunde",
    "termin",
    "morgen",
    "heute",
    "bitte",
    "nadresse",
    "n adresse",
  ]);
  if (blockedExact.has(normalized)) return null;

  const looksLikeOperationalOrSafetyInstruction =
    /\b(?:kein(?:e|en|em)?\s+(?:hund|tiere?|tier)|keine\s+tiere|hund\s+(?:vor\s+ort|befindet|ist)|tiere?\s+(?:im\s+gebaeude|im\s+gebäude|erlaubt|verboten)|ankunft|empfang|anmelden|melden|nicht\s+einfach|vorher|zuerst|kontakt|whatsapp|sms|telefon|phone|schluessel|schlussel|schlüssel|code|zugang|hinweis|achtung|warnung)\b/i.test(
      normalized,
    );

  if (looksLikeOperationalOrSafetyInstruction) return null;

  if (
    /^(?:um\s*\d|am\s*\d|es\s+geht\s+um|es\s+handelt\s+sich|zugang\s+(?:über|ueber)|bitte\b)/i.test(
      candidate,
    )
  ) {
    return null;
  }

  if (
    /\b(?:kontakt\s+vor\s+ort|kontaktperson|ansprechperson|person\s+vor\s+ort|vor\s+ort\s+(?:öffnet|oeffnet|ist|macht|kommt)|öffnet\s+|oeffnet\s+|hausdienst|hauswart|hausmeister|concierge|tel\.?|telefon|handy|natel)\b/i.test(
      candidate,
    )
  ) {
    return null;
  }

  if (parseBillingStreetLine(candidate)) return null;
  if (parseBillingPlzCityFromLine(candidate).plz) return null;

  const looksLikeServiceOrPriceLine =
    /\b\d+(?:[.,]\d+)?\s*(?:stueck|stück|stk|quadratmeter|qm|m2|m²|meter|laufmeter|lfm|stunde|stunden|std\.?|h|tag|tage)\b/i.test(
      normalized,
    ) ||
    /\b(?:chf|franken|fr\.?|sfr\.?|stutz|eur|euro|usd|dollar|preis|pauschal|pro|per|je)\b/i.test(
      normalized,
    );

  const hasServiceVerb =
    /\b(reinigen|reinigung|putzen|schneiden|entfernen|streichen|malen|montieren|demontieren|reparieren|liefern|entsorgen|spachteln|abdecken|anfahrt|fahrtkosten|fahrpauschale|wegpauschale)\b/i.test(
      normalized,
    );

  // Eine Leistungs-/Preiszeile oder reine Leistungszusammenfassung ist niemals
  // ein Objektname der Ausführungsadresse.
  // Beispiele: "Anfahrt CHF 45", "10 Fenster reinigen CHF 7 pro Stück",
  // "Fenster reinigen und Anfahrt".
  if (looksLikeServiceOrPriceLine) return null;
  if (hasServiceVerb) return null;

  return candidate;
}

function extractExecutionBlockFromText(
  rawText: string | null | undefined,
): string | null {
  const lines = splitIntakeLines(rawText);
  if (lines.length === 0) return null;

  const startRegex =
    /^\s*(?:arbeitsort|auftragsort|uftragsort|objektadresse|objekt|einsatzort|ausführungsadresse|ausfuehrungsadresse|arbeitsadresse|adresse\s+vor\s+ort|vor\s+ort|arbeiten\s+(?:bitte\s+)?(?:bei|beim|in|im)|arbeit\s+(?:bitte\s+)?(?:bei|beim|in|im))\s*:?\s*(.*)$/i;
  const stopRegex =
    /^\s*(?:rechnung\s+an|rechnungskunde|rechnungsempfänger|rechnungsempfaenger|rechnungsadresse|kunde|auftraggeber|besteller|zahler|kontakt\s+vor\s+ort|person\s+vor\s+ort|vor\s+ort\s+(?:öffnet|oeffnet|ist|macht)|zugang|besonderheiten|bemerkungen|leistungen|leistungsübersicht|leistungsuebersicht|termin|titel|title)\s*:?/i;

  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(startRegex);
    if (!match) continue;

    const blockLines: string[] = [];
    if (match[1]?.trim()) blockLines.push(match[1].trim());

    for (let offset = 1; offset <= 6; offset += 1) {
      const line = lines[index + offset];
      if (!line) break;
      if (stopRegex.test(line)) break;
      blockLines.push(line);
    }

    const block = blockLines.join("\n").trim();
    if (block) return block;
  }

  return null;
}

function repairExecutionStreetFromText(args: {
  rawText: string | null | undefined;
  currentStreet: string | null;
  siteName: string | null;
  sitePlz: string | null;
  siteCity: string | null;
}): string | null {
  if (args.currentStreet) return args.currentStreet;

  const executionBlock = extractExecutionBlockFromText(args.rawText);
  const blockStreet = executionBlock
    ? parseBillingStreetFromBlock(executionBlock)
    : null;
  if (blockStreet) return blockStreet;

  const source = normalizeIntakeSourceText(args.rawText);
  if (!source) return null;

  const name = args.siteName ? escapeRegExpLocal(args.siteName) : null;
  const city = args.siteCity ? escapeRegExpLocal(args.siteCity) : null;
  const plz = args.sitePlz ? escapeRegExpLocal(args.sitePlz) : null;

  const windows: string[] = [];
  if (name) {
    const match = source.match(new RegExp(`.{0,120}${name}.{0,180}`, "i"));
    if (match?.[0]) windows.push(match[0]);
  }
  if (plz || city) {
    const marker = [plz, city].filter(Boolean).join("\\s+");
    const match = source.match(new RegExp(`.{0,180}${marker}.{0,80}`, "i"));
    if (match?.[0]) windows.push(match[0]);
  }

  for (const windowText of windows) {
    const street = parseBillingStreetLine(windowText);
    if (street) return street;
  }

  return null;
}


function compactRepeatedExecutionSiteDescriptorsV17_48(
  descriptors: string[],
): string[] {
  const uniqueDescriptors = Array.from(
    new Map(descriptors.map((line) => [normalizeUnitText(line), line])).values(),
  ).slice(0, 3);

  if (uniqueDescriptors.length < 2) return uniqueDescriptors;

  const splitDescriptors = uniqueDescriptors.map((line) => {
    const parts = line
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);
    return { original: line, head: parts[0] || "", tail: parts.slice(1).join(", ") };
  });

  const firstHeadKey = normalizeUnitText(splitDescriptors[0]?.head || "");
  const allSameHead = Boolean(
    firstHeadKey &&
      splitDescriptors.every(
        (entry) =>
          normalizeUnitText(entry.head) === firstHeadKey && Boolean(entry.tail),
      ),
  );

  if (!allSameHead) return uniqueDescriptors;

  const tails = Array.from(
    new Map(
      splitDescriptors.map((entry) => [normalizeUnitText(entry.tail), entry.tail]),
    ).values(),
  );

  if (tails.length < 2) return uniqueDescriptors;

  const joinedTails =
    tails.length === 2
      ? `${tails[0]} und ${tails[1]}`
      : `${tails.slice(0, -1).join(", ")} und ${tails[tails.length - 1]}`;

  return [`${splitDescriptors[0].head}, ${joinedTails}`];
}

function extractLikelyOriginalProperSitePhrasesV17_49(value: string | null | undefined): string[] {
  const text = String(value || "");
  if (!text.trim()) return [];

  const phrases = new Set<string>();
  const phrasePattern = /\b[A-ZÀ-ÖØ-ÞÄÖÜ][\p{L}'’.-]*(?:\s+[A-ZÀ-ÖØ-ÞÄÖÜ][\p{L}'’.-]*){1,4}\b/gu;
  for (const match of text.matchAll(phrasePattern)) {
    const phrase = match[0].replace(/\s+/g, " ").trim();
    if (phrase.length < 5) continue;
    // Pure all-caps short tokens are usually IDs, not object names.
    if (/^[A-Z0-9\s.-]{2,8}$/.test(phrase)) continue;
    phrases.add(phrase);
  }

  return Array.from(phrases);
}

function translatedSiteNameWouldDropOriginalProperNameV17_49(args: {
  currentSiteName: string | null | undefined;
  translatedSiteName: string | null | undefined;
  rawText: string | null | undefined;
}): boolean {
  const current = compactText(args.currentSiteName);
  const translated = compactText(args.translatedSiteName);
  if (!current || !translated) return false;

  const originalPart = String(args.rawText || "")
    .split(/---\s*Übersetzung\s*\(automatisch\)\s*---/i)[0] || "";
  const originalBlock = extractExecutionBlockFromText(originalPart) || originalPart;
  const originalBlockKey = normalizeUnitText(originalBlock);
  const translatedKey = normalizeUnitText(translated);

  for (const phrase of extractLikelyOriginalProperSitePhrasesV17_49(current)) {
    const phraseKey = normalizeUnitText(phrase);
    if (!phraseKey || phraseKey.length < 5) continue;
    if (!originalBlockKey.includes(phraseKey)) continue;
    if (!translatedKey.includes(phraseKey)) return true;
  }

  return false;
}

function translatedExecutionSiteNameCandidateFromTextV17_45(
  rawText: string | null | undefined,
): string | null {
  const translated = String(rawText || "").split(/---\s*Übersetzung\s*\(automatisch\)\s*---/i).slice(1).join("\n");
  const executionBlock = extractExecutionBlockFromText(translated || rawText);
  if (!executionBlock) return null;

  const descriptors: string[] = [];
  for (const rawLine of splitIntakeLines(executionBlock)) {
    const line = rawLine.replace(/\s+/g, " ").trim();
    if (!line) continue;
    if (parseBillingStreetLine(line)) break;
    if (parseBillingPlzCityFromLine(line).plz) break;
    const candidate = cleanExecutionSiteNameCandidate(line);
    if (candidate) descriptors.push(candidate);
  }

  const uniqueDescriptors = compactRepeatedExecutionSiteDescriptorsV17_48(
    descriptors,
  ).slice(0, 2);

  return uniqueDescriptors.length > 0 ? uniqueDescriptors.join(", ") : null;
}

function shouldReplaceExecutionSiteNameWithTranslatedV17_45(args: {
  currentSiteName: string | null;
  translatedSiteName: string | null;
  rawText: string | null | undefined;
}): boolean {
  const current = normalizeUnitText(args.currentSiteName || "");
  const translated = normalizeUnitText(args.translatedSiteName || "");
  if (!current || !translated || current === translated) return false;

  const translatedBlock = String(args.rawText || "").split(/---\s*Übersetzung\s*\(automatisch\)\s*---/i).slice(1).join("\n");
  if (!translatedBlock) return false;
  if (!normalizeUnitText(translatedBlock).includes(translated)) return false;

  if (translatedSiteNameWouldDropOriginalProperNameV17_49({
    currentSiteName: args.currentSiteName,
    translatedSiteName: args.translatedSiteName,
    rawText: args.rawText,
  })) {
    return false;
  }

  // Replace raw-language site labels with the clean translated object label.
  // This is not a room-word mapping; the translated execution block itself is
  // used as evidence.
  const translatedIsMoreSpecific =
    translated.length >= current.length + 4 &&
    (translated.includes(current) ||
      current
        .split(/\s+/g)
        .filter((token) => token.length >= 2)
        .every((token) => translated.includes(token)));

  return (
    !normalizeUnitText(translatedBlock).includes(current) ||
    translatedIsMoreSpecific ||
    /\b(?:locale|ufficio|sala|room|staff|laundry|stairwell|work\s*site)\b/i.test(current)
  );
}

function repairExecutionSiteNameFromText(args: {
  rawText: string | null | undefined;
  currentSiteName: string | null;
  siteAddress: string | null;
  sitePlz: string | null;
  siteCity: string | null;
}): string | null {
  if (args.currentSiteName) return args.currentSiteName;

  const executionBlock = extractExecutionBlockFromText(args.rawText);
  if (!executionBlock) return null;

  const siteAddressKey = normalizeUnitText(args.siteAddress || "");
  const sitePlz = String(args.sitePlz || "").trim();
  const descriptors: string[] = [];

  for (const rawLine of splitIntakeLines(executionBlock)) {
    const cleanedLine = rawLine.replace(/\s+/g, " ").trim();
    if (!cleanedLine) continue;

    const parsedStreet = parseBillingStreetLine(cleanedLine);
    if (parsedStreet) {
      const beforeStreet = cleanedLine
        .replace(new RegExp(`${escapeRegExpLocal(parsedStreet)}.*$`, "i"), "")
        .replace(/[,:;\-–—]+$/g, "")
        .trim();
      const safePrefix = cleanExecutionSiteNameCandidate(beforeStreet);
      if (safePrefix) descriptors.push(safePrefix);
      continue;
    }

    const candidate = cleanExecutionSiteNameCandidate(cleanedLine);
    if (!candidate) continue;
    if (parseBillingPlzCityFromLine(candidate).plz) continue;
    if (sitePlz && candidate.includes(sitePlz)) continue;
    if (siteAddressKey && normalizeUnitText(candidate) === siteAddressKey)
      continue;
    descriptors.push(candidate);
  }

  const uniqueDescriptors = Array.from(
    new Map(
      descriptors.map((line) => [normalizeUnitText(line), line]),
    ).values(),
  ).slice(0, 2);

  return uniqueDescriptors.length > 0 ? uniqueDescriptors.join(", ") : null;
}

function sanitizeExtractedExecutionAddress<
  T extends {
    siteName?: string | null;
    siteAddress?: string | null;
    sitePlz?: string | null;
    siteCity?: string | null;
    siteNote?: string | null;
  },
>(address: T | null | undefined, rawText: string | null | undefined): T | null {
  if (!address) return null;

  let siteName = cleanExecutionSiteNameCandidate(address.siteName || null);
  const siteCity = cleanIntakeCityCandidate(address.siteCity || null);
  let siteAddress = cleanExecutionStreetCandidate(address.siteAddress || null);

  siteAddress = repairExecutionStreetFromText({
    rawText,
    currentStreet: siteAddress,
    siteName,
    sitePlz: address.sitePlz || null,
    siteCity,
  });

  siteName = repairExecutionSiteNameFromText({
    rawText,
    currentSiteName: siteName,
    siteAddress,
    sitePlz: address.sitePlz || null,
    siteCity,
  });

  const translatedSiteName = translatedExecutionSiteNameCandidateFromTextV17_45(rawText);
  if (
    shouldReplaceExecutionSiteNameWithTranslatedV17_45({
      currentSiteName: siteName,
      translatedSiteName,
      rawText,
    })
  ) {
    siteName = translatedSiteName;
  }

  const cleaned = {
    ...address,
    siteName,
    siteAddress,
    siteCity,
  };

  if (
    !cleaned.siteName &&
    !cleaned.siteAddress &&
    !cleaned.sitePlz &&
    !cleaned.siteCity
  ) {
    return null;
  }

  return cleaned as T;
}

function applySafeBillingCustomerGuard(args: {
  kundeData: any;
  evidence: SafeBillingCustomerEvidence;
  allowSelfIntroName: boolean;
}): { changed: boolean; reviewReason: string | null } {
  const { kundeData, evidence, allowSelfIntroName } = args;
  const before = JSON.stringify({
    name: kundeData.name || null,
    strasse: kundeData.strasse || null,
    hausnummer: kundeData.hausnummer || null,
    plz: kundeData.plz || null,
    ort: kundeData.ort || null,
    telefon: kundeData.telefon || null,
    email: kundeData.email || null,
  });

  if (!evidence.hasReliableCustomerBlock) {
    const safeSelfIntroName = allowSelfIntroName
      ? cleanBillingCustomerNameCandidate(kundeData.name || null)
      : null;

    // No verified billing block means: leave customer master fields empty.
    // Execution address and onsite contact stay only in order/site/special notes.
    kundeData.name = safeSelfIntroName || null;
    kundeData.strasse = null;
    kundeData.hausnummer = null;
    kundeData.plz = null;
    kundeData.ort = null;
    kundeData.telefon = null;
    kundeData.email = null;

    const after = JSON.stringify({
      name: kundeData.name || null,
      strasse: kundeData.strasse || null,
      hausnummer: kundeData.hausnummer || null,
      plz: kundeData.plz || null,
      ort: kundeData.ort || null,
      telefon: kundeData.telefon || null,
      email: kundeData.email || null,
    });

    return {
      changed: before !== after,
      reviewReason: "customer_data_uncertain_no_billing_block",
    };
  }

  kundeData.name = evidence.name || null;
  kundeData.strasse = evidence.street || null;
  kundeData.hausnummer = null;
  kundeData.plz = evidence.plz || null;
  kundeData.ort = evidence.city || null;
  kundeData.telefon = evidence.phone || null;
  kundeData.email = evidence.email || null;

  const after = JSON.stringify({
    name: kundeData.name || null,
    strasse: kundeData.strasse || null,
    hausnummer: kundeData.hausnummer || null,
    plz: kundeData.plz || null,
    ort: kundeData.ort || null,
    telefon: kundeData.telefon || null,
    email: kundeData.email || null,
  });

  return {
    changed: before !== after,
    reviewReason: null,
  };
}

type OnsiteContactHint = {
  hint: string | null;
  phone: string | null;
  phoneBelongsToSiteContact: boolean;
};

function normalizePhoneDigits(value: string | null | undefined): string {
  return String(value || "").replace(/\D/g, "");
}

function extractPhoneFromText(value: string | null | undefined): string | null {
  const source = String(value || "");
  const explicit = source.match(
    /\b(?:tel\.?|telefon|phone|mobile|handy|natel)\s*[:.]?\s*(\+?\d[\d\s()./-]{6,}\d)\b/i,
  );
  const loose =
    explicit?.[1] || source.match(/(\+?\d[\d\s()./-]{7,}\d)/)?.[1] || null;
  if (!loose) return null;

  const cleanedLoose = loose.replace(/\s+/g, " ").trim();
  if (/^\d{1,2}[./-]\d{1,2}[./-]\d{2,4}$/.test(cleanedLoose)) return null;

  const digits = normalizePhoneDigits(cleanedLoose);
  if (digits.length < 7 || digits.length > 15) return null;

  return cleanedLoose;
}

function extractEmailFromText(value: string | null | undefined): string | null {
  const source = String(value || "");
  const match = source.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return match?.[0]?.trim() || null;
}

function extractOnsiteContactHint(
  rawText: string | null | undefined,
  candidateCustomerPhone: string | null | undefined,
): OnsiteContactHint {
  const source = String(rawText || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  const candidateDigits = normalizePhoneDigits(candidateCustomerPhone);
  if (!source) {
    return { hint: null, phone: null, phoneBelongsToSiteContact: false };
  }

  const lines = source
    .split(/\n+/g)
    .map((line) => line.trim())
    .filter(Boolean);

  const explicitMarkerRe =
    /\b(kontakt\s+vor\s+ort|kontaktperson\s+vor\s+ort|ansprechperson\s+vor\s+ort|ansprechpartner\s+vor\s+ort|person\s+vor\s+ort|vor\s+ort\s+(?:öffnet|oeffnet|ist|macht))\b/i;
  const roleMarkerRe =
    /\b(hauswart|hausmeister|hausdienst|concierge|caretaker|gardien|facility\s+manager)\b/i;
  const anyMarkerRe = new RegExp(
    `${explicitMarkerRe.source}|${roleMarkerRe.source}`,
    "i",
  );
  const stopRe =
    /^(besonderheiten|leistungsübersicht|leistungsuebersicht|leistungen|titel|rechnung|rechnungsadresse|kunde|arbeitsort|objekt|termin|datum|fecha|date|data\s+lavoro|date\s+souhaitée|date\s+souhaitee)\s*:?/i;

  const cleanContactLine = (line: string, stripExplicitMarker: boolean) =>
    line
      .replace(stripExplicitMarker ? explicitMarkerRe : /^\b$/i, "")
      .replace(
        /\b(?:tel\.?|telefon|phone|mobile|handy|natel)\b\s*[:.]?.*$/i,
        "",
      )
      .replace(/^[\s:.-]+|[\s:.-]+$/g, "")
      .replace(/\s+/g, " ")
      .trim();

  for (let index = 0; index < lines.length; index += 1) {
    if (!anyMarkerRe.test(lines[index])) continue;

    const hasExplicitMarker = explicitMarkerRe.test(lines[index]);
    const blockLines: string[] = [];
    for (let offset = 0; offset <= 4; offset += 1) {
      const line = lines[index + offset];
      if (!line) continue;
      if (offset > 0 && stopRe.test(line)) break;
      blockLines.push(line);
    }

    const block = blockLines.join(" ");
    const phone = extractPhoneFromText(block);
    const phoneDigits = normalizePhoneDigits(phone);
    const phoneBelongsToSiteContact =
      !!candidateDigits &&
      !!phoneDigits &&
      (phoneDigits.endsWith(candidateDigits) ||
        candidateDigits.endsWith(phoneDigits) ||
        phoneDigits === candidateDigits);

    const contactName = blockLines
      .map((line, offset) =>
        cleanContactLine(line, hasExplicitMarker && offset === 0),
      )
      .find((line) => line && !/^\+?\d/.test(line));

    const parts = [
      contactName ? `Kontakt vor Ort: ${contactName}` : "Kontakt vor Ort",
      phone ? `Tel. ${phone}` : null,
    ].filter(Boolean);

    return {
      hint: parts.join(", "),
      phone,
      phoneBelongsToSiteContact,
    };
  }

  return { hint: null, phone: null, phoneBelongsToSiteContact: false };
}

function compactText(value: any): string {
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizeUnitText(value: any): string {
  return String(value || "")
    .toLowerCase()
    .replace(/[ä]/g, "ae")
    .replace(/[ö]/g, "oe")
    .replace(/[ü]/g, "ue")
    .replace(/[ß]/g, "ss")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeBlockText(value: any): string {
  return String(value || "")
    .toLowerCase()
    .replace(/[ä]/g, "ae")
    .replace(/[ö]/g, "oe")
    .replace(/[ü]/g, "ue")
    .replace(/[ß]/g, "ss")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizeSemanticText(value: any): string {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[ä]/g, "ae")
    .replace(/[ö]/g, "oe")
    .replace(/[ü]/g, "ue")
    .replace(/[ß]/g, "ss")
    .replace(/[^a-z0-9€$£\s/-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function uniqueNormalizedLines(lines: string[]): string[] {
  const seen = new Set<string>();

  return lines
    .map((line) =>
      String(line || "")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .filter(Boolean)
    .filter((line) => {
      const key = normalizeSemanticText(line);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function stripInternalTitleLinesFromText(value?: string | null): string {
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim();

      // Interne Karten-/Auftragstitel sind Metadaten. Sie dürfen nicht als
      // Kundennachricht gespeichert und nicht erneut als Leistung interpretiert
      // werden. Das ist keine Leistungs-Wortliste, sondern nur die Entfernung
      // des technischen Markers, den Smartflow selbst erzeugt hatte.
      return !/^\[\s*(?:titel|title)\s*[:：][^\]]*\]\s*$/i.test(trimmed);
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

type IntakeNormalizationResultV17_49 = {
  translationText: string;
  detectedLanguage: string;
  showTranslationInCustomerMessage: boolean;
};

const EMPTY_INTAKE_NORMALIZATION_V17_49: IntakeNormalizationResultV17_49 = {
  translationText: "",
  detectedLanguage: "",
  showTranslationInCustomerMessage: false,
};

function shouldShowAutomaticTranslationBlockV17_49(args: {
  originalText: string;
  translationText: string;
  detectedLanguage?: string | null;
  targetLanguage: string;
  modelWantsVisibleTranslation?: boolean;
}): boolean {
  const translationText = stripInternalTitleLinesFromText(args.translationText || "").trim();
  if (!translationText) return false;

  const detected = normalizeSemanticText(args.detectedLanguage || "");
  const target = normalizeSemanticText(args.targetLanguage || "Deutsch");

  const detectedClearlyTarget =
    (target.includes("deutsch") || target.includes("german")) &&
    /(?:^|)(?:deutsch|standarddeutsch|german)(?:|$)/i.test(detected) &&
    !/(?:schweizerdeutsch|dialekt|mundart|swiss\s*german|french|franzoes|franzos|italien|italian|spanisch|spanish|portugies|portuguese)/i.test(detected);

  if (detectedClearlyTarget) return false;

  const detectedClearlyDifferentLanguage =
    /(schweizerdeutsch|dialekt|mundart|swiss\s*german|french|franzoes|franzos|francais|français|italien|italian|italiano|spanisch|spanish|portugies|portuguese|english|englisch|mixed|mischsprache)/i.test(
      detected,
    );

  if (detectedClearlyDifferentLanguage) return true;

  // Fail closed for the UI: if the language detector is unsure, keep the
  // normalised Arbeitsfassung internal. Customer messages should not be filled
  // with a visible translation block unless the source was truly non-German or
  // dialectal. This is a display gate, not a service/address word list.
  return Boolean(args.modelWantsVisibleTranslation) && !detectedClearlyTarget;
}

async function createStandardGermanValidationTranslation(args: {
  text: string;
  targetLanguage: string;
  source: string;
}): Promise<IntakeNormalizationResultV17_49> {
  const rawText = stripInternalTitleLinesFromText(args.text || "").trim();
  const targetLanguage = (args.targetLanguage || "Deutsch").trim() || "Deutsch";
  if (!rawText || !process.env.OPENAI_API_KEY) return EMPTY_INTAKE_NORMALIZATION_V17_49;

  try {
    const transRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        messages: [
          {
            role: "system",
            content: `Du bist der vorgeschaltete Normalisierungs-Schritt für eine Auftragserfassung.
Ziel: Der nachfolgende Validator muss Leistungen, Ausführungsadresse und Hinweise strukturell korrekt lesen können.

Gib NUR gültiges JSON zurück:
{"detected_language":"...","needs_normalization":true/false,"show_customer_translation":true/false,"translation":"..." oder null}

Regeln:
- needs_normalization=true nur, wenn der Text wirklich fremdsprachig, dialektal, deutlich gemischtsprachig oder fachlich so roh ist, dass der nachfolgende Validator ohne Arbeitsfassung Leistungen/Rollen verlieren würde.
- show_customer_translation=true NUR, wenn der sichtbare Kundentext für einen deutschsprachigen Nutzer wirklich übersetzt werden muss, z.B. Französisch, Italienisch, Englisch, Spanisch, Schweizerdeutsch/Dialekt oder starke Mischsprache.
- show_customer_translation=false bei normalem Standard-${targetLanguage}, auch wenn darin echte fremdsprachige Eigennamen, Raum-/Gebäudenamen, Firmennamen, Straßennamen oder Ortsnamen vorkommen. Beispiel: "Rue du Lac", "Bâtiment Lumière", "Sala Verde", "Route de Genève" sind Namen und lösen allein keinen sichtbaren Übersetzungsblock aus.
- Übersetze/normalisiere bei needs_normalization=true den kompletten Text nach professionellem Standard-${targetLanguage}.
- Erhalte Struktur, Zeilenumbrüche, Adressblöcke, Telefonnummern, E-Mail, Mengen, Einheiten, Preise, Währungen, Codes und Reihenfolge exakt sinngemäß.
- Echte Eigennamen, Firmennamen, Gebäudenamen, Straßennamen, Haus-/Trakt-/Raumnamen und Standortnamen exakt behalten, wenn sie als Namen gemeint sind. Nicht aus "Sala Verde" automatisch "Grüner Saal" machen, nicht aus "Bâtiment Les Cèdres" automatisch "Gebäude Les Cèdres" machen.
- Nur frei beschreibende Funktions-/Raumbegriffe normalisieren, wenn sie keine Eigennamen sind und die Bedeutung eindeutig ist. Im Zweifel Originalnamen behalten.
- Leistungszeilen müssen in der Arbeitsfassung als klare fachliche Standard-${targetLanguage}-Arbeitszeilen erscheinen, mit sauberem Verb, z.B. "... reinigen", "... abstauben", "... entfernen", "... streichen" usw., wenn die Handlung aus dem Text hervorgeht.
- Arbeitsobjekt und Kontext dürfen nicht vertauscht werden: Wenn die Zeile Fenster/Tische/Vitrinen im Gang/Sitzungszimmer nennt, muss der sichtbare Leistungsname das Arbeitsobjekt behalten und darf nicht zu einem allgemeinen Bereich wie "Gangbereich reinigen" oder "Besprechungsbereich reinigen" verflachen.
- Ausführungsort-/Arbeitsort-Zeilen dürfen nur Objekt, Räume und Adresse enthalten. Kontaktwege, WhatsApp/SMS/Telefon, Zeitfenster, Zugang, Gefahren und Sonderhinweise bleiben eigene Hinweiszeilen und dürfen nicht an den Ortsnamen angehängt werden.
- Keine neuen Leistungen erfinden. Keine Mengen/Preise ändern. Keine Zeilen zusammenmischen.
- Wenn der Text bereits vollständig sauberes Standard-${targetLanguage} ist, needs_normalization=false, show_customer_translation=false und translation=null.`,
          },
          { role: "user", content: rawText },
        ],
        response_format: { type: "json_object" },
        max_tokens: 3600,
      }),
    });

    if (!transRes.ok) return EMPTY_INTAKE_NORMALIZATION_V17_49;
    const transResult = await transRes.json();
    const transContent = transResult?.choices?.[0]?.message?.content;
    if (!transContent) return EMPTY_INTAKE_NORMALIZATION_V17_49;

    const transData = JSON.parse(transContent);
    const translation = String(transData?.translation || "").trim();
    if (!transData?.needs_normalization || !translation) {
      return {
        ...EMPTY_INTAKE_NORMALIZATION_V17_49,
        detectedLanguage: String(transData?.detected_language || ""),
      };
    }

    const cleanTranslation = stripInternalTitleLinesFromText(translation);
    const detectedLanguage = String(transData?.detected_language || "");
    const showTranslationInCustomerMessage =
      shouldShowAutomaticTranslationBlockV17_49({
        originalText: rawText,
        translationText: cleanTranslation,
        detectedLanguage,
        targetLanguage,
        modelWantsVisibleTranslation: Boolean(transData?.show_customer_translation),
      });

    console.log(
      `[${args.source}] Intake text normalized from ${detectedLanguage || "unknown"} to ${targetLanguage} (visibleTranslation=${showTranslationInCustomerMessage ? "yes" : "no"})`,
    );
    return {
      translationText: cleanTranslation,
      detectedLanguage,
      showTranslationInCustomerMessage,
    };
  } catch (error) {
    console.error(`[${args.source}] Intake normalization failed:`, error);
    return EMPTY_INTAKE_NORMALIZATION_V17_49;
  }
}

function isNegatedSpecialNoteLine(value: string): boolean {
  const line = normalizeSemanticText(value);
  if (!line) return false;

  return /\b(kein|keine|keinen|keinem|nicht|nie|ohne|no|not|none|without|pas|sans|sin|ningun|ninguna|nessun|nessuna|sem)\b/i.test(
    line,
  );
}

const COMMUNICATION_NEGATION_TOKEN =
  "(?:nicht|kein|keine|keinen|keinem|ohne|no|not|never|none|without|pas|ne\\s+pas|sans|sin|non|nod|noed|ned|nid|nit|nuet|nued)";

const communicationChannelSource = (channel: "whatsapp" | "sms" | "mail") => {
  if (channel === "whatsapp") return "(?:whats\\s*app|whatsapp)";
  if (channel === "sms") return "sms";
  return "(?:mail|e\\s*mail|e-mail|email|courriel)";
};

function isForbiddenChannelInstructionLine(
  value: string | null | undefined,
  channel: "whatsapp" | "sms" | "mail",
): boolean {
  const text = normalizeSemanticText(value);
  if (!text) return false;

  const channelSource = communicationChannelSource(channel);
  if (!new RegExp(`\\b${channelSource}\\b`, "i").test(text)) return false;

  // Kanal-Verbote dürfen nur greifen, wenn die Verneinung semantisch den
  // Kommunikationskanal betrifft. Beispiel Live-Fehler:
  // "WhatsApp an 079..., nicht einfach kommen" ist WhatsApp POSITIV plus
  // separate Zugangsanweisung. Das "nicht" gehört nicht zu WhatsApp.
  const directBeforeChannel = new RegExp(
    `\\b${COMMUNICATION_NEGATION_TOKEN}\\b(?:\\s+(?:bitte|mehr|mehrmals|nur|mehrfach|per|via|ueber|uber|over|mit|auf|durch|kontakt|kontaktieren|schreiben|senden|schicken|message|nachricht)){0,5}\\s+(?:${channelSource})\\b`,
    "i",
  );
  const channelBeforeDirectNo = new RegExp(
    `\\b(?:${channelSource})\\b(?:\\s+(?:bitte|mehr|mehrmals|verwenden|benutzen|nutzen|use|kontaktieren|schreiben|senden|schicken|message|nachricht)){0,6}\\s+\\b${COMMUNICATION_NEGATION_TOKEN}\\b`,
    "i",
  );
  const explicitNoChannel = new RegExp(
    `\\b(?:${channelSource})\\b\\s*(?:nein|verboten|unerwuenscht|unerwünscht|nicht\\s+(?:verwenden|benutzen|nutzen|kontaktieren|schreiben|senden|schicken)|no|not|never)\\b`,
    "i",
  );

  return (
    directBeforeChannel.test(text) ||
    channelBeforeDirectNo.test(text) ||
    explicitNoChannel.test(text)
  );
}

function isPositiveChannelInstructionLine(
  value: string | null | undefined,
  channel: "whatsapp" | "sms" | "mail",
): boolean {
  const text = normalizeSemanticText(value);
  if (!text || isForbiddenChannelInstructionLine(text, channel)) return false;

  const channelSource = communicationChannelSource(channel);
  if (!new RegExp(`\\b${channelSource}\\b`, "i").test(text)) return false;

  const positiveIntent =
    "(?:reicht|genuegt|genuget|bevorzugt|preferred|preferiert|am\\s+besten|best|only|nur|schreiben|senden|schicken|kontakt|kontaktieren|melden)";

  return (
    new RegExp(
      `\\b(?:${channelSource})\\b(?:[-/\\s]+[a-z0-9]+){0,8}[-/\\s]+${positiveIntent}\\b`,
      "i",
    ).test(text) ||
    new RegExp(
      `\\b(?:per|via|mit|nur|only)\\s+(?:${channelSource})\\b`,
      "i",
    ).test(text) ||
    new RegExp(
      `\\b${positiveIntent}\\s+(?:per|via|mit)?\\s*(?:${channelSource})\\b`,
      "i",
    ).test(text)
  );
}

function reconcileCommunicationSpecialNoteLines(lines: string[]): string[] {
  const hasForbiddenWhatsApp = lines.some((line) =>
    isForbiddenChannelInstructionLine(line, "whatsapp"),
  );

  return lines.filter((line) => {
    if (
      hasForbiddenWhatsApp &&
      isPositiveChannelInstructionLine(line, "whatsapp")
    ) {
      return false;
    }

    return true;
  });
}

function dedupeSpecialNoteLines(lines: string[]): string[] {
  const cleaned = uniqueNormalizedLines(lines);
  const result: string[] = [];

  for (const line of cleaned.sort((a, b) => b.length - a.length)) {
    const key = normalizeSemanticText(line);
    if (!key) continue;

    const isSubsumed = result.some((existing) => {
      const existingKey = normalizeSemanticText(existing);
      if (!existingKey) return false;
      return existingKey.includes(key) || key.includes(existingKey);
    });

    if (!isSubsumed) result.push(line);
  }

  return result.reverse();
}

function isNonActionableSpecialNoteCandidate(line: string): boolean {
  const normalized = normalizeSemanticText(line);
  if (!normalized) return true;

  if (!isNegatedSpecialNoteLine(normalized)) return false;

  // Negative parking/access facts are still useful operational hints.
  if (
    /\b(kein\s+parkplatz|keine\s+parkplaetze|kein\s+parken|parkverbot|no\s+parking|sin\s+aparcamiento|sans\s+parking|senza\s+parcheggio|kein\s+lift|ohne\s+lift|no\s+elevator|no\s+lift)\b/i.test(
      normalized,
    )
  ) {
    return false;
  }

  return /\b(hund|dog|chien|perro|cane|cao|cão|oel|oil|huile|aceite|olio|scherben|glass|strom|kabel|wire|leiter|ladder|termin|appointment|schluessel|schlussel|key|parkplatz|parking|zugang|access)\b/i.test(
    normalized,
  );
}

function isNonActionablePlanningHint(line: string): boolean {
  const normalized = normalizeSemanticText(line);
  if (!normalized) return true;

  return (
    /\b(parkplatz\s+kein\s+thema|parkplatz\s+nicht\s+wichtig|direkt\s+halten|genug\s+platz|direkt\s+vor\s+dem\s+haus\s+(?:halten|moeglich|moglich))\b/i.test(
      normalized,
    ) ||
    /\b(zugang\s+(?:frei|offen|unproblematisch)|tuer\s+offen|tur\s+offen|kunde\s+ist\s+vor\s+ort)\b/i.test(
      normalized,
    )
  );
}

function isFalseCallbackHint(line: string): boolean {
  const normalized = normalizeSemanticText(line);
  if (!normalized) return false;

  if (
    !/\b(rueckruf|ruckruf|zurueckrufen|telefonisch|anruf|telefon)\b/i.test(
      normalized,
    )
  ) {
    return false;
  }

  // INTAKE_CALLBACK_NEGATION_SAFE_V16
  // A callback chip is allowed only for a positive request. These phrases are
  // explicit negative/door instructions and must never become "Rückruf".
  return (
    /\b(nicht\s+(?:telefonisch\s+)?(?:zurueckrufen|anrufen)|kein(?:e[nm]?)?\s+(?:telefonischer\s+)?(?:rueckruf|ruckruf|anruf)|rueckruf\s+(?:nicht\s+)?(?:noetig|nötig|erwuenscht|erwünscht)|nicht\s+erwuenscht|nicht\s+erwünscht)\b/i.test(
      normalized,
    ) ||
    /\b(klingeln|warten|haupteingang|kunde\s+ist\s+vor\s+ort|kundin\s+ist\s+vor\s+ort|oeffnet\s+die\s+tuer|offnet\s+die\s+tur|an\s+der\s+tuer|schluessel\s+wird\s+.*tuer)\b/i.test(
      normalized,
    )
  );
}

function canonicalizeSpecialNoteLine(line: string): string {
  const original = String(line || "")
    .replace(/\s+/g, " ")
    .trim();
  const normalized = normalizeSemanticText(original);
  if (!original || !normalized) return original;

  // Keep stored special notes visible in German. The LLM may occasionally
  // return a mixed-language note although the translated block is German.
  // This guard is phrase-meaning based for recurring safety/access concepts,
  // not a service-word mapping.
  if (
    /\b(paviment|pavimento|pavimento\s+delicato|detergente\s+neutro|detergenti\s+neutri)\b/i.test(normalized) ||
    (/\b(delicat|delicato|delicata|empfindlich|neutro|neutre|neutral)\b/i.test(normalized) && /\b(boden|floor|sol|suelo|paviment|pavimento|reinigungsmittel|detergente|detergent)\b/i.test(normalized))
  ) {
    return "Empfindlicher Boden, neutrales Reinigungsmittel verwenden";
  }

  if (/\b(non\s+toccare|ne\s+pas\s+toucher|do\s+not\s+touch|nicht\s+beruehren|nicht\s+berühren)\b/i.test(normalized) && /\b(kabel|cable|cavi|cables|strom|lichtanlage)\b/i.test(normalized)) {
    return /lichtanlage/i.test(normalized)
      ? "Lichtanlage nicht berühren"
      : "Nicht an den Kabeln arbeiten";
  }

  if (/\b(accesso|access|acceso|zugang|eingang|garage|porta|tuercode|türcode|code)\b/i.test(normalized) && /\b(code|garage|porta|tuer|tür|eingang|zugang)\b/i.test(normalized)) {
    return original
      .replace(/\bEntrare\s+dal\s+garage\b/gi, "Zugang über die Garage")
      .replace(/\bcodice\s+porta\b/gi, "Türcode")
      .replace(/\baccesso\b/gi, "Zugang")
      .replace(/\bporta\b/gi, "Tür")
      .replace(/\s+/g, " ")
      .trim();
  }

  if (/^kontakt\s+vor\s+ort:/i.test(normalized)) {
    return original
      .replace(/\bist\s+nur\s+und\b/gi, "ist nur Kontaktperson vor Ort und")
      .replace(
        /\bist\s+nur\s*,\s*nicht\b/gi,
        "ist nur Ansprechpartner vor Ort, nicht",
      )
      .replace(/,\s*Tel\.\s*\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\b/gi, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  // V16.95: Communication instructions are preserved as a structured
  // channel rule: allowed channel + forbidden phone contact. This prevents
  // "Bitte nur per Mail, nicht telefonisch" from being collapsed to the
  // weaker visible note "Mail reicht".
  const mentionsNoPhone =
    /\b(nicht\s+(?:telefonisch\s+)?(?:zurueckrufen|anrufen)|nicht\s+telefonisch|keine?\s+telefonische\s+(?:rueckfrage|ruckfrage|rueckruf|ruckruf|anfrage|kontaktaufnahme)|kein(?:e[nm]?)?\s+(?:telefonischer\s+)?(?:rueckruf|ruckruf|anruf)|ne\s+pas\s+appeler|ne\s+pas\s+rappeler|ne\s+pas\s+telephoner|pas\s+d\s+appel(?:s)?|pas\s+d\s+appel(?:s)?\s+telephonique(?:s)?|pas\s+appeler|pas\s+telephoner|sans\s+appel\s+telephonique|merci\s+de\s+ne\s+pas\s+appeler|do\s+not\s+call|dont\s+call|don't\s+call|no\s+phone\s+call|no\s+calls?)\b/i.test(
      normalized,
    );
  const mentionsWhatsApp = /\b(whatsapp|whats\s*app)\b/i.test(normalized);
  const mentionsSms = /\b(sms|text\s+message|kurznachricht)\b/i.test(
    normalized,
  );
  const mentionsMail = /\b(mail|e-mail|email|courriel)\b/i.test(normalized);

  if (mentionsNoPhone && mentionsWhatsApp)
    return "WhatsApp bevorzugt, bitte nicht telefonisch";
  if (mentionsNoPhone && mentionsSms)
    return "SMS reicht, bitte keine telefonische Rückfrage";
  if (mentionsNoPhone && mentionsMail)
    return "Mail reicht, bitte keine telefonische Rückfrage";
  if (mentionsNoPhone) return "Bitte keine telefonische Rückfrage";

  if (/kontakt\s+vor\s+ort.*\bist\s+nur\s*,\s*nicht/i.test(normalized)) {
    return original.replace(
      /\bist\s+nur\s*,\s*nicht/gi,
      "ist nur Ansprechpartner vor Ort, nicht",
    );
  }

  if (/^kontakt\s+vor\s+ort:/i.test(normalized)) {
    return original
      .replace(/,\s*Tel\.\s*\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\b/gi, "")
      .replace(
        /\bist\s+nur\s*,\s*nicht/gi,
        "ist nur Ansprechpartner vor Ort, nicht",
      )
      .replace(/\s+/g, " ")
      .trim();
  }

  if (
    /\b(whatsapp\s+(?:suffit|reicht|genuegt|genügt)|par\s+whatsapp|via\s+whatsapp|whatsapp\s+only)\b/i.test(
      normalized,
    )
  ) {
    return "WhatsApp reicht";
  }
  if (
    /\b(sms\s+(?:reicht|genuegt|genügt|suffit)|per\s+sms|via\s+sms|sms\s+only)\b/i.test(
      normalized,
    )
  ) {
    return "SMS reicht";
  }
  if (
    /\b(mail\s+(?:reicht|genuegt|genügt|suffit)|email\s+(?:reicht|genuegt|genügt|suffit)|per\s+(?:mail|email)|via\s+(?:mail|email)|mail\s+only|email\s+only)\b/i.test(
      normalized,
    )
  ) {
    return "Mail reicht";
  }

  let german = original
    .replace(/\blundi\b/gi, "Montag")
    .replace(/\bmardi\b/gi, "Dienstag")
    .replace(/\bmercredi\b/gi, "Mittwoch")
    .replace(/\bjeudi\b/gi, "Donnerstag")
    .replace(/\bvendredi\b/gi, "Freitag")
    .replace(/\bsamedi\b/gi, "Samstag")
    .replace(/\bdimanche\b/gi, "Sonntag")
    .replace(/\bmonday\b/gi, "Montag")
    .replace(/\btuesday\b/gi, "Dienstag")
    .replace(/\bwednesday\b/gi, "Mittwoch")
    .replace(/\bthursday\b/gi, "Donnerstag")
    .replace(/\bfriday\b/gi, "Freitag")
    .replace(/\bsaturday\b/gi, "Samstag")
    .replace(/\bsunday\b/gi, "Sonntag");

  if (
    /\b(place\s+de\s+parking|parking)\b/i.test(normalized) &&
    /\b(devant|entree|entrée|eingang|vor)\b/i.test(normalized)
  ) {
    return "Parkplatz vor dem Eingang vorhanden";
  }

  return german.replace(/\s+/g, " ").trim();
}

/**
 * Semantic fallback for safety notes.
 *
 * Primary detection is done by the LLM prompt below:
 * it understands the whole customer message and writes German `gefahren` /
 * `besonderheiten`.
 *
 * This deterministic fallback only prevents obvious operational risks from
 * disappearing when the LLM mixes them into the description or `besonderheiten`.
 * It deliberately writes German notes into specialNotes, so the UI can stay
 * language-independent and display short German chips.
 */
function extractSemanticSpecialNotesFallback(text: string | null | undefined): {
  safetyWarnings: string[];
  jobHints: string[];
} {
  const rawText = String(text || "").trim();
  if (!rawText) return { safetyWarnings: [], jobHints: [] };

  const normalizedLines = rawText
    .split(/\n+|(?<=[.!?])\s+/g)
    .map((line) => normalizeSemanticText(line))
    .filter(Boolean);

  const source = normalizedLines.join("\n");
  if (!source) return { safetyWarnings: [], jobHints: [] };

  const actionableLineHas = (subject: RegExp, positiveContext?: RegExp) =>
    normalizedLines.some((line) => {
      if (!subject.test(line)) return false;
      if (isNegatedSpecialNoteLine(line)) return false;
      return positiveContext ? positiveContext.test(line) : true;
    });

  const safetyWarnings: string[] = [];
  const jobHints: string[] = [];

  const oilSubject = /\b(oel|oil|huile|aceite|olio|oleo|ol|petroleo)\b/i;
  const oilContext =
    /\b(ausgelaufen|leaking|spill(?:ed)?|verschuttet|derrame|fuoriuscit|renverse|boden|floor|sol|suelo|pavimento)\b/i;
  const slipperySubject =
    /\b(rutschig|glatt|slippery|slick|glissant|resbaladiz|scivolos|escorregad|skluz)\b/i;

  const oil =
    actionableLineHas(oilSubject, oilContext) ||
    actionableLineHas(oilContext, oilSubject);
  const slippery = actionableLineHas(slipperySubject);
  if (oil && slippery) {
    safetyWarnings.push("Rutschiger Boden wegen Öl");
  } else if (oil) {
    safetyWarnings.push("Öl auf dem Boden");
  } else if (slippery) {
    safetyWarnings.push("Rutschiger Boden");
  }

  const dogSubject = /\b(hund|dog|chien|perro|cane|cao|cão)\b/i;
  const dangerousDogContext =
    /\b(frei|frei\s+lauf|laeuft|läuft|free|loose|unleashed|libre|suelto|sciolto|livre|aggressiv|aggressive|bissig|beisst|beißt|unbeaufsichtigt|unguarded)\b/i;
  const friendlyDogContext =
    /\b(freundlich|friendly|gentil|amable|docile|brav|bravo|lieb|owner|besitzer|maitre|proprietaire|propietario|presente|vor\s+ort)\b/i;
  if (actionableLineHas(dogSubject, dangerousDogContext)) {
    safetyWarnings.push("Hund frei oder ungesichert vor Ort");
  } else if (actionableLineHas(dogSubject, friendlyDogContext)) {
    jobHints.push("Hund freundlich vor Ort");
  } else if (actionableLineHas(dogSubject)) {
    jobHints.push("Hund vor Ort");
  }

  const electricSubject =
    /\b(strom|elektr|electric|electrical|electricite|electricidad|corriente|elettric|kabel|cable|cables|draht|wire|wires|stromkabel)\b/i;
  const electricDangerContext =
    /\b(offen|blank|frei|defekt|kaputt|danger|peligro|pericol|perigo|dangereux|exposed|open|loose|sichtbar)\b/i;
  if (actionableLineHas(electricSubject, electricDangerContext)) {
    safetyWarnings.push("Offene Stromkabel / Stromgefahr");
  }

  if (actionableLineHas(/\b(asbest|asbestos|amiante|amianto)\b/i)) {
    safetyWarnings.push("Asbestverdacht");
  }

  if (
    actionableLineHas(/\b(schimmel|mold|mould|moisissure|moho|muffa|bolor)\b/i)
  ) {
    safetyWarnings.push("Schimmel");
  }

  if (
    actionableLineHas(
      /\b(chemie|chemisch|chemical|chemicals|chimique|quimic|chimic|produto\s+quimico)\b/i,
    )
  ) {
    safetyWarnings.push("Chemische Stoffe");
  }

  if (
    actionableLineHas(
      /\b(feuer|brand|fire|feu|fuego|fuoco|incendio|incendie)\b/i,
    )
  ) {
    safetyWarnings.push("Brand-/Feuergefahr");
  }

  if (
    actionableLineHas(
      /\b(glasscherben|scherben|broken\s+glass|verre\s+casse|vidrio\s+roto|vetro\s+rotto)\b/i,
    )
  ) {
    safetyWarnings.push("Glasscherben");
  }

  if (
    actionableLineHas(
      /\b(absturz|sturz|fall\s+risk|fallgefahr|chute|caida|caduta)\b/i,
    ) ||
    normalizedLines.some(
      (line) =>
        !isNegatedSpecialNoteLine(line) &&
        /\b(instabil|unstable|instable|inestable|instabile)\b/i.test(line) &&
        /\b(boden|untergrund|floor|sol|suelo|pavimento)\b/i.test(line),
    )
  ) {
    safetyWarnings.push("Sturzgefahr");
  }

  const ladderSubject = /\b(leiter|ladder|echelle|escalera|scala|escada)\b/i;
  const ladderRisk =
    /\b(absturz|sturz|instabil|gefahr|danger|warning|peligro|pericolo|perigo|hauteur|height|hoehe|höhe)\b/i;
  const ladderMaybe =
    /\b(eventuell|evtl|vielleicht|moeglich|möglich|possibly|maybe|peut\s+etre|peut-être|quizas|forse)\b/i;
  if (actionableLineHas(ladderSubject, ladderRisk)) {
    safetyWarnings.push("Leiterarbeit mit zusätzlichem Risiko");
  } else if (actionableLineHas(ladderSubject, ladderMaybe)) {
    jobHints.push("Leiter eventuell benötigt");
  } else if (
    actionableLineHas(
      ladderSubject,
      /\b(benoetigt|benötigt|noetig|nötig|erforderlich|required|needed|necessaire|necesaria|necessaria)\b/i,
    )
  ) {
    jobHints.push("Leiter benötigt");
  } else if (actionableLineHas(ladderSubject)) {
    jobHints.push("Leiter eventuell benötigt");
  }

  const hasExplicitCallback = normalizedLines.some((line) => {
    if (isNegatedSpecialNoteLine(line)) return false;
    if (
      /\b(klingeln|warten|doorbell|ring\s+the\s+bell|sonner|timbre|campanello|campainha)\b/i.test(
        line,
      )
    )
      return false;
    return /\b(rueckruf|ruckruf|zurueckrufen|zurückrufen|call\s+back|please\s+call\s+back|telefonisch\s+(?:anrufen|melden|kontaktieren)|phone\s+back|rappeler|richiamare|devolver\s+la\s+llamada|ligar\s+de\s+volta)\b/i.test(
      line,
    );
  });
  if (hasExplicitCallback) {
    jobHints.push("Rückruf vor Arbeitsbeginn");
  }

  const hasDifficultAccess = normalizedLines.some((line) =>
    /\b(schwer\s+zugaenglich|schwer\s+zugänglich|schwieriger\s+zugang|kein\s+lift|ohne\s+lift|no\s+elevator|no\s+lift|access\s+difficult|difficult\s+access|acces\s+difficile|sin\s+ascensor|senza\s+ascensore|acesso\s+dificil)\b/i.test(
      line,
    ),
  );
  if (hasDifficultAccess) {
    jobHints.push("Schwieriger Zugang");
  }

  if (
    actionableLineHas(
      /\b(hanglage|hang|steigung|slope|pente|pendiente|pendenza|declive)\b/i,
    )
  ) {
    jobHints.push("Hanglage");
  }

  const isNegativeWhatsAppInstruction = (line: string) =>
    isForbiddenChannelInstructionLine(line, "whatsapp");

  const rawOperationalLines = rawText
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split(/\n+|(?<=[.!?])\s+/g)
    .map((line) => line.trim())
    .filter(Boolean);

  for (const rawLine of rawOperationalLines) {
    const line = normalizeSemanticText(rawLine);
    if (!line) continue;
    const phone = rawLine
      .match(/\+?\d[\d\s()./-]{6,}\d/)?.[0]
      ?.replace(/\s+/g, " ")
      .trim();
    const hasNoPhoneInstruction =
      /bitte\s+nicht\s+anrufen|nicht\s+anrufen|nicht\s+telefonisch|keine\s+telefonische\s+rueckfrage|keine\s+telefonische\s+ruckfrage|ne\s+pas\s+appeler|ne\s+pas\s+telephoner|pas\s+d\s+appel(?:s)?|pas\s+d\s+appel(?:s)?\s+telephonique(?:s)?|pas\s+appeler|pas\s+telephoner|sans\s+appel\s+telephonique|do\s+not\s+call|no\s+calls?/i.test(
        line,
      );
    const hasNegativeWhatsAppInstruction = isNegativeWhatsAppInstruction(line);

    if (hasNegativeWhatsAppInstruction) {
      jobHints.push(
        /telefon|aaluete|anluete|klingeln|anrufen/i.test(line)
          ? "Kein WhatsApp; lieber Telefonkontakt"
          : "Keine WhatsApp",
      );
      continue;
    }

    if (hasNoPhoneInstruction && /whats\s*app/i.test(line)) {
      jobHints.push("Nicht telefonisch zurückrufen, WhatsApp bevorzugt");
    } else if (
      hasNoPhoneInstruction &&
      /(mail|e\s*mail|email|courriel)/i.test(line)
    ) {
      jobHints.push("Mail reicht, bitte keine telefonische Rückfrage");
    } else if (hasNoPhoneInstruction && /\bsms\b/i.test(line)) {
      jobHints.push("Nicht telefonisch zurückrufen, SMS reicht");
    } else if (hasNoPhoneInstruction) {
      jobHints.push("Bitte keine telefonische Rückfrage");
    }

    if (
      /(?:nicht|noed|nöd|ned|nid|nit)\s+einfach\s+(?:kommen|vorbeikommen|cho|verbi\s+cho)|(?:nicht|noed|nöd|ned|nid|nit)\s+ohne\s+(?:ruecksprache|rucksprache|absprache)\s+(?:kommen|vorbeikommen|cho)|vor\s+(?:start|arbeitsbeginn|ankunft)\s+(?:kurz\s+)?(?:telefonisch\s+)?(?:melden|anrufen|kontaktieren)|erst\s+nach\s+(?:ruecksprache|rucksprache|absprache)\s+(?:kommen|vorbeikommen|cho)/i.test(
        line,
      )
    ) {
      const parts: string[] = [];
      if (
        /(?:nicht|noed|nöd|ned|nid|nit)\s+einfach\s+(?:kommen|vorbeikommen|cho|verbi\s+cho)/i.test(
          line,
        )
      )
        parts.push("Nicht einfach kommen");
      if (
        /(?:nicht|noed|nöd|ned|nid|nit)\s+ohne\s+(?:ruecksprache|rucksprache|absprache)\s+(?:kommen|vorbeikommen|cho)|erst\s+nach\s+(?:ruecksprache|rucksprache|absprache)\s+(?:kommen|vorbeikommen|cho)/i.test(
          line,
        )
      )
        parts.push("Nicht ohne Rücksprache kommen");
      if (
        /vor\s+(?:start|arbeitsbeginn|ankunft)\s+(?:kurz\s+)?(?:telefonisch\s+)?(?:melden|anrufen|kontaktieren)/i.test(
          line,
        )
      )
        parts.push("Vor Arbeitsbeginn telefonisch melden");
      const timeMatch = rawLine.match(
        /(?:erst\s+)?(?:ab|nach)\s*(\d{1,2})(?:[:.\s]+(\d{2}))?\s*(?:uhr|h)?\b/i,
      );
      if (timeMatch?.[1]) {
        parts.push(
          `erst ab ${timeMatch[1].padStart(2, "0")}:${timeMatch[2] || "00"}`,
        );
      }
      if (isNegativeWhatsAppInstruction(line)) parts.push("keine WhatsApp");
      jobHints.push(parts.length ? parts.join(", ") : "Vorher melden");
    }

    if (
      /nur\s+whats\s*app|whats\s*app.*nicht\s+anrufen|nicht\s+anrufen.*whats\s*app/i.test(
        line,
      )
    ) {
      jobHints.push(
        phone
          ? `Nur WhatsApp, nicht anrufen: ${phone}`
          : "Nur WhatsApp, nicht anrufen",
      );
      continue;
    }

    if (/whats\s*app/i.test(line) && phone) {
      jobHints.push(`WhatsApp bevorzugt: ${phone}`);
    }

    if (
      /\bsms\b/i.test(line) &&
      /am\s+besten|best|preferred|bevorzugt|reicht/i.test(line)
    ) {
      jobHints.push(
        phone ? `SMS ist am besten: ${phone}` : "SMS ist am besten",
      );
    }

    if (
      /(mail|e\s*mail|email)/i.test(line) &&
      /keine\s+telefonische|nicht\s+telefonisch|nicht\s+anrufen|no\s+calls?|do\s+not\s+call/i.test(
        line,
      )
    ) {
      jobHints.push("Mail reicht, bitte keine telefonische Rückfrage");
    } else if (
      /(mail|e\s*mail|email)/i.test(line) &&
      /reicht|only|nur|preferred|bevorzugt/i.test(line)
    ) {
      jobHints.push("Mail reicht");
    }

    if (
      hasNoPhoneInstruction &&
      !/(whats\s*app|\bsms\b|mail|e\s*mail|email|courriel)/i.test(line)
    ) {
      jobHints.push(
        /keine\s+telefonische|nicht\s+telefonisch|pas\s+d\s+appel|pas\s+appeler|ne\s+pas|no\s+calls?|do\s+not\s+call/i.test(
          line,
        )
          ? "Bitte keine telefonische Rückfrage"
          : "Bitte nicht anrufen",
      );
    }

    if (
      /no\s+calls?\s+during\s+office\s+hours|keine\s+anrufe\s+waehrend\s+der\s+buerozeiten|keine\s+anrufe\s+waehrend\s+der\s+bürozeiten/i.test(
        line,
      )
    ) {
      jobHints.push("Keine Anrufe während der Bürozeiten");
    }
  }

  const hasGoodParking = normalizedLines.some(
    (line) =>
      !isNegatedSpecialNoteLine(line) &&
      /\b(parkplatz|parking|aparcamiento|parcheggio)\b/i.test(line) &&
      /\b(vorhanden|reserviert|frei|innenhof|available|reserved|courtyard|disponible|riservato)\b/i.test(
        line,
      ),
  );
  const hasBadParking = normalizedLines.some(
    (line) =>
      !isNonActionablePlanningHint(line) &&
      /\b(parkplatz|parking|aparcamiento|parcheggio)\b/i.test(line) &&
      /\b(schwierig|kein|keine|parkverbot|difficult|no\s+parking|sin|sans|senza)\b/i.test(
        line,
      ),
  );
  if (hasGoodParking) {
    jobHints.push("Parkplatz vorhanden oder reserviert");
  } else if (hasBadParking) {
    jobHints.push("Parkplatz schwierig");
  }

  for (const rawLine of rawOperationalLines) {
    const line = normalizeSemanticText(rawLine);
    if (!line) continue;
    const isAccessOrCodeHint =
      /\b(?:zugang|zufahrt|eingang|seitentor|gartentor|torcode|codebox|code|schluessel|schlüssel|briefkasten|garage)\b/i.test(
        line,
      );
    const isPricingOrServiceLine =
      /\b\d+(?:[.,]\d+)?\s*(?:m2|m²|qm|meter|laufmeter|stunden?|std\.?|stueck|stück|stk)\b/i.test(
        rawLine,
      ) ||
      /\b(?:chf|eur|euro|franken|stutz)\s*\d|\d\s*(?:chf|eur|euro|franken|stutz)\b/i.test(
        rawLine,
      );

    if (isAccessOrCodeHint && !isPricingOrServiceLine) {
      jobHints.push(rawLine.replace(/\s+/g, " ").trim());
    }
  }

  return {
    safetyWarnings: dedupeSpecialNoteLines(safetyWarnings),
    jobHints: dedupeSpecialNoteLines(jobHints),
  };
}

function isLikelySafetyWarning(line: string): boolean {
  return extractSemanticSpecialNotesFallback(line).safetyWarnings.length > 0;
}

function detectQuantityUnitFromText(text: string): {
  value: number | null;
  unit: string | null;
  raw: string | null;
} {
  const source = normalizeUnitText(text);
  if (!source) return { value: null, unit: null, raw: null };

  const patterns = [
    {
      unit: "square_meter",
      re: /(\d+(?:[.,]\d+)?)\s*(?:m2|m²|qm|quadratmeter|quadrat meter)\b/i,
    },
    {
      unit: "cubic_meter",
      re: /(\d+(?:[.,]\d+)?)\s*(?:m3|m³|kubikmeter|kubik meter|cbm)\b/i,
    },
    { unit: "hour", re: /(\d+(?:[.,]\d+)?)\s*(?:stunden|stunde|std\.?|h)\b/i },
    {
      unit: "day",
      re: /(\d+(?:[.,]\d+)?)\s*(?:tage|tag|arbeitstage|arbeitstag)\b/i,
    },
    { unit: "meter", re: /(\d+(?:[.,]\d+)?)\s*(?:laufmeter|lfm|meter|m)\b/i },
    { unit: "kilogram", re: /(\d+(?:[.,]\d+)?)\s*(?:kilogramm|kg)\b/i },
    { unit: "ton", re: /(\d+(?:[.,]\d+)?)\s*(?:tonnen|tonne|to\.?|t)\b/i },
    { unit: "liter", re: /(\d+(?:[.,]\d+)?)\s*(?:liter|ltr\.?|l)\b/i },
    {
      unit: "piece",
      re: /(\d+(?:[.,]\d+)?)\s*(?:stueck|stück|stuck|stk|anzahl|einheiten|baeume|bäume|baume|baum)\b/i,
    },
  ];

  for (const pattern of patterns) {
    const match = source.match(pattern.re);
    if (match?.[1]) {
      return {
        value: Number(match[1].replace(",", ".")),
        unit: pattern.unit,
        raw: match[0],
      };
    }
  }

  return { value: null, unit: null, raw: null };
}

function validateQuantityAgainstServiceUnit(args: {
  serviceUnit?: string | null;
  detectedValue?: number | null;
  detectedUnit?: string | null;
  serviceName?: string | null;
}) {
  const serviceUnit = normalizeUnitText(args.serviceUnit);
  const detectedValue =
    typeof args.detectedValue === "number" &&
    isFinite(args.detectedValue) &&
    args.detectedValue > 0
      ? args.detectedValue
      : null;
  const detectedUnit = normalizeUnitText(args.detectedUnit);

  const serviceUnitType = getServiceUnitType(args.serviceUnit ?? null);

  if (serviceUnitType === "flat") {
    return {
      quantity: 0,
      needsReview: !!detectedValue,
      reason: detectedValue
        ? "Menge_erkannt_aber_Leistung_ist_pauschal"
        : (null as string | null),
    };
  }

  if (!detectedValue || !detectedUnit) {
    return {
      quantity: 0,
      needsReview: false,
      reason: null as string | null,
    };
  }

  if (serviceUnitType === detectedUnit) {
    return {
      quantity: detectedValue,
      needsReview: false,
      reason: null as string | null,
    };
  }

  const reasonByServiceUnit: Record<string, string> = {
    hour: "Menge_erkannt_aber_Leistung_basiert_auf_Stunden",
    day: "Menge_erkannt_aber_Leistung_basiert_auf_Tagen",
    meter: "Menge_erkannt_aber_Leistung_basiert_auf_Metern",
    square_meter: "Menge_erkannt_aber_Leistung_basiert_auf_Quadratmetern",
    cubic_meter: "Menge_erkannt_aber_Leistung_basiert_auf_Kubikmetern",
    piece: "Menge_erkannt_aber_Leistung_basiert_auf_Stueck",
    kilogram: "Menge_erkannt_aber_Leistung_basiert_auf_Kilogramm",
    ton: "Menge_erkannt_aber_Leistung_basiert_auf_Tonnen",
    liter: "Menge_erkannt_aber_Leistung_basiert_auf_Litern",
    unknown: "Menge_erkannt_aber_Leistungseinheit_unbekannt",
  };

  return {
    quantity: 0,
    needsReview: true,
    reason: reasonByServiceUnit[serviceUnitType] || reasonByServiceUnit.unknown,
  };
}

function getServiceUnitType(serviceUnit?: string | null): string {
  const unit = normalizeUnitText(serviceUnit);

  const unitAliases: Record<string, string[]> = {
    flat: ["pauschal", "fixpreis", "festpreis", "pauschale"],
    square_meter: [
      "quadratmeter",
      "quadradmeter",
      "qm",
      "m2",
      "m²",
      "flaeche",
      "fläche",
    ],
    cubic_meter: ["kubikmeter", "cbm", "m3", "m³", "volumen"],
    kilogram: ["kilogramm", "kg"],
    ton: ["tonne", "tonnen", "to", "t"],
    liter: ["liter", "ltr", "l"],
    hour: ["stunde", "stunden", "std", "h", "stundensatz"],
    day: ["tag", "tage", "arbeitstag", "arbeitstage", "tagessatz"],
    meter: ["meter", "laufmeter", "lfm", "m"],
    piece: [
      "stueck",
      "stück",
      "stuck",
      "stk",
      "piece",
      "pieces",
      "piece",
      "pieces",
      "vitre",
      "vitres",
      "fenetre",
      "fenetres",
      "window",
      "windows",
      "anzahl",
      "einheit",
      "einheiten",
    ],
  };

  for (const [type, aliases] of Object.entries(unitAliases)) {
    if (aliases.some((alias) => unit === alias)) return type;
  }

  for (const [type, aliases] of Object.entries(unitAliases)) {
    if (aliases.some((alias) => unit.includes(alias))) return type;
  }

  return "unknown";
}

function detectUnitPriceFromText(text: string): number | null {
  const source = normalizeUnitText(text);
  if (!source) return null;

  const unitWords =
    "(?:stueck|stück|stuck|stk|einheit|piece|pieces|pi[eè]ce|pi[eè]ces|vitre|vitres|fenetre|fenetres|window|windows|quadratmeter|quadratmetern|qm|m2|m²|sqm|kubikmeter|kubikmetern|cbm|meter|laufmeter|lfm|stunde|stunden|std|hour|hours|tag|tage|day|days|kg|kilogramm|tonne|tonnen|liter|ltr)";

  const currencyWords =
    "(?:chf|franken|fr\\.?|sfr\\.?|stutz|eur|euro|€|usd|dollar|\\$|gbp|pfund|£)";

  const joinWords = "(?:pro|je|per|par|à|a|/)";

  const priceNumber = "(\\d+(?:[.,]\\d{1,2})?)";

  const patterns = [
    // Stundenpreis 110 CHF / Stundensatz von 95 CHF / Satz pro Stunde 80 CHF
    new RegExp(
      `(?:stundenpreis|stundensatz|satz\\s+pro\\s+stunde)\\s*(?:von|=|:)?\\s*${priceNumber}\\s*${currencyWords}`,
      "i",
    ),

    // Stundensatz von 95 CHF / Tagessatz 700 CHF
    new RegExp(
      `(?:stundensatz|tagessatz|quadratmeterpreis|kubikmeterpreis|meterpreis|stueckpreis|stückpreis|kilopreis|kilogrammpreis|tonnenpreis|literpreis)\\s*(?:von|=|:)?\\s*${priceNumber}\\s*${currencyWords}`,
      "i",
    ),
    // 14 CHF pro qm
    new RegExp(
      `${priceNumber}\\s*${currencyWords}\\s*${joinWords}\\s*${unitWords}`,
      "i",
    ),

    // CHF 14 pro qm
    new RegExp(
      `${currencyWords}\\s*${priceNumber}\\s*${joinWords}\\s*${unitWords}`,
      "i",
    ),

    // zu 14 CHF pro qm
    new RegExp(
      `(?:preis|kostet|kosten|zu|fuer|für|a|à)\\s*(?:je\\s+)?${priceNumber}\\s*${currencyWords}\\s*${joinWords}\\s*${unitWords}`,
      "i",
    ),

    // Preis von 14 CHF pro qm
    new RegExp(
      `(?:preis\\s+von|price\\s+of)\\s*${priceNumber}\\s*${currencyWords}\\s*${joinWords}\\s*${unitWords}`,
      "i",
    ),
  ];

  for (const pattern of patterns) {
    const match = source.match(pattern);

    if (match?.[1]) {
      const value = Number(match[1].replace(",", "."));

      if (Number.isFinite(value) && value > 0) {
        return value;
      }
    }
  }

  return null;
}

// INTAKE_CURRENCY_ONLY_EUR_FIX_V13
function stripNonPricingCurrencyContextForIntake(
  text: string | null | undefined,
): string {
  return String(text || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split(/\n+/g)
    .filter((line) => {
      const trimmed = line.trim();
      if (!trimmed) return false;

      // Titel/Notizen sind Test- oder Metadaten und dürfen keine Währung setzen.
      // Beispiel: "[Titel: CHF gewinnt trotz EUR Einstellung]" darf aus einem
      // sauber bepreisten CHF-Auftrag keinen CHF/EUR-Konflikt machen.
      return !/^\s*\[?\s*(?:titel|title)\s*:/i.test(trimmed);
    })
    .join("\n");
}

function stripNegatedCurrencyMentionsForIntake(
  text: string | null | undefined,
): string {
  let source = normalizeUnitText(stripNonPricingCurrencyContextForIntake(text));
  if (!source) return "";

  // Negative currency instructions are not real order currencies.
  // Example: "Leistung komplett in EUR ... bitte nicht in CHF umrechnen"
  // should be EUR-only, not CHF+EUR conflict.
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

const INTAKE_PRICE_NUMBER_FOR_CURRENCY = "\\d+(?:[.,]\\d{1,2})?";
const INTAKE_CHF_WORDS_FOR_CURRENCY = "(?:chf|franken|fr\\.?|sfr\\.?|stutz)";
const INTAKE_EUR_WORDS_FOR_CURRENCY = "(?:eur|euro|€)";

function hasExplicitCurrencyAmountForIntake(
  source: string,
  currencyWords: string,
): boolean {
  return (
    new RegExp(
      `\\b${currencyWords}\\s*${INTAKE_PRICE_NUMBER_FOR_CURRENCY}\\b`,
      "i",
    ).test(source) ||
    new RegExp(
      `\\b${INTAKE_PRICE_NUMBER_FOR_CURRENCY}\\s*${currencyWords}\\b`,
      "i",
    ).test(source)
  );
}

function detectCurrencyFromText(
  text: string | null | undefined,
): "CHF" | "EUR" | null {
  const source = stripNegatedCurrencyMentionsForIntake(text);

  if (!source) return null;

  const hasExplicitChf = hasExplicitCurrencyAmountForIntake(
    source,
    INTAKE_CHF_WORDS_FOR_CURRENCY,
  );
  const hasExplicitEur = hasExplicitCurrencyAmountForIntake(
    source,
    INTAKE_EUR_WORDS_FOR_CURRENCY,
  );

  // Preisnahe Währungen sind stärker als Währungswörter in Kundennamen/Titeln.
  // So bleibt "CHF Trotz EUR AG" mit "Fenster ... CHF 5" ein CHF-Auftrag.
  if (hasExplicitChf || hasExplicitEur) {
    if (hasExplicitChf && !hasExplicitEur) return "CHF";
    if (hasExplicitEur && !hasExplicitChf) return "EUR";
    return null;
  }

  const hasChf = /\b(chf|franken|fr\.?|sfr\.?|stutz)\b/i.test(source);
  const hasEur = /\b(eur|euro)\b|€/i.test(source);

  if (hasChf && !hasEur) return "CHF";
  if (hasEur && !hasChf) return "EUR";

  return null;
}

function findOriginalSegmentForWorkItem(
  item: {
    raw?: string | null;
    name?: string | null;
    evidence?: string | null;
    source_text?: string | null;
    context?: string | null;
  },
  fullText: string,
): string | null {
  const sourceBlock = normalizeBlockText(fullText);
  if (!sourceBlock) return null;

  const itemName = normalizeUnitText(item.name || "");
  const raw = normalizeUnitText(item.raw || "");
  const evidence = normalizeUnitText(item.evidence || item.source_text || "");
  const context = normalizeUnitText(item.context || "");

  const itemWords = [itemName, raw, evidence, context]
    .join(" ")
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w.length >= 4)
    .filter(
      (w) =>
        ![
          "chf",
          "euro",
          "eur",
          "stunde",
          "stunden",
          "std",
          "preis",
          "reinigen",
          "reinigung",
          "bitte",
          "auftrag",
        ].includes(w),
    );

  if (itemWords.length === 0) return null;

  const lineSegments = sourceBlock
    .split(/\n+|;/g)
    .map((p) => p.trim())
    .filter((p) => p.length >= 8);

  const broadSegments = sourceBlock
    .split(
      /\n{2,}|;|\bdanach\b|\bzusaetzlich\b|\bzusätzlich\b|\banschliessend\b|\banschließend\b|\bthen\b|\bafterwards\b|\badditional(?:ly)?\b|\balso\b|\bensuite\b|\bpuis\b|\bsupplémentaire\b|\badditionnel\b|\bpoi\b|\binoltre\b|\baggiuntivo\b/gi,
    )
    .map((p) => p.trim())
    .filter((p) => p.length >= 8);

  const segments = Array.from(new Set([...lineSegments, ...broadSegments]));

  let best: { segment: string; score: number } | null = null;

  for (const segment of segments) {
    let score = 0;

    for (const word of itemWords) {
      if (segment.includes(word)) score += 10;
    }

    if (itemName && segment.includes(itemName)) score += 40;
    if (raw && segment.includes(raw)) score += 30;
    if (evidence && segment.includes(evidence)) score += 20;
    if (context && segment.includes(context)) score += 10;

    if (detectAllQuantityUnitsFromText(segment).length > 0) score += 12;
    if (detectUnitPriceFromText(segment)) score += 12;

    // Prefer a real service line over a whole-message block. Whole-message
    // matches can contain several quantities and caused explicit hour values
    // such as "3.5 Stunden" to be lost or mixed with neighbouring lines.
    if (segment.length > 280) score -= 30;
    if (countUnitPriceSignals(segment) > 1) score -= 25;

    if (!best || score > best.score) {
      best = { segment, score };
    }
  }

  return best && best.score >= 10 ? best.segment : null;
}

function findColonBlockForWorkItem(
  item: { raw?: string | null; name?: string | null },
  fullText: string,
): string | null {
  const source = normalizeBlockText(fullText);
  if (!source) return null;

  const itemName = normalizeUnitText(item.name || "");
  const raw = normalizeUnitText(item.raw || "");
  const searchText = [itemName, raw].filter(Boolean).join(" ");

  const keywords = searchText
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w.length >= 4);

  if (keywords.length === 0) return null;

  const blocks = source
    .split(/\n\s*\n/g)
    .map((b) => b.trim())
    .filter((b) => b.length >= 8);

  let best: { block: string; score: number } | null = null;

  for (const block of blocks) {
    let score = 0;
    const normalizedBlock = normalizeUnitText(block);
    const firstLine = normalizeUnitText(block.split("\n")[0] || "");

    for (const keyword of keywords) {
      if (normalizedBlock.includes(keyword)) score += 10;
      if (firstLine.includes(keyword)) score += 20;
    }

    if (itemName && normalizedBlock.includes(itemName)) score += 60;
    if (itemName && firstLine.includes(itemName)) score += 80;
    if (raw && normalizedBlock.includes(raw)) score += 40;
    if (block.includes(":")) score += 20;

    if (!best || score > best.score) {
      best = { block, score };
    }
  }

  return best && best.score >= 30 ? best.block : null;
}

function countUnitPriceSignals(text: string | null | undefined): number {
  const source = normalizeUnitText(text || "");
  if (!source) return 0;

  const currencyWords =
    "(?:chf|franken|fr\\.?|sfr\\.?|stutz|eur|euro|€|usd|dollar|\\$|gbp|pfund|£)";
  const unitJoin = "(?:pro|je|per|par|à|a|/)";
  const unitWords =
    "(?:stueck|stück|stuck|stk|piece|pieces|pi[eè]ce|pi[eè]ces|vitre|vitres|fenetre|fenetres|window|windows|quadratmeter|qm|m2|m²|meter|laufmeter|lfm|stunde|stunden|std|tag|tage|kg|kilogramm|tonne|tonnen|liter|ltr)";

  const patterns = [
    new RegExp(
      `\\d+(?:[.,]\\d{1,2})?\\s*${currencyWords}\\s*${unitJoin}\\s*${unitWords}`,
      "gi",
    ),
    new RegExp(
      `${currencyWords}\\s*\\d+(?:[.,]\\d{1,2})?\\s*${unitJoin}\\s*${unitWords}`,
      "gi",
    ),
  ];

  return patterns.reduce(
    (sum, pattern) => sum + Array.from(source.matchAll(pattern)).length,
    0,
  );
}

function parseStructuredUnitPrice(value: unknown): number | null {
  const parsed = Number(
    String(value ?? "")
      .replace("'", "")
      .replace(",", "."),
  );
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function detectUnitPriceForWorkItem(
  item: {
    raw?: string | null;
    name?: string | null;
    unit_price?: number | string | null;
    currency?: string | null;
    evidence?: string | null;
    source_text?: string | null;
  },
  fullText: string,
): number | null {
  const evidenceText = [item.source_text, item.evidence, item.raw]
    .map((part) => String(part || "").trim())
    .filter(Boolean)
    .join(" ");

  const evidencePrice = detectUnitPriceFromText(evidenceText);
  if (evidencePrice) return evidencePrice;

  // Strukturierter KI-Preis ist nur zweite Wahl. Er wird später in
  // lib/order-intake-validation.ts nochmals gegen Evidence/Währung geprüft.
  const structuredPrice = parseStructuredUnitPrice(item.unit_price);
  if (structuredPrice && evidenceText) return structuredPrice;

  const localText = [item.raw, item.name].filter(Boolean).join(" ");
  const localPrice = detectUnitPriceFromText(localText);
  if (localPrice) return localPrice;

  const originalSegment = findOriginalSegmentForWorkItem(item, fullText);
  if (originalSegment && countUnitPriceSignals(originalSegment) <= 1) {
    const segmentPrice = detectUnitPriceFromText(originalSegment);
    if (segmentPrice) return segmentPrice;
  }

  const colonBlock = findColonBlockForWorkItem(item, fullText);
  if (
    colonBlock &&
    colonBlock.length <= 240 &&
    countUnitPriceSignals(colonBlock) <= 1
  ) {
    return detectUnitPriceFromText(colonBlock);
  }

  return null;
}

function hasAmbiguousCompactLinePrice(
  text: string | null | undefined,
): boolean {
  const source = normalizeUnitText(text || "");
  if (!source) return false;

  const hasExplicitUnitPriceSignal =
    /\b(pro|je|per|par|stundensatz|tagessatz|quadratmeterpreis|kubikmeterpreis|meterpreis|stueckpreis|stückpreis|kilopreis|kilogrammpreis|tonnenpreis|literpreis)\b/i.test(
      source,
    );

  if (hasExplicitUnitPriceSignal) return false;

  const unitWords =
    "(?:stueck|stück|stuck|stk|einheit|piece|pieces|pi[eè]ce|pi[eè]ces|vitre|vitres|fenetre|fenetres|window|windows|quadratmeter|quadratmetern|qm|m2|m²|sqm|kubikmeter|kubikmetern|cbm|meter|laufmeter|lfm|m|stunde|stunden|std|h|tag|tage|kg|kilogramm|tonne|tonnen|liter|ltr)";

  const currencyWords =
    "(?:chf|franken|fr\\.?|sfr\\.?|stutz|eur|euro|€|usd|dollar|\\$|gbp|pfund|£)";

  const quantityNumber = "\\d+(?:[.,]\\d+)?";
  const priceNumber = "\\d+(?:[.,]\\d{1,2})?";

  return (
    new RegExp(
      `${quantityNumber}\\s*${unitWords}\\s*${currencyWords}\\s*${priceNumber}`,
      "i",
    ).test(source) ||
    new RegExp(
      `${quantityNumber}\\s*${unitWords}\\s*${priceNumber}\\s*${currencyWords}`,
      "i",
    ).test(source)
  );
}

function detectAllQuantityUnitsFromText(
  text: string,
): Array<{ value: number; unit: string; raw: string }> {
  const source = normalizeUnitText(text);
  if (!source) return [];

  const patterns = [
    {
      unit: "square_meter",
      re: /(\d+(?:[.,]\d+)?)\s*(?:m2|m²|qm|quadratmeter|quadrat meter)\b/gi,
    },
    {
      unit: "cubic_meter",
      re: /(\d+(?:[.,]\d+)?)\s*(?:m3|m³|kubikmeter|kubik meter|cbm)\b/gi,
    },
    { unit: "hour", re: /(\d+(?:[.,]\d+)?)\s*(?:stunden|stunde|std\.?|h)\b/gi },
    {
      unit: "day",
      re: /(\d+(?:[.,]\d+)?)\s*(?:tage|tag|arbeitstage|arbeitstag)\b/gi,
    },
    { unit: "meter", re: /(\d+(?:[.,]\d+)?)\s*(?:laufmeter|lfm|meter|m)\b/gi },
    { unit: "kilogram", re: /(\d+(?:[.,]\d+)?)\s*(?:kilogramm|kg)\b/gi },
    { unit: "ton", re: /(\d+(?:[.,]\d+)?)\s*(?:tonnen|tonne|to\.?|t)\b/gi },
    { unit: "liter", re: /(\d+(?:[.,]\d+)?)\s*(?:liter|ltr\.?|l)\b/gi },
    {
      unit: "piece",
      re: /(\d+(?:[.,]\d+)?)\s*(?:stueck|stück|stuck|stk|piece|pieces|pi[eè]ce|pi[eè]ces|vitre|vitres|fenetre|fenetres|window|windows|anzahl|einheiten|baeume|bäume|baume|baum)\b/gi,
    },
  ];

  const matches: Array<{ value: number; unit: string; raw: string }> = [];

  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern.re)) {
      if (match?.[1]) {
        matches.push({
          value: Number(match[1].replace(",", ".")),
          unit: pattern.unit,
          raw: match[0],
        });
      }
    }
  }

  return matches.filter((m) => Number.isFinite(m.value) && m.value > 0);
}

// V16.95: Final semantic repair for explicit hour lines from the original customer text.
// This is intentionally line-anchored: a service row is repaired only when the

type IntakeFinalOrderItemForBlocker = {
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
  [key: string]: any;
};

function applyFinalAmountBlockersBeforePersist(
  items: IntakeFinalOrderItemForBlocker[],
  options: {
    detectedCurrencies?: string[] | null;
    finalCurrency?: string | null;
  } = {},
): IntakeFinalOrderItemForBlocker[] {
  const detectedCurrencies = Array.isArray(options.detectedCurrencies)
    ? options.detectedCurrencies.filter(Boolean)
    : [];
  const finalCurrency = String(options.finalCurrency || "").toUpperCase();
  const hasGlobalCurrencyConflict = detectedCurrencies.length > 1;

  return items.map((item) => {
    const next: IntakeFinalOrderItemForBlocker = { ...item };
    const serviceName =
      String(next.serviceName || "Unbekannte Leistung").trim() ||
      "Unbekannte Leistung";
    const unitKey = normalizeUnitText(next.unit || "");
    const reviewKey = normalizeUnitText(
      [
        next.unit,
        next.description,
        next.sourceText,
        next.evidence,
        next.reviewReason,
      ]
        .filter(Boolean)
        .join(" "),
    );
    const detectedCurrency = String(next.detectedCurrency || "").toUpperCase();

    const unitBlocked =
      unitKey.includes("pruefen") ||
      unitKey.includes("prüfen") ||
      unitKey === "unklar" ||
      unitKey === "unknown" ||
      unitKey === "unbekannt" ||
      reviewKey.includes("einheit fehlt") ||
      reviewKey.includes("unit missing") ||
      String(next.reviewReason || "").startsWith("unit_missing_in_text:") ||
      String(next.reviewReason || "").startsWith("unit_mismatch:");

    const priceBlocked =
      String(next.reviewReason || "").startsWith("price_unclear:") ||
      reviewKey.includes("preis fehlt") ||
      reviewKey.includes("preis unklar") ||
      reviewKey.includes("price missing") ||
      reviewKey.includes("price unclear") ||
      Number(next.unitPrice || 0) <= 0;

    const quantityBlocked =
      getServiceUnitType(next.unit) !== "flat" &&
      Number(next.quantity || 0) <= 0;

    const mixedCurrencyItemBlocked =
      hasGlobalCurrencyConflict &&
      (!detectedCurrency ||
        (finalCurrency && detectedCurrency !== finalCurrency));
    const genericCurrencyReviewBlocked =
      String(next.reviewReason || "") === "currency_review" &&
      (!detectedCurrency ||
        (finalCurrency && detectedCurrency !== finalCurrency));

    const currencyBlocked =
      mixedCurrencyItemBlocked ||
      Boolean(
        detectedCurrency && finalCurrency && detectedCurrency !== finalCurrency,
      ) ||
      String(next.reviewReason || "").startsWith("item_currency_mismatch:") ||
      String(next.reviewReason || "").startsWith("currency_conflict_item:") ||
      genericCurrencyReviewBlocked;

    if (!(unitBlocked || priceBlocked || quantityBlocked || currencyBlocked)) {
      return next;
    }

    next.needsReview = true;
    next.totalPrice = 0;

    if (currencyBlocked) {
      next.unitPrice = 0;
      if (!next.reviewReason || next.reviewReason === "currency_review") {
        next.reviewReason =
          detectedCurrency &&
          finalCurrency &&
          detectedCurrency !== finalCurrency
            ? `item_currency_mismatch:${serviceName}:${detectedCurrency}:${finalCurrency}`
            : `currency_conflict_item:${serviceName}:${detectedCurrency || "UNKNOWN"}:${finalCurrency || "UNKNOWN"}`;
      }
      return next;
    }

    if (unitBlocked) {
      if (!unitKey.includes("pruefen") && !unitKey.includes("prüfen")) {
        next.unit = "Einheit prüfen";
      }
      if (!next.reviewReason)
        next.reviewReason = `unit_missing_in_text:${serviceName}`;
      return next;
    }

    if (priceBlocked) {
      next.unitPrice = 0;
      if (!next.reviewReason)
        next.reviewReason = `price_unclear:${serviceName}`;
      return next;
    }

    if (quantityBlocked) {
      next.quantity = 0;
      if (!next.reviewReason) next.reviewReason = "quantity_review";
    }

    return next;
  });
}

// same original line contains service topic + explicit hour quantity + explicit
// unit price. It prevents catalog-unit overwrite without leaking the hour price
// into neighbouring Stück/m² rows.
type IntakeHourLineRepairItem = {
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
};

function roundIntakeMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function parseIntakeDecimalNumber(value?: string | null): number | null {
  const parsed = Number(
    String(value || "")
      .replace("'", "")
      .replace(",", "."),
  );
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

const INTAKE_HOUR_WORD_QUANTITIES: Record<string, number> = {
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

function parseIntakeHourQuantityToken(value?: string | null): number | null {
  const numeric = parseIntakeDecimalNumber(value);
  if (numeric) return numeric;

  const key = normalizeUnitText(value || "").replace(/\s+/g, "");
  return INTAKE_HOUR_WORD_QUANTITIES[key] || null;
}

function normalizeIntakeHourQuantity(
  value: number | null | undefined,
): number | null {
  const quantity = Number(value || 0);
  if (!Number.isFinite(quantity) || quantity <= 0) return null;

  // Billing precision: always keep time quantities on a 15-minute grid.
  return roundIntakeMoney(Math.round(quantity * 4) / 4);
}

function detectExplicitIntakeHourQuantityInLine(
  line?: string | null,
): number | null {
  const source = normalizeUnitText(line || "");
  if (!source) return null;

  const numberOrWord =
    "(?:\\d+(?:[.,]\\d+)?|ein|eine|einen|einem|einer|eins|viertel|halbe|halb|dreiviertel|anderthalb|eineinhalb|zweieinhalb|dreieinhalb|viereinhalb|fuenfeinhalb|funfeinhalb|sechseinhalb|siebeneinhalb|achteinhalb|neuneinhalb|zwei|drei|vier|fuenf|funf|sechs|sieben|acht|neun|zehn)";
  const hourUnit = "(?:stunden?|std\\.?|h|hours?)";
  const minuteUnit = "(?:min\\.?|minuten?|minutes?)";

  const hourMatch = source.match(
    new RegExp(`\\b(${numberOrWord})\\s*${hourUnit}\\b`, "i"),
  );
  if (hourMatch?.[1]) {
    const base = parseIntakeHourQuantityToken(hourMatch[1]);
    if (base) {
      let total = base;
      const after = source.slice((hourMatch.index || 0) + hourMatch[0].length);
      const minuteAfter = after.match(
        new RegExp(`^\\s*(?:und|\\+)?\\s*(15|30|45)\\s*${minuteUnit}\\b`, "i"),
      );
      if (minuteAfter?.[1]) total += Number(minuteAfter[1]) / 60;
      const normalized = normalizeIntakeHourQuantity(total);
      if (normalized) return normalized;
    }
  }

  const hourPlusWordFraction = source.match(
    new RegExp(
      `\\b(${numberOrWord})\\s*${hourUnit}\\s*(?:und|\\+)?\\s*(?:eine?n?\\s+)?(viertel|halb|halbe|dreiviertel)\\s*(?:stunde|stunden|std\\.?|h)?\\b`,
      "i",
    ),
  );
  if (hourPlusWordFraction?.[1] && hourPlusWordFraction?.[2]) {
    const base = parseIntakeHourQuantityToken(hourPlusWordFraction[1]);
    const fraction = parseIntakeHourQuantityToken(hourPlusWordFraction[2]);
    const normalized = normalizeIntakeHourQuantity(
      (base || 0) + (fraction || 0),
    );
    if (normalized) return normalized;
  }

  const compactHourMinute = source.match(
    new RegExp(
      `\\b(\\d{1,2})\\s*(?:h|std\\.?|stunden?)\\s*(15|30|45)\\s*(?:${minuteUnit})?\\b`,
      "i",
    ),
  );
  if (compactHourMinute?.[1] && compactHourMinute?.[2]) {
    const normalized = normalizeIntakeHourQuantity(
      Number(compactHourMinute[1]) + Number(compactHourMinute[2]) / 60,
    );
    if (normalized) return normalized;
  }

  const minuteOnly = source.match(
    new RegExp(`\\b(15|30|45)\\s*${minuteUnit}\\b`, "i"),
  );
  if (
    minuteOnly?.[1] &&
    /(?:pro|je|per|par|à|a|\/)\s*(?:stunde|stunden|std\.?|h|hour|hours)\b/i.test(
      source,
    )
  ) {
    const normalized = normalizeIntakeHourQuantity(Number(minuteOnly[1]) / 60);
    if (normalized) return normalized;
  }

  const wordOnlyFraction = source.match(
    /\b(?:eine?n?\s+)?(viertel|halb|halbe|dreiviertel)\s*(?:stunde|stunden|std\.?|h)\b/i,
  );
  if (wordOnlyFraction?.[1]) {
    const normalized = normalizeIntakeHourQuantity(
      parseIntakeHourQuantityToken(wordOnlyFraction[1]),
    );
    if (normalized) return normalized;
  }

  return null;
}

function detectExplicitIntakeMeasuredPriceInLine(
  line?: string | null,
): number | null {
  const source = normalizeUnitText(line || "");
  if (!source) return null;

  const currencyWords = "(?:chf|franken|fr\\.?|sfr\\.?|stutz|eur|euro|€)";
  const number = "(\\d+(?:[.,]\\d{1,2})?)";
  const anchor = "(?:à|a|pro|je|per|zu|fuer|für|/)";

  const anchoredPatterns = [
    new RegExp(`${anchor}\\s*${currencyWords}\\s*${number}\\b`, "i"),
    new RegExp(`${anchor}\\s*${number}\\s*${currencyWords}\\b`, "i"),
    new RegExp(
      `${currencyWords}\\s*${number}\\s*(?:${anchor})\\s*(?:stunde|stunden|std\\.?|h|hour|hours)\\b`,
      "i",
    ),
    new RegExp(
      `${number}\\s*${currencyWords}\\s*(?:${anchor})\\s*(?:stunde|stunden|std\\.?|h|hour|hours)\\b`,
      "i",
    ),
  ];

  for (const pattern of anchoredPatterns) {
    const match = source.match(pattern);
    const value = match?.[1] || match?.[2];
    const parsed = parseIntakeDecimalNumber(value);
    if (parsed) return parsed;
  }

  const currencyMatches = Array.from(
    source.matchAll(
      new RegExp(
        `(?:${currencyWords}\\s*${number}|${number}\\s*${currencyWords})`,
        "gi",
      ),
    ),
  );

  for (const match of currencyMatches) {
    const parsed = parseIntakeDecimalNumber(match[1] || match[2]);
    if (parsed) return parsed;
  }

  return null;
}

function intakeSemanticServiceTopicFromText(
  value?: string | null,
): string | null {
  const source = normalizeUnitText(value || "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!source) return null;

  const canonical = canonicalGermanServiceNameFromText(source);
  const canonicalKey = normalizeUnitText(canonical || "");

  if (/\bboden\b/.test(canonicalKey)) return "boden_reinigen";
  if (/\bfenster\b/.test(canonicalKey)) return "fenster_reinigen";
  if (/\banfahrt\b/.test(canonicalKey)) return "anfahrt";

  const hasCleaningIntent =
    /reinig|putz|putze|saeuber|clean|nettoyage|nettoyer|pulizia|limpieza|limpeza|wisch|aufnehmen/.test(
      source,
    );

  if (
    (/\bboden\b|\bbode\b|\bfloor\b|\bsol\b|\bpaviment|\bsuelo\b|\bchao\b|\bhallenboden\b|\bkellerboden\b|\blagerboden\b/.test(
      source,
    ) ||
      /bodenreinigung|floor cleaning|nettoyage du sol|nettoyage sol|limpieza suelo|pulizia pavimento/.test(
        source,
      )) &&
    hasCleaningIntent
  ) {
    return "boden_reinigen";
  }

  if (
    /fenster|fensterli|vitrin|vitre|window|fenetre|finestr|ventan/.test(source)
  ) {
    return "fenster_reinigen";
  }

  if (/\bteppich\b|carpet|moquette/.test(source) && hasCleaningIntent) {
    return "teppich_reinigen";
  }

  if (
    /\banfahrt\b|\bfahrtkosten\b|\bfahrkosten\b|\bfahrpauschale\b|\bwegpauschale\b|\bdeplacement\b|\btravel\b|\btrip\b/.test(
      source,
    )
  ) {
    return "anfahrt";
  }

  return null;
}

function lineMatchesIntakeServiceTopic(
  serviceName?: string | null,
  line?: string | null,
): boolean {
  const service = normalizeUnitText(serviceName || "");
  const source = normalizeUnitText(line || "");
  if (!service || !source) return false;

  const serviceTopic = intakeSemanticServiceTopicFromText(service);
  const sourceTopic = intakeSemanticServiceTopicFromText(source);
  if (serviceTopic && sourceTopic && serviceTopic === sourceTopic) return true;

  const generic = new Set([
    "reinigen",
    "reinigung",
    "putzen",
    "clean",
    "cleaning",
    "machen",
    "arbeit",
    "arbeiten",
    "service",
    "leistung",
    "leistungen",
  ]);

  const tokens = service
    .split(/\s+/g)
    .map((token) => token.trim())
    .filter((token) => token.length >= 4)
    .filter((token) => !generic.has(token));

  if (tokens.some((token) => source.includes(token))) return true;
  if (/\bboden\b/.test(service) && /\bboden\b/.test(source)) return true;
  if (
    /\bfenster|fensterli|window|vitrine|vitre/.test(service) &&
    /\bfenster|fensterli|window|vitrine|vitre/.test(source)
  )
    return true;
  if (
    /\bwasserablauf|ablauf|pumpe|pumpenraum/.test(service) &&
    /\bwasserablauf|ablauf|pumpe|pumpenraum/.test(source)
  )
    return true;

  return false;
}

function repairExplicitHourQuantitiesFromOriginalText(
  items: IntakeHourLineRepairItem[],
  originalText: string,
): IntakeHourLineRepairItem[] {
  const lines = String(originalText || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split(/\n+|;/g)
    .map((line) => line.trim())
    .filter((line) => line.length >= 8)
    .filter((line) => !/^\s*\[?\s*(?:titel|title)\s*:/i.test(line))
    .map((line) => ({
      raw: line,
      quantity: detectExplicitIntakeHourQuantityInLine(line),
      price: detectExplicitIntakeMeasuredPriceInLine(line),
    }))
    .filter(
      (line) =>
        line.quantity && line.quantity > 0 && line.price && line.price > 0,
    );

  if (lines.length === 0) return items;

  const lineScoreForItem = (
    item: IntakeHourLineRepairItem,
    line: { raw: string; quantity: number | null; price: number | null },
  ) => {
    let score = 0;
    const serviceName = item.serviceName || "";
    const lineText = line.raw;
    const lineKey = normalizeUnitText(lineText);

    const canonicalLineService = canonicalGermanServiceNameFromText(lineText);
    const serviceKey = normalizeUnitText(serviceName);
    const canonicalLineKey = normalizeUnitText(canonicalLineService || "");

    const itemTopic = intakeSemanticServiceTopicFromText(
      [serviceName, item.description, item.sourceText, item.evidence]
        .filter(Boolean)
        .join(" "),
    );
    const lineTopic = intakeSemanticServiceTopicFromText(lineText);

    if (itemTopic && lineTopic && itemTopic === lineTopic) score += 220;
    if (canonicalLineKey && serviceKey && canonicalLineKey === serviceKey)
      score += 140;
    if (lineMatchesIntakeServiceTopic(serviceName, lineText)) score += 80;
    if (lineMatchesIntakeServiceTopic(item.description, lineText)) score += 40;
    if (lineMatchesIntakeServiceTopic(item.sourceText, lineText)) score += 30;
    if (lineMatchesIntakeServiceTopic(item.evidence, lineText)) score += 20;

    const sourceKey = normalizeUnitText(item.sourceText || "");
    const evidenceKey = normalizeUnitText(item.evidence || "");
    const descriptionKey = normalizeUnitText(item.description || "");

    if (
      sourceKey &&
      (lineKey.includes(sourceKey) || sourceKey.includes(lineKey))
    )
      score += 30;
    if (
      evidenceKey &&
      (lineKey.includes(evidenceKey) || evidenceKey.includes(lineKey))
    )
      score += 20;
    if (descriptionKey && lineKey.includes(descriptionKey)) score += 20;

    // Safety: service-domain anchors are mandatory. A matching price alone is
    // not enough, otherwise an hour price can leak into a neighbouring line.
    const hasStrongTopic = score >= 60;
    if (!hasStrongTopic) return 0;

    const currentPrice = Number(item.unitPrice || 0);
    if (Number.isFinite(currentPrice) && currentPrice > 0 && line.price) {
      if (Math.abs(currentPrice - line.price) < 0.01) score += 60;
      else score -= 90;
    }

    if (getServiceUnitType(item.unit) === "hour") score += 30;
    if (Number(item.quantity || 0) <= 0) score += 20;
    if (/\bstunde|stunden|std\.?|h\b/i.test(lineKey)) score += 10;

    return score;
  };

  return items.map((item) => {
    const currentQuantity = Number(item.quantity || 0);
    const currentPrice = Number(item.unitPrice || 0);
    const currentUnitType = getServiceUnitType(item.unit);

    // Repair is allowed for hour rows and for zero-quantity rows when the
    // original line has a strong service-topic match. This catches cases where
    // the UI already shows "Stunde", but also cases where validation still
    // kept the catalog unit while the customer text is explicitly hourly.
    if (currentUnitType !== "hour" && currentQuantity > 0) return item;

    let best: {
      raw: string;
      quantity: number | null;
      price: number | null;
      score: number;
    } | null = null;

    for (const line of lines) {
      const score = lineScoreForItem(item, line);
      if (score <= 0) continue;
      if (!best || score > best.score) {
        best = { ...line, score };
      }
    }

    if (!best || !best.quantity || !best.price || best.score < 100) return item;

    // Do not override a valid, different current price. This protects adjacent
    // Stück/m² services from a previous hourly price.
    if (
      Number.isFinite(currentPrice) &&
      currentPrice > 0 &&
      Math.abs(currentPrice - best.price) >= 0.01
    ) {
      return item;
    }

    const quantity = normalizeIntakeHourQuantity(best.quantity);
    const price = best.price;
    if (!quantity || quantity <= 0 || !price || price <= 0) return item;

    const shouldRepair =
      currentQuantity <= 0 ||
      currentUnitType !== "hour" ||
      Math.abs(currentQuantity - quantity) >= 0.001 ||
      Math.abs(currentPrice - price) >= 0.01 ||
      !item.sourceText ||
      !normalizeUnitText(item.sourceText).includes(normalizeUnitText(best.raw));

    if (!shouldRepair) return item;

    return {
      ...item,
      quantity,
      unit: "Stunde",
      unitPrice: price,
      totalPrice: roundIntakeMoney(quantity * price),
      sourceText: best.raw,
      evidence: best.raw,
    };
  });
}

function findExplicitHourLineRepairForMappedItem(
  item: IntakeHourLineRepairItem,
  originalText: string,
): { quantity: number; price: number; raw: string; score: number } | null {
  const currentPrice = Number(item.unitPrice || 0);
  if (!Number.isFinite(currentPrice) || currentPrice <= 0) return null;

  const lines = String(originalText || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split(/\n+|;/g)
    .map((line) => line.trim())
    .filter((line) => line.length >= 8)
    .filter((line) => !/^\s*\[?\s*(?:titel|title)\s*:/i.test(line))
    .map((line) => ({
      raw: line,
      quantity: detectExplicitIntakeHourQuantityInLine(line),
      price: detectExplicitIntakeMeasuredPriceInLine(line),
    }))
    .filter(
      (line) =>
        line.quantity && line.quantity > 0 && line.price && line.price > 0,
    );

  let best: {
    quantity: number;
    price: number;
    raw: string;
    score: number;
  } | null = null;

  for (const line of lines) {
    if (!line.quantity || !line.price) continue;

    // Hard safety: the hourly line must carry the same explicit price as the
    // current mapped item. This prevents the old cross-line leak into window /
    // piece services while still rescuing the lost hour quantity.
    if (Math.abs(currentPrice - line.price) >= 0.01) continue;

    let score = 0;
    const canonicalLineService = canonicalGermanServiceNameFromText(line.raw);
    const canonicalLineKey = normalizeUnitText(canonicalLineService || "");
    const serviceKey = normalizeUnitText(item.serviceName || "");

    const itemTopic = intakeSemanticServiceTopicFromText(
      [item.serviceName, item.description, item.sourceText, item.evidence]
        .filter(Boolean)
        .join(" "),
    );
    const lineTopic = intakeSemanticServiceTopicFromText(line.raw);

    if (itemTopic && lineTopic && itemTopic === lineTopic) score += 240;
    if (canonicalLineKey && serviceKey && canonicalLineKey === serviceKey)
      score += 160;
    if (lineMatchesIntakeServiceTopic(item.serviceName, line.raw)) score += 120;
    if (lineMatchesIntakeServiceTopic(item.description, line.raw)) score += 60;
    if (lineMatchesIntakeServiceTopic(item.sourceText, line.raw)) score += 40;
    if (lineMatchesIntakeServiceTopic(item.evidence, line.raw)) score += 30;

    const lineKey = normalizeUnitText(line.raw);
    const descriptionKey = normalizeUnitText(item.description || "");
    const sourceKey = normalizeUnitText(item.sourceText || "");

    if (serviceKey && lineKey.includes(serviceKey)) score += 60;
    if (descriptionKey && lineKey.includes(descriptionKey)) score += 30;
    if (
      sourceKey &&
      sourceKey.length >= 8 &&
      (lineKey.includes(sourceKey) || sourceKey.includes(lineKey))
    )
      score += 20;
    if (getServiceUnitType(item.unit) === "hour") score += 40;
    if (Number(item.quantity || 0) <= 0) score += 30;

    // The service topic is mandatory. Price + hour alone is not enough.
    if (score < 120) continue;

    const quantity = normalizeIntakeHourQuantity(line.quantity);
    if (!quantity || quantity <= 0) continue;

    const candidate = {
      quantity,
      price: line.price as number,
      raw: line.raw,
      score,
    };

    if (!best || candidate.score > best.score) best = candidate;
  }

  return best;
}

// V17.00: Persistence-boundary hard repair for explicit hourly customer lines.
// This runs immediately before totals / prisma.order.create and repairs the
// exact failure mode where the mapper kept only "Std. à CHF ..." as item text.
// Safety rules:
// - same explicit unit price is mandatory
// - explicit hour quantity in the same original line is mandatory
// - semantic service topic match is preferred
// - fallback by unique same-price hour line is allowed only for zero-quantity
//   hour rows, so the amount is not leaked to Stück/m² rows
function repairExplicitHourQuantitiesBeforePersist(
  items: IntakeHourLineRepairItem[],
  originalText: string,
): IntakeHourLineRepairItem[] {
  const lines = String(originalText || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split(/\n+|;/g)
    .map((line) => line.trim())
    .filter((line) => line.length >= 8)
    .filter((line) => !/^\s*\[?\s*(?:titel|title)\s*:/i.test(line))
    .map((line) => ({
      raw: line,
      quantity: detectExplicitIntakeHourQuantityInLine(line),
      price: detectExplicitIntakeMeasuredPriceInLine(line),
      topic: intakeSemanticServiceTopicFromText(line),
    }))
    .filter(
      (line) =>
        line.quantity && line.quantity > 0 && line.price && line.price > 0,
    ) as Array<{
    raw: string;
    quantity: number;
    price: number;
    topic: string | null;
  }>;

  if (lines.length === 0) return items;

  const repaired = items.map((item) => {
    const currentQuantity = Number(item.quantity || 0);
    const currentPrice = Number(item.unitPrice || 0);
    const currentUnitType = getServiceUnitType(item.unit);

    if (!Number.isFinite(currentPrice) || currentPrice <= 0) return item;

    // Never touch valid non-hour rows. This protects following Stück/m² rows.
    if (currentUnitType !== "hour" && currentQuantity > 0) return item;

    const itemText = [
      item.serviceName,
      item.description,
      item.sourceText,
      item.evidence,
    ]
      .filter(Boolean)
      .join(" ");
    const itemTopic = intakeSemanticServiceTopicFromText(itemText);

    const samePriceLines = lines.filter(
      (line) => Math.abs(line.price - currentPrice) < 0.01,
    );
    if (samePriceLines.length === 0) return item;

    const topicMatches = itemTopic
      ? samePriceLines.filter((line) => line.topic && line.topic === itemTopic)
      : [];

    let chosen: (typeof samePriceLines)[number] | null = null;

    if (topicMatches.length === 1) {
      chosen = topicMatches[0];
    } else if (topicMatches.length > 1) {
      chosen = topicMatches.sort((a, b) => b.raw.length - a.raw.length)[0];
    } else if (
      currentUnitType === "hour" &&
      currentQuantity <= 0 &&
      samePriceLines.length === 1
    ) {
      // Last safe fallback for the real failure case:
      // item already says Stunde + price, but quantity is 0 and source/evidence
      // was shortened to "Std. à CHF ...". A unique same-price hour line in the
      // original message is then the only reliable quantity source.
      chosen = samePriceLines[0];
    }

    if (!chosen) return item;

    const quantity = normalizeIntakeHourQuantity(chosen.quantity);
    if (!quantity || quantity <= 0) return item;

    return {
      ...item,
      quantity,
      unit: "Stunde",
      unitPrice: chosen.price,
      totalPrice: roundIntakeMoney(quantity * chosen.price),
      // DB only persists description on OrderItem. Keep the full customer line
      // there so the UI no longer shows the misleading "Std. à CHF ..." hint.
      description: chosen.raw,
      sourceText: chosen.raw,
      evidence: chosen.raw,
    };
  });

  return repaired;
}

function splitWorkSegments(text: string): string[] {
  const source = normalizeUnitText(text);
  if (!source) return [];

  const roughParts = source
    .split(/\n|;|\*|,|\bsowie\b|\bplus\b/gi)
    .map((p) => p.trim())
    .filter(Boolean);

  const segments: string[] = [];

  for (const part of roughParts) {
    const splitByQuantity = part
      .replace(
        /\s+(?=\d+(?:[.,]\d+)?\s*(?:m2|m²|qm|quadratmeter|quadrat meter|m3|m³|kubikmeter|kubik meter|cbm|stunden|stunde|std\.?|h|tage|tag|meter|laufmeter|lfm|tonnen|tonne|to\.?|kg|kilogramm|liter|ltr\.?|stück|stueck|stk)\b)/gi,
        "|||",
      )
      .split("|||")
      .map((p) => p.trim())
      .filter(Boolean);

    segments.push(...splitByQuantity);
  }
  const cleanedSegments = segments.filter((segment) => {
    const normalized = normalizeUnitText(segment);

    if (!normalized) return false;
    if (normalized.length < 8) return false;

    const blocked = [
      "zudem",
      "danach",
      "anschliessend",
      "anschließend",
      "sowie",
      "und",
      "plus",
    ];

    if (blocked.includes(normalized)) return false;

    const hasQuantityUnit = detectAllQuantityUnitsFromText(segment).length > 0;

    const hasWorkVerb =
      /\b(reinigen|reinigung|putzen|clean|cleaning|nettoyage|nettoyer|pulizia|pulire|limpieza|limpiar|schneiden|stutzen|pflegen|pflege|mähen|maehen|mähen|streichen|malen|entsorgen|entsorgung|abtransportieren|transportieren|fällen|faellen|montieren|demontieren|reparieren|ersetzen|liefern|räumen|raeumen|ausräumen|ausraeumen|anfahrt|fahrtkosten|fahrpauschale|wegpauschale|deplacement|déplacement|travel|transport|trasferta|transferta)\b/i.test(
        normalized,
      );

    return hasQuantityUnit || hasWorkVerb;
  });
  return cleanedSegments.length > 0 ? cleanedSegments : [source];
}

function unitTypeToDisplayUnit(unitType?: string | null): string {
  switch (unitType) {
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
    case "piece":
      return "Stück";
    case "flat":
      return "Pauschal";
    default:
      return "Pauschal";
  }
}

function cleanDetectedWorkName(segment: string): string {
  return normalizeUnitText(segment)
    .replace(
      /\b\d+(?:[.,]\d+)?\s*(?:m2|m²|qm|quadratmeter|quadrat meter|m3|m³|kubikmeter|kubik meter|cbm|stunden|stunde|std\.?|h|tage|tag|meter|laufmeter|lfm|tonnen|tonne|to\.?|kg|kilogramm|liter|ltr\.?|stück|stueck|stk)\b/gi,
      " ",
    )
    .replace(/\b(ca|circa|ungefähr|ungefaehr|etwa|rund)\b/gi, " ")
    .replace(
      /\b(?:chf|franken|fr\.?|sfr\.?|stutz|eur|euro|usd|dollar|gbp|pfund)\s*\d+(?:[.,]\d{1,2})?\b/gi,
      " ",
    )
    .replace(
      /\b\d+(?:[.,]\d{1,2})?\s*(?:chf|franken|fr\.?|sfr\.?|stutz|eur|euro|usd|dollar|gbp|pfund)\b/gi,
      " ",
    )
    .replace(
      /\b(?:pro|je|per|par|à|a|\/)\s*(?:stück|stueck|stk|m2|m²|qm|meter|stunde|stunden|pauschal)\b/gi,
      " ",
    )
    .replace(/\b(?:pro|je|per|par|à|a)\s*[.,;:!?]*$/gi, " ")
    .replace(/[+]+/g, " ")
    .replace(/[.,;:!?]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function composeWorkNameSource(item: any, raw: string): string {
  const action = String(item.action_name || "").trim();
  const context = String(item.context || "").trim();
  const name = String(item.name || "").trim();
  const serviceName = String(
    item.service_name || item.matched_service_name || "",
  ).trim();
  const actionKey = normalizeUnitText(action)
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const contextKey = normalizeUnitText(context)
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const nameKey = normalizeUnitText(name)
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (
    name &&
    action &&
    nameKey.includes(actionKey) &&
    name.length > action.length + 3
  ) {
    return name;
  }

  const actionTooGeneric =
    /^(?:reinigen|reinigung|putzen|montieren|demontieren|streichen|malen|prüfen|pruefen|ersetzen|entsorgen|schneiden|stutzen|regiearbeit)$/i.test(
      actionKey,
    );
  const contextHasWorkObject =
    /\b(?:kabelkanal|kabel|lampe|leuchte|wand|waende|wände|decke|boden|fenster|teppich|abfluss|dichtung|hecke|gruen|grün|steckdose|steckdosen|material)\b/i.test(
      contextKey,
    );
  if (actionTooGeneric && contextKey && contextHasWorkObject) {
    return `${context} ${action}`.trim();
  }

  return action || serviceName || name || raw || "";
}

function canonicalGermanServiceNameFromText(
  value?: string | null,
): string | null {
  const normalized = normalizeUnitText(value || "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!normalized) return null;

  const hasFloorIntent =
    /\b(boden|bode|floor|sol|paviment|suelo|chao)\b|bodenreinigung|floor cleaning|nettoyage du sol|nettoyage sol|limpieza suelo|pulizia pavimento/i.test(
      normalized,
    );
  const hasCleaningIntent =
    /reinig|putz|putze|saeuber|clean|nettoyage|nettoyer|pulizia|limpieza|limpeza|wisch|aufnehmen/i.test(
      normalized,
    );

  if (hasFloorIntent && hasCleaningIntent) {
    return "Boden reinigen";
  }

  const hasWindowIntent =
    /fenster|fensterli|vitrin|vitre|window|fenetre|fenêtre|finestr|ventan/i.test(
      normalized,
    );

  if (hasWindowIntent) {
    return "Fenster reinigen";
  }

  if (
    /\b(anfahrt|fahrt|fahrtkosten|fahrkosten|fahrpauschale|wegpauschale|deplacement|déplacement|travel fee|travel cost|travel costs|trip fee|transport fee|trasferta|transferta|viaje)\b/i.test(
      normalized,
    )
  ) {
    return "Anfahrt";
  }

  if (
    /\b(clean floor|floor cleaning|boden reinigen|bodenreinigung|nettoyage du sol|nettoyage sol|nettoyer sol|pulizia pavimento|pulizia del pavimento|limpieza suelo|limpieza de suelo)\b/i.test(
      normalized,
    )
  ) {
    return "Boden reinigen";
  }

  if (
    /\b(clean windows|window cleaning|windows cleaning|fenster reinigen|fensterreinigung|nettoyage des vitres|nettoyage vitres|nettoyage des vitrines|nettoyage vitrines|vitres|vitrines|fenetres|pulizia finestre|pulizia delle finestre|limpieza ventanas|limpieza de ventanas)\b/i.test(
      normalized,
    )
  ) {
    return "Fenster reinigen";
  }

  return null;
}

function formatWorkNameForDisplay(value: string): string {
  const canonical = canonicalGermanServiceNameFromText(value);
  if (canonical) return canonical;

  const text = String(value || "")
    .replace(/ae/g, "ä")
    .replace(/oe/g, "ö")
    .replace(/ue/g, "ü")
    .replace(/\b(?:pro|je|per|par|à|a)\s*[.,;:!?]*$/gi, " ")
    .replace(/\s+\.\s*$/g, "")
    .replace(/[.,;:!?]+$/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

  if (!text) return "Unbekannte Leistung";

  const forceUppercaseWords = [
    "glasfläche",
    "fugen",
    "gartentor",
    "kupferornamente",
    "terrasse",
    "fenster",
    "hecke",
    "rasen",
    "baum",
  ];

  return text
    .split(" ")
    .map((word, index) => {
      if (index === 0 || forceUppercaseWords.includes(word)) {
        return word.charAt(0).toUpperCase() + word.slice(1);
      }

      return word;
    })
    .join(" ");
}

function findBestQuantityForService(
  serviceName: string,
  unitType: string,
  text: string,
  quantityMatches: Array<{ value: number; unit: string; raw: string }>,
): { value: number; unit: string; raw: string } | null {
  const relevant = quantityMatches.filter((q) => q.unit === unitType);
  if (relevant.length === 0) return null;
  if (relevant.length === 1) return relevant[0];

  const normalizedText = normalizeUnitText(text);
  const normalizedService = normalizeUnitText(serviceName);

  const serviceKeywords = normalizedService
    .split(/\s+/)
    .filter((w) => w.length >= 4);

  const keywordMap: Record<string, string[]> = {
    square_meter: [
      "streichen",
      "malen",
      "wand",
      "fassade",
      "flaeche",
      "fläche",
    ],
    cubic_meter: [
      "kubikmeter",
      "volumen",
      "entsorgung",
      "entsorgen",
      "gruenabfall",
      "grünabfall",
      "bauschutt",
      "aushub",
    ],
    ton: [
      "tonne",
      "tonnen",
      "entsorgung",
      "entsorgen",
      "bauschutt",
      "aushub",
      "abfall",
    ],
    liter: [
      "liter",
      "reiniger",
      "reinigungsmittel",
      "reinigung",
      "spezialreiniger",
    ],
    meter: ["meter", "hecke", "hecken", "schneiden", "stutzen", "rohr", "zaun"],
    hour: ["stunde", "stunden", "maehen", "mähen", "wiese", "rasen"],
    day: ["tag", "tage", "arbeitstag", "arbeitstage", "montage"],
    piece: ["stueck", "stück", "baum", "baeume", "bäume", "platten"],
    kilogram: ["kilogramm", "kilo", "kg", "kies", "material"],
  };

  const keywords = [...serviceKeywords, ...(keywordMap[unitType] || [])];

  const sentences = normalizedText
    .split(/[.!?\n;-]+/)
    .map((s) => s.trim())
    .filter(Boolean);

  let best: {
    q: { value: number; unit: string; raw: string };
    score: number;
  } | null = null;

  for (const q of relevant) {
    const raw = normalizeUnitText(q.raw);
    let score = 0;

    for (const sentence of sentences) {
      if (!sentence.includes(raw)) continue;

      for (const keyword of keywords) {
        if (sentence.includes(keyword)) score += 10;
      }

      if (normalizedService && sentence.includes(normalizedService))
        score += 25;
    }

    const rawIndex = normalizedText.indexOf(raw);
    const serviceIndex = keywords
      .map((k) => normalizedText.indexOf(k))
      .filter((i) => i >= 0)
      .sort((a, b) => Math.abs(a - rawIndex) - Math.abs(b - rawIndex))[0];

    if (rawIndex >= 0 && serviceIndex >= 0) {
      score += Math.max(
        0,
        20 - Math.floor(Math.abs(rawIndex - serviceIndex) / 20),
      );
    }

    if (!best || score > best.score) {
      best = { q, score };
    }
  }

  return best?.q || relevant[0];
}
function findConflictingQuantityForService(
  serviceName: string,
  serviceUnitType: string,
  text: string,
  quantityMatches: Array<{ value: number; unit: string; raw: string }>,
): { value: number; unit: string; raw: string } | null {
  const otherUnits = quantityMatches.filter((q) => q.unit !== serviceUnitType);
  if (otherUnits.length === 0) return null;

  const normalizedText = normalizeUnitText(text);
  const normalizedService = normalizeUnitText(serviceName);

  const serviceKeywords = normalizedService
    .split(/\s+/)
    .filter((w) => w.length >= 4);

  const activityKeywords: Record<string, string[]> = {
    hour: [
      "maehen",
      "mähen",
      "wiese",
      "rasen",
      "arbeit",
      "nacharbeit",
      "reinigen",
      "montieren",
    ],
    day: ["arbeitstag", "arbeitstage", "montage", "montieren", "vorbereitung"],
    meter: [
      "hecke",
      "hecken",
      "schneiden",
      "stutzen",
      "rohr",
      "verlegen",
      "zaun",
    ],
    square_meter: ["streichen", "malen", "wand", "fassade", "decke", "farbe"],
    cubic_meter: [
      "aushub",
      "gruenabfall",
      "grünabfall",
      "volumen",
      "kubikmeter",
      "entsorgen",
    ],
    ton: ["tonne", "tonnen", "bauschutt", "aushub", "entsorgen", "entsorgung"],
    liter: ["liter", "reiniger", "reinigungsmittel", "spezialreiniger"],
    kilogram: ["kilogramm", "kilo", "kg", "kies", "material", "liefern"],
    piece: ["stueck", "stück", "baum", "baeume", "bäume", "platten", "setzen"],
    flat: ["pauschal", "fällen", "faellen", "baum"],
  };

  const keywords = [
    ...serviceKeywords,
    ...(activityKeywords[serviceUnitType] || []),
  ].filter(Boolean);

  const sentences = normalizedText
    .split(/[.!?\n;-]+/)
    .map((s) => s.trim())
    .filter(Boolean);

  let best: {
    q: { value: number; unit: string; raw: string };
    score: number;
  } | null = null;

  for (const q of otherUnits) {
    const raw = normalizeUnitText(q.raw);
    let score = 0;

    for (const sentence of sentences) {
      if (!sentence.includes(raw)) continue;

      for (const keyword of keywords) {
        if (sentence.includes(keyword)) score += 10;
      }

      if (normalizedService && sentence.includes(normalizedService))
        score += 30;
    }

    if (!best || score > best.score) {
      best = { q, score };
    }
  }

  return best && best.score > 0 ? best.q : null;
}

/**
 * Strukturiertes Audit-Log für jede Intake-Verarbeitung.
 * Wird in stdout als kompakter JSON-Block ausgegeben:
 *   [INTAKE-AUDIT] {"source":"WhatsApp", ...}
 *
 * Telefonnummern sind maskiert (maskPhoneForLog).
 * Audio-Buffer / Bildinhalte werden NIE geloggt.
 */
function logIntakeAudit(payload: {
  source: string;
  userId: string | null;
  phoneMasked: string;
  senderName: string;
  mediaType: string | null;
  hasTranscript: boolean;
  transcriptLen: number;
  llmExtractedName: string | null;
  llmAbgleichStatus: string;
  selfIntroFallbackUsed: boolean;
  resolvedCustomerName: string | null;
  customerId: string | null;
  customerWasNewlyCreated: boolean;
  customerNameInDb: string | null;
  customerFallbackUsed: boolean;
  notes?: string;
}): void {
  try {
    console.log("[INTAKE-AUDIT]", JSON.stringify(payload));
  } catch {
    // never let logging break the intake
  }
}

// ---------- Types ----------
export interface IntakeResult {
  orderId: string;
  description: string;
  customerName: string;
  serviceName: string;
  kundeStatus: string;
  kundenabgleichStatus: string;
}

export interface IntakeInput {
  source: "Telegram" | "WhatsApp";
  senderName: string;
  /**
   * Block R — sender phone (E.164) for masked audit logging only.
   * NEVER used for customer matching. Optional: existing call sites may
   * omit this field; logIntakeAudit will then output phoneMasked='[redacted]'.
   */
  phoneNumber?: string | null;
  messageText: string;
  imageBase64?: string | null;
  imageMimeType?: string;
  savedMediaPath?: string | null;
  savedMediaType?: "audio" | "image" | null;
  optimizedPreviewPath?: string | null;
  optimizedThumbnailPath?: string | null;
  userId?: string | null;
  // Multi-image support
  allImageBase64s?: string[];
  allImageMimeTypes?: string[];
  allSavedMediaPaths?: string[];
  allOptimizedPreviewPaths?: string[];
  allOptimizedThumbnailPaths?: string[];
  // ─── Stage I: audio usage tracking (additive, optional) ───
  // Detected duration in seconds (may be fractional; will be rounded by the
  // intake before writing). NULL when duration parsing failed (Stage H
  // fail-open path) or when the order has no audio at all.
  audioDurationSec?: number | null;
  // Lifecycle marker — see Order.audioTranscriptionStatus comment in schema.prisma.
  // 'transcribed' | 'failed' | 'skipped_too_long' | 'skipped_uncheckable' | 'skipped_quota_exceeded' | null
  audioTranscriptionStatus?:
    | "transcribed"
    | "failed"
    | "skipped_too_long"
    | "skipped_uncheckable"
    | "skipped_quota_exceeded"
    | null;
  additionalReviewReasons?: string[];
  reviewNote?: string;
  forceReview?: boolean;
}

// ---------- Build system prompt ----------
function buildSystemPrompt(
  serviceListJson: string,
  customerListJson: string,
  senderName: string,
  branche: string = "Gartenbau",
  hauptsprache: string = "Deutsch",
): string {
  return `WICHTIG – ABSOLUT KRITISCH:

Gib NUR gültiges JSON zurück.
KEINE Markdown-Formatierung.
KEIN Text vor oder nach dem JSON.
KEINE Erklärungen.

--------------------------------------------------
ROLLE
--------------------------------------------------

Du bist eine KI für ein ${branche}-Unternehmen.

Deine Aufgaben:

1. Endkunden-Daten extrahieren
2. Kundenabgleich durchführen
3. Auftrag verstehen
4. Passende Leistung erkennen (Service-Matching)
5. Unsicherheiten markieren

--------------------------------------------------
WICHTIGER KONTEXT
--------------------------------------------------

- Nachrichten werden typischerweise vom Firmenkunden (A) weitergeleitet
- Der Absender ("${senderName}") ist STANDARDMÄSSIG Kunde A – NICHT der Endkunde
- Telefonnummer und E-Mail NICHT für Kundenabgleich verwenden
- Es geht in der Regel um Endkunde (B) – alle Daten aus dem Nachrichtentext extrahieren
- KEINE Daten erfinden


- WICHTIG: kunde.name MUSS aus dem eingehenden Nachrichtentext / Audio-Transkript / Bildinhalt extrahiert werden, wenn dort ein Personen- oder Firmenname eindeutig genannt wird.
- Das gilt für Selbstvorstellungen, Anreden, Weiterleitungen und normale Auftragstexte.
- Beispiele für gültige Namenssignale:
  "Mein Name ist Max Müller" → kunde.name = "Max Müller"
  "Hallo Frau Meier, Hecke geschnitten" → kunde.name = "Frau Meier"
  "Guten Tag Herr Keller, Terrasse reinigen" → kunde.name = "Herr Keller"
  "Bitte bei Max Müller Rasen mähen" → kunde.name = "Max Müller"
  "Kunde: Peter Schmid" → kunde.name = "Peter Schmid"
- Der Absendername ("${senderName}") darf NICHT automatisch als kunde.name übernommen werden.
- ABER: Wenn derselbe Name eindeutig im Nachrichtentext selbst steht, darf und soll er als kunde.name extrahiert werden.
- Namen dürfen NIEMALS aus bestehende_kunden kopiert werden. bestehende_kunden dient nur zum Abgleich, nicht zum Befüllen von kunde.name.
- Wenn im Nachrichtentext kein Name steht → kunde.name = null.

--------------------------------------------------
EINGABE
--------------------------------------------------

bestehende_kunden:
${customerListJson}

leistungen:
${serviceListJson}

--------------------------------------------------
ZIELE
--------------------------------------------------

1. Kunde extrahieren:
- name
- strasse
- hausnummer
- plz
- ort
- telefon
- email

2. Auftrag:
- titel (max 3 Wörter, IMMER auf ${hauptsprache})
- beschreibung (IMMER auf ${hauptsprache}, auch wenn die Nachricht in einer anderen Sprache ist)
- beschreibung enthält NUR die Arbeiten/Leistungen, kurz und sachlich.
- beschreibung darf KEINE Gefahren, Warnhinweise, organisatorischen Hinweise, Rückrufe, Zugangshinweise, Hund-/Öl-/Strom-Hinweise oder lange Kundenerklärungen enthalten.
- gefahren: JSON-Array mit echten Sicherheitsrisiken / Warnhinweisen, z.B. ["Hund läuft frei auf dem Grundstück", "Offene Stromkabel im Keller", "Rutschiger Boden wegen Öl"]
- besonderheiten: JSON-Array mit normalen organisatorischen Hinweisen oder positiven Arbeitserleichterungen, z.B. ["Leiter benötigt", "Rückruf vor Arbeitsbeginn", "Zugang über Seiteneingang", "Parkplatz im Innenhof reserviert"]
  (GEFAHREN und BESONDERHEITEN strikt trennen.)
  (Leiter allein ist KEINE Gefahr. Leiter nur dann als Gefahr werten, wenn zusätzlich ein echtes Risiko genannt wird, z.B. Absturzgefahr, instabiler Stand, Arbeiten in großer Höhe.)
  (Hund ist NICHT automatisch Gefahr: freilaufend/aggressiv/ungesichert = gefahr; freundlich/gesichert/Besitzer vor Ort = besonderheit.)
  (Parkplatz/Zugang unterscheiden: reserviert/vorhanden/Innenhof = positive besonderheit; schwierig/kein Parkplatz/enge Zufahrt = wichtige besonderheit.)
  (Neutrale oder unwichtige Erleichterungen NICHT als Außen-Hinweis erzwingen: "Parkplatz ist kein Thema", "man kann direkt halten", "Zugang frei", "Tür ist offen".)
  (Rückruf NUR aufnehmen, wenn der Kunde ausdrücklich einen TELEFONISCHEN Rückruf/Anruf verlangt. Klingeln, warten, an der Tür melden, Kunde ist vor Ort, Schlüsselübergabe an der Tür oder "nicht anrufen" sind KEIN Rückruf. Dann höchstens als normaler Hinweis formulieren, z.B. "Vor Arbeitsbeginn klingeln und warten".)
  (Verneinte oder nicht relevante Aussagen NICHT aufnehmen: "kein Hund", "kein Öl", "keine Scherben", "Leiter nicht benötigt", "Termin flexibel", "Parkplatz kein Thema".)
  (Keine Leistungen, Preise oder Mengen in gefahren/besonderheiten schreiben.)
  (Kommunikationshinweise semantisch vollständig ausgeben: Kanal erlaubt/verboten/bevorzugt und Kontaktzeit sauber trennen. Wenn ein Kanal verboten ist, darf er nicht positiv formuliert werden. Beispiel: nicht über WhatsApp schreiben => "Kein WhatsApp; lieber Telefonkontakt". Beispiel: WhatsApp erst ab 18:00 => "WhatsApp-Kontakt erst ab 18:00 Uhr möglich".)
  (WICHTIG: Verneinungen immer semantisch an den richtigen Satzteil binden. "WhatsApp an 079..., nicht einfach kommen" bedeutet WhatsApp bevorzugt + nicht unangemeldet kommen. Es bedeutet NICHT "Keine WhatsApp".)
  (Kontaktzeiten wie SMS/WhatsApp/Mail/Telefon erst ab/nach Uhrzeit sind KEINE Ausführungstermine.)
  (KEINE Systemhinweise.)
  (IMMER auf ${hauptsprache} übersetzen, auch wenn die Nachricht in einer anderen Sprache ist.)
  (WICHTIG: Erkenne Gefahren, Rückruf, Zugang und Parken semantisch nach Bedeutung, NICHT nur über feste deutsche Wörter. Auch Englisch, Französisch, Spanisch, Italienisch, Portugiesisch, Schweizerdeutsch oder gemischte Nachrichten müssen in deutsche gefahren/besonderheiten übersetzt werden.)

3. Service erkennen:
- passende Leistung aus "leistungen"
- KEIN Service erfinden
- wenn nichts passt → null

4. einfache Kalkulation:
- estimated_quantity (nur wenn klar erkennbar)
- unit (aus Leistung übernehmen)
- unit_price (aus Leistung übernehmen)

--------------------------------------------------
MATCHING-REGELN (STRENG – SICHERHEIT VOR FALSCHEM ABGLEICH)
--------------------------------------------------

ABSOLUT VERBOTEN:
- NIEMALS "gleicher_kunde" NUR aufgrund von Name setzen!
- NIEMALS bei Teilnamen (z.B. nur Vorname oder Nachname) als gleicher_kunde werten!
- NIEMALS bei ähnlichem/gleichem Namen OHNE mindestens ein starkes Signal!

STARKE SIGNALE (mindestens eines MUSS für "gleicher_kunde" vorhanden sein):
- Gleiche Telefonnummer
- Gleiche E-Mail-Adresse
- Gleiche Straße + Hausnummer + (PLZ oder Ort)
- Gleiche vollständige Adresse

SCHWACHE SIGNALE (reichen ALLEIN NICHT für "gleicher_kunde"):
- Gleicher/ähnlicher Name → NUR "moeglicher_treffer"
- Nur Nachname gleich → NUR "moeglicher_treffer"
- Nur Vorname gleich → NUR "moeglicher_treffer"
- Nur Ort gleich → NUR "moeglicher_treffer"
- Nur PLZ gleich → NUR "moeglicher_treffer"
- Teilname enthalten → NUR "moeglicher_treffer"

NAME-VARIANTEN:
- Schreibvarianten erkennen (ss=ß, Str.=Strasse=Straße, Reihenfolge egal)
- ABER Name allein = schwaches Signal!

ADRESSE:
- Straße + Hausnummer + PLZ/Ort → stark (zusammen mit Name = gleicher_kunde erlaubt)
- Straße ohne Nummer → mittel
- nur Ort → schwach

ENTSCHEIDUNGSLOGIK:
- Name + starkes Signal → "gleicher_kunde"
- Name allein (auch exakt) → "moeglicher_treffer" (NIEMALS gleicher_kunde!)
- Teilname/ähnlicher Name → "moeglicher_treffer"
- Kein relevanter Treffer → "kein_treffer"
- Widersprüchliche Daten → "konflikt"

--------------------------------------------------
STATUS
--------------------------------------------------

"gleicher_kunde" → NUR bei Name + mindestens einem starken Signal!
"moeglicher_treffer" → Bei Name-Ähnlichkeit OHNE starkes Signal
"konflikt" → Bei widersprüchlichen Daten
"kein_treffer" → Kein relevanter Treffer

--------------------------------------------------
SEMANTIC INTAKE ENGINE V12 – WICHTIG
--------------------------------------------------

Du liest IMMER den gesamten Kundentext als Bedeutung, nicht als Wortliste.
Du sollst wie ein vorsichtiger Sachbearbeiter entscheiden:

- Wer bekommt die Rechnung?
- Wo wird tatsächlich gearbeitet?
- Welche konkrete Arbeit wird gemacht?
- Was ist nur Ort/Kontext?
- Welche Menge gehört zu welcher Arbeit?
- Welcher Preis gehört zu welcher Arbeit?
- Welche Währung gehört zu welcher Arbeit?
- Was ist unsicher?

ABSOLUTE SICHERHEITSREGEL:
Wenn ein Wert nicht eindeutig aus dem Kundentext belegbar ist, setze ihn auf null.
Nicht raten. Nicht aus anderen Leistungen übernehmen. Nicht aus vorhandenen Kunden übernehmen.
Lieber leer lassen und prüfen lassen als falsch speichern.

FÜR JEDE ARBEITSPOSITION MUSST DU TRENNEN:
- action_name: die echte Arbeit, z.B. "Fenster reinigen", "Treppenhaus reinigen", "Garagenreinigung"
- context: Ort/Teilbereich, z.B. "EG", "Treppenhaus", "Keller", "Garage Haus Nord"
- service_id / service_name: nur dann aus der Liste "leistungen", wenn die Arbeit fachlich eindeutig passt.
  Wenn nicht eindeutig: service_id = null, service_name = null, confidence = "niedrig".

LEISTUNGSNAMEN / SICHTBARE ARBEITEN:
- Alle sichtbaren Leistungsnamen und action_name-Werte IMMER auf ${hauptsprache} zurückgeben.
- Nicht einfach Originalwörter abschreiben, wenn der Kundentext fremdsprachig, mundartlich oder unprofessionell formuliert ist.
- Erkenne die Bedeutung semantisch und formuliere daraus einen kurzen professionellen deutschen Leistungsnamen.
- Bei handwerklichen Neben-/Vorbereitungsleistungen die Form "...arbeiten" bevorzugen, wenn fachlich passend.
  Beispiele: "spachteln" / "Spachtel" / sinngleiche Formulierungen → "Spachtelarbeiten"; "abdecken" / Schutz abdecken → "Abdeckarbeiten"; "schleifen" → "Schleifarbeiten"; "vorbereiten" → "Vorbereitungsarbeiten".
- Bei bekannten Standardarbeiten kurze deutsche Fachnamen verwenden: "Nettoyer le sol" → "Boden reinigen", "Déplacement" → "Anfahrt", "Nettoyage des vitres"/"Nettoyage des vitrines" → "Fenster reinigen".
- Der Originaltext gehört nur in raw/evidence/sourceText, nicht als sichtbarer Leistungsname.
- Arbeitsobjekt und Ort/Kontext dürfen nicht vertauscht werden. Wenn der Text z.B. Fenster, Tische, Vitrinen, Geländer oder Haken IN einem Raum/Bereich nennt, bleibt dieses Objekt Teil des sichtbaren Leistungsnamens. Der Name darf nicht zu einem allgemeinen Bereich verflachen.
- Beispiele semantisch: "Fenêtres couloir intérieur" = Fenster im Gang innen reinigen, nicht Gangbereich reinigen. "Tische im Sitzungszimmer reinigen" = Tische im Sitzungszimmer reinigen, nicht Besprechungsbereich reinigen.

WICHTIG:
Ein Ort oder Kontext ist nicht automatisch die Leistung.
Wenn eine Formulierung sagt, dass etwas IN einem Bereich gemacht wird, muss die Handlung die Leistung bestimmen.
Die Leistung darf nur übernommen werden, wenn die evidence genau diese Handlung belegt.

KONTEXT + ARBEITSOBJEKT IN EINER PREISZEILE:
- Eine kurze Preiszeile kann Ort/Teilbereich + Arbeitsobjekt + Menge/Preis enthalten.
- Wenn eine einzige Zeile nur EINE Menge, EINEN Preis und EINE Währung enthält, darf daraus grundsätzlich nur EINE Arbeitsposition entstehen.
- Der Orts-/Bereichsteil gehört dann in context; die eigentliche bearbeitete Sache/Tätigkeit gehört in action_name/name.
- Erzeuge NICHT zusätzlich eine zweite Leistung nur aus dem Orts-/Bereichsteil.
- Beispiele semantisch, nicht als Wortliste:
  - "Lagerraum Boden 42 à CHF 7" = eine Position; context = "Lagerraum", Arbeit = Boden/Fläche reinigen, Einheit unsicher wenn nicht genannt.
  - "Garage floor 80 sqm at EUR 5" = eine Position; context = Garage, Arbeit = Boden reinigen.
  - "Cave sol 30 m2 à CHF 6" = eine Position; context = Cave/Keller, Arbeit = Boden reinigen.
- Wenn zwei mögliche Positionen dieselbe evidence/raw-Zeile, dieselbe Menge, denselben Preis und dieselbe Währung hätten, ist das ein Split-Fehler: behalte nur die eine fachlich konkrete Arbeitsposition und verschiebe den Rest in context.

EVIDENCE-PFLICHT:
Jedes automatisch gesetzte Feld braucht eine konkrete evidence aus dem Originaltext.
Das gilt besonders für:
- kunde.name
- kunde.strasse / plz / ort
- ausfuehrungsadresse
- jede Arbeitsposition
- menge
- einheit
- unit_price
- currency

--------------------------------------------------
KI-VORSORTIERUNG – SEHR WICHTIG
--------------------------------------------------
Du bist die erste und wichtigste Sortierschicht. Der nachgelagerte Code verlässt
sich auf deine strukturierten Felder und validiert nur noch Plausibilität.

V17.09 STRUKTURVERTRAG:
- Du musst pro Arbeitsposition selbst entscheiden, welche Menge, Einheit, Einzelpreis
  und Währung wirklich zu genau dieser Position gehören.
- Der Code nach dir darf fehlende Werte nicht mehr still aus dem Katalog auffüllen.
- Wenn Menge fehlt oder unsicher ist: menge = null.
- Wenn Einheit fehlt oder unsicher ist: einheit = null.
- Wenn Einzelpreis fehlt oder unsicher ist: unit_price = null.
- Wenn Währung fehlt oder unsicher ist: currency = null.
- Wenn eine Zeile nur Menge + Preis enthält, aber keine Einheit, z. B.
  "Boden im Lager reinigen 42 à CHF 7", dann ist einheit = null.
  Du darfst NICHT aus dem Leistungskatalog "Stunde", "m2" oder "Stück" einsetzen.
- Wenn CHF und EUR oder andere Währungen gemischt vorkommen, ordne jede Währung
  nur der exakt belegten Position zu und setze unsichere Positionswährungen auf null.
- Wenn eine Position dadurch nicht vollständig abrechenbar ist, setze confidence = "niedrig"
  und schreibe in raw/evidence trotzdem die Originalzeile, damit der Validator rot prüfen kann.
- Kein Preis, keine Menge und keine Einheit dürfen von einer anderen Zeile oder
  einer anderen Leistung übernommen werden.

Sortiere nach Bedeutung, nicht nach einzelnen Signalwörtern:
- Wer/was bezahlt oder bekommt die Rechnung? → kunde
- Wo wird die Arbeit tatsächlich ausgeführt? → auftrag.ausfuehrungsadresse
- Welche einzelnen Arbeiten werden gemacht? → auftrag.arbeitspositionen
- Was ist nur Hinweis/Kommunikation/Termin/Zugang? → besonderheiten

Wenn ein Wert nicht sicher ist: null setzen. Nicht raten.
Labels, Einleitungen, Arbeitsanweisungen, Kommunikationswünsche, Termine und
Satzreste dürfen niemals als kunde.name gespeichert werden. Ein Kundenname ist
nur ein echter Personenname oder ein echter Firmenname aus dem Originaltext.

Arbeitspositionen dürfen keine zusammengesetzten Satzreste sein.
Wenn konkrete Einzelpositionen mit Preis/Menge vorhanden sind, bilde nur diese
Einzelpositionen und keine zusätzliche Sammelposition aus dem Satz davor.
Beispiel: Aus einer Nachricht mit Wände streichen, Abdeckarbeiten und Anfahrt
müssen drei getrennte Positionen entstehen, nicht eine Sammelposition.
service/action_name muss die vollständige Tätigkeit enthalten; bei Kabelkanal
montieren darf action_name nicht nur "montieren" sein.

--------------------------------------------------
ADRESS-SORTIERUNG – AI-FIRST
--------------------------------------------------
kunde ist ausschließlich der Rechnungskunde / Rechnungsempfänger / Zahlende.
auftrag.ausfuehrungsadresse ist ausschließlich der Ort, an dem gearbeitet wird.

Regeln:
- Wenn Rechnungskunde ohne Namen, aber mit Straße/PLZ/Ort/E-Mail genannt ist:
  kunde.name = null, Adresse/Kontaktfelder übernehmen, system.needs_review = true.
- Wenn nur ein Arbeitsort genannt ist und kein Rechnungskunde erkennbar ist:
  kunde komplett leer lassen und nur auftrag.ausfuehrungsadresse setzen.
- Wenn Rechnungsadresse und Arbeitsort gleich sind:
  auftrag.ausfuehrungsadresse.ist_abweichend = false.
- Wenn Rechnungsadresse und Arbeitsort unterschiedlich sind:
  auftrag.ausfuehrungsadresse.ist_abweichend = true und vollständige Arbeitsadresse setzen.
- Bei auftrag.ausfuehrungsadresse.strasse nur den Straßennamen setzen und die Hausnummer separat in hausnummer setzen.
  Wenn du Straße und Hausnummer nicht sicher trennen kannst, schreibe beides vollständig in strasse.
- Wenn unklar ist, welche Adresse welche Rolle hat:
  keine Adresse in kunde schreiben; nur sichere Arbeitsadresse setzen oder alles leer lassen.
- Straße, PLZ und Ort dürfen nur aus echten Adressteilen bestehen, nicht aus
  Arbeitsanweisungen, Terminen oder Leistungstext.

CONFIDENCE:
- "hoch": eindeutig im Text belegt und keine Widersprüche.
- "mittel": wahrscheinlich, aber noch prüfbedürftig.
- "niedrig": unsicher. Werte bei niedrig möglichst null lassen.

--------------------------------------------------
FAIL-CLOSED-SICHERHEIT – KEINE WORTLISTEN-LOGIK
--------------------------------------------------
- Du musst die Rollen selbst semantisch erkennen.
- Der Code nach dir soll keine mehrsprachigen Rechnungs-/Arbeitsort-Wortlisten als Hauptlogik verwenden.
- Deshalb ist deine Strukturierung entscheidend:
  kunde = nur Rechnungskunde/Rechnungsadresse.
  auftrag.ausfuehrungsadresse = nur Arbeitsort/Baustelle/Objekt.
  kontakt vor Ort = nur Hinweis/Besonderheit, niemals Rechnungskunde.
- kunde.confidence MUSS "hoch", "mittel" oder "niedrig" sein.
- kunde.evidence MUSS die exakte Original-Textstelle enthalten, aus der die Kundendaten stammen.
- Wenn du keine exakte evidence hast: alle unsicheren kunde-Felder null lassen und kunde.confidence = "niedrig".
- Wenn nur eine namenlose Rechnungsadresse sicher vorhanden ist:
  kunde.name = null,
  Adresse/E-Mail setzen,
  kunde.confidence = "mittel" oder "hoch",
  kunde.evidence = exakter Rechnungsadressblock,
  system.needs_review = true.
- Wenn eine Adresse wahrscheinlich nur Arbeitsort ist:
  NICHT in kunde schreiben.
- Wenn du unsicher bist, welche Rolle eine Adresse hat:
  lieber kunde leer lassen und system.needs_review = true.

--------------------------------------------------
AUSGABEFORMAT
--------------------------------------------------

{
  "kunde": {
    "name": null,
    "strasse": null,
    "hausnummer": null,
    "plz": null,
    "ort": null,
    "telefon": null,
    "email": null,
    "confidence": "niedrig",
    "evidence": null
  },
"auftrag": {
  "titel": null,
  "beschreibung": null,
  "gefahren": [],
  "besonderheiten": [],
  "ausfuehrungsadresse": {
    "ist_abweichend": false,
    "name": null,
    "strasse": null,
    "hausnummer": null,
    "plz": null,
    "ort": null,
    "confidence": "niedrig",
    "evidence": null
  },
  "arbeitspositionen": []
},
  "service": {
    "service_id": null,
    "service_name": null,
    "estimated_quantity": null,
    "unit": null,
    "unit_price": null
  },
  "kundenabgleich": {
    "status": null,
    "bestehende_kunden_id": null,
    "confidence": 0,
    "unterschiede": [],
    "warnung": ""
  },
  "system": {
    "needs_review": false,
    "prioritaet": "normal"
  }
}

--------------------------------------------------
REGELN
--------------------------------------------------

1. KEINE DATEN ERFINDEN / KEIN ABSCHREIBEN VON BESTEHENDEN KUNDEN
- Felder unter "kunde" (name, strasse, hausnummer, plz, ort) dürfen AUSSCHLIESSLICH
  aus dem Nachrichtentext / Audio-Transkript / Bildinhalt stammen.
- NIEMALS Felder aus der Liste "bestehende_kunden" nach "kunde" kopieren.
- Wenn ein Feld nicht in der eingehenden Nachricht vorkommt → null setzen, nicht raten.
- PLZ nur setzen wenn im Text vorhanden; keine Rückschlüsse aus Ort.

2. E-Mail komplett ignorieren (KEINE Warnung, KEIN needs_review)

3. Telefonnummer:
- NICHT für Matching verwenden
- ABER wenn Telefon im Text vorhanden UND bestehender Kunde hat andere Telefonnummer:
  → status = "moeglicher_treffer"
  → needs_review = true
  → warnung = "Telefonnummer weicht ab – bitte prüfen"
- Wenn Telefon fehlt: komplett ignorieren

4. Service-Matching:
- nur beste Übereinstimmung wählen
- wenn unsicher → service = null

5. estimated_quantity:
- nur wenn Zahl UND Einheit eindeutig zur hinterlegten Leistungseinheit passen
- Stundenleistungen: NUR Mengen aus "Stunde", "Stunden", "Std", "h" übernehmen
- Tagesleistungen: NUR Mengen aus "Tag", "Tage", "Arbeitstag", "Arbeitstage" übernehmen
- Meterleistungen: NUR Mengen aus "Meter", "m", "Laufmeter", "lfm" übernehmen
- Quadratmeterleistungen: NUR Mengen aus "Quadratmeter", "m²", "m2", "qm" übernehmen
- Kubikmeterleistungen: NUR Mengen aus "Kubikmeter", "m³", "m3", "cbm" übernehmen
- Stückleistungen: NUR Mengen aus "Stück", "stk", "Anzahl", "Einheiten" übernehmen
- Kilogrammleistungen: NUR Mengen aus "Kilogramm", "kg" übernehmen
- Tonnenleistungen: NUR Mengen aus "Tonne", "Tonnen", "t" übernehmen
- Literleistungen: NUR Mengen aus "Liter", "l" übernehmen
- Pauschalleistungen: estimated_quantity immer null oder 1
- Fläche / m² / qm NIEMALS als Stunden-, Tages-, Meter-, Stück- oder Pauschalmenge übernehmen
- Meter / Laufmeter NIEMALS als Stunden-, Tages-, Quadratmeter-, Stück- oder Pauschalmenge übernehmen
- Stunden / Tage NIEMALS als Meter-, Quadratmeter-, Kubikmeter-, Stück-, Liter-, Kilo-, Tonnen- oder Pauschalmenge übernehmen
- Gewicht / kg / Tonnen NIEMALS als Stunden-, Meter-, Quadratmeter-, Stück- oder Pauschalmenge übernehmen
- Volumen / Liter / Kubikmeter NIEMALS als Stunden-, Meter-, Quadratmeter-, Stück- oder Pauschalmenge übernehmen
- Wenn Zahl und Einheit nicht zur Leistungseinheit passen → estimated_quantity = null und needs_review = true
- wenn unsicher → estimated_quantity = null
- sonst null

6. needs_review = true bei:
- moeglicher_treffer
- konflikt
- fehlende Adresse
- kein Service erkannt
- Telefonnummer weicht ab (siehe Regel 3)

7. WARNLOGIK:
moeglicher_treffer → "Möglicher Kundentreffer – bitte prüfen"
konflikt → "Konflikt bei Kundenzuordnung – manuelle Prüfung erforderlich"
Telefon abweichend → "Telefonnummer weicht ab – bitte prüfen"
sonst → ""

8. confidence:
- gleicher_kunde → 0.9–1.0
- moeglicher_treffer → 0.5–0.8
- konflikt → 0.2–0.5
- kein_treffer → 0–0.3

9. PRIORITÄT:
- "hoch" bei Wörtern wie: "dringend", "sofort", "heute"
- sonst "normal"

9a. GEFAHREN / BESONDERHEITEN:
- auftrag.gefahren enthält NUR echte Sicherheitsrisiken oder Warnhinweise.
- auftrag.besonderheiten enthält normale Hinweise zur Ausführung / Organisation.
- Gefahren semantisch erkennen: Es geht um Bedeutung und Arbeitsrisiko, nicht um feste Wörter.
- Auch wenn der Kunde in Englisch, Französisch, Spanisch, Italienisch, Portugiesisch, Schweizerdeutsch oder gemischt schreibt, müssen gefahren und besonderheiten auf ${hauptsprache} ausgegeben werden.
- Beispiele für gefahren: freilaufender/ungesicherter/aggressiver Hund, offene Stromkabel, Rutschgefahr, Öl auf Boden, Schimmel/Asbest/Chemikalien, Absturzgefahr, instabiler Untergrund, Glasscherben, Brand-/Feuergefahr.
- Beispiele für besonderheiten: telefonischer Rückruf, Zugang über Seiteneingang, Parkplatz reserviert/schwierig, Schlüssel, fester Terminwunsch, Leiter benötigt, Zufahrt, Kunde nur vormittags erreichbar, Hund freundlich vor Ort.
- Kommunikationshinweise immer nach Absicht ausgeben, nicht nur zusammenfassen: Kanal verboten / bevorzugt / erlaubt plus Kontaktzeit. Ein verbotener Kanal darf nie als bevorzugter Kanal erscheinen.
- Verneinungen müssen am richtigen Bezug hängen: "nicht einfach kommen" / "nicht eintreten" / "nicht ohne Rücksprache" sind Zugangs-/Ablaufhinweise und dürfen niemals als WhatsApp-/SMS-Verbot interpretiert werden, wenn WhatsApp/SMS in derselben Zeile positiv genannt ist.
- Kontaktzeiten für Mail/SMS/WhatsApp/Telefon sind keine Ausführungstermine und dürfen keinen Terminchip erzeugen.
- Rückruf nur bei echter telefonischer Kontaktaufnahme ausgeben. "Klingeln und warten", "an der Tür melden", "Kunde ist vor Ort", "Schlüssel wird an der Tür übergeben" oder "nicht anrufen" sind KEIN Rückruf.
- Positive Arbeitserleichterungen als besonderheit aufnehmen, wenn sie wirklich planungsrelevant sind: Parkplatz reserviert/vorhanden, Schlüssel liegt bereit. Rein neutrale Hinweise wie "Zugang frei", "Tür offen", "Parkplatz kein Thema" oder "direkt halten möglich" nicht als wichtigen Außen-Hinweis erzwingen.
- Wichtig: "Leiter benötigt" allein ist besonderheit, NICHT gefahr. "Leiter eventuell benötigt" ist nur Innen-Hinweis und darf keinen festen Außen-Chip erzwingen.
- Wichtig: "Hund freundlich" ist besonderheit, NICHT gefahr. Nur freilaufend/ungesichert/aggressiv ist gefahr.
- Wichtig: "Öl auf dem Boden", "rutschiger Boden", "offene Kabel", "freilaufender Hund", "Asbestverdacht", "Schimmel", "Chemikalien" sind gefahren, auch wenn sie in anderer Sprache beschrieben werden.
- Verneinte/nicht relevante Hinweise NICHT ausgeben: kein Hund, kein Öl, keine Scherben, keine Leiter nötig, Termin flexibel, Parkplatz kein Thema, kein Anruf / nicht anrufen.
- Keine Doppelung: Eine Information darf entweder in gefahren ODER in besonderheiten stehen, nicht in beiden.
- Keine Leistung als Gefahr/Besonderheit ausgeben.
- Keine Gefahren oder Besonderheiten in beschreibung schreiben. Dort nur die Arbeit selbst.

10. NUR-BILD-NACHRICHTEN (WICHTIG):
Wenn KEIN Text und KEINE Sprachnachricht vorhanden ist (nur Bild(er)):
- beschreibung: NUR beschreiben, was auf dem Bild SICHTBAR ist
- NICHT den gewünschten Auftrag erraten oder erfinden
- NICHT schreiben: "soll geschnitten werden", "muss gepflegt werden", "gewünscht"
- STATTDESSEN vorsichtig formulieren:
  - "Das Bild zeigt eine Hecke entlang der Straße und eine Rasenfläche davor."
  - "Genauer Auftrag ist ohne zusätzlichen Text nicht eindeutig erkennbar."
  - "Sichtbar: Hecke, Rasen, Baumbestand."
- titel: beschreibend, NICHT handlungsorientiert (z.B. "Hecke / Garten" statt "Hecke schneiden")
- needs_review = true (immer bei Nur-Bild ohne Text)

11. ARBEITSPOSITIONEN:
- Extrahiere jede einzelne Arbeit als eigenen Eintrag in auftrag.arbeitspositionen.
- Jede Position enthält:
  {
    "name": "kurze Arbeitsbeschreibung",
    "action_name": "eigentliche Tätigkeit ohne Orts-/Kontextwörter oder null",
    "context": "Ort/Teilbereich dieser Arbeit oder null",
    "service_id": "id aus leistungen oder null",
    "service_name": "exakter Name aus leistungen oder null",
    "service_confidence": "hoch" | "mittel" | "niedrig",
    "menge": Zahl oder null,
    "einheit": "Quadratmeter" | "Kubikmeter" | "Meter" | "Stunde" | "Tag" | "Tonne" | "Kilogramm" | "Liter" | "Stück" | "Pauschal" | null,
    "unit_price": Zahl oder null,
    "currency": "CHF" | "EUR" | "USD" | "GBP" | andere erkannte Währung oder null,
    "raw": "Originalteil aus der Nachricht",
    "evidence": "exakte Textstelle, aus der Menge, Einheit, Preis und Währung dieser Position stammen",
    "confidence": "hoch" | "mittel" | "niedrig"
  }
- Jede Leistung braucht ihre eigene evidence/sourceText.
- Preis, Menge, Einheit und Währung dürfen NUR gesetzt werden, wenn sie in der evidence derselben Position stehen.
- Jede Arbeitsposition muss eine echte fachliche Tätigkeit oder Kostenposition sein. Reine Preis-/Rechenfragmente wie "à 6.50", "je 8.-", "mal 9", "CHF 35", "pro m2" sind NIEMALS eigene arbeitspositionen.
- service_name/name immer als sauberen deutschen Leistungsnamen ausgeben. Mundart, Französisch, Englisch oder Rohformulierungen nicht sichtbar speichern.
- Wenn die Kundenzeile in Mundart, Französisch, Englisch, Italienisch, Spanisch oder gemischt formuliert ist, übersetze die Bedeutung zuerst semantisch in professionelles Deutsch und speichere nur diese deutsche Form als name/action_name. Der Originalwortlaut bleibt ausschließlich in raw/evidence/sourceText.
- Sichtbare Leistungsnamen müssen eine echte Tätigkeit oder Kostenposition ausdrücken. Wenn eine Preiszeile nur Bereich + Objekt + Menge + Preis enthält, formuliere daraus eine einzige deutsche Leistung mit Objekt und Bereich, z. B. sinngemäß "Boden Gemeinschaftsraum reinigen" statt Rohsprache oder zwei Split-Positionen.
- Wenn du eine fremdsprachige/mundartliche Leistung nicht sicher auf Deutsch formulieren kannst, setze name/action_name lieber auf null und confidence = "niedrig", statt die Rohform sichtbar zu speichern.
- Zustand, Verschmutzungsgrad und Rechenwörter gehören nicht in den Leistungsnamen: "sehr dreckig", "stark verschmutzt", "mal", "je", "à", "pro" in besonderheiten/evidence lassen, aber aus name/action_name entfernen.
- Strukturwörter aus einer Arbeitsfassung wie "Fläche:", "Anzahl:", "Menge:", "Preis:" oder "Einheit:" sind Feldlabels für Menge/Einheit/Preis und dürfen niemals Teil von service_name/name/action_name werden.
- Eine Kundenzeile mit Objekt + Menge + Preis ergibt genau eine Position. Nicht zusätzlich den Preisanker oder einen Teil der Zeile als zweite Position ausgeben.

- Preis aus einer anderen Zeile/anderen Leistung NIEMALS übernehmen.
- Pauschalpreise dürfen NIEMALS auf andere Positionen kopiert werden. Wenn eine Zeile "Eingangsbereich pauschal 120" sagt, gilt 120 nur für diese eine Position.
- Rechnungsadresse/Billing address/Rechnung geht an ist NIE eine Arbeitsposition und darf keine generische Leistung wie "Reinigung" erzeugen.
- Fremdsprachige, mundartliche oder unprofessionell formulierte Leistungen semantisch auf deutsche professionelle Leistungsnamen übersetzen: "Nettoyage des vitres"/"Nettoyage des vitrines" = Fenster reinigen, "Nettoyage du sol du garage" = Garageboden reinigen, "Déplacement" = Anfahrt.
- Erkenne semantisch jede eigenständige Kostenposition für Weg/Fahrt/Einsatz beim Kunden als eigene Leistung "Anfahrt". Das gilt unabhängig von Sprache oder Formulierung. Speichere niemals die fremdsprachige Originalform als Leistungsnamen. Wenn der Kundentext dafür einen klaren Pauschalpreis nennt: name/action_name = "Anfahrt", einheit = "Pauschal", menge = 1, unit_price = Betrag, currency = erkannte Währung, evidence = exakte Preiszeile.
- Keine reine Wortlistenlogik: Entscheidend ist die Bedeutung der Kostenposition. Nicht als Anfahrt werten: Personen fahren irgendwohin, Tür öffnen, Parkplatz, Zugang, Bauleiter/Polier/Vorarbeiter oder normale Kontaktangaben ohne eigene Kostenposition.
- Bei handwerklichen Nebenleistungen bevorzugt professionelle "...arbeiten"-Namen verwenden, wenn fachlich passend: Spachteln → Spachtelarbeiten, Abdecken → Abdeckarbeiten, Schleifen → Schleifarbeiten.
- Nicht auf falsche Katalogleistung wie Kellerboden/Farbreste ausweichen.
- Wenn bei einer Position kein eigener Preis steht → unit_price = null.
- Wenn mehrere Preise/Währungen im Text stehen, jede Position separat zuordnen; bei Unsicherheit unit_price = null und confidence = "niedrig".
- Keine Leistungen erfinden.
- Interne Karten-/Auftragstitel, Betreff-/Überschriftszeilen und Zusammenfassungen sind keine Kundenleistung. Nutze sie höchstens als auftrag.titel, aber NIEMALS als eigene arbeitsposition, Preis-/Einheitsquelle, Adresse oder Besonderheit. Entscheide semantisch: Eine Arbeitsposition braucht echte Arbeitsaussage plus eigene Evidence aus dem Kundentext.
- Nicht versuchen, unbekannte Arbeiten einer bestehenden Leistung zuzuordnen.
- Wenn mehrere Arbeiten genannt werden, jede Arbeit separat ausgeben.
- Aber eine einzige Preis-/Mengenzeile mit nur einer Menge und nur einem Preis ist keine Mehrfacharbeit, nur weil sie aus Bereich + Objekt besteht.
- Klassifiziere semantisch: In einer Zeile können Orts-/Bereichswörter und Arbeitsobjekt zusammenstehen. Das ist trotzdem eine einzige Arbeitsposition, wenn nur ein Mengen-/Preisblock vorhanden ist. Beispielprinzip: "Raum/Bereich + Objekt + Menge + Preis" darf nicht in "Raum reinigen" plus "Objekt reinigen" zerlegt werden.
- Keine Doppelpositionen aus derselben evidence: Wenn zwei Arbeitspositionen dieselbe raw/evidence-Zeile und denselben Preis-/Mengen-/Währungsbeleg hätten, ist eine davon nur Kontext oder Zusammenfassung und muss entfallen.
- Wenn eine zweite Position nur aus einem Ort, Raum, Bereich, Stockwerk, Gebäude-Teil oder Titel der gleichen Zeile besteht, ist sie keine eigene Leistung. Die echte Leistung ist die semantische Arbeit aus dieser Zeile.
- Zweiter-Prüfer-Regel: Menge, Einheit, Preis und Währung müssen aus derselben Leistungszeile oder einem eindeutig verbundenen Satz stammen. Zahlen aus PLZ, Hausnummer, Telefonnummer, Uhrzeit, Adresse oder vorheriger/nächster Leistungszeile dürfen nie auf eine andere Leistung übertragen werden.
- Einheit und Menge gehören nur zu der Position, in deren Text sie stehen.

12. AUSFÜHRUNGSADRESSE / ARBEITSORT:
- Erkenne semantisch, ob neben der Rechnungsadresse ein anderer Ort genannt wird, an dem gearbeitet wird.
- Entscheidend ist ausschließlich die Rolle der Adresse im Text: Wer bezahlt die Rechnung ≠ wo wird gearbeitet.
- Arbeite nicht über feste Stichwortlisten. Verstehe den Satzinhalt, auch wenn der Text kurz, falsch geschrieben, mundartlich, gemischtsprachig oder unordentlich ist.
- Wenn zwei unterschiedliche Adressblöcke vorhanden sind, trenne sie nach Rolle:
  kunde/Rechnung = zahlende Stelle;
  ausfuehrungsadresse = Ort der Arbeit/Baustelle/Objekt/Wohnung/Lager/Büro.
- Wenn eindeutig anderer Arbeitsort vorhanden UND Strasse + PLZ + Ort dieses Arbeitsorts im Eingangstext vorhanden sind:
  auftrag.ausfuehrungsadresse.ist_abweichend = true
  name/strasse/plz/ort befüllen
  confidence = "hoch" oder "mittel"
  evidence = exakte Textstelle, die den Arbeitsort enthält
- Wenn die Rolle der Adresse unsicher ist, wenn Strasse/PLZ/Ort fehlen oder wenn du nur aus dem Titel/Leistungstext raten müsstest:
  ist_abweichend = false
  keine Ausführungsadresse speichern
  in besonderheiten kurz "Ausführungsadresse prüfen" aufnehmen.
- Keine Leistungsbeschreibung, Preise, Hinweise oder Sätze wie "Bitte reinigen..." in die Adresse schreiben.
- Auftrags-/Karten-Titel wie "[Titel: ...]" sind nur Titel und dürfen NIEMALS als name der Ausführungsadresse gespeichert werden.
- name der Ausführungsadresse darf nur ein echter Objekt-/Ortsname sein, z.B. "Garage West", "Wohnung 3", "Lagerhalle Süd".
- name der Ausführungsadresse NIEMALS mit Leistungs-/Preiszeilen oder Leistungszusammenfassungen füllen, z.B. NICHT "Anfahrt CHF 45", NICHT "10 Fenster reinigen CHF 7 pro Stück", NICHT "Fenster reinigen und Anfahrt".`;
}

// ---------- Main intake function ----------
export async function processIncomingMessage(
  input: IntakeInput,
): Promise<IntakeResult | null> {
  const {
    source,
    senderName,
    messageText,
    imageBase64,
    imageMimeType,
    savedMediaPath,
    savedMediaType,
    optimizedPreviewPath,
    optimizedThumbnailPath,
    userId: inputUserId,
    allImageBase64s,
    allImageMimeTypes,
    allSavedMediaPaths,
    allOptimizedPreviewPaths,
    allOptimizedThumbnailPaths,
    audioDurationSec: inputAudioDurationSec,
    audioTranscriptionStatus: inputAudioTranscriptionStatus,
    additionalReviewReasons,
    reviewNote,
    forceReview,
  } = input;

  // Resolve userId: use provided userId ONLY. No fallbacks!
  // Webhooks must resolve userId via phone number BEFORE calling this function.
  const userId = inputUserId || null;
  if (!userId) {
    console.error(
      `[${source}] ❌ No userId provided — cannot process message. Webhook must resolve userId by phone number.`,
    );
    logAuditAsync({
      action: `ORDER_CREATE_FROM_${source.toUpperCase()}_FAILED`,
      area: "WEBHOOK",
      success: false,
      details: { reason: "no_userId", sender: senderName },
    });
    return null;
  }
  const _intakeStartTime = Date.now();
  console.log(
    `[${source}] Processing message for userId: ${userId} (textLength=${messageText.length}chars, hasImage=${!!imageBase64}, hasMedia=${!!savedMediaPath})`,
  );

  const userFilter = userId ? { userId } : {};

  // Load services
  const services = await prisma.service.findMany({ where: userFilter });
  const serviceListJson = JSON.stringify(
    services.map((s: any) => ({
      id: s.id,
      name: s.name,
      einheit: s.unit,
      standard_preis: Number(s.defaultPrice),
    })),
  );

  // Load customers for matching (max 200).
  // Phase 2b: ONLY expose {id, name} to the LLM — never address/phone/email.
  // Rationale: the LLM previously copied address fields from a candidate's
  // master record into its own `kunde.*` output on name-only hits, which the
  // create-path then persisted into a *new* customer (silent partial-inheritance bug).
  // The authoritative customer match runs server-side in verifyCustomerMatch
  // (reads address/phone/email straight from the DB), so the LLM does not need
  // that information to decide "gleicher_kunde" / "moeglicher_treffer".
  const allCustomers = await prisma.customer.findMany({
    where: { deletedAt: null, ...userFilter },
    select: { id: true, name: true },
    orderBy: { updatedAt: "desc" },
    take: 200,
  });
  const customerListJson = JSON.stringify(
    allCustomers.map((c: any) => ({ id: c.id, name: c.name })),
  );

  // Fetch branche + hauptsprache from company settings
  const companySettings = userId
    ? await prisma.companySettings.findFirst({ where: { userId } })
    : await prisma.companySettings.findFirst();
  const branche = companySettings?.branche || "Gartenbau";
  const detectedCurrency = detectCurrencyFromText(messageText);

  const intakeCurrency =
    detectedCurrency || (companySettings?.currency === "EUR" ? "EUR" : "CHF");
  const hauptsprache = (companySettings as any)?.hauptsprache || "Deutsch";

  // V17.46 SEMANTIC_NORMALIZATION_BEFORE_MAIN_LLM:
  // Fremdsprache/Dialekt darf gar nicht erst als sichtbarer Leistungsname,
  // Ausführungsort oder Hinweis in die Haupt-KI laufen. Die Normalisierung
  // bleibt beweisführend getrennt: Originaltext für Zahlen/Preise,
  // Arbeitsfassung für professionelle deutsche Namen und Rollen.
  const intakeNormalization = await createStandardGermanValidationTranslation({
    text: messageText,
    targetLanguage: hauptsprache,
    source,
  });
  const translationText = intakeNormalization.translationText;
  const showTranslationInCustomerMessage =
    intakeNormalization.showTranslationInCustomerMessage;

  // Resolve default VAT rate from CompanySettings.
  // If MwSt is active and a rate is configured → use that rate.
  // If MwSt is explicitly disabled → 0.
  // Otherwise fall back to schema default (8.1) for backwards compatibility.
  const intakeVatRate: number =
    companySettings?.mwstAktiv === true && companySettings?.mwstSatz != null
      ? Number(companySettings.mwstSatz)
      : companySettings?.mwstAktiv === false
        ? 0
        : 8.1;

  // Build prompt
  const systemPrompt = buildSystemPrompt(
    serviceListJson,
    customerListJson,
    senderName,
    branche,
    hauptsprache,
  );

  // Build user content (supports multi-image)
  const hasMultipleImages = allImageBase64s && allImageBase64s.length > 0;
  const hasAnyImage = hasMultipleImages || !!imageBase64;
  const userContent: any[] = [];
  const isImageOnly =
    !messageText.trim() && (hasMultipleImages || !!imageBase64);
  if (messageText.trim()) {
    const normalizedMessageForAi = translationText
      ? [
          `Nachricht Original:\n"${messageText}"`,
          `--- Semantisch normalisierte Arbeitsfassung (${hauptsprache}) ---\n${translationText}`,
          `Pflicht: Originaltext bleibt maßgeblich für Zahlen, Preise, Währungen, Codes und Strasse/PLZ/Ort. Die Arbeitsfassung ist maßgeblich für sichtbare professionelle ${hauptsprache}-Leistungsnamen und Hinweise. Für Ausführungsort-Namen gilt: echte Eigennamen, Gebäudenamen, Straßennamen, Haus-/Trakt-/Raumnamen und Standortnamen exakt behalten; nur beschreibende Funktions-/Raumbegriffe normalisieren, wenn sie eindeutig keine Eigennamen sind. Speichere niemals Rohsprache/Dialekt als serviceName/name/action_name, wenn die Arbeitsfassung eine saubere ${hauptsprache}-Form liefert. Arbeitsobjekte nicht verflachen: Fenster/Tische/Vitrinen im Raum bleiben Fenster/Tische/Vitrinen, nicht nur der Raum.`,
        ].join("\n\n")
      : `Nachricht:\n"${messageText}"`;

    userContent.push({ type: "text", text: normalizedMessageForAi });
  }
  if (hasMultipleImages) {
    if (isImageOnly) {
      userContent.push({
        type: "text",
        text: `Der Kunde hat ${allImageBase64s.length} Bilder geschickt, aber KEINEN Text dazu. Beschreibe NUR was sichtbar ist. Erfinde KEINEN Auftrag. Setze needs_review=true.`,
      });
    } else {
      userContent.push({
        type: "text",
        text: `Der Kunde hat ${allImageBase64s.length} Bilder zusammen mit der Nachricht geschickt. Es handelt sich um EINEN Auftrag:`,
      });
    }
    for (let imgIdx = 0; imgIdx < allImageBase64s.length; imgIdx++) {
      userContent.push({
        type: "image_url",
        image_url: {
          url: `data:${allImageMimeTypes?.[imgIdx] || "image/jpeg"};base64,${allImageBase64s[imgIdx]}`,
        },
      });
    }
  } else if (imageBase64) {
    if (isImageOnly) {
      userContent.push({
        type: "text",
        text: "Der Kunde hat NUR dieses Bild geschickt, OHNE Text. Beschreibe NUR was sichtbar ist. Erfinde KEINEN konkreten Auftrag. Setze needs_review=true.",
      });
    } else {
      userContent.push({
        type: "text",
        text: "Der Kunde hat auch dieses Bild geschickt:",
      });
    }
    userContent.push({
      type: "image_url",
      image_url: {
        url: `data:${imageMimeType || "image/jpeg"};base64,${imageBase64}`,
      },
    });
  }
  if (userContent.length === 0) {
    console.log(`[${source}] No content to analyze, skipping`);
    return null;
  }

  // Call LLM
  // If the LLM fails (credits exhausted, HTTP error, network/timeout, empty or
  // unparseable response), we fall back to creating a manual-review order so
  // no WhatsApp message gets silently dropped. See createFallbackOrderFromRawPayload.
  const _llmStartTime = Date.now();
  console.log(
    `[${source}] 🤖 Starting LLM analysis (model=${hasAnyImage ? "gpt-4.1" : "gpt-4.1-mini"}, systemPrompt=${systemPrompt.length}chars, userContent=${JSON.stringify(userContent).length}chars)`,
  );
  let llmResponse: Response;
  try {
    llmResponse = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: hasAnyImage ? "gpt-4.1" : "gpt-4.1-mini",
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content:
              userContent.length === 1 && !hasAnyImage
                ? userContent[0].text
                : userContent,
          },
        ],
        response_format: { type: "json_object" },
        max_tokens: 2600,
      }),
    });
  } catch (netErr: any) {
    console.error(
      `[${source}] LLM network/timeout error:`,
      netErr?.message || netErr,
    );
    logAuditAsync({
      userId,
      action: `ORDER_CREATE_FROM_${source.toUpperCase()}_FAILED`,
      area: "WEBHOOK",
      success: false,
      details: {
        reason: "llm_network_error",
        sender: senderName,
        error: netErr?.message || String(netErr),
      },
    });
    return await createFallbackOrderFromRawPayload(input, "llm_network_error");
  }

  if (!llmResponse.ok) {
    const errText = await llmResponse.text().catch(() => "");
    console.error(`[${source}] LLM API error:`, errText);
    logAuditAsync({
      userId,
      action: `ORDER_CREATE_FROM_${source.toUpperCase()}_FAILED`,
      area: "WEBHOOK",
      success: false,
      details: {
        reason: "llm_api_error",
        sender: senderName,
        httpStatus: llmResponse.status,
      },
    });
    return await createFallbackOrderFromRawPayload(input, "llm_api_error");
  }

  let llmResult: any;
  try {
    llmResult = await llmResponse.json();
  } catch (jsonErr: any) {
    console.error(
      `[${source}] LLM response JSON parse error:`,
      jsonErr?.message || jsonErr,
    );
    logAuditAsync({
      userId,
      action: `ORDER_CREATE_FROM_${source.toUpperCase()}_FAILED`,
      area: "WEBHOOK",
      success: false,
      details: { reason: "llm_response_parse_error", sender: senderName },
    });
    return await createFallbackOrderFromRawPayload(
      input,
      "llm_response_parse_error",
    );
  }
  console.log(
    `[${source}] 🤖 LLM analysis completed in ${Date.now() - _llmStartTime}ms`,
  );
  const content = llmResult?.choices?.[0]?.message?.content;
  if (!content) {
    console.error(`[${source}] LLM returned empty content`);
    logAuditAsync({
      userId,
      action: `ORDER_CREATE_FROM_${source.toUpperCase()}_FAILED`,
      area: "WEBHOOK",
      success: false,
      details: { reason: "llm_empty_response", sender: senderName },
    });
    return await createFallbackOrderFromRawPayload(input, "llm_empty_response");
  }

  let parsed: any;
  try {
    parsed = JSON.parse(content);
  } catch {
    console.error(
      `[${source}] Failed to parse LLM response:`,
      content?.slice(0, 500),
    );
    logAuditAsync({
      userId,
      action: `ORDER_CREATE_FROM_${source.toUpperCase()}_FAILED`,
      area: "WEBHOOK",
      success: false,
      details: { reason: "llm_parse_error", sender: senderName },
    });
    return await createFallbackOrderFromRawPayload(input, "llm_parse_error");
  }

  console.log(
    `[${source}] KI-Analyse:`,
    JSON.stringify({
      kunde: parsed.kunde?.name,
      titel: parsed.auftrag?.titel,
      service: parsed.service?.service_name,
      abgleich_status: parsed.kundenabgleich?.status,
      confidence: parsed.kundenabgleich?.confidence,
      treffer_id: parsed.kundenabgleich?.bestehende_kunden_id,
      prioritaet: parsed.system?.prioritaet,
      needs_review: parsed.system?.needs_review,
    }),
  );

  // --- Customer resolution based on kundenabgleich.status ---
  const abgleich = parsed.kundenabgleich || {};
  let abgleichStatus = abgleich.status || "kein_treffer";
  const matchId = abgleich.bestehende_kunden_id || "";

  // Ensure address is split properly
  const kundeData = parsed.kunde || {};

  // V16.9: Telefonnummern aus "Kontakt vor Ort" dürfen nicht als normale
  // Kundentelefonnummer gespeichert oder für Matching verwendet werden.
  // Beispiel:
  // Kontakt vor Ort:
  // Hauswart Meier
  // Tel. 079 123 45 67
  // => bleibt als Hinweis erhalten, wird aber nicht zur Rechnungsadresse.
  const onsiteContactHint = extractOnsiteContactHint(
    messageText,
    kundeData.telefon || null,
  );
  if (onsiteContactHint.phoneBelongsToSiteContact) {
    console.log(
      `[${source}] 🛡️ onsite contact phone removed from customer data: ${maskPhoneForLog(kundeData.telefon || null)}`,
    );
    kundeData.telefon = null;
  }

  // Block R — Safety-Net: Wenn die LLM keinen Namen extrahiert hat, aber der
  // Text eine eindeutige Selbstvorstellung enthält ("mein Name ist Aida",
  // "Ich heisse X", "Ich bin X" etc.), den Namen aus dem Text übernehmen.
  // Greift NUR bei leerem LLM-Namen — überschreibt NIE eine LLM-Extraktion.
  // Bug-Hintergrund: Wenn der WhatsApp-ProfileName mit dem Endkunden-Namen
  // identisch ist (z.B. Solo-Selbständige testen mit eigener Nummer), unterdrückt
  // die Prompt-Regel "Absender = Kunde A, NICHT Endkunde" die Namens-Extraktion.
  const llmExtractedName = (kundeData.name || "").trim();

  const invalidStandaloneCities = new Set([
    "form",
    "reinigen",
    "schneiden",
    "pflegen",
    "entsorgen",
    "ausraeumen",
    "ausräumen",
    "maehen",
    "mähen",
    "streichen",
    "bauen",
    "montieren",
  ]);

  const normalizedOrtCandidate = normalizeUnitText(kundeData.ort || "");

  const hasStrongCustomerData =
    !!String(kundeData.name || "").trim() ||
    !!String(kundeData.strasse || "").trim() ||
    !!String(kundeData.hausnummer || "").trim() ||
    !!String(kundeData.plz || "").trim();

  if (
    normalizedOrtCandidate &&
    invalidStandaloneCities.has(normalizedOrtCandidate) &&
    !hasStrongCustomerData
  ) {
    console.log(
      `[${source}] 🚫 Removed invalid AI city extraction: "${kundeData.ort}"`,
    );
    kundeData.ort = null;
  }

  let selfIntroFallbackUsed = false;
  if (!llmExtractedName) {
    const selfIntroName = extractSelfIntroductionName(messageText);
    if (selfIntroName) {
      kundeData.name = selfIntroName;
      selfIntroFallbackUsed = true;
      console.log(
        `[${source}] 🪪 Selbstvorstellungs-Safety-Net griff: kunde.name='${selfIntroName}' (LLM hatte leer/null geliefert)`,
      );
    }
  }

  // V16.39: no name rescue from raw wording. The AI must sort the billing
  // customer into structured fields; if it does not, the customer stays empty
  // and the order remains review-required.
  if (!String(kundeData.name || "").trim()) {
    kundeData.name = null;
  }

  const customerGuardReviewReasons: string[] = [];
  const legacyBillingFallbackEnabled =
    process.env.INTAKE_LEGACY_BILLING_FALLBACK === "1";
  const rawBillingEvidence = legacyBillingFallbackEnabled
    ? extractDeterministicBillingEvidence(messageText)
    : null;
  const billingEvidence = supplementAiBillingEvidence(
    extractAiStructuredBillingEvidence(kundeData, messageText),
    rawBillingEvidence,
  );
  const customerGuard = applySafeBillingCustomerGuard({
    kundeData,
    evidence: billingEvidence,
    allowSelfIntroName: selfIntroFallbackUsed,
  });
  if (customerGuard.changed) {
    console.log(
      `[${source}] 🛡️ Billing customer guard normalized customer data (source=${billingEvidence.source}, reliable=${billingEvidence.hasReliableCustomerBlock})`,
    );
  }
  if (customerGuard.reviewReason) {
    customerGuardReviewReasons.push(customerGuard.reviewReason);
    parsed.system = parsed.system || {};
    parsed.system.needs_review = true;
  }

  function looksLikeWeakCityOnlyFromWorkText(
    kundeData: any,
    text: string,
  ): boolean {
    const cityNorm = normalizeUnitText(kundeData?.ort);
    const textNorm = normalizeUnitText(text);

    if (!cityNorm || !textNorm) return false;

    const hasName = !!String(kundeData?.name || "").trim();
    const hasStreet = !!String(kundeData?.strasse || "").trim();
    const hasHouseNumber = !!String(kundeData?.hausnummer || "").trim();
    const hasPlz = !!String(kundeData?.plz || "").trim();

    // Wenn echte Kundendaten vorhanden sind, Ort nicht blocken.
    if (hasName || hasStreet || hasHouseNumber || hasPlz) return false;

    const cityInText = new RegExp(`\\bin\\s+${cityNorm}\\b`, "i").test(
      textNorm,
    );

    // Ohne weitere Kundendaten ist "in X" zu unsicher:
    // kann Ort sein, kann aber auch Teil der Arbeit sein.
    return cityInText;
  }

  if (looksLikeWeakCityOnlyFromWorkText(kundeData, messageText)) {
    kundeData.ort = null;
  }

  const addr = ensureAddressSplit({
    customerStreet: kundeData.strasse
      ? `${kundeData.strasse}${kundeData.hausnummer ? " " + kundeData.hausnummer : ""}`
      : null,
    customerPlz: kundeData.plz,
    customerCity: kundeData.ort,
  });

  if (
    normalizeUnitText(addr.city) === "form" &&
    /in\s+form\s+(bringen|schneiden|setzen|machen|pflegen)/i.test(
      normalizeUnitText(messageText),
    )
  ) {
    console.log(
      `[${source}] 🚫 Removed invalid addr.city from work phrase: "${addr.city}"`,
    );
    addr.city = null;
  }

  let customerId: string | null = null;
  let duplicateWarning = "";
  let customerWasNewlyCreated = false;

  // ═══ SERVER-SIDE CUSTOMER MATCHING (v2 — hardened) ═══
  // Uses centralized verifyCustomerMatch from lib/customer-matching.ts.
  // The LLM output is NEVER trusted for auto-assignment decisions.
  // Only phone or email matches allow auto-assignment.
  // Name + address requires confirmation (not auto-assign).
  // All other signals are review/suggestion only.

  if (abgleichStatus === "gleicher_kunde" && matchId) {
    const matchResult = await verifyCustomerMatch(matchId, {
      phone: kundeData.telefon || null,
      email: kundeData.email || null,
      street: addr.street,
      plz: addr.plz,
      city: addr.city,
      name: kundeData.name,
    });

    if (matchResult.verdict === "auto_assign") {
      // ✅ Strong unique signal verified (phone or email) → safe to auto-assign
      customerId = matchId;
      const matchedCust = await prisma.customer.findUnique({
        where: { id: matchId },
        select: { address: true, plz: true, city: true },
      });
      if (
        !matchedCust?.address?.trim() ||
        !matchedCust?.plz?.trim() ||
        !matchedCust?.city?.trim()
      ) {
        parsed.system = parsed.system || {};
        parsed.system.needs_review = true;
        console.log(
          `[${source}] ✅ AUTO-ASSIGN VERIFIED (${matchResult.reason}, conf ${abgleich.confidence}) but address incomplete → needsReview=true`,
        );
      } else {
        console.log(
          `[${source}] ✅ AUTO-ASSIGN VERIFIED (${matchResult.reason}, conf ${abgleich.confidence}) → auto-assign to ${matchId}`,
        );
      }
    } else if (matchResult.verdict === "bestaetigungs_treffer") {
      // 🟡 Name + address match but no unique identifier → needs manual confirmation
      abgleichStatus = "bestaetigungs_treffer";
      duplicateWarning = `⚠️ Name und Adresse stimmen überein, aber kein eindeutiges Signal (Telefon/E-Mail). Manuelle Bestätigung erforderlich.`;
      parsed.system = parsed.system || {};
      parsed.system.needs_review = true;
      console.log(
        `[${source}] 🟡 CONFIRMATION REQUIRED (${matchResult.reason}) → bestaetigungs_treffer for ${matchId}`,
      );
    } else {
      // 🛡️ No strong signal → downgrade to moeglicher_treffer, NEVER auto-assign
      abgleichStatus = "moeglicher_treffer";
      const unterschiede = (abgleich.unterschiede || []).join(", ");
      duplicateWarning = `⚠️ KI-Treffer herabgestuft: Kein starkes Signal (${matchResult.reason}). Manuelle Prüfung erforderlich.${unterschiede ? ` (${unterschiede})` : ""}`;
      parsed.system = parsed.system || {};
      parsed.system.needs_review = true;
      console.log(
        `[${source}] 🛡️ DOWNGRADED → moeglicher_treffer (reason: ${matchResult.reason}, no strong signal for ${matchId})`,
      );
    }
  } else if (abgleichStatus === "gleicher_kunde" && !matchId) {
    console.log(`[${source}] ⚠ gleicher_kunde but no matchId, creating new`);
  } else if (abgleichStatus === "moeglicher_treffer") {
    const unterschiede = (abgleich.unterschiede || []).join(", ");
    duplicateWarning = `⚠️ ${abgleich.warnung || "Möglicher Kundentreffer – bitte prüfen"}${unterschiede ? ` (${unterschiede})` : ""}. Confidence: ${abgleich.confidence}`;
    parsed.system = parsed.system || {};
    parsed.system.needs_review = true;
    console.log(
      `[${source}] ⚠ moeglicher_treffer (confidence ${abgleich.confidence}) → new customer + warning`,
    );
  } else if (abgleichStatus === "konflikt") {
    duplicateWarning = `🚨 ${abgleich.warnung || "Konflikt bei Kundenzuordnung – manuelle Prüfung erforderlich"}. Confidence: ${abgleich.confidence}`;
    parsed.system = parsed.system || {};
    parsed.system.needs_review = true;
    console.log(`[${source}] 🚨 konflikt → new customer + strong warning`);
  } else {
    console.log(`[${source}] ➕ kein_treffer → creating new customer`);
  }

  // ═══ PHASE 2c: EXACT DETERMINISTIC REUSE (before creating a new customer) ═══
  // Only if no customerId was assigned by strong-signal matching (phone/email),
  // AND the incoming record is fully addressed (name + street + plz + city),
  // AND exactly one active candidate under this user matches strictly, AND
  // there is no phone/email conflict — reuse that candidate.
  //
  // This is NOT a merge: no second record exists yet. We simply skip the
  // would-be duplicate create. For every other case (0 hits, >1 hits, any
  // conflict, archived candidate, incomplete incoming) fall through to the
  // existing create-new-customer path unchanged.
  // Phase 2d: accumulate tags for reviewReasons to surface in the UI banner.
  const autoReuseTags: string[] = [];
  if (!customerId) {
    const exact = await findExactDeterministicMatch(prisma, userId ?? null, {
      name: kundeData.name || null,
      street: addr.street,
      plz: addr.plz,
      city: addr.city,
      phone: kundeData.telefon || null,
      email: kundeData.email || null,
    });
    if (exact.match) {
      customerId = exact.match.id;
      autoReuseTags.push(`AUTO_REUSED:${exact.match.customerNumber}`);
      console.log(
        `[${source}] 🎯 EXACT REUSE → binding to existing ${exact.match.customerNumber} (${exact.match.id})`,
      );
      logAuditAsync({
        userId,
        action: "CUSTOMER_REUSE_EXACT",
        area: "CUSTOMERS",
        targetType: "Customer",
        targetId: exact.match.id,
        success: true,
        details: {
          source,
          matchedOn: ["name", "street", "plz", "city"],
          candidateCustomerNumber: exact.match.customerNumber,
        },
      });
      // Improve-only update: the existing `else` branch below
      // (`// Update existing customer with new data - only if it IMPROVES...`)
      // already runs protectCustomerData(existing, incoming) for any non-null
      // customerId — so we do nothing extra here and let that canonical path
      // handle address/plz/city fill-in.
    } else if (
      exact.reason !== "incomplete_incoming" &&
      exact.reason !== "no_candidate"
    ) {
      // Useful trace for the other guarded cases (multi-match / conflict):
      console.log(
        `[${source}] exact-reuse skipped (${exact.reason}, count=${exact.candidateCount}) → normal create/duplicate path`,
      );
    }
  }

  // ═══ PHASE 2d: NEAR-EXACT DETERMINISTIC REUSE (strict) ═══
  // Triggers ONLY when: name+street exact, EXACTLY ONE of {plz, city} missing
  // on incoming, candidate has that field filled, exactly 1 active candidate,
  // no phone/email conflict. Completion is implicit (order binds to candidate
  // which already has the field). Never weakens exact-match. See spec in
  // lib/exact-customer-match.ts for full rules.
  if (!customerId) {
    const nearExact = await findNearExactDeterministicMatch(
      prisma,
      userId ?? null,
      {
        name: kundeData.name || null,
        street: addr.street,
        plz: addr.plz,
        city: addr.city,
        phone: kundeData.telefon || null,
        email: kundeData.email || null,
      },
    );
    if (nearExact.match && nearExact.completedField) {
      customerId = nearExact.match.id;
      autoReuseTags.push(
        `AUTO_REUSED_NEAR_EXACT:${nearExact.match.customerNumber}:${nearExact.completedField}_completed`,
      );
      console.log(
        `[${source}] 🎯 NEAR-EXACT REUSE → binding to existing ${nearExact.match.customerNumber} (${nearExact.match.id}), completed=${nearExact.completedField}`,
      );
      logAuditAsync({
        userId,
        action: "CUSTOMER_REUSE_NEAR_EXACT",
        area: "CUSTOMERS",
        targetType: "Customer",
        targetId: nearExact.match.id,
        success: true,
        details: {
          source,
          matchedOn: [
            "name",
            "street",
            nearExact.completedField === "plz" ? "city" : "plz",
          ],
          completedField: nearExact.completedField,
          completedValue: nearExact.completedValue,
          candidateCustomerNumber: nearExact.match.customerNumber,
        },
      });
    } else if (
      nearExact.reason !== "not_applicable" &&
      nearExact.reason !== "incomplete_incoming" &&
      nearExact.reason !== "no_candidate"
    ) {
      console.log(
        `[${source}] near-exact-reuse skipped (${nearExact.reason}, count=${nearExact.candidateCount}) → normal create/duplicate path`,
      );
    }
  }

  // Create new customer if not auto-assigned
  if (!customerId) {
    // ═══ DEFENSE-IN-DEPTH: only persist master data fields that are
    // demonstrably present in the raw incoming message (text + audio transcript).
    // This blocks silent partial inheritance of city/ZIP/street/phone/email from
    // any existing customer record, even if a future LLM/model regression tries
    // to copy fields from the `bestehende_kunden` prompt list into `kunde.*`.
    // Applies to the CREATE path only — improve-existing (auto_assign) goes
    // through protectCustomerData and is unchanged.
    // messageText already contains the audio transcript (transcription happens
    // in the webhook before processIncomingMessage is called). For image-only
    // messages messageText is empty → sanitize drops every auto-derived field.
    // Note: phone/email are NOT auto-persisted from webhook intake today
    // (historical conservative default). We still run them through the sanitizer
    // to keep the audit trail accurate about what the LLM tried to set.
    const sanitized = sanitizeNewCustomerFields({
      rawText: messageText,
      street: addr.street,
      plz: addr.plz,
      city: addr.city,
      phone: kundeData.telefon || null,
      email: kundeData.email || null,
    });
    if (sanitized.dropped.length > 0) {
      console.log(
        `[${source}] 🛡️ intake-sanitize dropped unverified fields on new-customer create: ${sanitized.dropped.join(", ")}`,
      );
    }

    // V16.20: Final create-path guard.
    // If the parser did not find a reliable billing/customer block, never let
    // sanitizeNewCustomerFields re-persist execution-site data from rawText as
    // customer master data. This specifically protects messages like:
    // "Arbeitsort: Objekt Alpha ... Kontakt vor Ort: Herr Frei ..."
    // where the customer should remain empty + needsReview.
    const hasPersistableCustomerName = Boolean(
      cleanAiStructuredBillingName(kundeData.name || null),
    );

    const namelessBillingEvidence =
      !hasPersistableCustomerName &&
      billingEvidence.hasReliableCustomerBlock &&
      !billingEvidence.name
        ? billingEvidence
        : null;

    const hasNamelessBillingAddress = Boolean(
      namelessBillingEvidence &&
      (namelessBillingEvidence.street ||
        namelessBillingEvidence.plz ||
        namelessBillingEvidence.city ||
        namelessBillingEvidence.phone ||
        namelessBillingEvidence.email),
    );

    const hasReliableBillingForCreate =
      billingEvidence.hasReliableCustomerBlock ||
      Boolean(namelessBillingEvidence);

    const keepNewCustomerMasterEmpty =
      !hasReliableBillingForCreate ||
      (!hasPersistableCustomerName && !hasNamelessBillingAddress);

    const safeNewCustomerFields = keepNewCustomerMasterEmpty
      ? {
          ...sanitized,
          street: null,
          plz: null,
          city: null,
          phone: null,
          email: null,
        }
      : {
          ...sanitized,
          // AI-first: persist only structured billing fields that survived the
          // customer guard. The raw WhatsApp wording no longer decides the role.
          street: billingEvidence.street ?? sanitized.street,
          plz: billingEvidence.plz ?? sanitized.plz,
          city: billingEvidence.city ?? sanitized.city,
          phone: billingEvidence.phone ?? sanitized.phone,
          email: billingEvidence.email ?? sanitized.email,
        };

    const safeNewCustomerName = hasPersistableCustomerName
      ? cleanAiStructuredBillingName(kundeData.name || null) || ""
      : "";

    if (keepNewCustomerMasterEmpty) {
      console.log(
        `[${source}] 🛡️ missing safe billing customer name/block → new customer master name/address/phone/email kept empty`,
      );
      parsed.system = parsed.system || {};
      parsed.system.needs_review = true;
      if (
        !customerGuardReviewReasons.includes(
          "customer_data_uncertain_no_billing_block",
        )
      ) {
        customerGuardReviewReasons.push(
          "customer_data_uncertain_no_billing_block",
        );
      }
    } else if (hasNamelessBillingAddress) {
      console.log(
        `[${source}] 🛡️ labeled billing address without name → persisted partial customer data with needsReview=true`,
      );
      parsed.system = parsed.system || {};
      parsed.system.needs_review = true;
      if (
        !customerGuardReviewReasons.includes(
          "customer_name_missing_billing_address_present",
        )
      ) {
        customerGuardReviewReasons.push(
          "customer_name_missing_billing_address_present",
        );
      }
    }

    const { generateCustomerNumber } = await import("@/lib/customer-number");
    const customerNumber = await generateCustomerNumber();
    const customer = await prisma.customer.create({
      data: {
        customerNumber,
        name: safeNewCustomerName,
        // New customer master data is stored only after the AI-structured billing
        // evidence passed the customer guard. Execution-site data must never be
        // copied into the billing customer card.
        phone: safeNewCustomerFields.phone,
        email: safeNewCustomerFields.email,
        address: safeNewCustomerFields.street,
        plz: safeNewCustomerFields.plz,
        city:
          normalizeUnitText(safeNewCustomerFields.city) === "form"
            ? null
            : safeNewCustomerFields.city,
        notes: `${source}-Kunde`,
        ...(userId ? { userId } : {}),
      },
    });

    // V16.39: No post-create raw-text rescue. Customer master fields were already
    // decided by the AI-structured billing evidence above.

    customerId = customer.id;
    customerWasNewlyCreated = true;
  } else {
    // V16.18: Existing customer master data is not changed by webhook/AI intake.
    // Corrections must happen manually via customer edit or customer merge.
    // The order can still bind to a verified customerId, but address/phone/email
    // fields on the customer record remain untouched.
    console.log(
      `[${source}] Customer ${customerId} reused; master data left unchanged by intake`,
    );
  }

  // --- Build specialNotes (marker-based, NO language/keyword guessing in UI) ---
  // System hints (needsReview, duplicateWarning, confidence) are tracked via
  // needsReview boolean and shown dynamically in the UI — not stored in specialNotes.
  //
  // The parser stores semantic markers:
  // [GEFAHR] = red safety warning in the UI
  // [HINWEIS] = normal operational special note in the UI
  //
  // This avoids brittle language-specific keyword lists in the UI.
  const toNoteArray = (value: any): string[] => {
    if (Array.isArray(value)) {
      return value.map((item) => String(item || "").trim()).filter(Boolean);
    }

    if (typeof value === "string" && value.trim()) {
      return value
        .split(/[,\n]+/)
        .map((item) => item.trim())
        .filter(Boolean);
    }

    return [];
  };

  const safetyMarkerRe = /^\s*\[(GEFAHR|WARNUNG|WARNHINWEIS)\]\s*/i;
  const hintMarkerRe = /^\s*\[(HINWEIS|INFO|NOTIZ)\]\s*/i;
  const stripSpecialMarker = (line: string) =>
    line.replace(safetyMarkerRe, "").replace(hintMarkerRe, "").trim();

  const rawGefahren =
    parsed.auftrag?.gefahren ??
    parsed.auftrag?.warnhinweise ??
    parsed.auftrag?.sicherheitswarnungen;
  const rawBesonderheiten = parsed.auftrag?.besonderheiten;

  const rawGefahrenItems = toNoteArray(rawGefahren);
  const rawBesonderheitenItems = toNoteArray(rawBesonderheiten);

  const gefahrItemsFromBesonderheiten = rawBesonderheitenItems
    .filter((line) => safetyMarkerRe.test(line) || isLikelySafetyWarning(line))
    .map(stripSpecialMarker)
    .filter(Boolean);

  const baseHinweisItems = rawBesonderheitenItems
    .filter(
      (line) => !safetyMarkerRe.test(line) && !isLikelySafetyWarning(line),
    )
    .map(stripSpecialMarker)
    .map(canonicalizeSpecialNoteLine)
    .filter(Boolean);

  const detectMultipleWorksiteReviewHint = (value: string): string | null => {
    const source = String(value || "")
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n");
    const explicitNumberedSites =
      source.match(
        /^\s*(?:arbeitsort|ausführung|ausfuehrung|einsatzort|objekt)\s*\d+\s*:/gim,
      )?.length || 0;
    const genericSiteMarkers =
      source.match(
        /^\s*(?:arbeitsort|ausführung|ausfuehrung|einsatzort|objekt)\s*:/gim,
      )?.length || 0;

    if (explicitNumberedSites >= 2 || genericSiteMarkers >= 2) {
      return "Mehrere Arbeitsorte erkannt – bitte prüfen";
    }

    return null;
  };

  const semanticFallbackNotes = extractSemanticSpecialNotesFallback(
    [
      messageText,
      parsed.auftrag?.beschreibung,
      parsed.auftrag?.titel,
      Array.isArray(parsed.auftrag?.arbeitspositionen)
        ? parsed.auftrag.arbeitspositionen
            .map((item: any) =>
              [item?.name, item?.raw].filter(Boolean).join(" "),
            )
            .join("\n")
        : "",
    ]
      .filter(Boolean)
      .join("\n"),
  );

  const gefahrItems = dedupeSpecialNoteLines([
    ...rawGefahrenItems.map(stripSpecialMarker),
    ...gefahrItemsFromBesonderheiten,
    ...semanticFallbackNotes.safetyWarnings,
  ]).filter((line) => !isNonActionableSpecialNoteCandidate(line));

  const hinweisItems = reconcileCommunicationSpecialNoteLines(
    dedupeSpecialNoteLines(
      [
        ...baseHinweisItems,
        ...semanticFallbackNotes.jobHints.map(canonicalizeSpecialNoteLine),
        onsiteContactHint.hint || "",
      ].map(canonicalizeSpecialNoteLine),
    ),
  )
    .filter((line) => !isNonActionableSpecialNoteCandidate(line))
    .filter((line) => !isNonActionablePlanningHint(line))
    .filter(
      (line) =>
        !gefahrItems.some(
          (danger) =>
            normalizeSemanticText(danger) === normalizeSemanticText(line),
        ),
    );

  const finalSpecialNotesText = buildSpecialNotes({
    safetyWarnings: gefahrItems,
    jobHints: hinweisItems,
  });

  const finalSpecialNotes = finalSpecialNotesText || null;

  // --- Map services / AI work items, strict per-position matching ---

  type AiWorkItem = {
    name?: string | null;
    action_name?: string | null;
    context?: string | null;
    service_id?: string | null;
    service_name?: string | null;
    matched_service_id?: string | null;
    matched_service_name?: string | null;
    service_confidence?: "hoch" | "mittel" | "niedrig" | string | null;
    menge?: number | null;
    einheit?: string | null;
    unit_price?: number | string | null;
    currency?: string | null;
    raw?: string | null;
    evidence?: string | null;
    source_text?: string | null;
    confidence?: "hoch" | "mittel" | "niedrig" | string | null;
  };

  const normalizeServiceText = (value: any) =>
    String(value || "")
      .toLowerCase()
      .replace(/[ä]/g, "ae")
      .replace(/[ö]/g, "oe")
      .replace(/[ü]/g, "ue")
      .replace(/[ß]/g, "ss")
      .replace(/[^a-z0-9\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();

  const fullWorkText =
    parsed.auftrag?.beschreibung && String(parsed.auftrag.beschreibung).trim()
      ? String(parsed.auftrag.beschreibung)
      : messageText;

  const aiWorkItemsRaw: AiWorkItem[] = Array.isArray(
    parsed.auftrag?.arbeitspositionen,
  )
    ? parsed.auftrag.arbeitspositionen
    : [];

  const fallbackSegments = splitWorkSegments(fullWorkText).map((segment) => {
    const quantityMatch = detectAllQuantityUnitsFromText(segment)[0] || null;

    return {
      name: cleanDetectedWorkName(segment),
      menge: quantityMatch?.value ?? null,
      einheit: quantityMatch?.unit
        ? unitTypeToDisplayUnit(quantityMatch.unit)
        : null,
      raw: segment,
      confidence: "mittel",
    };
  });

  const aiWorkItems: AiWorkItem[] =
    aiWorkItemsRaw.length > 0 ? aiWorkItemsRaw : fallbackSegments;

  const getWorkItemUnitType = (item: AiWorkItem): string => {
    const text = normalizeUnitText(
      [
        item.source_text,
        item.evidence,
        item.raw,
        item.name,
        item.context,
        item.einheit,
      ]
        .filter(Boolean)
        .join(" "),
    );

    if (
      /\b(pauschal|pauschale|pauschale abrechnung|fixpreis|festpreis)\b/i.test(
        text,
      )
    ) {
      return "flat";
    }

    const fromUnit = getServiceUnitType(item.einheit || null);
    if (fromUnit !== "unknown") return fromUnit;

    const q = detectAllQuantityUnitsFromText(
      [item.source_text, item.evidence, item.raw, item.name, item.context]
        .filter(Boolean)
        .join(" "),
    )[0];

    return q?.unit || "unknown";
  };

  const getWorkItemQuantity = (item: AiWorkItem): number => {
    if (
      typeof item.menge === "number" &&
      isFinite(item.menge) &&
      item.menge > 0
    ) {
      return item.menge;
    }

    const q = detectAllQuantityUnitsFromText(
      [item.source_text, item.evidence, item.raw, item.name, item.context]
        .filter(Boolean)
        .join(" "),
    )[0];

    return q?.value ?? 0;
  };

  const hasForbiddenServiceWorkConflict = (
    serviceName: string,
    workText: string,
  ): boolean => {
    const s = normalizeServiceText(serviceName);
    const w = normalizeServiceText(workText);

    const serviceIsHedge = /\b(hecke|hecken)\b/i.test(s);
    const workIsTree = /\b(baum|baeume|baume|bäume)\b/i.test(w);

    if (serviceIsHedge && workIsTree) return true;

    const serviceIsGreenWaste =
      /\b(gruenzeug|gruenabfall|gruengut|gartenabfall|grünzeug|grünabfall|grüngut)\b/i.test(
        s,
      );

    const workIsConstructionWaste =
      /\b(bauschutt|aushub|erde|beton|ziegel|steine|kies|schutt)\b/i.test(w);

    if (serviceIsGreenWaste && workIsConstructionWaste) return true;

    return false;
  };

  const serviceDomainMatchesWork = (
    serviceName: string,
    workText: string,
  ): boolean => {
    const s = normalizeServiceText(serviceName);
    const w = normalizeServiceText(workText);

    const domains = [
      {
        service: ["hecke", "hecken"],
        work: ["hecke", "hecken", "schneiden", "stutzen", "pflegen", "pflege"],
      },
      {
        service: ["wiese", "rasen"],
        work: ["wiese", "rasen", "maehen", "mahen", "mähen"],
      },
      {
        service: ["baum", "baeume"],
        work: ["baum", "baeume", "bäume", "faellen", "fällen", "schneiden"],
      },
      {
        service: ["entsorgung", "entsorgen", "abtransport", "aushub"],
        work: [
          "entsorgung",
          "entsorgen",
          "abtransport",
          "abtransportieren",
          "erde",
          "aushub",
          "bauschutt",
        ],
      },
      {
        service: ["fenster", "fensterreinigung"],
        work: [
          "fenster",
          "fensterreinigung",
          "vitre",
          "vitres",
          "fenetre",
          "fenetres",
          "window",
          "windows",
          "finestre",
          "ventanas",
          "reinigen",
          "reinigung",
          "clean",
          "cleaning",
          "nettoyage",
          "pulizia",
          "limpieza",
        ],
      },
      {
        service: ["boden", "garage", "garagenboden", "lagerboden"],
        work: [
          "boden",
          "floor",
          "sol",
          "pavimento",
          "suelo",
          "garage",
          "garagenboden",
          "lagerboden",
          "reinigen",
          "reinigung",
          "clean",
          "cleaning",
          "nettoyage",
          "pulizia",
          "limpieza",
        ],
      },
      {
        service: [
          "anfahrt",
          "fahrtkosten",
          "fahrkosten",
          "wegpauschale",
          "fahrpauschale",
        ],
        work: [
          "anfahrt",
          "fahrtkosten",
          "fahrkosten",
          "wegpauschale",
          "fahrpauschale",
          "deplacement",
          "déplacement",
          "travel",
          "travel fee",
          "trip",
          "transport",
          "trasferta",
          "transferta",
        ],
      },
    ];

    return domains.some((domain) => {
      const serviceHit = domain.service.some((token) => s.includes(token));
      const workHit = domain.work.some((token) => w.includes(token));
      return serviceHit && workHit;
    });
  };

  const normalizeAiConfidence = (value?: string | null) => {
    const normalized = normalizeServiceText(value || "");
    if (["hoch", "high", "sicher", "certain"].includes(normalized))
      return "hoch";
    if (["mittel", "medium", "wahrscheinlich", "probably"].includes(normalized))
      return "mittel";
    if (["niedrig", "low", "unsicher", "uncertain"].includes(normalized))
      return "niedrig";
    return "";
  };

  const findSemanticServiceForWorkItem = (
    item: AiWorkItem,
    services: any[],
  ) => {
    const confidence = normalizeAiConfidence(
      item.service_confidence || item.confidence || null,
    );

    // INTAKE_SEMANTIC_ENGINE_V12:
    // If the AI itself marks the service as uncertain, do not guess via token matching.
    if (confidence === "niedrig") return null;

    const explicitId = String(
      item.service_id || item.matched_service_id || "",
    ).trim();
    if (explicitId) {
      const byId = services.find(
        (service: any) => String(service.id) === explicitId,
      );
      if (byId) return byId;
    }

    const explicitName = String(
      item.service_name || item.matched_service_name || "",
    ).trim();

    if (explicitName) {
      const normalizedExplicitName = normalizeServiceText(explicitName);

      const exact = services.find(
        (service: any) =>
          normalizeServiceText(service.name) === normalizedExplicitName,
      );
      if (exact) return exact;

      // Allow a cautious near-exact match only when the AI is at least medium confident.
      const near = services.find((service: any) => {
        const serviceName = normalizeServiceText(service.name);
        return (
          serviceName.length >= 4 &&
          normalizedExplicitName.length >= 4 &&
          (serviceName.includes(normalizedExplicitName) ||
            normalizedExplicitName.includes(serviceName))
        );
      });

      if (near && confidence) return near;
    }

    return null;
  };

  const strictMatchServiceForWorkItem = (item: AiWorkItem, services: any[]) => {
    const workName = normalizeServiceText(
      item.action_name ||
        item.name ||
        item.service_name ||
        item.matched_service_name ||
        "",
    );
    const workRaw = normalizeServiceText(
      [item.raw, item.evidence, item.context].filter(Boolean).join(" "),
    );
    const workText = [workName, workRaw].filter(Boolean).join(" ");
    const workUnitType = getWorkItemUnitType(item);

    if (!workText || workText.length < 3) return null;

    const workTokens = workText
      .split(/\s+/)
      .filter(
        (token) =>
          token.length >= 4 &&
          ![
            "eine",
            "einer",
            "eines",
            "einem",
            "einen",
            "mit",
            "der",
            "die",
            "das",
            "von",
            "ca",
            "circa",
            "etwa",
            "rund",
            "flaeche",
            "fläche",
            "gesamt",
            "gesamten",
            "test",
            "merge",
          ].includes(token),
      );

    let best: { service: any; score: number } | null = null;

    for (const service of services) {
      const serviceName = normalizeServiceText(service.name);
      const serviceUnitType = getServiceUnitType(service.unit);

      if (hasForbiddenServiceWorkConflict(service.name, workText)) {
        continue;
      }

      if (!serviceName) continue;

      const serviceTokens = serviceName
        .split(/\s+/)
        .filter((token: string) => token.length >= 4);

      // Schutz gegen kaputte Kurz-Leistungen wie "te".
      // Solche gespeicherten Alt-/Test-Leistungen dürfen nicht automatisch matchen.
      if (serviceName.length < 4 && serviceTokens.length === 0) continue;

      let score = 0;

      if (serviceName === workName) score += 100;

      // Enthalten-Matches nur bei ausreichend langen Begriffen.
      // Verhindert: serviceName "te" matcht auf "test merge".
      if (
        workName &&
        serviceName.length >= 4 &&
        workName.length >= 4 &&
        serviceName.includes(workName)
      ) {
        score += 75;
      }

      if (
        workName &&
        serviceName.length >= 4 &&
        workName.length >= 4 &&
        workName.includes(serviceName)
      ) {
        score += 75;
      }

      for (const token of serviceTokens) {
        if (workTokens.includes(token) || workText.includes(token)) {
          score += 30;
        }
      }

      if (serviceDomainMatchesWork(service.name, workText)) {
        score += 55;
      }

      // Einheit ist ein Sicherheits-Signal:
      // gleiche Einheit unterstützt, klare falsche Einheit blockiert eher.
      // So wird z.B. eine Stück-Position nicht nur wegen eines Ortswortes
      // auf eine Quadratmeter-/Stunden-Leistung gemappt.
      if (workUnitType !== "unknown") {
        if (workUnitType === serviceUnitType) {
          score += 25;
        } else if (serviceUnitType !== "unknown") {
          score -= 90;
        }
      }

      if (!best || score > best.score) {
        best = { service, score };
      }
    }

    if (!best || best.score < 60) return null;

    return best.service;
  };

  const mappedOrderItems = aiWorkItems
    .map((item) => {
      const raw = String(item.raw || item.name || "").trim();
      const detectedName = cleanDetectedWorkName(
        composeWorkNameSource(item, raw),
      );

      if (!detectedName || detectedName.length < 3) return null;

      const semanticMatchedService = findSemanticServiceForWorkItem(
        item,
        services,
      );
      const semanticConfidence = normalizeAiConfidence(item.confidence || null);
      const matchedService =
        semanticMatchedService ||
        (semanticConfidence === "niedrig"
          ? null
          : strictMatchServiceForWorkItem(item, services));
      const evidenceText = String(
        item.source_text || item.evidence || item.raw || "",
      ).trim();
      const originalLookupText = `${messageText}\n${fullWorkText}`;
      const matchedOriginalSegment =
        findOriginalSegmentForWorkItem(item, originalLookupText) ||
        findColonBlockForWorkItem(item, originalLookupText) ||
        "";
      const evidenceHasQuantityUnit =
        detectAllQuantityUnitsFromText(evidenceText).length > 0;
      const matchedSegmentHasQuantityUnit =
        detectAllQuantityUnitsFromText(matchedOriginalSegment).length > 0;

      const originalSegment =
        evidenceText && evidenceHasQuantityUnit
          ? evidenceText
          : matchedSegmentHasQuantityUnit
            ? matchedOriginalSegment
            : evidenceText || matchedOriginalSegment || "";

      const detectedUnitTypeFromItem = getWorkItemUnitType(item);
      const detectedQuantityFromItem = getWorkItemQuantity(item);
      const originalQuantityMatch =
        detectAllQuantityUnitsFromText(originalSegment)[0] || null;

      const detectedUnitType =
        detectedUnitTypeFromItem !== "unknown"
          ? detectedUnitTypeFromItem
          : originalQuantityMatch?.unit || "unknown";

      const detectedQuantity =
        detectedQuantityFromItem > 0
          ? detectedQuantityFromItem
          : originalQuantityMatch?.value || 0;

      const detectedUnitPrice = detectUnitPriceForWorkItem(
        item,
        `${messageText}\n${fullWorkText}`,
      );

      if (matchedService) {
        const serviceUnit = String(matchedService.unit || "Stunde");
        const serviceUnitType = getServiceUnitType(serviceUnit);
        const hasExplicitDetectedUnit =
          detectedUnitType !== "unknown" && detectedQuantity > 0;

        const unit = hasExplicitDetectedUnit
          ? unitTypeToDisplayUnit(detectedUnitType)
          : serviceUnit;

        const unitType = getServiceUnitType(unit);
        const catalogUnitPrice = Number(matchedService.defaultPrice || 0);
        const priceSearchText = `${raw} ${originalSegment}`;

        const hasLooseCurrencyAmount =
          /\b\d+(?:[.,]\d{1,2})?\s*(?:chf|franken|fr\.?|sfr\.?|stutz|eur|euro|€|usd|dollar|\$|gbp|pfund|£)\b/i.test(
            priceSearchText,
          ) ||
          /\b(?:chf|franken|fr\.?|sfr\.?|stutz|eur|euro|€|usd|dollar|\$|gbp|pfund|£)\s*\d+(?:[.,]\d{1,2})?\b/i.test(
            priceSearchText,
          );

        const hasAmbiguousLinePrice =
          hasAmbiguousCompactLinePrice(priceSearchText);
        const hasExplicitUnitPrice = Boolean(
          detectedUnitPrice && detectedUnitPrice > 0,
        );
        const hasNoPriceSignal =
          /\b(ohne\s+preis|ohne\s+preisangabe|kein\s+preis|keine\s+preisangabe|preis\s+offen|preis\s+folgt|preis\s+laut\s+offerte|laut\s+offerte|nach\s+aufwand)\b/i.test(
            priceSearchText,
          );

        const shouldBlockCatalogFallback =
          (hasLooseCurrencyAmount ||
            hasAmbiguousLinePrice ||
            hasNoPriceSignal) &&
          !hasExplicitUnitPrice;

        // V17.09 STRUCTURED_INTAKE_FAIL_CLOSED:
        // Die KI muss Menge/Einheit/Preis pro Arbeitsposition selbst
        // strukturiert liefern. Der Code darf nicht mehr still den
        // Katalogpreis oder die Katalogeinheit als sichere Kundentext-Daten
        // einsetzen, wenn die Position dafür keine eigene Evidence hat.
        const serviceNameForReview = String(
          matchedService.name || "Unbekannte Leistung",
        );
        const isFlatServiceUnit = serviceUnitType === "flat";
        const hasOwnQuantityEvidence = detectedQuantity > 0;
        const hasOwnUnitEvidence = detectedUnitType !== "unknown";
        const hasOwnPriceEvidence = hasExplicitUnitPrice;

        const unitPrice = hasOwnPriceEvidence ? Number(detectedUnitPrice) : 0;

        const priceOverrideDetected =
          hasOwnPriceEvidence &&
          catalogUnitPrice > 0 &&
          Math.abs(unitPrice - catalogUnitPrice) >= 0.01;

        const quantityValidation = validateQuantityAgainstServiceUnit({
          serviceUnit: unit,
          detectedValue: detectedQuantity,
          detectedUnit:
            detectedUnitType !== "unknown" ? detectedUnitType : null,
          serviceName: matchedService.name,
        });
        const mismatchDetected =
          hasExplicitDetectedUnit && serviceUnitType !== detectedUnitType;

        const structuredReviewReasons: string[] = [];

        if (mismatchDetected) {
          structuredReviewReasons.push(
            `unit_mismatch:${serviceNameForReview}:${serviceUnit}:${unit}:${detectedQuantity}`,
          );
        } else if (!isFlatServiceUnit && !hasOwnUnitEvidence) {
          structuredReviewReasons.push(
            `unit_mismatch:${serviceNameForReview}:Unklar:${serviceUnit}:0`,
          );
        }

        if (!isFlatServiceUnit && !hasOwnQuantityEvidence) {
          structuredReviewReasons.push("quantity_review");
        }

        if (!hasOwnPriceEvidence) {
          structuredReviewReasons.push(
            `price_unclear:${serviceNameForReview}`,
            "unit_price_review",
          );
        } else if (priceOverrideDetected) {
          structuredReviewReasons.push(
            `price_override:${serviceNameForReview}:${catalogUnitPrice}:${unitPrice}`,
          );
        }

        if (shouldBlockCatalogFallback) {
          structuredReviewReasons.push(`price_unclear:${serviceNameForReview}`);
        }

        const reviewReason =
          structuredReviewReasons[0] || quantityValidation.reason || null;

        const explicitHourLineRepair = findExplicitHourLineRepairForMappedItem(
          {
            serviceName: String(matchedService.name || "Unbekannte Leistung"),
            description: String(
              raw || detectedName || fullWorkText || `${source}-Auftrag`,
            ),
            quantity: quantityValidation.quantity,
            unit,
            unitPrice,
            totalPrice: unitPrice * quantityValidation.quantity,
            needsReview:
              structuredReviewReasons.length > 0 ||
              quantityValidation.needsReview,
            reviewReason,
            sourceText: originalSegment || raw || null,
            evidence: item.evidence || item.source_text || evidenceText || null,
            detectedCurrency: item.currency || null,
          },
          originalLookupText,
        );

        const finalMappedQuantity =
          explicitHourLineRepair?.quantity || quantityValidation.quantity;
        const finalMappedUnit = explicitHourLineRepair ? "Stunde" : unit;
        const finalMappedUnitPrice = explicitHourLineRepair?.price || unitPrice;
        const finalMappedSourceText =
          explicitHourLineRepair?.raw || originalSegment || raw || null;
        const finalMappedEvidence =
          explicitHourLineRepair?.raw ||
          item.evidence ||
          item.source_text ||
          null;
        const effectiveStructuredReviewReasons = explicitHourLineRepair
          ? structuredReviewReasons.filter(
              (reason) =>
                reason !== "quantity_review" &&
                reason !== "unit_price_review" &&
                !reason.startsWith("price_unclear:") &&
                !/^unit_mismatch:[^:]+:Unklar:/i.test(reason),
            )
          : structuredReviewReasons;
        const effectiveReviewReason =
          effectiveStructuredReviewReasons[0] ||
          (explicitHourLineRepair ? null : quantityValidation.reason) ||
          null;

        return {
          serviceName: formatWorkNameForDisplay(
            String(matchedService.name || "Unbekannte Leistung"),
          ),
          description: String(
            raw || detectedName || fullWorkText || `${source}-Auftrag`,
          ),

          quantity: finalMappedQuantity,
          unit: finalMappedUnit,
          unitPrice: finalMappedUnitPrice,
          totalPrice: roundIntakeMoney(
            finalMappedUnitPrice * finalMappedQuantity,
          ),
          needsReview:
            effectiveStructuredReviewReasons.length > 0 ||
            (!explicitHourLineRepair && quantityValidation.needsReview),
          reviewReason: effectiveReviewReason,
          sourceText: finalMappedSourceText,
          evidence: finalMappedEvidence,
          detectedCurrency: item.currency || null,
        };
      }

      const unit =
        detectedUnitType !== "unknown"
          ? unitTypeToDisplayUnit(detectedUnitType)
          : unitTypeToDisplayUnit(getServiceUnitType(item.einheit || null));

      const cleanedDetectedName = formatWorkNameForDisplay(
        detectedName || "Unbekannte Leistung",
      );

      const finalServiceName =
        cleanedDetectedName.length < 4 ||
        cleanedDetectedName.split(" ").length > 6
          ? "Unbekannte Leistung"
          : cleanedDetectedName;

      const confidence = normalizeAiConfidence(item.confidence || null);
      const safeUnitPrice =
        confidence === "niedrig" ? 0 : detectedUnitPrice || 0;
      const safeQuantity = confidence === "niedrig" ? 0 : detectedQuantity || 0;

      return {
        serviceName: finalServiceName,
        description: String(
          raw || detectedName || fullWorkText || `${source}-Auftrag`,
        ),
        quantity: safeQuantity,
        unit: unit || "Pauschal",
        unitPrice: safeUnitPrice,
        totalPrice: safeUnitPrice * safeQuantity,
        needsReview: true,
        reviewReason: "unbekannte_leistung_pruefen",
        sourceText: originalSegment || raw || null,
        evidence: item.evidence || item.source_text || null,
        detectedCurrency: item.currency || null,
      };
    })
    .filter(Boolean) as Array<{
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
  }>;
  const hasHourQuantityInText = detectAllQuantityUnitsFromText(
    messageText,
  ).some((q) => q.unit === "hour");

  const hasHourItemAlready = mappedOrderItems.some(
    (item) => getServiceUnitType(item.unit) === "hour",
  );

  const hasMaterialLiterItem = mappedOrderItems.some(
    (item) => getServiceUnitType(item.unit) === "liter",
  );

  const firstHourQuantity = detectAllQuantityUnitsFromText(messageText).find(
    (q) => q.unit === "hour",
  );

  const mappedOrderItemsWithHourSafety =
    hasHourQuantityInText &&
    !hasHourItemAlready &&
    hasMaterialLiterItem &&
    firstHourQuantity
      ? [
          {
            serviceName: "Reinigung",
            description: String(
              messageText || fullWorkText || `${source}-Auftrag`,
            ),
            quantity: firstHourQuantity.value,
            unit: "Stunde",
            unitPrice: 0,
            totalPrice: 0,
            needsReview: true,
            reviewReason: "stunden_arbeitsposition_pruefen",
          },
          ...mappedOrderItems,
        ]
      : mappedOrderItems;

  const messageHasCleaningMaterialSignal =
    /\b(liter|ltr\.?|reinigungsmittel|reiniger|spezialreiniger|produkt|mittel)\b/i.test(
      normalizeUnitText(messageText),
    );

  const cleanedMappedOrderItemsWithHourSafety =
    mappedOrderItemsWithHourSafety.filter((item) => {
      const name = normalizeUnitText(item.serviceName);
      const unitType = getServiceUnitType(item.unit);

      const isCleaningMaterial =
        unitType === "liter" &&
        /\b(reinigungsmittel|reiniger|spezialreiniger)\b/i.test(name);

      if (isCleaningMaterial && !messageHasCleaningMaterialSignal) {
        return false;
      }

      return true;
    });

  let finalOrderItems: Array<{
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
  }> =
    cleanedMappedOrderItemsWithHourSafety.length > 0
      ? cleanedMappedOrderItemsWithHourSafety
      : [
          {
            serviceName: formatWorkNameForDisplay(
              parsed.auftrag?.titel || "Unbekannte Leistung",
            ),
            description: String(fullWorkText || `${source}-Auftrag`),
            quantity: 0,
            unit: "Pauschal",
            unitPrice: 0,
            totalPrice: 0,
            needsReview: true,
            reviewReason: "unbekannte_leistung_pruefen",
          },
        ];

  const validationSourceText = [
    messageText,
    fullWorkText,
    translationText ? `--- Übersetzung (automatisch) ---\n${translationText}` : "",
  ]
    .filter((part) => String(part || "").trim())
    .join("\n");

  const intakeValidation = validateAndRepairParsedOrderItems({
    items: finalOrderItems,
    originalText: validationSourceText,
    fallbackCurrency: intakeCurrency,
  });

  finalOrderItems = repairExplicitHourQuantitiesFromOriginalText(
    intakeValidation.items,
    validationSourceText,
  );

  // INTAKE_FLAT_TOTAL_LAST_GUARD_V8
  // Letzte Schutzschicht direkt vor Speichern: Pauschalpositionen haben
  // fachlich keine echte Menge, müssen aber mit Menge 1 gespeichert werden,
  // damit OrderItem.totalPrice und Order.totalPrice nicht fälschlich 0 bleiben.
  finalOrderItems = finalOrderItems.map((item) => {
    const unitType = getServiceUnitType(item.unit);
    const unitPriceValue = Number(item.unitPrice || 0);

    if (
      unitType !== "flat" ||
      !Number.isFinite(unitPriceValue) ||
      unitPriceValue <= 0
    ) {
      return item;
    }

    const reviewReason = item.reviewReason || null;
    const onlyQuantityReview =
      reviewReason &&
      /menge|quantity|leistung_ist_pauschal|pauschal|pruefen|prüfen/i.test(
        reviewReason,
      );

    return {
      ...item,
      quantity: 1,
      totalPrice: Math.round((unitPriceValue + Number.EPSILON) * 100) / 100,
      needsReview: onlyQuantityReview ? false : item.needsReview,
      reviewReason: onlyQuantityReview ? null : item.reviewReason,
    };
  });

  // V16.96: Run the explicit-hour repair once more as the final service-line
  // guard before totals are calculated. This catches remaining zero-quantity
  // hour rows after all validation and flat-item normalization steps.
  finalOrderItems = repairExplicitHourQuantitiesFromOriginalText(
    finalOrderItems,
    validationSourceText,
  );

  // V17.00: absolutely last explicit-hour repair before totals and persistence.
  // This fixes rows that still arrive as Stunde + price + quantity 0 directly
  // before OrderItem.create, after every parser/validation step has finished.
  finalOrderItems = repairExplicitHourQuantitiesBeforePersist(
    finalOrderItems,
    validationSourceText,
  );

  // V17.03: shared cross-route repair, same helper used by WhatsApp queue and
  // Orders API. This is the final in-memory correction before totals and
  // OrderItem.create, independent from shortened AI evidence like "Std. à CHF".
  finalOrderItems = repairZeroQuantityHourItemsFromText(
    finalOrderItems,
    validationSourceText,
    {
      logPrefix: "[INTAKE_HOUR_SHARED_FIX_V17_07]",
      // V17.43: Pauschal-/Anfahrtszeilen werden bereits line-local im
      // Validator aus dem normalisierten Leistungsteil erstellt. Die alte
      // Nachreparatur darf keine zweite "Anfahrts"-Position mehr anhängen.
      skipFlatFeeRepair: true,
    },
  ).items;

  // V17.10: Finaler KI-Struktur-Schutz direkt vor der Totalberechnung.
  // Wenn der Kundentext zwar Menge + Preis, aber keine Einheit enthält
  // (z. B. "42 à CHF 7"), darf keine KI-/Katalog-/Repair-Schicht daraus
  // still eine Stunde/m2/Stück-Position mit berechnetem Total machen.
  const unitlessQuantityGuardBeforePersist =
    applyUnitlessQuantityPriceLineGuard(
      finalOrderItems,
      validationSourceText,
    );
  finalOrderItems = unitlessQuantityGuardBeforePersist.items;

  // V17.11: Allerletzter Summen-Blocker vor Order.create.
  // Rote Prüfpositionen dürfen zwar Menge/Preis als Hinweis behalten, aber
  // niemals in Order.totalPrice/OrderItem.totalPrice eingerechnet werden.
  finalOrderItems = applyFinalAmountBlockersBeforePersist(finalOrderItems, {
    detectedCurrencies: intakeValidation.detectedCurrencies,
    finalCurrency: intakeValidation.finalCurrency,
  });

  const aiExecutionAddress = parsed.auftrag?.ausfuehrungsadresse;
  const executionAddressCustomerContext = {
    customerAddress: addr.street,
    customerPlz: addr.plz,
    customerCity: addr.city,
  };

  const legacyAddressFallbackEnabled =
    process.env.INTAKE_LEGACY_ADDRESS_FALLBACK === "1";
  const aiStructuredExecutionAddress = extractAiStructuredExecutionAddress(
    aiExecutionAddress,
    executionAddressCustomerContext,
    validationSourceText,
  );

  let extractedExecutionAddress = sanitizeExtractedExecutionAddress(
    aiStructuredExecutionAddress ||
      (legacyAddressFallbackEnabled
        ? extractExecutionAddressFromText(
            validationSourceText,
            executionAddressCustomerContext,
          )
        : null),
    validationSourceText,
  );

  if (
    extractedExecutionAddress &&
    sameStructuredAddress({
      aStreet: extractedExecutionAddress.siteAddress,
      aPlz: extractedExecutionAddress.sitePlz,
      aCity: extractedExecutionAddress.siteCity,
      bStreet: executionAddressCustomerContext.customerAddress,
      bPlz: executionAddressCustomerContext.customerPlz,
      bCity: executionAddressCustomerContext.customerCity,
    })
  ) {
    extractedExecutionAddress = null;
  }

  // V16.23: Zweiter Prüfer als reine Read-only-Kontrolle.
  // Dieser Validator darf keine Daten ändern, keine Chips setzen und nichts
  // blockieren. Er schreibt nur strukturierte Warnungen ins Server-Log, damit
  // wir riskante Strukturen später sauber aktivieren können.
  const readOnlyRiskValidator = runReadOnlyIntakeRiskValidator({
    originalText: `${messageText}\n${fullWorkText}`,
    billingCustomer: {
      name: kundeData.name || null,
      street: addr.street || null,
      plz: addr.plz || null,
      city: addr.city || null,
      phone: kundeData.telefon || null,
      source: billingEvidence.source,
      hasReliableCustomerBlock: billingEvidence.hasReliableCustomerBlock,
    },
    executionAddress: extractedExecutionAddress || null,
    detectedCurrencies: intakeValidation.detectedCurrencies,
    finalCurrency: intakeValidation.finalCurrency,
  });

  if (readOnlyRiskValidator.warnings.length > 0) {
    console.warn(
      `[${source}] 🧪 Intake risk validator (${readOnlyRiskValidator.riskLevel}): ${readOnlyRiskValidator.warnings.join(", ")}`,
      readOnlyRiskValidator.checks,
    );
  }

  const structuralRiskReviewReasons = readOnlyRiskValidator.warnings.map(
    (warning) => `intake_risk:${warning}`,
  );

  if (structuralRiskReviewReasons.length > 0) {
    parsed.system = parsed.system || {};
    parsed.system.needs_review = true;
  }

  const primaryItem = finalOrderItems[0] || null;

  const serviceName = primaryItem?.serviceName || "";
  const unit = primaryItem?.unit || "Stunde";
  const unitPrice = primaryItem?.unitPrice || 0;
  const quantity = primaryItem?.quantity || 0;
  const totalPrice = finalOrderItems.reduce(
    (sum, item) => sum + Number(item.totalPrice || 0),
    0,
  );

  const quantityReviewReasons = finalOrderItems
    .filter((item) => item.needsReview && item.reviewReason)
    .map((item) => item.reviewReason as string);

  if (quantityReviewReasons.length > 0) {
    parsed.system = parsed.system || {};
    parsed.system.needs_review = true;
  }

  // --- UNIT MISMATCH CHECK ---
  const unitMismatchReasons: string[] = [];

  const normalizeUnitForReview = (value?: string | null) => {
    const v = normalizeUnitText(value || "");

    if (["stunde", "stunden", "std", "h"].includes(v)) return "Stunde";
    if (["tag", "tage", "arbeitstag", "arbeitstage"].includes(v)) return "Tag";
    if (["meter", "laufmeter", "lfm", "m"].includes(v)) return "Meter";
    if (["quadratmeter", "qm", "m2", "m²"].includes(v)) return "Quadratmeter";
    if (["kubikmeter", "cbm", "m3", "m³"].includes(v)) return "Kubikmeter";
    if (["stueck", "stück", "stk", "anzahl", "einheiten"].includes(v))
      return "Stück";
    if (["kilogramm", "kg"].includes(v)) return "Kilogramm";
    if (["tonne", "tonnen", "to", "t"].includes(v)) return "Tonne";
    if (["liter", "ltr", "l"].includes(v)) return "Liter";
    if (["pauschal", "pauschale", "fixpreis", "festpreis"].includes(v))
      return "Pauschal";

    return value || "";
  };

  const unitTypeToReviewUnit = (unitType?: string | null) => {
    switch (unitType) {
      case "hour":
        return "Stunde";
      case "day":
        return "Tag";
      case "meter":
        return "Meter";
      case "square_meter":
        return "Quadratmeter";
      case "cubic_meter":
        return "Kubikmeter";
      case "piece":
        return "Stück";
      case "kilogram":
        return "Kilogramm";
      case "ton":
        return "Tonne";
      case "liter":
        return "Liter";
      case "flat":
        return "Pauschal";
      default:
        return "";
    }
  };

  const detectUnitInsideOwnItemText = (text?: string | null) => {
    const matches = detectAllQuantityUnitsFromText(text || "");
    if (matches.length !== 1) return "";
    return unitTypeToReviewUnit(matches[0].unit);
  };

  const safeServiceMatchForReview = (itemServiceName: string) => {
    const itemName = normalizeServiceText(itemServiceName);
    if (!itemName || itemName.length < 4) return null;

    return (
      services.find((s: any) => {
        const serviceName = normalizeServiceText(s.name);
        if (!serviceName || serviceName.length < 4) return false;

        return serviceName === itemName;
      }) || null
    );
  };

  for (const item of finalOrderItems) {
    const itemServiceName = (item.serviceName || "").trim();
    if (!itemServiceName) continue;

    const matchingService = safeServiceMatchForReview(itemServiceName);
    const expectedUnit = normalizeUnitForReview(
      matchingService?.unit || item.unit,
    );

    const detectedUnit = detectUnitInsideOwnItemText(item.description);

    if (detectedUnit && expectedUnit && detectedUnit !== expectedUnit) {
      unitMismatchReasons.push(
        `unit_mismatch:${item.serviceName}:${detectedUnit}:${expectedUnit}`,
      );
    }
  }

  // --- Description ---
  const description =
    parsed.auftrag?.beschreibung ||
    parsed.auftrag?.titel ||
    `${source}-Auftrag`;

  // translationText wurde absichtlich vor der Validator-Phase erzeugt, damit
  // Dialekt/Fremdsprache bereits dort für line-local Prüfung und sichtbare
  // Hochdeutsch-Leistungsnamen verfügbar ist.

  // --- Build notes ---
  // Der KI-Titel bleibt strukturierte Metainfo. Er darf nicht in den
  // Kundennachrichten landen, weil er sonst später wieder als Leistung gelesen
  // werden kann.
  const cleanMessageTextForNotes = stripInternalTitleLinesFromText(messageText);
  const notesParts: string[] = [`${source}:\n${cleanMessageTextForNotes}`];
  if (parsed.system?.prioritaet === "hoch")
    notesParts.push(`[Priorität: hoch]`);
  if (showTranslationInCustomerMessage)
    notesParts.push(`\n--- Übersetzung (automatisch) ---\n${translationText}`);
  if (reviewNote?.trim())
    notesParts.push(`\n[Review-Hinweis]\n${reviewNote.trim()}`);

  // --- Build reviewReasons from abgleich status + external intake hints ---
  const baseReviewReasons: string[] = [];
  if (
    abgleichStatus === "moeglicher_treffer" ||
    abgleichStatus === "konflikt" ||
    abgleichStatus === "bestaetigungs_treffer"
  ) {
    baseReviewReasons.push("uncertain_assignment");
  }
  // Image-only messages (no text, no audio) always need review — intent is unclear
  if (isImageOnly) {
    baseReviewReasons.push("image_only_no_text");
  }

  const allReviewReasons: string[] = [
    ...(additionalReviewReasons || []),
    ...baseReviewReasons,
    ...customerGuardReviewReasons,
    ...quantityReviewReasons,
    ...unitMismatchReasons,
    ...intakeValidation.reviewReasons,
    ...unitlessQuantityGuardBeforePersist.reviewReasons,
    ...structuralRiskReviewReasons,
    ...(extractedExecutionAddress ? ["execution_address_detected"] : []),
  ];

  if (autoReuseTags.length > 0) {
    allReviewReasons.push(...autoReuseTags);
  }

  const needsReview = !!forceReview || allReviewReasons.length > 0;
  const hinweisLevel = allReviewReasons.some(
    (reason) =>
      ["multi_image_overflow", "image_only_no_text"].includes(reason) ||
      reason.startsWith("unit_mismatch:") ||
      reason.startsWith("currency_"),
  )
    ? "warning"
    : needsReview
      ? "info"
      : parsed.system?.prioritaet === "hoch"
        ? "important"
        : finalSpecialNotes
          ? "info"
          : "none";

  // --- Create order ---
  const order = await prisma.order.create({
    data: {
      customerId,
      ...(userId ? { userId } : {}),
      description,
      serviceName,
      status: "Offen",
      priceType: unit,
      unitPrice,
      quantity,
      totalPrice,
      currency: intakeValidation.finalCurrency,
      vatRate: intakeVatRate,
      date: new Date(),
      notes: stripInternalTitleLinesFromText(notesParts.join("\n")),
      specialNotes: finalSpecialNotes,
      siteAddressDifferent: Boolean(extractedExecutionAddress),
      siteName: extractedExecutionAddress?.siteName || null,
      siteAddress: extractedExecutionAddress?.siteAddress || null,
      sitePlz: extractedExecutionAddress?.sitePlz || null,
      siteCity: extractedExecutionAddress?.siteCity || null,
      siteNote: extractedExecutionAddress?.siteNote || null,
      needsReview,
      reviewReasons: allReviewReasons,
      hinweisLevel,
      mediaUrl: savedMediaPath || allSavedMediaPaths?.[0] || null,
      mediaType:
        savedMediaType ||
        (allSavedMediaPaths && allSavedMediaPaths.length > 0 ? "image" : null),
      imageUrls:
        allOptimizedPreviewPaths && allOptimizedPreviewPaths.length > 0
          ? allOptimizedPreviewPaths
          : allSavedMediaPaths && allSavedMediaPaths.length > 0
            ? allSavedMediaPaths
            : savedMediaType === "image"
              ? ([optimizedPreviewPath || savedMediaPath].filter(
                  Boolean,
                ) as string[])
              : [],
      thumbnailUrls:
        allOptimizedThumbnailPaths && allOptimizedThumbnailPaths.length > 0
          ? allOptimizedThumbnailPaths
          : allSavedMediaPaths && allSavedMediaPaths.length > 0
            ? allSavedMediaPaths
            : savedMediaType === "image"
              ? ([optimizedThumbnailPath || savedMediaPath].filter(
                  Boolean,
                ) as string[])
              : [],
      audioTranscript:
        savedMediaType === "audio" && messageText ? messageText : null,
      // Stage I — audio usage tracking (only set when this order carries an audio file)
      audioDurationSec:
        savedMediaType === "audio"
          ? typeof inputAudioDurationSec === "number" &&
            isFinite(inputAudioDurationSec)
            ? Math.max(0, Math.round(inputAudioDurationSec))
            : null
          : null,
      audioTranscriptionStatus:
        savedMediaType === "audio"
          ? inputAudioTranscriptionStatus || null
          : null,
      ...(finalOrderItems.length > 0
        ? {
            items: {
              create: finalOrderItems.map((item) => ({
                serviceName: item.serviceName,
                description: item.description,
                quantity: item.quantity,
                unit: item.unit,
                unitPrice: item.unitPrice,
                totalPrice: item.totalPrice,
              })),
            },
          }
        : {}),
    },
    include: { customer: true, items: true },
  });

  // V16.39: Final order path deliberately does not re-parse raw text for
  // billing data. If the AI-structured billing evidence failed validation, the
  // customer remains review-required instead of being rescued by marker words.

  console.log(
    `[${source}] Order created: ${order.id} | Customer: ${order.customer?.name} (${order.customer?.customerNumber}) | Service: ${serviceName} | Abgleich: ${abgleichStatus} (confidence: ${abgleich.confidence || 0}) | Priorität: ${parsed.system?.prioritaet || "normal"}${duplicateWarning ? " | ⚠️ WARNING" : ""}`,
  );

  // Audit log: order created from webhook (technical webhook trail)
  logAuditAsync({
    userId,
    action: `ORDER_CREATED_FROM_${source.toUpperCase()}`,
    area: "WEBHOOK",
    targetType: "Order",
    targetId: order.id,
    success: true,
    details: {
      sender: senderName,
      customer: order.customer?.name || "Unbekannt",
      customerId,
      service: serviceName,
      abgleichStatus,
      confidence: abgleich.confidence || 0,
      needsReview: !!parsed.system?.needs_review,
      hasMedia: !!savedMediaPath,
      mediaType: savedMediaType || null,
    },
  });

  // Audit log: fachlicher Auftragseintrag unter ORDERS (damit Bereich-Filter ORDERS auch Webhook-Aufträge zeigt)
  logAuditAsync({
    userId,
    action: "ORDER_CREATE",
    area: "ORDERS",
    targetType: "Order",
    targetId: order.id,
    success: true,
    details: {
      source: source.toLowerCase(),
      sender: senderName,
      customer: order.customer?.name || "Unbekannt",
      customerId,
      service: serviceName,
    },
  });

  console.log(
    `[${source}] ✅ Order created in ${Date.now() - _intakeStartTime}ms total (orderId=${order.id}, desc="${description.slice(0, 60)}")`,
  );

  // Block R — strukturiertes Audit-Log für jede erfolgreiche Intake-Verarbeitung.
  // Macht es trivial zu finden, wo bei zukünftigen Issue-Reports der Name verloren geht.
  logIntakeAudit({
    source,
    userId,
    phoneMasked: maskPhoneForLog(input.phoneNumber || null),
    senderName: senderName || "",
    mediaType: savedMediaType || null,
    hasTranscript: !!(messageText && messageText.trim().length > 0),
    transcriptLen: (messageText || "").length,
    llmExtractedName: llmExtractedName || null,
    llmAbgleichStatus: abgleichStatus || "unknown",
    selfIntroFallbackUsed,
    resolvedCustomerName: kundeData.name || null,
    customerId,
    customerWasNewlyCreated,
    customerNameInDb: order.customer?.name || null,
    customerFallbackUsed: false,
  });

  return {
    orderId: order.id,
    description,
    customerName: order.customer?.name || "Unbekannt",
    serviceName,
    kundeStatus: parsed.system?.needs_review ? "unbestaetigt" : "bestaetigt",
    kundenabgleichStatus: abgleichStatus,
  };
}

// ---------- Fallback order creation (LLM failure) ----------
/**
 * Creates a manual-review fallback order from the raw incoming payload
 * when the LLM/AI analysis fails (credits exhausted, API error, network,
 * parse error, empty response, etc.).
 *
 * Rules:
 *   - Never invents customer data. Binds to a per-user placeholder customer.
 *   - Stores only the raw payload (text, images/thumbs, audio ref) + metadata.
 *   - Flags needsReview=true + hinweisLevel=warning so the UI shows the
 *     orange "Kundendaten unvollständig" badge on the order card.
 *   - Status stays 'Offen' so it appears in the default active orders view.
 *
 * @param input  The original IntakeInput that was being processed.
 * @param reason Machine-readable failure reason (e.g. 'llm_api_error',
 *               'llm_parse_error', 'llm_empty_response', 'llm_network_error').
 */
async function createFallbackOrderFromRawPayload(
  input: IntakeInput,
  reason: string,
): Promise<IntakeResult | null> {
  const {
    source,
    senderName,
    messageText,
    savedMediaPath,
    savedMediaType,
    optimizedPreviewPath,
    optimizedThumbnailPath,
    userId: inputUserId,
    allOptimizedPreviewPaths,
    allOptimizedThumbnailPaths,
    audioDurationSec: inputAudioDurationSec,
    audioTranscriptionStatus: inputAudioTranscriptionStatus,
  } = input;
  const userId = inputUserId || null;
  if (!userId) {
    // No user → cannot create; already logged upstream. Do not invent anything.
    return null;
  }

  const FALLBACK_CUSTOMER_NAME = "⚠️ Unbekannt (WhatsApp)";

  // Resolve default VAT rate from CompanySettings (same logic as main intake path)
  const fbSettings = await prisma.companySettings.findFirst({
    where: { userId },
  });
  const fbIntakeCurrency = fbSettings?.currency === "EUR" ? "EUR" : "CHF";
  const fbIntakeVatRate: number =
    fbSettings?.mwstAktiv === true && fbSettings?.mwstSatz != null
      ? Number(fbSettings.mwstSatz)
      : fbSettings?.mwstAktiv === false
        ? 0
        : 8.1;

  try {
    // Upsert per-user fallback customer (name-only; no guessed fields).
    let fallbackCustomer = await prisma.customer.findFirst({
      where: { userId, name: FALLBACK_CUSTOMER_NAME, deletedAt: null },
      select: { id: true, name: true },
    });
    if (!fallbackCustomer) {
      fallbackCustomer = await prisma.customer.create({
        data: { name: FALLBACK_CUSTOMER_NAME, userId },
        select: { id: true, name: true },
      });
      console.log(
        `[${source}] 🆕 Fallback customer created: ${fallbackCustomer.id} for userId=${userId}`,
      );
    }

    // Assemble image arrays from whatever preprocessing already saved to S3.
    const imageUrls: string[] =
      allOptimizedPreviewPaths && allOptimizedPreviewPaths.length > 0
        ? (allOptimizedPreviewPaths.filter(Boolean) as string[])
        : optimizedPreviewPath
          ? [optimizedPreviewPath]
          : [];
    const thumbnailUrls: string[] =
      allOptimizedThumbnailPaths && allOptimizedThumbnailPaths.length > 0
        ? (allOptimizedThumbnailPaths.filter(Boolean) as string[])
        : optimizedThumbnailPath
          ? [optimizedThumbnailPath]
          : [];

    const rawText = (messageText || "").trim();
    // Description: raw text if present, otherwise neutral placeholder.
    const description =
      rawText.length > 0
        ? rawText
        : imageUrls.length > 0
          ? `(Nur Bild${imageUrls.length > 1 ? "er" : ""} erhalten – kein Text)`
          : "(Leere Nachricht)";

    // ─── Layer 1 of three-layer customer-data-pollution defense ───
    // Same rationale as createVoiceTooLongReviewOrder: every system-derived
    // metadata line gets a [META] prefix so the extract-from-notes heuristic
    // ignores it. Originaltext (the raw user message) is NOT prefixed —
    // that is genuine user content and may legitimately contain an address.
    const timestampIso = new Date().toISOString();
    const notesParts = [
      "⚠️ KI-Analyse fehlgeschlagen – bitte manuell prüfen.",
      `[META] Quelle: ${source}`,
      `[META] Absender (WhatsApp/Telegram-Profilname): ${senderName || "Unbekannt"}`,
      `[META] Empfangen: ${timestampIso}`,
      `[META] Grund: ${reason}`,
    ];
    if (rawText.length > 0) {
      notesParts.push(`Originaltext: ${rawText}`);
    }
    const notes = notesParts.join("\n");

    const order = await prisma.order.create({
      data: {
        customerId: fallbackCustomer.id,
        description,
        serviceName: null,
        status: "Offen",
        priceType: "Stundensatz",
        unitPrice: 0,
        quantity: 0,
        totalPrice: 0,
        currency: fbIntakeCurrency,
        vatRate: fbIntakeVatRate,
        vatAmount: 0,
        total: 0,
        needsReview: true,
        reviewReasons: [reason],
        hinweisLevel: "warning",
        mediaUrl: savedMediaPath || null,
        mediaType: savedMediaType || null,
        imageUrls,
        thumbnailUrls,
        notes,
        userId,
        // Stage I — even on LLM-fallback we still track audio usage if duration was detected
        audioDurationSec:
          savedMediaType === "audio"
            ? typeof inputAudioDurationSec === "number" &&
              isFinite(inputAudioDurationSec)
              ? Math.max(0, Math.round(inputAudioDurationSec))
              : null
            : null,
        // On LLM-fallback for audio messages, status defaults to 'failed' unless caller provided one
        audioTranscriptionStatus:
          savedMediaType === "audio"
            ? inputAudioTranscriptionStatus || "failed"
            : null,
      },
    });

    console.log(
      `[${source}] 🛟 Fallback order created: ${order.id} (reason=${reason}, sender=${senderName})`,
    );

    logAuditAsync({
      userId,
      action: `ORDER_CREATED_FROM_${source.toUpperCase()}_FALLBACK`,
      area: "WEBHOOK",
      targetType: "Order",
      targetId: order.id,
      success: true,
      details: {
        reason,
        sender: senderName,
        customerId: fallbackCustomer.id,
        customer: FALLBACK_CUSTOMER_NAME,
        rawTextLength: rawText.length,
        imageCount: imageUrls.length,
        hasAudio: savedMediaType === "audio",
      },
    });

    logIntakeAudit({
      source,
      userId,
      phoneMasked: maskPhoneForLog(input.phoneNumber || null),
      senderName: senderName || "",
      mediaType: savedMediaType || null,
      hasTranscript: !!(rawText && rawText.trim().length > 0),
      transcriptLen: (rawText || "").length,
      llmExtractedName: null,
      llmAbgleichStatus: "ki_fehler",
      selfIntroFallbackUsed: false,
      resolvedCustomerName: FALLBACK_CUSTOMER_NAME,
      customerId: fallbackCustomer.id,
      customerWasNewlyCreated: false,
      customerNameInDb: FALLBACK_CUSTOMER_NAME,
      customerFallbackUsed: true,
      notes: `fallback: ${reason}`,
    });

    return {
      orderId: order.id,
      description,
      customerName: FALLBACK_CUSTOMER_NAME,
      serviceName: "",
      kundeStatus: "fallback_unknown",
      kundenabgleichStatus: "ki_fehler",
    };
  } catch (err: any) {
    console.error(
      `[${source}] ❌ Fallback order creation failed:`,
      err?.message || err,
    );
    logAuditAsync({
      userId,
      action: `ORDER_CREATE_FROM_${source.toUpperCase()}_FALLBACK_FAILED`,
      area: "WEBHOOK",
      success: false,
      details: {
        reason: `fallback_exception:${err?.message || "unknown"}`,
        originalReason: reason,
        sender: senderName,
      },
    });
    return null;
  }
}

// ────────────────────────────────────────────────────────────────────────
// Stage H — Cost optimization: long voice messages (>60 s)
// ────────────────────────────────────────────────────────────────────────

export interface VoiceTooLongInput {
  /** 'WhatsApp' or 'Telegram'. */
  source: "Telegram" | "WhatsApp";
  /** WhatsApp ProfileName / Telegram first_name etc. */
  senderName: string;
  /** Sender phone (E.164) — only used for logging, not customer match. */
  phoneNumber?: string | null;
  /** S3 path of the original audio file (still archived/playable). */
  audioPath: string | null;
  /** Detected duration in seconds (rounded). null if duration parsing failed. */
  durationSec: number | null;
  /** Resolved owner of the message intake. */
  userId: string | null;
  /** Optional preview paths of images that came with the same message. */
  imagePreviewPaths?: string[];
  /** Optional thumbnail paths of images that came with the same message. */
  imageThumbnailPaths?: string[];
  /**
   * Why this review order is being created.
   *  - `'too_long'` (default): duration was reliably detected and exceeds the 60 s cap.
   *    Warning: "⚠️ Sprachnachricht länger als 60 Sekunden – bitte manuell prüfen".
   *  - `'uncheckable'`: duration could not be determined safely (parse failure,
   *    no metadata, FFmpeg probe failure). Audio was NOT transcribed in order to
   *    protect the cost cap — manual review is required.
   *    Warning: "⚠️ Sprachnachricht konnte zeitlich nicht geprüft werden – bitte manuell prüfen".
   *  - `'quota_exceeded'`: monthly audio-minute plan limit (e.g. 20 min on Standard)
   *    would be exceeded by transcribing this audio. Audio is saved + linked, but
   *    NOT transcribed — manual review required. Warning:
   *    "⚠️ Monatliches Audio-Limit erreicht – bitte manuell prüfen".
   *  - `'transcription_failed'`: OpenAI transcription returned an error (400, timeout,
   *    corrupted file, etc.). Audio is saved + linked, but no transcript available.
   *    Warning: "⚠️ Transkription fehlgeschlagen – bitte manuell prüfen".
   */
  reason?:
    | "too_long"
    | "uncheckable"
    | "quota_exceeded"
    | "transcription_failed";
  /**
   * Optional usage snapshot for the audit log when reason='quota_exceeded'.
   * Omitted in other paths.
   */
  quotaUsedMinutes?: number;
  /** Optional plan limit snapshot for the audit log when reason='quota_exceeded'. */
  quotaIncludedMinutes?: number;
}

/**
 * Creates a visible review order for a voice message that exceeds the 60s
 * cost-control cap, WITHOUT calling the LLM (cost-saving short-circuit).
 *
 * Mirrors the customer-fallback pattern of {@link createFallbackOrderFromRawPayload}:
 * - Per-user "⚠️ Unbekannt (WhatsApp)" customer (created on first use).
 * - `needsReview = true`, `hinweisLevel = 'warning'`, `reviewReasons = ['voice_too_long']`.
 * - Original audio is still linked (`mediaUrl`) so it remains playable in the order detail view.
 * - No transcription, no AI vision, no service detection.
 *
 * Description is the exact German warning text required by the spec.
 */
export async function createVoiceTooLongReviewOrder(
  input: VoiceTooLongInput,
): Promise<IntakeResult | null> {
  const {
    source,
    senderName,
    phoneNumber,
    audioPath,
    durationSec,
    userId,
    imagePreviewPaths,
    imageThumbnailPaths,
  } = input;
  const reason:
    | "too_long"
    | "uncheckable"
    | "quota_exceeded"
    | "transcription_failed" = input.reason ?? "too_long";
  const quotaUsedMinutes = input.quotaUsedMinutes;
  const quotaIncludedMinutes = input.quotaIncludedMinutes;

  if (!userId) {
    console.warn(
      `[${source}] ❌ createVoiceTooLongReviewOrder: missing userId — cannot create order.`,
    );
    return null;
  }

  // Resolve default VAT rate from CompanySettings (same logic as main intake path)
  const voiceSettings = await prisma.companySettings.findFirst({
    where: { userId },
  });
  const voiceIntakeCurrency = voiceSettings?.currency === "EUR" ? "EUR" : "CHF";
  const voiceIntakeVatRate: number =
    voiceSettings?.mwstAktiv === true && voiceSettings?.mwstSatz != null
      ? Number(voiceSettings.mwstSatz)
      : voiceSettings?.mwstAktiv === false
        ? 0
        : 8.1;

  const FALLBACK_CUSTOMER_NAME =
    source === "WhatsApp"
      ? "⚠️ Unbekannt (WhatsApp)"
      : "⚠️ Unbekannt (Telegram)";

  // Exact required German warning text — DO NOT change wording.
  const WARNING_DESCRIPTION =
    reason === "transcription_failed"
      ? "⚠️ Transkription fehlgeschlagen – bitte manuell prüfen"
      : reason === "quota_exceeded"
        ? "⚠️ Monatliches Audio-Limit erreicht – bitte manuell prüfen"
        : reason === "uncheckable"
          ? "⚠️ Sprachnachricht konnte zeitlich nicht geprüft werden – bitte manuell prüfen"
          : "⚠️ Sprachnachricht länger als 60 Sekunden – bitte manuell prüfen";

  // Lifecycle marker written to Order.audioTranscriptionStatus so usage and
  // CommunicationBlock chips can distinguish the cost-protection paths.
  const STATUS_VALUE:
    | "skipped_too_long"
    | "skipped_uncheckable"
    | "skipped_quota_exceeded"
    | "failed" =
    reason === "transcription_failed"
      ? "failed"
      : reason === "quota_exceeded"
        ? "skipped_quota_exceeded"
        : reason === "uncheckable"
          ? "skipped_uncheckable"
          : "skipped_too_long";

  // Tag in Order.reviewReasons array so dashboard filters can pick this up.
  const REVIEW_REASON_TAG:
    | "voice_too_long"
    | "voice_uncheckable"
    | "voice_quota_exceeded"
    | "voice_transcription_failed" =
    reason === "transcription_failed"
      ? "voice_transcription_failed"
      : reason === "quota_exceeded"
        ? "voice_quota_exceeded"
        : reason === "uncheckable"
          ? "voice_uncheckable"
          : "voice_too_long";

  // Audit suffix mirrors the existing `voice_too_long` events for traceability.
  const AUDIT_SUFFIX =
    reason === "transcription_failed"
      ? "VOICE_TRANSCRIPTION_FAILED"
      : reason === "quota_exceeded"
        ? "VOICE_QUOTA_EXCEEDED"
        : reason === "uncheckable"
          ? "VOICE_UNCHECKABLE"
          : "VOICE_TOO_LONG";

  try {
    // Upsert per-user fallback customer (same pattern as createFallbackOrderFromRawPayload)
    let fallbackCustomer = await prisma.customer.findFirst({
      where: { userId, name: FALLBACK_CUSTOMER_NAME, deletedAt: null },
      select: { id: true, name: true },
    });
    if (!fallbackCustomer) {
      fallbackCustomer = await prisma.customer.create({
        data: { name: FALLBACK_CUSTOMER_NAME, userId },
        select: { id: true, name: true },
      });
      console.log(
        `[${source}] 🆕 Fallback customer created (${REVIEW_REASON_TAG}): ${fallbackCustomer.id} for userId=${userId}`,
      );
    }

    const timestampIso = new Date().toISOString();
    const durationLabel =
      typeof durationSec === "number" && isFinite(durationSec)
        ? `${Math.round(durationSec)}s`
        : "unbekannt";

    // ─── Layer 1 of three-layer customer-data-pollution defense ───
    // Every metadata line (sender phone, timestamp, audio duration, ...) is
    // prefixed with the [META] tag so that the auto-fill heuristic in
    // lib/extract-from-notes.ts can deterministically skip these lines and
    // never mistake e.g. a Twilio sandbox number for the customer's phone or
    // a year out of an ISO timestamp for a PLZ.
    //
    // The warning description and the user-facing "Hinweis:" lines stay
    // unprefixed because they contain no extractable address-like patterns.
    const notes = [
      WARNING_DESCRIPTION,
      `[META] Quelle: ${source}`,
      `[META] Absender (WhatsApp/Telegram-Profilname): ${senderName || "Unbekannt"}`,
      phoneNumber
        ? `[META] Telefon (Absender, NICHT Kunde): ${phoneNumber}`
        : null,
      `[META] Empfangen: ${timestampIso}`,
      `[META] Audiodauer: ${durationLabel}`,
      reason === "quota_exceeded" &&
      typeof quotaUsedMinutes === "number" &&
      typeof quotaIncludedMinutes === "number"
        ? `[META] Audio-Verbrauch diesen Monat: ${Number.isInteger(quotaUsedMinutes) ? quotaUsedMinutes : quotaUsedMinutes.toFixed(1)} / ${quotaIncludedMinutes} Min`
        : null,
      reason === "quota_exceeded"
        ? "Audio ist im Auftrag abrufbar – bitte manuell anhören."
        : "Audio ist im Auftrag abrufbar – bitte manuell anhören.",
    ]
      .filter(Boolean)
      .join("\n");

    const imageUrls: string[] = (imagePreviewPaths || []).filter(
      Boolean,
    ) as string[];
    const thumbnailUrls: string[] = (imageThumbnailPaths || []).filter(
      Boolean,
    ) as string[];

    const order = await prisma.order.create({
      data: {
        customerId: fallbackCustomer.id,
        description: "",
        serviceName: null,
        status: "Offen",
        priceType: "Stundensatz",
        unitPrice: 0,
        quantity: 0,
        totalPrice: 0,
        currency: voiceIntakeCurrency,
        vatRate: voiceIntakeVatRate,
        vatAmount: 0,
        total: 0,
        needsReview: true,
        reviewReasons: [REVIEW_REASON_TAG],
        hinweisLevel: "warning",
        mediaUrl: audioPath || null,
        mediaType: audioPath ? "audio" : null,
        imageUrls,
        thumbnailUrls,
        notes,
        userId,
        // Stage I — audio usage tracking for the cost-cap path.
        // For 'uncheckable' we typically don't have a duration, so this stays null
        // (the order is intentionally excluded from the monthly minutes total).
        audioDurationSec:
          typeof durationSec === "number" && isFinite(durationSec)
            ? Math.max(0, Math.round(durationSec))
            : null,
        audioTranscriptionStatus: STATUS_VALUE,
      },
    });

    console.log(
      `[${source}] ⏱️ Voice review order created (reason=${reason}): orderId=${order.id} duration=${durationLabel} sender=${senderName} phone=${phoneNumber ?? "?"}`,
    );

    logAuditAsync({
      userId,
      action: `ORDER_CREATED_FROM_${source.toUpperCase()}_${AUDIT_SUFFIX}`,
      area: "WEBHOOK",
      targetType: "Order",
      targetId: order.id,
      success: true,
      details: {
        reason: REVIEW_REASON_TAG,
        sender: senderName,
        phone: phoneNumber ?? null,
        durationSec:
          typeof durationSec === "number" ? Math.round(durationSec) : null,
        customerId: fallbackCustomer.id,
        customer: FALLBACK_CUSTOMER_NAME,
        transcriptionSkipped: true,
        hasAudio: !!audioPath,
        imageCount: imageUrls.length,
      },
    });

    logIntakeAudit({
      source,
      userId: userId ?? null,
      phoneMasked: maskPhoneForLog(phoneNumber || null),
      senderName: senderName || "",
      mediaType: "audio",
      hasTranscript: false,
      transcriptLen: 0,
      llmExtractedName: null,
      llmAbgleichStatus: REVIEW_REASON_TAG,
      selfIntroFallbackUsed: false,
      resolvedCustomerName: FALLBACK_CUSTOMER_NAME,
      customerId: fallbackCustomer.id,
      customerWasNewlyCreated: false,
      customerNameInDb: FALLBACK_CUSTOMER_NAME,
      customerFallbackUsed: true,
      notes: `voice_review: ${REVIEW_REASON_TAG} dur=${typeof durationSec === "number" ? Math.round(durationSec) : "null"}`,
    });

    return {
      orderId: order.id,
      description: WARNING_DESCRIPTION,
      customerName: FALLBACK_CUSTOMER_NAME,
      serviceName: "",
      kundeStatus: "fallback_unknown",
      kundenabgleichStatus: REVIEW_REASON_TAG,
    };
  } catch (err: any) {
    console.error(
      `[${source}] ❌ createVoiceTooLongReviewOrder failed (reason=${reason}):`,
      err?.message || err,
    );
    logAuditAsync({
      userId,
      action: `ORDER_CREATE_FROM_${source.toUpperCase()}_${AUDIT_SUFFIX}_FAILED`,
      area: "WEBHOOK",
      success: false,
      details: {
        reason: `${REVIEW_REASON_TAG}_exception:${err?.message || "unknown"}`,
        sender: senderName,
        phone: phoneNumber ?? null,
        durationSec:
          typeof durationSec === "number" ? Math.round(durationSec) : null,
      },
    });
    return null;
  }
}
