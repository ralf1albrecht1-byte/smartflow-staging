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

const isDogSafetyNoteV17_90L34 = (value: string): boolean =>
  /\b(?:hund|dog|chien)\b/i.test(normalizeDedupeText(value));

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

const stripProtectedRoleMarkerV17_90L103 = (line: string) =>
  normalizeLine(
    String(line || "").replace(SAFETY_MARKER, "").replace(HINT_MARKER, ""),
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
// V17.90L104: Structured role markers are authoritative after the first AI pass.
// Text and role are preserved. We remove exact formatting duplicates and, only
// for the same structured access identity, retain the more complete source line
// (for example the version that also contains its code). No wording is created.
const dedupeProtectedRoleLinesV17_90L103 = (values: string[]): string[] => {
  const exactSeen = new Set<string>();
  const ordered: string[] = [];

  for (const rawValue of values) {
    const value = stripProtectedRoleMarkerV17_90L103(String(rawValue || ""));
    const exactKey = normalizeDedupeText(value);
    if (!value || !exactKey || exactSeen.has(exactKey)) continue;
    exactSeen.add(exactKey);
    ordered.push(value);
  }

  const accessByKey = new Map<string, string>();
  const passthrough: string[] = [];
  const completenessScore = (value: string) => {
    const digitCount = (value.match(/\d/g) || []).length;
    const tokenCount = normalizeDedupeText(value)
      .split(/\s+/g)
      .filter(Boolean).length;
    return digitCount * 1000 + tokenCount * 10 + value.length;
  };

  for (const value of ordered) {
    const semanticKey = semanticNoteKey(value);
    if (!semanticKey.startsWith("key:") && semanticKey !== "key") {
      passthrough.push(value);
      continue;
    }

    const existing = accessByKey.get(semanticKey);
    if (!existing || completenessScore(value) > completenessScore(existing)) {
      accessByKey.set(semanticKey, value);
    }
  }

  const accessKeys = Array.from(accessByKey.keys());
  if (accessKeys.some((key) => key.startsWith("key:keybox:"))) {
    accessByKey.delete("key:keybox");
    accessByKey.delete("key");
  } else if (accessKeys.some((key) => key !== "key")) {
    accessByKey.delete("key");
  }

  return [...passthrough, ...accessByKey.values()];
};


export type SpecialNoteSemanticRoleV17_90L93 =
  | "safety"
  | "access"
  | "parking"
  | "equipment"
  | "communication"
  | "appointment"
  | "operational"
  | "unknown";

/**
 * Shared semantic role guard for customer notes. This is deliberately based on
 * generic roles (risk, access, parking, communication, schedule), not on a
 * customer- or service-specific vocabulary. All consumers use the same result
 * so a note cannot be red in one view and yellow in another.
 */
export function classifySpecialNoteRoleV17_90L93(
  value: string | null | undefined,
): SpecialNoteSemanticRoleV17_90L93 {
  const raw = stripKnownMarker(String(value || ""));
  const text = normalizeDedupeText(raw);
  if (!text) return "unknown";

  // A dog presence always remains a red dog warning in Smartflow. Severity is
  // conveyed by the full tooltip; ordinary dog presence must not disappear.
  if (/\b(?:hund|hunde|dog|dogs|chien|chiens|cane|cani|perro|perros)\b/.test(text)) {
    return "safety";
  }

  const explicitPhysicalRisk =
    /\b(?:unter spannung|sous tension|under voltage|live electrical|stromschlag|elektrisch(?:er|e|es)? schlag|electrical cabinet|electric cabinet|switchboard|quadro elettrico|schaltschrank|sicherungskasten|gasleitung|gas pipe|conduite de gaz|tubo del gas|gasleck|heisse? leitungen?|heisse? rohre?|hot pipes?|hot lines?|conduites? chaudes?|dampfleitung|steam pipe|conduite de vapeur|rutschgefahr|rutschig|slippery|glissant|scivoloso|glatt|absturz|einsturz|instabil|giftig|toxic|aetzend|corrosive|explosiv|brandgefahr|fire hazard|feuer|asbest|asbestos|scherben|glasbruch|broken glass|schimmel|mold|niedrige leitungen|niedrige decke|low pipes?|low ceiling|kopfhoehe|schwerer? \w+.{0,45}nicht alleine|heavy \w+.{0,45}not alone|aggressiv|aggressive|beisst|beißt|bites?|laeuft frei|läuft frei|running freely)\b/.test(
      text,
    );
  const safetyAction =
    /\b(?:nicht anfassen|nicht beruehren|nicht berühren|do not touch|ne pas toucher|non toccare|nicht oeffnen|nicht öffnen|do not open|ne pas ouvrir|non aprire|nicht alleine bewegen|do not move alone|vorsicht|achtung|gefahr|warnung|warning|danger)\b/.test(
      text,
    );
  if (explicitPhysicalRisk || (safetyAction && /\b(?:strom|elektr|electric|gas|leitung|line|pipe|rohr|dampf|steam|schrank|cabinet|switchboard|glas|glass|chem|maschine|machine|tresor|safe)\b/.test(text))) {
    return "safety";
  }

  if (
    /\b(?:parkplatz|besucherfeld|besucherparkplatz|lieferantenfeld|ladezone|anlieferung|parken|parkieren|parking|stellplatz|parking space|underground parking)\b/.test(
      text,
    )
  ) {
    return "parking";
  }

  if (
    /\b(?:schluessel|schlussel|schlüssel|key|badge|keycard|schluesselkarte|schlusselkarte|schlüsselkarte|zugang|zutritt|eingang|hintereingang|seiteneingang|concierge|schluesselbox|schlusselbox|schlüsselbox|schluesseltresor|schlusseltresor|schlüsseltresor|zugangscode|torcode|code|pin|rampe|lift|aufzug|security desk|nachtportier)\b/.test(
      text,
    )
  ) {
    return "access";
  }

  if (/\b(?:leiter|ladder|echelle|scala|escalera|escada|arbeitsbuehne|arbeitsbühne)\b/.test(text)) {
    return "equipment";
  }

  if (
    /\b(?:kontakt|ansprechperson|vor ort|on site|onsite|contact sur place|sms|whatsapp|mail|email|e mail|anrufen|telefon|rueckruf|ruckruf|nicht telefonisch|keine anrufe|do not call|no calls)\b/.test(
      text,
    )
  ) {
    return "communication";
  }

  if (
    /\b(?:termin|zeitfenster|appointment|rendez vous|datum)\b/.test(text) &&
    /\b(?:\d{1,2}[./-]\d{1,2}|\d{1,2}:\d{2}|vormittag|nachmittag|abend)\b/.test(text)
  ) {
    return "appointment";
  }

  const timedOperatingRule =
    /\b(?:darf|soll|muss|kann|erst ab|erst nach|nur ab|nur nach|vor \d{1,2}(?::\d{2})?)\b/.test(text) &&
    /\b(?:abschalten|abgeschaltet|ausgeschaltet|ausschalten|einschalten|reserviert|verfuegbar|verfügbar|betrieb|oeffnen|öffnen|schliessen|schließen)\b/.test(text);
  const courtesyOrWorkflow =
    /\b(?:bewohner|patienten|gaeste|gaste|kinder|serverteam|mitarbeiter|arbeitsplaetze|arbeitsplätze|rezeption|empfang|lebensmittel|fluchtweg\w*|laufweg\w*|tor|\w*tuer|\w*tür|\w*tur|reception|guests?|residents?|food|escape route|walkway|gate|door)\b/.test(text) &&
    /\b(?:nicht stoeren|nicht storen|ruhig|leise|schlafen|weiterarbeiten|arbeitet weiter|nicht blockieren|freihalten|nicht zustellen|nicht abstellen|abstellen|nicht verschieben|wieder schliessen|wieder schließen|zumachen|offen halten|do not disturb|keep quiet|quietly|keep.{0,35}free|do not block|do not move|close again|keep open|ne pas bloquer|non bloccare)\b/.test(text);
  const materialOrMethod =
    /\b(?:reiniger|reinigungsmittel|mittel|produkt|material|geruchsarm|duftfrei|schonend|keine stark riechenden|stark riechend|strongly scented|strong scented|low odor|low odour|chemicals?|vorsichtig absaugen)\b/.test(text);
  if (timedOperatingRule || courtesyOrWorkflow || materialOrMethod) {
    return "operational";
  }

  return "unknown";
}

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
  const hasActionableSignal = /\b(?:schluessel|schlussel|schlüssel|key|code|torcode|zugangscode|schluesselbox|schlusselbox|schlüsselbox|briefkasten|hund|dog|chien|leiter|parkplatz|parken|parkieren|parking|stellplatz|sms|whatsapp|telefon|anrufen|nicht\s+einfach|vorher|termin)\b/.test(text);

  const isNarrativeWorkSiteOnly =
    /^(?:die\s+)?arbeiten\s+(?:sind|finden\s+statt)\s+(?:im|in|bei|am)\s+.+/i.test(
      body,
    );

  return (
    (startsAsWorkSite || hasAddressEvidence || isNarrativeWorkSiteOnly) &&
    !hasActionableSignal
  );
};

const isNonSafetyConditionLineV17_33 = (value: string): boolean => {
  const text = normalizeDedupeText(value);
  if (!text) return false;

  const hasRealSafetyRisk = /\b(?:hund|dog|chien|oel|ol|oil|rutsch|glatt|slippery|strom|kabel|gas|rauch|scherb|glasbruch|asbest|schimmel|chem|feuer|brand|sturz|absturz|instabil|einsturz|gefahr|warnung)\b/.test(text);
  const isDirtOrConditionOnly = /\b(?:dreckig|verschmutzt|schmutzig|stark verschmutzt|dirty|sale|salissure|encrasse|verdreckt)\b/.test(text);
  const hasCleaningContext = /\b(?:boden|kueche|kuche|küche|eingang|raum|floor|sol|cuisine|reinigen|reinigung|nettoyage)\b/.test(text);

  return isDirtOrConditionOnly && hasCleaningContext && !hasRealSafetyRisk;
};

const hasExplicitSafetyRiskV17_90L92 = (value: string): boolean => {
  const text = normalizeDedupeText(value);
  if (!text) return false;

  return (
    /\b(?:unter spannung|stromschlag|elektrisch|heisse? leitungen?|heisse? rohre?|nicht anfassen|nicht oeffnen|nicht öffnen|rutschgefahr|glatt|absturz|einsturz|instabil|giftig|aetzend|ätzend|explosiv|brandgefahr|feuer|gas|asbest|scherben|glasbruch|schimmel|schwerer? \w+.{0,35}nicht alleine|niedrige leitungen|niedrige decke|kopfhoehe|kopfhöhe)\b/.test(
      text,
    ) ||
    /\b(?:hund|dog|chien)\b/.test(text)
  );
};

const isClearlyOperationalNotSafetyV17_90L92 = (value: string): boolean => {
  const text = normalizeDedupeText(value);
  if (!text || hasExplicitSafetyRiskV17_90L92(text)) return false;

  const accessOrCredential =
    /\b(?:zugang|zufahrt|eingang|badge|besucherausweis|schluessel|schlussel|schlüssel|key|code|zugangscode|torcode|empfang|rezeption|rampe)\b/.test(
      text,
    );
  const parkingOrTimeLimit =
    /\b(?:parkplatz|besucherfeld|besucherparkplatz|parken|parkieren|parking|stellplatz|anlieferung)\b/.test(
      text,
    );
  const courtesyOrWorkflow =
    /\b(?:bewohner|patienten|gaeste|gaste|kinder|serverteam|mitarbeiter|arbeitsplaetze|arbeitsplätze)\b/.test(
      text,
    ) &&
    /\b(?:nicht stoeren|nicht storen|ruhig|leise|schlafen|weiterarbeiten|arbeitet weiter|nicht blockieren|freihalten|ruecksicht|rücksicht)\b/.test(
      text,
    );
  const equipmentAvailabilityOrShutdown =
    /\b(?:darf|soll|muss|kann|erst ab|erst nach|nur ab|nur nach|reserviert|verfuegbar|verfügbar)\b/.test(
      text,
    ) &&
    /\b(?:abschalten|ausgeschaltet|ausschalten|einschalten|betrieb|lift|aufzug|anlage|maschine|geraet|gerät)\b/.test(
      text,
    );
  const materialOrMethodPreference =
    /\b(?:reiniger|reinigungsmittel|mittel|produkt|material|geruchsarm|duftfrei|schonend|vorsichtig|nicht verschieben|nicht ausstecken)\b/.test(
      text,
    );
  const communicationOrArrival =
    /\b(?:sms|whatsapp|telefon|anrufen|kontakt|vorher melden|vor ankunft|nicht einfach kommen)\b/.test(
      text,
    );

  return (
    accessOrCredential ||
    parkingOrTimeLimit ||
    courtesyOrWorkflow ||
    equipmentAvailabilityOrShutdown ||
    materialOrMethodPreference ||
    communicationOrArrival
  );
};

const isEquipmentOnlyWarningLineV17_34 = (value: string): boolean => {
  const text = normalizeDedupeText(value);
  if (!text) return false;

  if (isClearlyOperationalNotSafetyV17_90L92(text)) return true;

  // Ausrüstung, Parkierung und Ruhehinweise sind operative Besonderheiten,
  // keine roten Gefahren. Echte Risiken bleiben unverändert rot.
  const isParkingOrQuietHint =
    /\b(?:parkplatz|besucherparkplatz|parken|parkieren|stellplatz|bewohner schlafen|ruhig arbeiten)\b/.test(
      text,
    );
  if (isParkingOrQuietHint) return true;

  // V17.90L86: Ruhe-/Rücksichtsanweisungen betreffen den Arbeitsablauf,
  // nicht die Arbeitssicherheit. Die Entscheidung basiert auf der semantischen
  // Kombination Personengruppe + Ruhe/Rücksicht und nicht auf einem Kundenfall.
  const isOccupantCourtesyHint =
    /\b(?:bewohner|patienten|gaeste|gaste|kinder|residents?|occupants?|patients?|guests?)\b/.test(
      text,
    ) &&
    /\b(?:nicht stoeren|nicht storen|ruhe|ruhig|leise|schlafen|do not disturb|dont disturb|quiet|sleeping)\b/.test(
      text,
    );
  if (isOccupantCourtesyHint) return true;

  // V17.90L84: Ressourcen-/Zugangszeiten und Kommunikationsanweisungen sind
  // wichtige operative Hinweise, aber keine roten Gefahren.
  const isOperationalScheduleOrCommunicationHint =
    /\b(?:genaue\s+zeit\b.{0,80}\b(?:mitteilen|melden)|(?:lift|aufzug)\b.{0,100}\b(?:reserviert|verfuegbar|verfügbar|erst\s+ab|ab\s+\d{1,2}(?::\d{2})?\s*uhr))\b/.test(
      text,
    );
  if (isOperationalScheduleOrCommunicationHint) return true;

  // Eine Leiter ist Ausrüstung/Arbeitsmittel, kein roter Gefahrenhinweis.
  // Echte Gefahren wie Gas, Rauch, Strom, Rutschgefahr usw. bleiben rot.
  const hasLadder = /\bleiter\b|\bladder\b|\bechelle\b|\bescalera\b|\bscala\b|\bescada\b/.test(text);
  if (!hasLadder) return false;

  const hasRealSafetyRisk = /\b(?:hund|dog|chien|oel|ol|oil|rutsch|glatt|slippery|strom|kabel|gas|rauch|scherb|glasbruch|asbest|schimmel|chem|feuer|brand|sturz|absturz|instabil|einsturz)\b/.test(text);
  return !hasRealSafetyRisk;
};

const stripNoteSentencePunctuationV17_34 = (value: string): string =>
  String(value || "").replace(/[.;:,\s]+$/g, "").trim();

// V17.90L57: Auftrag und daraus erzeugtes Angebot müssen dieselben
// kompakten, sichtbaren Besonderheiten verwenden. Diese Normalisierung
// verändert keine fachliche Aussage, sondern entfernt nur doppelte Labels
// und kürzt Parkplatzhinweise auf die tatsächlich benötigte Information.
const normalizeParkingDisplayV17_90L57 = (value: string): string => {
  // Parking details are operational evidence. Keep field/space identifiers and
  // time limits verbatim instead of shortening them to a generic label.
  return stripNoteSentencePunctuationV17_34(stripKnownMarker(value))
    .replace(/\s+/g, " ")
    .trim();
};

const cleanStructuredContactNameV17_90L91 = (value: string): string => {
  const compact = String(value || "")
    .replace(/^[\s,;:·\-–—]+|[\s,;:·\-–—]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!compact) return "";

  const tokens = compact.split(/\s+/g);
  const result: string[] = [];
  let index = 0;
  if (/^(?:Herr|Frau|Mr\.?|Mrs\.?|Ms\.?|Mme\.?|M\.)$/i.test(tokens[0] || "")) {
    result.push(tokens[0]);
    index = 1;
  }
  for (; index < tokens.length && result.length < 5; index += 1) {
    const token = tokens[index].replace(/^[,;:·]+|[,;:·]+$/g, "");
    if (!/^[A-ZÀ-ÖØ-ÞÄÖÜ][\p{L}'’.-]*$/u.test(token)) break;
    result.push(token);
  }

  return result.length >= (result[0] && /^(?:Herr|Frau|Mr|Mrs|Ms|Mme|M)/i.test(result[0]) ? 2 : 1)
    ? result.join(" ")
    : compact;
};

const normalizeOnSiteContactV17_90L57 = (value: string): string => {
  const raw = stripNoteSentencePunctuationV17_34(stripKnownMarker(value));
  if (!/^Kontakt vor Ort\s*:/i.test(raw)) return raw;

  const body = raw.replace(/^Kontakt vor Ort\s*:\s*(?:ist\s+)?/i, "");
  const phoneMatches = Array.from(
    body.matchAll(/\+?\d[\d\s()./-]{6,}\d/g),
  ).map((match) => match[0].replace(/\s+/g, " ").trim());
  const uniquePhones = phoneMatches.filter(
    (phone, index, all) =>
      all.findIndex(
        (candidate) =>
          candidate.replace(/\D/g, "") === phone.replace(/\D/g, ""),
      ) === index,
  );

  const hasSms = /\b(?:nur\s+)?sms\b|\btext\s+message\b/i.test(body);
  const hasWhatsapp = /\bwhats\s*app|\bwhatsapp\b/i.test(body);
  const noCall =
    /\b(?:nicht\s+(?:telefonisch\s+)?anrufen|nicht\s+telefonisch|kein(?:e[nm]?)?\s+anruf|do\s+not\s+call|don['’]?t\s+call|no\s+calls?)\b/i.test(
      body,
    );
  const wantsCall =
    !noCall && /\b(?:anrufen|telefonieren|call|phone\s+call)\b/i.test(body);
  const channelLabel = hasSms
    ? "nur SMS"
    : hasWhatsapp
      ? "nur WhatsApp"
      : wantsCall
        ? "anrufen"
        : "";
  const noCallLabel =
    noCall && !hasSms && !hasWhatsapp ? "nicht telefonisch" : "";

  const name = cleanStructuredContactNameV17_90L91(
    body
      .replace(/\b(?:Tel(?:efon)?|Mobile|Mobil|Phone|Handy|Natel)\.?\s*:?\s*/gi, "")
      .replace(/\+?\d[\d\s()./-]{6,}\d/g, "")
      .replace(/\b(?:bitte\s+)?(?:nur\s+)?(?:per\s+)?sms\b/gi, "")
      .replace(/\b(?:bitte\s+)?(?:nur\s+)?(?:per\s+)?whats\s*app\b/gi, "")
      .replace(/\b(?:nicht\s+(?:telefonisch\s+)?anrufen|nicht\s+telefonisch|kein(?:e[nm]?)?\s+anruf|do\s+not\s+call|don['’]?t\s+call|no\s+calls?)\b/gi, "")
      .replace(/\b(?:bitte\s+)?(?:diese\s+nummer\s+)?(?:anrufen|telefonieren|call)\b/gi, "")
      .replace(/^[,;:\s]+|[,;:\s]+$/g, "")
      .replace(/\s{2,}/g, " ")
      .trim(),
  );

  return `Kontakt vor Ort: ${[
    name,
    uniquePhones[0],
    channelLabel,
    noCallLabel,
  ]
    .filter(Boolean)
    .join(" · ")}`;
};

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

  body = normalizeOnSiteContactV17_90L57(body);
  if (/park|parking|stellplatz/i.test(body)) {
    body = normalizeParkingDisplayV17_90L57(body);
  }

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

  if (/^kontakt\s+vor\s+ort\s*:/i.test(visibleLine)) {
    const phone =
      visibleLine.match(/\+?\d[\d\s()./-]{6,}\d/)?.[0]?.replace(/\D/g, "") ||
      "";
    const identity = normalizeDedupeText(
      visibleLine
        .replace(/\+?\d[\d\s()./-]{6,}\d/g, "")
        .replace(/^kontakt\s+vor\s+ort\s*:\s*/i, ""),
    )
      .split(/\s+/g)
      .slice(0, 5)
      .join("_");
    return `onsite_contact:${phone || identity || "unknown"}`;
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
  if (/\b(?:hund|dog|chien)\b/.test(text)) {
    const hasConcreteBehaviour =
      /laeuft frei|lauft frei|läuft frei|frei herum|nicht angeleint|bellt|beisst|beißt/.test(
        text,
      );
    if (hasConcreteBehaviour) score += 180;
    if (/gefaehrlich|gefahrlich|gefährlich/.test(text) && !hasConcreteBehaviour) {
      score -= 170;
    }
  }
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

  // A more precise communication instruction replaces its generic duplicate.
  if (byKey.has("communication_whatsapp_no_call")) {
    byKey.delete("communication_whatsapp");
  }
  if (byKey.has("communication_sms_no_call")) {
    byKey.delete("communication_sms");
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
    .filter((line) => Boolean(line) && !/\[object Object\]/i.test(line));

  const systemHints: string[] = [];
  const safetyWarnings: string[] = [];
  const jobHints: string[] = [];

  for (const rawLine of lines) {
    const line = normalizeLine(rawLine);
    if (!line) continue;

    // V17.90L103: Explicit markers are the immutable role snapshot written
    // after the first AI pass. The UI may display them, but must not classify
    // them again or move/rewrite them.
    if (isSafetyWarningLine(line)) {
      const protectedText = stripProtectedRoleMarkerV17_90L103(line);
      if (protectedText) safetyWarnings.push(protectedText);
      continue;
    }
    if (isHintLine(line)) {
      const protectedText = stripProtectedRoleMarkerV17_90L103(line);
      if (protectedText) {
        // Product exception: every actual dog mention uses the red dog chip,
        // while its wording remains unchanged.
        if (isDogSafetyNoteV17_90L34(protectedText)) {
          safetyWarnings.push(protectedText);
        } else {
          jobHints.push(protectedText);
        }
      }
      continue;
    }

    const cleaned = stripKnownMarker(line);
    if (!cleaned) continue;

    // Legacy/unmarked data keeps the old fallback behaviour. This branch may
    // classify, but it never touches marker-protected structured roles.
    if (SYSTEM_KEYWORDS.test(line)) {
      systemHints.push(cleaned);
      continue;
    }

    const semanticRole = classifySpecialNoteRoleV17_90L93(cleaned);
    if (semanticRole === "safety") {
      safetyWarnings.push(cleaned);
      continue;
    }
    if (semanticRole !== "unknown" || isOperationalJobHint(cleaned)) {
      jobHints.push(cleaned);
    }
  }

  const dedupedSafetyWarnings = dedupeProtectedRoleLinesV17_90L103(
    safetyWarnings,
  );
  const safetyKeys = new Set(
    dedupedSafetyWarnings.map((line) => normalizeDedupeText(line)),
  );
  const dedupedJobHints = dedupeProtectedRoleLinesV17_90L103(jobHints).filter(
    (line) => !safetyKeys.has(normalizeDedupeText(line)),
  );
  const hasExplicitNoCall = dedupedJobHints.some((line) =>
    [
      "communication_no_call",
      "communication_whatsapp_no_call",
      "communication_sms_no_call",
      "communication_email_no_call",
    ].includes(semanticNoteKey(line)),
  );
  const contradictionFreeJobHints = hasExplicitNoCall
    ? dedupedJobHints.filter((line) => semanticNoteKey(line) !== "callback")
    : dedupedJobHints;

  return {
    systemHints: dedupeProtectedRoleLinesV17_90L103(systemHints),
    safetyWarnings: dedupedSafetyWarnings,
    jobHints: contradictionFreeJobHints,
  };
}

export function splitJobHints(jobHints: string[]): SplitJobHints {
  const equipment: string[] = [];
  const operational: string[] = [];

  for (const rawHint of jobHints) {
    const cleaned = normalizeLine(stripKnownMarker(rawHint));
    if (!cleaned) continue;

    // Marker-protected normal hints are never promoted to hazards in the UI.
    // Role detection here is presentation-only: access/equipment can be shown
    // together, while every other normal hint stays operational.
    const role = classifySpecialNoteRoleV17_90L93(cleaned);
    if (role === "access" || role === "equipment") {
      equipment.push(cleaned);
    } else {
      operational.push(cleaned);
    }
  }

  return {
    hazards: [],
    equipment: dedupeProtectedRoleLinesV17_90L103(equipment),
    operational: dedupeProtectedRoleLinesV17_90L103(operational),
  };
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
    const structuredContact = smsLines
      .map((line) => stripKnownMarker(line).replace(/\s+/g, " ").trim())
      .filter((line) => /^Kontakt vor Ort\s*:/i.test(line))
      .sort((a, b) => b.length - a.length)[0] || "";

    // V17.90L88: A structured onsite contact is canonical business data.
    // Keep name, phone and channel instead of collapsing it to "Nur SMS".
    if (structuredContact) {
      out.push(`[HINWEIS] ${structuredContact}`);
    } else {
      const phone = mergedSmsSource.map(extractPhoneFromNoteV17_33).find(Boolean) || "";
      const time = mergedSmsSource.map(extractContactTimeFromNoteV17_33).find(Boolean) || "";
      const hasOnlySms = mergedSmsSource.some((line) => /\b(?:nur|only|seulement)\s+(?:per\s+)?sms\b/i.test(stripKnownMarker(line)));
      const noWhatsapp = mergedSmsSource.some((line) => /(?:kein|keine|no|pas)\s+whatsapp|pas\s+whatsapp/i.test(stripKnownMarker(line)));

      const parts = [hasOnlySms ? "Nur SMS als Kontakt" : "SMS-Kontakt bevorzugt"];
      if (phone) parts[0] += `: ${phone}`;
      if (time) parts.push(`bevorzugt ${time}`);
      if (noWhatsapp) parts.push("keine WhatsApp");

      out.push(`[HINWEIS] ${parts.join("; ")}.`);
    }
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

const splitSafetyWarningClausesV17_90L85 = (value: string): string[] => {
  const body = stripKnownMarker(value);
  if (!body) return [];

  return body
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split(
      /\n+|;\s+|(?<=[.!?])\s+|(?=\b(?:bewohner|patienten|gäste|gaeste)\b.{0,45}\b(?:schlafen|ruhen|ruhe)\b)|(?=\b(?:lift|aufzug)\b.{0,90}\b(?:reserviert|verfügbar|verfuegbar|erst\s+ab)\b)/i,
    )
    .flatMap((part) => {
      const quietMatch = part.match(/\b(?:bitte\s+)?ruhig\s+arbeiten\b/i);
      if (!quietMatch || quietMatch.index == null || quietMatch.index <= 0) {
        return [part];
      }

      const beforeQuiet = part.slice(0, quietMatch.index);
      const alreadyResidentContext =
        /\b(?:bewohner|patienten|gäste|gaeste)\b.{0,45}\b(?:schlafen|ruhen|ruhe)\b/i.test(
          beforeQuiet,
        );
      return alreadyResidentContext
        ? [part]
        : [beforeQuiet, part.slice(quietMatch.index)];
    })
    .map((part) => part.replace(/^[\s,.;:–—-]+|[\s,.;:–—-]+$/g, "").trim())
    .filter(Boolean);
};

export function buildSpecialNotes(input: {
  safetyWarnings?: string[];
  jobHints?: string[];
  systemHints?: string[];
  preserveStructuredRoles?: boolean;
}) {
  // V17.90L89: When the first KI already returned explicit role arrays,
  // serialization must be lossless. Later keyword/heuristic classifiers may
  // not demote, promote, split or discard those values. They are allowed only
  // on legacy/unstructured call paths.
  if (input.preserveStructuredRoles) {
    // V17.90L103: Lossless serialization of the first-AI role snapshot.
    // No downstream classifier may rewrite text or move a statement between
    // danger and normal information. Only exact formatting duplicates are
    // removed.
    const safetyWarnings = dedupeProtectedRoleLinesV17_90L103(
      input.safetyWarnings ?? [],
    );
    const safetyKeys = new Set(
      safetyWarnings.map((line) => normalizeDedupeText(line)),
    );
    const jobHints = dedupeProtectedRoleLinesV17_90L103(
      input.jobHints ?? [],
    ).filter((line) => !safetyKeys.has(normalizeDedupeText(line)));
    const systemHints = dedupeProtectedRoleLinesV17_90L103(
      input.systemHints ?? [],
    );

    return [
      ...safetyWarnings.map((line) => `[GEFAHR] ${line}`),
      ...jobHints.map((line) => `[HINWEIS] ${line}`),
      ...systemHints,
    ]
      .map((line) => line.trim())
      .filter((line) => Boolean(line) && !/\[object Object\]/i.test(line))
      .join("\n");
  }

  const rawSafetyWarnings = (input.safetyWarnings ?? [])
    .flatMap(splitSafetyWarningClausesV17_90L85)
    .map(canonicalizeSpecialNoteLineV17_32)
    .filter(Boolean);
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
    .filter((line) => Boolean(line) && !/\[object Object\]/i.test(line));

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
