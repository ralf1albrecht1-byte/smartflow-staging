/**
 * Utility to split specialNotes into system hints, safety warnings and real job hints.
 *
 * Rule:
 * The parser/merge logic writes semantic markers into specialNotes:
 * [GEFAHR], [WARNUNG], [HINWEIS].
 * The UI should not invent hazards only from generic words.
 */

const SYSTEM_KEYWORDS =
  /Kundentreffer|prüfen|geprüft|Confidence|⚠️|🚨|Kundendaten|Konflikt|Zuordnung|manuelle.*prüfung|Priorität.*HOCH|Mehrere Ausführungsorte|verbundenen Aufträge|unterschiedliche Arbeitsorte|Angebot\/Rechnung\/PDF|Türchip|Tuerchip|türchip|tuerchip/i;

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
  /\btermin\b.*\b(klären|klaeren|klaren|abstimmen|abgestimmt|abstimmung|koordinieren|vereinbaren|abmachen|melden|vorschlagen|offen|rücksprache|ruecksprache|rucksprache)\b|\b(rücksprache|ruecksprache|rucksprache|melden|abmachen|vorschlagen)\b.*\btermin\b|\bappointment\b.*\b(schedule|arrange)\b|\bschedule\b.*\bappointment\b|\brendez\s*vous\b.*\bfix|\bfixer\b.*\brendez\s*vous\b/i;

const FIXED_APPOINTMENT_HINT =
  /^Termin\b.*(?:\d{1,2}[.\-/]\d{1,2}|\d{1,2}:\d{2}|\b(?:vormittag|nachmittag|abend|uhr)\b)/i;

const PRE_ARRIVAL_HINT =
  /(?:nicht\s+einfach\s+(?:kommen|vorbeikommen)|nicht\s+ohne\s+(?:ruecksprache|rucksprache|absprache)\s+(?:kommen|vorbeikommen)|vor\s+(?:start|arbeitsbeginn|ankunft)\s+(?:kurz\s+)?(?:telefonisch\s+)?(?:melden|anrufen|kontaktieren)|erst\s+nach\s+(?:ruecksprache|rucksprache|absprache)\s+(?:kommen|vorbeikommen))/i;

const isOperationalJobHint = (value: string) => {
  const line = normalizeLine(value);
  if (!line) return false;
  if (isPureWorkSiteHeaderV17_32(line)) return false;
  if (isWorkSiteOnlySpecialNoteLineV17_33(line)) return false;
  if (isNonSafetyConditionLineV17_33(line)) return false;
  if (isServiceLikeSpecialNoteLineV17_32(line)) return false;
  if (APPOINTMENT_CLARIFY_HINT.test(line)) return true;
  if (PRE_ARRIVAL_HINT.test(line)) return true;
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

const extractAccessCodeV17_32 = (value: string): string => {
  const raw = stripKnownMarker(value);
  const match = raw.match(/(?:torcode|zugangscode|code)\D{0,18}(\d{2,8})/i) || raw.match(/\b(\d{3,8})\b/);
  return match?.[1] || "";
};

const isPureWorkSiteHeaderV17_32 = (value: string): boolean =>
  /^\s*(?:arbeitsort|ausfuehrungsort|ausführungsort|einsatzort|objekt)\s*:?\s*$/i.test(stripKnownMarker(value));

const isWorkSiteOnlySpecialNoteLineV17_33 = (value: string): boolean => {
  const body = stripKnownMarker(value);
  const text = normalizeDedupeText(body);
  if (!body || !text) return false;

  const startsAsWorkSite = /^\s*(?:arbeitsort|ausfuehrungsort|ausführungsort|einsatzort|objekt|baustelle)\s*:/i.test(body);
  const hasAddressEvidence = /\b\d{4,5}\b/.test(body) || /\b(?:strasse|straße|str\.?|weg|gasse|platz|allee|ring|rain|halde|steig|route|rue|avenue|av\.?|chemin|via|viale|street|road|lane)\s+\d+[a-z]?\b/i.test(body);
  const hasActionableSignal = /\b(?:schluessel|schlussel|schlüssel|key|code|torcode|zugangscode|schluesselbox|schlusselbox|schlüsselbox|briefkasten|hund|dog|chien|leiter|sms|whatsapp|telefon|anrufen|nicht\s+einfach|vorher|termin)\b/.test(text);

  return (startsAsWorkSite || hasAddressEvidence) && !hasActionableSignal;
};

const isNonSafetyConditionLineV17_33 = (value: string): boolean => {
  const text = normalizeDedupeText(value);
  if (!text) return false;

  const hasRealSafetyRisk = /\b(?:hund|dog|chien|oel|ol|oil|rutsch|glatt|slippery|strom|kabel|gas|rauch|scherb|glasbruch|asbest|schimmel|chem|feuer|brand|sturz|absturz|instabil|einsturz|gefahr|warnung)\b/.test(text);
  const isDirtOrConditionOnly = /\b(?:dreckig|verschmutzt|schmutzig|stark verschmutzt|dirty|sale|salissure|encrasse|verdreckt)\b/.test(text);
  const hasCleaningContext = /\b(?:boden|kueche|kuche|küche|eingang|raum|floor|sol|cuisine|reinigen|reinigung|nettoyage)\b/.test(text);

  return isDirtOrConditionOnly && hasCleaningContext && !hasRealSafetyRisk;
};

const isEquipmentOnlyWarningLineV17_34 = (value: string): boolean => {
  const text = normalizeDedupeText(value);
  if (!text) return false;

  // Eine Leiter ist Ausrüstung/Arbeitsmittel, kein roter Gefahrenhinweis.
  // Echte Gefahren wie Gas, Rauch, Strom, Rutschgefahr usw. bleiben rot.
  const hasLadder = /\bleiter\b|\bladder\b|\bechelle\b|\bescalera\b|\bscala\b|\bescada\b/.test(text);
  if (!hasLadder) return false;

  const hasRealSafetyRisk = /\b(?:hund|dog|chien|oel|ol|oil|rutsch|glatt|slippery|strom|kabel|gas|rauch|scherb|glasbruch|asbest|schimmel|chem|feuer|brand|sturz|absturz|instabil|einsturz)\b/.test(text);
  return !hasRealSafetyRisk;
};

const stripNoteSentencePunctuationV17_34 = (value: string): string =>
  String(value || "").replace(/[.;:,\s]+$/g, "").trim();

const isNoWhatsappOnlyLineV17_34 = (value: string): boolean => {
  const text = normalizeDedupeText(value);
  if (!text) return false;
  return /\b(?:kein|keine|keinen|ohne|no|not|pas|sans)\s+whatsapp\b|\bwhatsapp\s+(?:nicht|not|pas|nein)\b/.test(text) && !/\bsms\b/.test(text);
};

const isPreArrivalOnlyLineV17_34 = (value: string): boolean => {
  const text = normalizeDedupeText(value);
  if (!text) return false;
  return /\bnicht\s+einfach\s+(?:kommen|vorbeikommen)\b/.test(text) &&
    !/\b(?:whatsapp|sms|telefon|anrufen|kontaktieren|melden)\b/.test(text);
};

const isContactBeforeArrivalLineV17_34 = (value: string): boolean => {
  const text = normalizeDedupeText(value);
  if (!text) return false;
  return /\b(?:vorher|zuerst|vor\s+(?:ankunft|arbeitsbeginn|start))\b/.test(text) &&
    /\b(?:whatsapp|sms|telefon|anrufen|kontaktieren|melden)\b/.test(text);
};

const extractPhoneFromGenericNoteV17_35 = (value: string): string => {
  const match = stripKnownMarker(value).match(/\+?\d[\d\s()./-]{6,}\d/);
  return match ? match[0].replace(/\s+/g, " ").trim() : "";
};

const isWhatsappPhonePreferenceLineV17_35 = (value: string): boolean => {
  const text = normalizeDedupeText(value);
  if (!text) return false;
  return /\bwhatsapp\b/.test(text) && Boolean(extractPhoneFromGenericNoteV17_35(value)) && !/\bsms\b/.test(text);
};

const hasPreArrivalInstructionSignalV17_35 = (value: string): boolean =>
  /\bnicht\s+einfach\s+(?:kommen|vorbeikommen)\b/.test(normalizeDedupeText(value));

const buildCleanWhatsappPreArrivalLineV17_35 = (phoneLine: string, contactLine: string, preArrivalOnly: string): string => {
  const markerMatch =
    contactLine.match(/^\s*(\[(?:HINWEIS|INFO|NOTIZ)\])\s*/i) ||
    preArrivalOnly.match(/^\s*(\[(?:HINWEIS|INFO|NOTIZ)\])\s*/i) ||
    phoneLine.match(/^\s*(\[(?:HINWEIS|INFO|NOTIZ)\])\s*/i);
  const marker = markerMatch?.[1] || "[HINWEIS]";
  const phone = extractPhoneFromGenericNoteV17_35(phoneLine || contactLine);
  const contactBody = stripNoteSentencePunctuationV17_34(stripKnownMarker(contactLine));
  const needsNoEntry = hasPreArrivalInstructionSignalV17_35(contactLine) || hasPreArrivalInstructionSignalV17_35(preArrivalOnly);

  if (phone) {
    return `${marker} Vorher WhatsApp an ${phone}${needsNoEntry ? "; nicht einfach kommen" : ""}.`;
  }

  if (contactBody) {
    return `${marker} ${contactBody}${needsNoEntry && !hasPreArrivalInstructionSignalV17_35(contactBody) ? "; nicht einfach kommen" : ""}.`;
  }

  return `${marker} Nicht einfach kommen.`;
};

const mergePreArrivalInstructionLinesV17_34 = (lines: string[]): string[] => {
  const out: string[] = [];
  let preArrivalOnly = "";
  let contactLine = "";
  let whatsappPhoneLine = "";

  for (const line of lines) {
    if (isPreArrivalOnlyLineV17_34(line)) {
      preArrivalOnly = preArrivalOnly || line;
      continue;
    }
    if (isWhatsappPhonePreferenceLineV17_35(line)) {
      whatsappPhoneLine = whatsappPhoneLine || line;
      continue;
    }
    if (isContactBeforeArrivalLineV17_34(line)) {
      contactLine = contactLine || line;
      continue;
    }
    out.push(line);
  }

  if (contactLine && (preArrivalOnly || whatsappPhoneLine)) {
    out.push(buildCleanWhatsappPreArrivalLineV17_35(whatsappPhoneLine, contactLine, preArrivalOnly));
  } else if (whatsappPhoneLine && preArrivalOnly) {
    out.push(buildCleanWhatsappPreArrivalLineV17_35(whatsappPhoneLine, "", preArrivalOnly));
  } else if (contactLine && preArrivalOnly) {
    out.push(buildCleanWhatsappPreArrivalLineV17_35("", contactLine, preArrivalOnly));
  } else {
    if (contactLine) out.push(contactLine);
    if (whatsappPhoneLine) out.push(whatsappPhoneLine);
    if (preArrivalOnly) out.push(preArrivalOnly);
  }

  return out;
};

const isServiceLikeSpecialNoteLineV17_32 = (value: string): boolean => {
  const body = stripKnownMarker(value);
  const text = normalizeDedupeText(value);
  if (!body || !text) return false;

  const hasWorkAction = /(?:\b|[a-z])(?:reinigen|reinigung|gereinigt|putzen|saeubern|säubern|clean(?:ing)?|nettoyage|nettoyer|pulizia|pulire|limpieza|limpiar)\b/.test(text);
  const hasMeasureOrPrice =
    /\b\d+(?:[.,]\d+)?\s*(?:m2|m²|qm|quadratmeter|meter|laufmeter|stunden?|std|stueck|stück|stk|pcs?|chf|eur|euro|franken|stutz)\b/i.test(body) ||
    /\(\s*\d+(?:[.,]\d+)?\s*(?:m2|m²|qm|quadratmeter|meter|stueck|stück|stk)\s*\)/i.test(body) ||
    /\b(?:chf|eur|euro|franken|stutz)\s*\d/i.test(body);

  const actionCount = (text.match(/(?:\b|[a-z])(?:reinigen|reinigung|gereinigt|putzen|saeubern|säubern|clean(?:ing)?|nettoyage|nettoyer|pulizia|pulire|limpieza|limpiar)\b/g) || []).length;
  const hasListSeparator = /[,;+]/.test(body);
  const hasOperationalSignal = /\b(?:schluessel|schlussel|schlüssel|key|code|torcode|zugangscode|hund|dog|chien|leiter|sms|whatsapp|telefon|anrufen|nicht\s+einfach|vorher|termin)\b/.test(text);

  const hasServiceListSummary = hasListSeparator && actionCount >= 1 && /\b(?:anfahrt|fahrtkosten|fahrt|pauschale)\b/.test(text);
  const serviceLabelWordCount = text.split(/\s+/g).filter(Boolean).length;
  // V17.90L: kurze serviceartige Labels wie "Reinigung Garage" oder
  // "Garage Boden reinigen" sind Leistungszusammenfassungen, keine operativen
  // Besonderheiten. Ohne Kontakt-/Zugangs-/Gefahren-Signal gehören sie nicht in
  // die Hinweise.
  const isShortServiceLabel = hasWorkAction && !hasOperationalSignal && serviceLabelWordCount <= 6;

  return hasWorkAction && !hasOperationalSignal && (hasMeasureOrPrice || (hasListSeparator && actionCount >= 2) || hasServiceListSummary || isShortServiceLabel);
};

const canonicalSpecialNoteBodyV17_32 = (value: string): string => {
  let body = stripKnownMarker(value).replace(/\s+/g, " ").trim();
  if (!body) return "";
  if (isPureWorkSiteHeaderV17_32(body)) return "";
  if (isWorkSiteOnlySpecialNoteLineV17_33(body)) return "";
  if (isServiceLikeSpecialNoteLineV17_32(body)) return "";

  body = body
    .replace(/^Arbeitsort:\s*(?=Schl[üu]ssel|Schluessel|Schlussel|Key|Cl[eé]\b)/i, "")
    .replace(/\bCode\s+vorhanden\b/gi, "Code beim Hauswart")
    .replace(/\s+/g, " ")
    .trim();

  const normalized = normalizeDedupeText(body);
  const code = extractAccessCodeV17_32(body);

  const mentionsKeyBox =
    /\b(?:schluesselbox|schlusselbox|schlüsselbox|schluesselkasten|schlusselkasten|schlüsselkasten|codebox|boite a cle|boite a cles|boite a clef|boite a clefs|boîte à clé|boîte à clés)\b/.test(normalized) ||
    /\b(?:schlüssel|schluessel|schlussel|cle|clé|key)\b.*\b(?:box|kasten)\b/.test(normalized);
  if (mentionsKeyBox && code) return `Schlüssel in Schlüsselbox; Code ${code}.`;

  const mentionsKey = /\b(?:schluessel|schlussel|schlüssel|cle|clé|key)\b/.test(normalized);
  const mentionsCaretaker = /\b(?:hauswart|huuswart|caretaker|concierge)\b/.test(normalized);
  const mentionsMailbox = /\b(?:briefkasten|mailbox|letterbox)\b/.test(normalized);
  const codeHeldByCaretaker = /\b(?:code\s+(?:hat|het)\s+(?:er|sie)|code\s+beim\s+hauswart|code\s+hat\s+der\s+hauswart)\b/.test(normalized);

  if (!mentionsKey && mentionsCaretaker && (codeHeldByCaretaker || /code\s+beim\s+hauswart/.test(normalized))) {
    return "Schlüssel beim Hauswart; Code beim Hauswart.";
  }
  if (mentionsKey && mentionsCaretaker && mentionsMailbox && code) {
    return `Schlüssel liegt beim Hauswart im Briefkasten; Code ${code}.`;
  }
  if (mentionsKey && mentionsCaretaker && (codeHeldByCaretaker || /code\s+beim\s+hauswart/.test(normalized))) {
    return "Schlüssel beim Hauswart; Code beim Hauswart.";
  }
  if (mentionsKey && mentionsCaretaker && code) {
    return `Schlüssel beim Hauswart; Code ${code}.`;
  }
  if (mentionsKey && mentionsCaretaker) {
    return "Schlüssel beim Hauswart.";
  }

  return body;
};

const canonicalizeSpecialNoteLineV17_32 = (value: string): string => {
  const markerMatch = String(value || "").match(/^\s*(\[(?:GEFAHR|WARNUNG|WARNHINWEIS|HINWEIS|INFO|NOTIZ)\])\s*/i);
  const marker = markerMatch?.[1] || "";
  const body = canonicalSpecialNoteBodyV17_32(value);
  if (!body) return "";
  return marker ? `${marker} ${body}` : body;
};

const semanticNoteKey = (value: string) => {
  const canonicalLine = canonicalizeSpecialNoteLineV17_32(value);
  const visibleLine = stripKnownMarker(canonicalLine || value);
  const text = normalizeDedupeText(canonicalLine || value);
  if (!text) return "";

  const isCommunicationLine = /\b(?:sms|whatsapp|telefon|tel\.?|mail|email|e-mail)\b/i.test(visibleLine);
  if (
    !isCommunicationLine &&
    /^[^:]{2,120}:\s+/.test(visibleLine) &&
    !/^kontakt\s+vor\s+ort:\s*/i.test(visibleLine) &&
    /(?:whatsapp|sms|mail|email|e-mail|telefon|anruf|anrufen|rueckruf|ruckruf|rückruf|termin|uhr|schluessel|schlüssel|zugang|eingang|hauswart|rezeption)/i.test(visibleLine)
  ) {
    return text;
  }

  if (/\bhund\b|\bgartenhund\b|\bdog\b/.test(text)) return "dog";
  if (/\bleiter\b|\bladder\b/.test(text)) return "ladder";
  if (/\bschluessel\b|\bschlussel\b|\bschlüssel\b|\bkey\b|\bbriefkasten\b/.test(text)) {
    const code = extractAccessCodeV17_32(visibleLine);
    if (/schluesselbox|schlusselbox|schlüsselbox|schluesselkasten|schlusselkasten|schlüsselkasten|codebox/.test(text)) {
      return code ? `key:keybox:${code}` : "key:keybox";
    }
    if (/hauswart|huuswart|caretaker|concierge/.test(text)) return "key:hauswart";
    return code ? `key:${code}` : "key";
  }
  if (/\bzugang\b|\btor(?:code)?\b|\bseitentor\b|\baccess\b|\bseiteneingang\b|\bhintereingang\b|\bnebeneingang\b|\brampe\b|\bklingel\b|\blift\b/.test(text)) return "access";
  if (/\bparkplatz\b|\bparken\b|\bparking\b/.test(text)) return "parking";
  if (/(nicht einfach kommen|nicht einfach vorbeikommen|nicht ohne ruecksprache|nicht ohne rucksprache|vor arbeitsbeginn|vor start|vor ankunft).*(melden|anrufen|kontaktieren|kommen|whatsapp)|vorher melden/.test(text)) return "pre_arrival_instruction";
  if (/termin.*(klaeren|klaren|abstimmen|abgestimmt|abstimmung|koordinieren|vereinbaren|abmachen|melden)|ruecksprache.*termin|rucksprache.*termin/.test(text)) return "appointment_clarify";

  const hasNoCall = /nicht anrufen|nicht telefonisch|keine telefonische|kein telefon|no calls?|do not call|pas d appel|pas d appels|pas appeler|pas telephoner|ne pas appeler|ne pas telephoner|sans appel telephonique/.test(text);
  const hasNoWhatsapp = /(?:kein|keine|keinen|ohne|no|not|pas|sans)\s+whatsapp|whatsapp\s+(?:nicht|not|pas|nein)/.test(text);
  if (/\bsms\b/.test(text) && hasNoWhatsapp) return "communication_sms";
  if (/whatsapp/.test(text) && hasNoCall) return "communication_whatsapp_no_call";
  if (/\bsms\b/.test(text) && hasNoCall) return "communication_sms_no_call";
  if (/(?:mail|email|e mail|e-mail)/.test(text) && hasNoCall) return "communication_email_no_call";
  if (/\bsms\b/.test(text)) return "communication_sms";
  if (/whatsapp/.test(text)) return "communication_whatsapp";
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
    const value = normalizeLine(canonicalizeSpecialNoteLineV17_32(rawValue));
    if (!value) continue;

    const key = semanticNoteKey(value);
    if (!key) continue;

    const existing = byKey.get(key);
    if (existing && key === "communication_sms") {
      const merged = mergeCommunicationLinesV17_33([existing, value])[0] || existing;
      byKey.set(key, merged);
      continue;
    }
    if (existing && key === "communication_whatsapp") {
      const merged = mergePreArrivalInstructionLinesV17_34([existing, value])[0] || existing;
      byKey.set(key, merged);
      continue;
    }

    if (!existing || noteSpecificityScore(value) > noteSpecificityScore(existing)) {
      byKey.set(key, value);
    }
  }

  const semanticKeys = Array.from(byKey.keys());
  const hasSpecificKey = semanticKeys.some((key) => key.startsWith("key:"));
  if (hasSpecificKey) {
    byKey.delete("key");
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
    const line = normalizeLine(canonicalizeSpecialNoteLineV17_32(rawLine));
    if (!line) continue;

    if (SYSTEM_KEYWORDS.test(line)) {
      systemHints.push(stripKnownMarker(line));
      continue;
    }

    if (isSafetyWarningLine(line)) {
      const cleaned = stripKnownMarker(line);
      if (cleaned && isNonSafetyConditionLineV17_33(cleaned)) {
        continue;
      }
      if (cleaned && isEquipmentOnlyWarningLineV17_34(cleaned)) {
        if (isOperationalJobHint(cleaned)) jobHints.push(cleaned);
        continue;
      }
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
  const cleanedJobHints = mergePreArrivalInstructionLinesV17_34(
    mergeCommunicationLinesV17_33(dedupedJobHints),
  )
    .map(stripKnownMarker)
    .map(normalizeLine)
    .filter(Boolean);

  return {
    systemHints: dedupeSemanticLines(systemHints),
    safetyWarnings: dedupedSafetyWarnings,
    jobHints: cleanedJobHints,
  };
}

export function splitJobHints(jobHints: string[]): SplitJobHints {
  const hazards: string[] = [];
  const equipment: string[] = [];
  const operational: string[] = [];

  for (const rawHint of jobHints) {
    const hint = normalizeLine(canonicalizeSpecialNoteLineV17_32(rawHint));
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

function normalizeSpecialNoteLineV17_27(value: string): string {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function firstPhoneKeyV17_27(value: string): string {
  const match = String(value || "").match(/\+?\d[\d\s()./-]{6,}\d/);
  return match ? match[0].replace(/\D/g, "") : "";
}

function rebuildSpecialNoteLineV17_27(originalLine: string, body: string): string {
  const markerMatch = String(originalLine || "").match(/^\s*(\[(?:GEFAHR|WARNUNG|WARNHINWEIS|HINWEIS|INFO|NOTIZ)\])\s*/i);
  const marker = markerMatch?.[1] || "";
  const cleanedBody = body.replace(/\s+/g, " ").trim();
  return marker ? `${marker} ${cleanedBody}` : cleanedBody;
}

const extractPhoneFromNoteV17_33 = (value: string): string => {
  const match = String(value || "").match(/\+?\d[\d\s()./-]{6,}\d/);
  return match ? match[0].replace(/\s+/g, " ").trim() : "";
};

const extractContactTimeFromNoteV17_33 = (value: string): string => {
  const raw = stripKnownMarker(value);
  const between = raw.match(/(?:zwischen|von)\s*(\d{1,2})(?::(\d{2}))?\s*(?:und|bis|-)\s*(\d{1,2})(?::(\d{2}))?\s*(?:uhr)?/i);
  if (between) {
    const start = `${between[1]}${between[2] ? `:${between[2]}` : ""}`;
    const end = `${between[3]}${between[4] ? `:${between[4]}` : ""}`;
    return `zwischen ${start} und ${end} Uhr`;
  }
  const after = raw.match(/(?:ab|nach|erst\s+nach)\s*(\d{1,2})(?::(\d{2}))?\s*(?:uhr)?/i);
  if (after) return `ab ${after[1]}${after[2] ? `:${after[2]}` : ""} Uhr`;
  return "";
};

function mergeCommunicationLinesV17_33(lines: string[]): string[] {
  const out: string[] = [];
  const smsLines: string[] = [];
  const noWhatsappOnlyLines: string[] = [];

  for (const line of lines) {
    const key = semanticNoteKey(line);
    if (key === "communication_sms") {
      smsLines.push(line);
      continue;
    }
    if (isNoWhatsappOnlyLineV17_34(line)) {
      noWhatsappOnlyLines.push(line);
      continue;
    }
    out.push(line);
  }

  if (smsLines.length > 0) {
    const mergedSmsSource = [...smsLines, ...noWhatsappOnlyLines];
    const phone = mergedSmsSource.map(extractPhoneFromNoteV17_33).find(Boolean) || "";
    const time = mergedSmsSource.map(extractContactTimeFromNoteV17_33).find(Boolean) || "";
    const hasOnlySms = mergedSmsSource.some((line) => /\b(?:nur|only|seulement)\s+(?:per\s+)?sms\b/i.test(stripKnownMarker(line)));
    const noWhatsapp = mergedSmsSource.some((line) => /(?:kein|keine|no|pas)\s+whatsapp|pas\s+whatsapp/i.test(stripKnownMarker(line)));

    const parts = [hasOnlySms ? "Nur SMS als Kontakt" : "SMS-Kontakt bevorzugt"];
    if (phone) parts[0] += `: ${phone}`;
    if (time) parts.push(`bevorzugt ${time}`);
    if (noWhatsapp) parts.push("keine WhatsApp");

    out.push(`[HINWEIS] ${parts.join("; ")}.`);
  } else {
    out.push(...noWhatsappOnlyLines);
  }

  return out;
}

function compactSpecialNoteLinesV17_27(lines: string[]): string[] {
  const normalizedBodies = lines.map((line) => normalizeSpecialNoteLineV17_27(stripKnownMarker(line)));
  const whatsappContextLines = lines.filter((line) => {
    const key = normalizeSpecialNoteLineV17_27(stripKnownMarker(line));
    return /whatsapp/.test(key) && /(vorher|zuerst|termin|nicht einfach kommen|melden|schreiben|kontakt)/.test(key);
  });
  const whatsappPhones = new Set(whatsappContextLines.map(firstPhoneKeyV17_27).filter(Boolean));
  const seen = new Set<string>();
  const out: string[] = [];

  const seenSemantic = new Set<string>();

  lines.forEach((line, index) => {
    const canonicalLine = canonicalizeSpecialNoteLineV17_32(line);
    const body = stripKnownMarker(canonicalLine);
    let key = normalizeSpecialNoteLineV17_27(body) || normalizedBodies[index] || "";
    if (!key || !body) return;

    const isDanger = isSafetyWarningLine(canonicalLine || line);
    let nextBody = body;

    nextBody = nextBody.replace(/^Arbeiten sind nicht dort, sondern im\s+/i, "Arbeitsort: ");
    nextBody = nextBody.replace(/^Die Arbeiten sind nicht dort, sondern im\s+/i, "Arbeitsort: ");

    const phone = firstPhoneKeyV17_27(body);
    const isShortWhatsappPreference = /whatsapp\s+bevorzugt/i.test(body) || /^whatsapp\s*:/i.test(body);
    if (!isDanger && isShortWhatsappPreference && phone && whatsappPhones.has(phone)) {
      return;
    }

    if (!isDanger && /kontakt vor ort\s*:/i.test(body) && /rechnung\s+bitte\s+an/i.test(body)) {
      return;
    }
    if (!isDanger && /^rechnung\s+bitte\s+an\b/i.test(body)) {
      return;
    }

    const rebuilt = rebuildSpecialNoteLineV17_27(canonicalLine || line, nextBody);
    key = normalizeSpecialNoteLineV17_27(stripKnownMarker(rebuilt));
    const semanticKey = semanticNoteKey(rebuilt);
    if (!key || !semanticKey || seen.has(key) || seenSemantic.has(semanticKey)) return;
    seen.add(key);
    seenSemantic.add(semanticKey);
    out.push(rebuilt);
  });

  return mergePreArrivalInstructionLinesV17_34(mergeCommunicationLinesV17_33(out));
}

export function buildSpecialNotes(input: {
  safetyWarnings?: string[];
  jobHints?: string[];
  systemHints?: string[];
}) {
  const rawSafetyWarnings = (input.safetyWarnings ?? []).map(canonicalizeSpecialNoteLineV17_32).filter(Boolean);
  const demotedSafetyHints = rawSafetyWarnings
    .map(stripKnownMarker)
    .filter((line) => isEquipmentOnlyWarningLineV17_34(line));
  const safetyWarnings = rawSafetyWarnings.filter((line) => {
    const cleaned = stripKnownMarker(line);
    return !isNonSafetyConditionLineV17_33(cleaned) && !isEquipmentOnlyWarningLineV17_34(cleaned);
  });
  const jobHints = [...(input.jobHints ?? []), ...demotedSafetyHints]
    .map(canonicalizeSpecialNoteLineV17_32)
    .filter((line) => !isNonSafetyConditionLineV17_33(line))
    .filter(isOperationalJobHint);
  const systemHints = (input.systemHints ?? []).map(canonicalizeSpecialNoteLineV17_32).filter(Boolean);

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

  return Array.from(new Set(compactSpecialNoteLinesV17_27(lines))).join("\n");
}

export function hasWarningKeywords(text: string): boolean {
  if (!text) return false;
  return text
    .split("\n")
    .some((line) => isSafetyWarningLine(line));
}

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

const normalizeCallbackText = (value: string) =>
  value
    .toLowerCase()
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
