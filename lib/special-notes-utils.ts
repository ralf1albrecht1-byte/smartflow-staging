/**
 * Utility to split specialNotes into system hints, safety warnings and real job hints.
 *
 * New rule:
 * The UI does not guess hazards from words/languages anymore.
 * The parser/merge logic must write semantic markers into specialNotes:
 *
 * [GEFAHR] Hund frei auf Grundstück
 * [GEFAHR] Offene Stromkabel im Keller
 * [HINWEIS] Leiter eventuell benötigt
 * [HINWEIS] Rückruf vor Arbeitsbeginn
 *
 * Backward compatibility:
 * - Existing unmarked lines are treated as normal job hints.
 * - Existing system/check lines are still separated into systemHints.
 */

const SYSTEM_KEYWORDS =
  /Kundentreffer|prüfen|geprüft|Confidence|⚠️|🚨|Kundendaten|Konflikt|Zuordnung|manuelle.*prüfung|Priorität.*HOCH|Mehrere Ausführungsorte|verbundenen Aufträge|unterschiedliche Arbeitsorte|Angebot\/Rechnung\/PDF/i;

const SAFETY_MARKER = /^\s*\[(GEFAHR|WARNUNG|WARNHINWEIS)\]\s*/i;
const HINT_MARKER = /^\s*\[(HINWEIS|INFO|NOTIZ)\]\s*/i;

export interface SplitNotes {
  systemHints: string[];
  safetyWarnings: string[];
  jobHints: string[];
}

export interface SplitJobHints {
  hazards: string[];
  equipment: string[];
  operational: string[];
}

const normalizeLine = (value: string) => value.replace(/\s+/g, " ").trim();

const NON_OPERATIONAL_JOB_HINT =
  /^(Arbeit am\b|Ausführung am\b|Ausfuehrung am\b|Mehrere Ausführungsorte\b|Mehrere Ausfuehrungsorte\b)/i;

const APPOINTMENT_CLARIFY_HINT =
  /\btermin\b.*\b(klären|klaeren|klaren|abstimmen|vereinbaren|abmachen|melden|vorschlagen|offen|rücksprache|ruecksprache|rucksprache)\b|\b(rücksprache|ruecksprache|rucksprache|melden|abmachen|vorschlagen)\b.*\btermin\b|\bappointment\b.*\b(schedule|arrange)\b|\bschedule\b.*\bappointment\b|\brendez\s*vous\b.*\bfix|\bfixer\b.*\brendez\s*vous\b/i;

const FIXED_APPOINTMENT_HINT =
  /^Termin\b.*(?:\d{1,2}[.\-/]\d{1,2}|\d{1,2}:\d{2}|\b(?:vormittag|nachmittag|abend|uhr)\b)/i;

const isOperationalJobHint = (value: string) => {
  const line = normalizeLine(value);
  if (!line) return false;
  if (APPOINTMENT_CLARIFY_HINT.test(line)) return true;
  if (/(?:nicht\s+einfach\s+(?:kommen|vorbeikommen)|nicht\s+ohne\s+(?:ruecksprache|rucksprache|absprache)\s+(?:kommen|vorbeikommen)|vor\s+(?:start|arbeitsbeginn|ankunft)\s+(?:kurz\s+)?(?:telefonisch\s+)?(?:melden|anrufen|kontaktieren)|erst\s+nach\s+(?:ruecksprache|rucksprache|absprache)\s+(?:kommen|vorbeikommen))/i.test(line)) return true;
  if (FIXED_APPOINTMENT_HINT.test(line)) return false;
  return !NON_OPERATIONAL_JOB_HINT.test(line);
};
const fixVisibleNoteGrammar = (value: string) =>
  value
    .replace(/\bKeine telefonische Rückruf notwendig\b/gi, "Kein telefonischer Rückruf notwendig")
    .replace(/\bKeine telefonische Rückrufwunsch\b/gi, "Kein telefonischer Rückrufwunsch")
    .replace(/\bKeine telefonischer Rückrufwunsch\b/gi, "Kein telefonischer Rückrufwunsch");

const stripKnownMarker = (line: string) =>
  fixVisibleNoteGrammar(
    normalizeLine(line.replace(SAFETY_MARKER, "").replace(HINT_MARKER, "")),
  );

const normalizeDedupeText = (value: string) =>
  stripKnownMarker(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const semanticNoteKey = (value: string) => {
  const visibleLine = stripKnownMarker(value);
  const text = normalizeDedupeText(value);
  if (!text) return "";

  // Grouped merge notes must not be collapsed across work sites.
  // Example: "Haus B · Limmatweg 14: Nicht telefonisch zurückrufen"
  // and "Haus A · Limmatweg 12: Keine telefonische Rückfrage" are
  // two different operational instructions, even if both are "no call".
  if (
    /^[^:]{2,120}:\s+/.test(visibleLine) &&
    !/^kontakt\s+vor\s+ort:\s*/i.test(visibleLine) &&
    /(?:whatsapp|sms|mail|email|e-mail|telefon|anruf|anrufen|rueckruf|ruckruf|rückruf|termin|uhr|schluessel|schlüssel|zugang|eingang|hauswart|rezeption)/i.test(visibleLine)
  ) {
    return text;
  }

  if (/\bhund\b|\bgartenhund\b|\bdog\b/.test(text)) return "dog";
  if (/\bleiter\b|\bladder\b/.test(text)) return "ladder";
  if (/\bschluessel\b|\bschluessel\b|\bkey\b|\bbriefkasten\b/.test(text)) return "key";
  if (/\bzugang\b|\beingang\b|\btor\b|\bseitentor\b|\baccess\b/.test(text)) return "access";
  if (/\bparkplatz\b|\bparken\b|\bparking\b/.test(text)) return "parking";
  if (/(nicht einfach kommen|nicht einfach vorbeikommen|nicht ohne ruecksprache|nicht ohne rucksprache|vor arbeitsbeginn|vor start|vor ankunft).*(melden|anrufen|kontaktieren|kommen|whatsapp)|vorher melden/.test(text)) return "pre_arrival_instruction";
  if (/termin.*(klaeren|klaren|abstimmen|vereinbaren|abmachen|melden)|ruecksprache.*termin|rucksprache.*termin/.test(text)) return "appointment_clarify";
  const hasNoCall = /nicht anrufen|nicht telefonisch|keine telefonische|kein telefon|no calls?|do not call|pas d appel|pas d appels|pas appeler|pas telephoner|ne pas appeler|ne pas telephoner|sans appel telephonique/.test(text);
  if (/whatsapp/.test(text) && hasNoCall) return "communication_whatsapp_no_call";
  if (/\bsms\b/.test(text) && hasNoCall) return "communication_sms_no_call";
  if (/(?:mail|email|e mail|e-mail)/.test(text) && hasNoCall) return "communication_email_no_call";
  if (/whatsapp/.test(text)) return "communication_whatsapp";
  if (/\bsms\b/.test(text)) return "communication_sms";
  if (hasNoCall) return "communication_no_call";
  if (/mail|email|e mail|e-mail/.test(text)) return "communication_email";
  if (/\brueckruf\b|\bruckruf\b|\banrufen\b|\btelefonisch\b|\btelefon\b/.test(text)) return "callback";

  return text;
};

const noteSpecificityScore = (value: string) => {
  const text = normalizeDedupeText(value);
  let score = text.length;

  if (/frei|laeuft frei|läuft frei|achtung|gefahr|warnung/.test(text)) score += 100;
  if (/benoetigt|benötigt|noetig|nötig/.test(text)) score += 80;
  if (/bitte|nur|nicht anrufen|nicht telefonisch|keine telefonische|pas d appel|pas appeler|mail reicht|whatsapp|sms|nicht einfach|vor arbeitsbeginn|vor start|vor ankunft|nach \d{1,2}|ab \d{1,2}|erst nach \d{1,2}/.test(text)) score += 90;
  if (/\+\d|\b0\d{2,}\b/.test(text)) score += 80;
  if (/eventuell|vielleicht|moeglich|möglich/.test(text)) score -= 30;
  if (/vor ort/.test(text)) score -= 20;

  return score;
};

const dedupeSemanticLines = (values: string[]) => {
  const byKey = new Map<string, string>();

  for (const rawValue of values) {
    const value = normalizeLine(rawValue);
    if (!value) continue;

    const key = semanticNoteKey(value);
    if (!key) continue;

    const existing = byKey.get(key);
    if (!existing || noteSpecificityScore(value) > noteSpecificityScore(existing)) {
      byKey.set(key, value);
    }
  }

  return Array.from(byKey.values());
};

export const isSafetyWarningLine = (line: string | null | undefined) => {
  if (!line) return false;
  return SAFETY_MARKER.test(line);
};

export const isHintLine = (line: string | null | undefined) => {
  if (!line) return false;
  return HINT_MARKER.test(line);
};

export const formatSafetyWarningLine = (line: string) => {
  const cleaned = stripKnownMarker(line);
  return cleaned ? `[GEFAHR] ${cleaned}` : "";
};

export const formatHintLine = (line: string) => {
  const cleaned = stripKnownMarker(line);
  return cleaned ? `[HINWEIS] ${cleaned}` : "";
};

/**
 * Splits specialNotes text into:
 * - systemHints: internal review/customer matching hints
 * - safetyWarnings: lines explicitly marked with [GEFAHR] / [WARNUNG]
 * - jobHints: lines explicitly marked with [HINWEIS] or unmarked legacy lines
 */
export function splitSpecialNotes(text: string | null | undefined): SplitNotes {
  if (!text || !text.trim()) {
    return { systemHints: [], safetyWarnings: [], jobHints: [] };
  }

  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const systemHints: string[] = [];
  const safetyWarnings: string[] = [];
  const jobHints: string[] = [];

  for (const rawLine of lines) {
    const line = normalizeLine(rawLine);
    if (!line) continue;

    if (SYSTEM_KEYWORDS.test(line)) {
      systemHints.push(stripKnownMarker(line));
      continue;
    }

    if (isSafetyWarningLine(line)) {
      const cleaned = stripKnownMarker(line);
      if (cleaned) safetyWarnings.push(cleaned);
      continue;
    }

    const cleaned = stripKnownMarker(line);
    if (cleaned && isOperationalJobHint(cleaned)) jobHints.push(cleaned);
  }

  const dedupedSafetyWarnings = dedupeSemanticLines(safetyWarnings);
  const safetyKeys = new Set(dedupedSafetyWarnings.map(semanticNoteKey));
  const dedupedJobHints = dedupeSemanticLines(jobHints).filter(
    (line) => !safetyKeys.has(semanticNoteKey(line)),
  );

  return {
    systemHints: dedupeSemanticLines(systemHints),
    safetyWarnings: dedupedSafetyWarnings,
    jobHints: dedupedJobHints,
  };
}

/**
 * Legacy helper kept for existing UI/components.
 *
 * New behavior:
 * - Only explicit [GEFAHR] / [WARNUNG] markers are treated as hazards.
 * - No language/keyword guessing.
 * - "equipment" is intentionally empty unless a future explicit marker is added.
 * - Unmarked lines are operational hints.
 */
export function splitJobHints(jobHints: string[]): SplitJobHints {
  const hazards: string[] = [];
  const equipment: string[] = [];
  const operational: string[] = [];

  for (const rawHint of jobHints) {
    const hint = normalizeLine(rawHint);
    if (!hint) continue;

    if (isSafetyWarningLine(hint)) {
      const cleaned = stripKnownMarker(hint);
      if (cleaned) hazards.push(cleaned);
      continue;
    }

    const cleaned = stripKnownMarker(hint);
    if (cleaned) operational.push(cleaned);
  }

  return { hazards, equipment, operational };
}

/**
 * Combines notes back into the stored specialNotes format.
 * Use this whenever saving merged/edited notes so markers stay consistent.
 */
export function buildSpecialNotes(input: {
  safetyWarnings?: string[];
  jobHints?: string[];
  systemHints?: string[];
}) {
  const safetyWarnings = input.safetyWarnings ?? [];
  const jobHints = (input.jobHints ?? []).filter(isOperationalJobHint);
  const systemHints = input.systemHints ?? [];

  const dedupedSafetyWarnings = dedupeSemanticLines(safetyWarnings);
  const safetyKeys = new Set(dedupedSafetyWarnings.map(semanticNoteKey));
  const dedupedJobHints = dedupeSemanticLines(jobHints).filter(
    (line) => !safetyKeys.has(semanticNoteKey(line)),
  );

  const lines = [
    ...dedupedSafetyWarnings.map(formatSafetyWarningLine),
    ...dedupedJobHints.map(formatHintLine),
    ...dedupeSemanticLines(systemHints).map(stripKnownMarker),
  ]
    .map((line) => line.trim())
    .filter(Boolean);

  return Array.from(new Set(lines)).join("\n");
}

/**
 * Checks if a text contains explicit warning markers.
 * No keyword/language guessing.
 */
export function hasWarningKeywords(text: string): boolean {
  if (!text) return false;
  return text
    .split("\n")
    .some((line) => isSafetyWarningLine(line));
}

/**
 * Returns React-compatible segments.
 * New behavior: the whole line is marked as warning only when it has [GEFAHR]/[WARNUNG].
 */
export function getWarningSegments(
  text: string,
): Array<{ text: string; isWarning: boolean }> {
  if (!text) return [];

  return text.split("\n").flatMap((line, index, arr) => {
    const cleaned = stripKnownMarker(line);
    const segment = {
      text: cleaned,
      isWarning: isSafetyWarningLine(line),
    };

    if (index < arr.length - 1) {
      return [segment, { text: "\n", isWarning: false }];
    }

    return [segment];
  });
}

/**
 * Callback detection should be handled semantically by the parser in the future.
 * Kept only for existing imports; does not guess from language-specific keywords anymore.
 */
const normalizeCallbackText = (value: string) =>
  value
    .toLowerCase()
    // Map German umlauts before Unicode accent stripping. Otherwise
    // "Rückruf" becomes "ruckruf" and older "rueckruf" patterns miss it.
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const CALLBACK_WORD = "(?:rueckruf|ruckruf)";
const CALL_BACK_VERB = "(?:zurueckrufen|zuruckrufen|anrufen|telefonieren|melden|kontaktieren)";
const CALLBACK_NEGATIVE_PATTERN = new RegExp(
  `\\b(?:nicht\\s+(?:telefonisch\\s+)?${CALL_BACK_VERB}|kein(?:e[nm]?)?\\s+(?:telefonischer\\s+)?(?:${CALLBACK_WORD}|anruf)|${CALLBACK_WORD}\\s+(?:nicht\\s+)?(?:noetig|notig|erwuenscht)|nicht\\s+erwuenscht)\\b`,
  "i",
);
const CALLBACK_POSITIVE_PATTERN = new RegExp(
  [
    `${CALLBACK_WORD}\\s+(?:gewuenscht|erwuenscht|bitte|vor|arbeitsbeginn|ankunft)`,
    `telefonischer\\s+${CALLBACK_WORD}`,
    `bitte\\s+${CALL_BACK_VERB}`,
    `vorher\\s+${CALL_BACK_VERB}`,
    `vor\\s+ankunft\\s+(?:kurz\\s+)?${CALL_BACK_VERB}`,
    `telefonisch\\s+(?:abklaeren|melden|kontaktieren)`,
    `kunde\\s+moechte\\s+(?:${CALLBACK_WORD}|anruf)`,
    `\\d+\\s*minuten\\s+(?:vorher|vor\\s+arbeitsbeginn|vor\\s+ankunft)\\s+${CALL_BACK_VERB}`,
    `vor\\s+(?:start|arbeitsbeginn|ankunft)\\s+(?:kurz\\s+)?(?:telefonisch\\s+)?${CALL_BACK_VERB}`,
  ].join("|"),
  "i",
);

const isNegativeCallbackLine = (line: string) => {
  const text = normalizeCallbackText(line);
  if (!text) return true;

  return (
    CALLBACK_NEGATIVE_PATTERN.test(text) ||
    /\b(klingeln|warten|haupteingang|kunde\s+ist\s+vor\s+ort|kundin\s+ist\s+vor\s+ort|oeffnet\s+die\s+tuer|offnet\s+die\s+tur)\b/i.test(text)
  );
};

/**
 * Callback detection is intentionally positive-only.
 * Negative instructions such as "Kein Rückruf" or "Nicht telefonisch
 * zurückrufen" must never create a callback chip.
 */
export function detectCallbackRequest(
  text: string | null | undefined,
): string | null {
  if (!text) return null;

  const { jobHints } = splitSpecialNotes(text);
  const callbackHint = jobHints.find((line) => {
    const normalized = normalizeCallbackText(line);
    if (isNegativeCallbackLine(line)) return false;
    return CALLBACK_POSITIVE_PATTERN.test(normalized);
  });

  return callbackHint || null;
}

/**
 * Checks if a customer has complete address data (Straße + PLZ + Ort).
 */
export function hasCompleteAddress(
  customer:
    | { address?: string | null; plz?: string | null; city?: string | null }
    | null
    | undefined,
): boolean {
  if (!customer) return false;
  return !!(
    customer.address?.trim() &&
    customer.plz?.trim() &&
    customer.city?.trim()
  );
}
