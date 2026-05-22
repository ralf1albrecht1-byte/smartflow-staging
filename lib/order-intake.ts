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
import {
  extractExecutionAddressFromText,
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
function cleanBillingCustomerNameCandidate(value: string | null | undefined): string | null {
  let candidate = String(value || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split(/\n+/)[0] || "";

  candidate = candidate
    .replace(/^["'“”‘’\s:,\-–—]+/g, "")
    .replace(/["'“”‘’\s:,\-–—.]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!candidate) return null;

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

  const normalized = normalizeUnitText(candidate);

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
    "name",
    "unbekannt",
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
  ];
  if (blockedStarts.some((start) => normalized.startsWith(start))) return null;

  const blockedContained =
    /\b(reinigen|reinigung|schneiden|entfernen|streichen|malen|auftrag|leistung|leistungen|preis|preise|währung|waehrung|prüfen|pruefen|fenster|treppenhaus|garage|tiefgarage|baustelle|arbeitsort|ausführungsadresse|ausfuehrungsadresse|kundentext)\b/i;
  if (blockedContained.test(normalized)) return null;

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
    "(?:kunde\\s*/\\s*rechnungsadresse|rechnungsadresse|rechnung\\s+geht\\s+an|rechnung\\s+an|rechnung\\s+bekommt|kunde\\s+ist|kunde|invoice\\s+customer\\s+is|invoice\\s+customer|billing\\s+customer\\s+is|billing\\s+customer|bill\\s+to)";

  // 1) Einzeiler: "Rechnung geht an Swiss Facility Service AG, Badenerstrasse 90 in 8004 Zürich."
  const inlinePattern = new RegExp(`(?:^|[\\n.!?]\\s*)${marker}\\s*:?\\s+([^\\n]+)`, "gi");
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
  const markerWithValuePattern = new RegExp(`^\\s*${marker}\\s*:?\\s+(.+)$`, "i");

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

  return null;
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
    .map((line) => String(line || "").replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .filter((line) => {
      const key = normalizeSemanticText(line);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function isNegatedSpecialNoteLine(value: string): boolean {
  const line = normalizeSemanticText(value);
  if (!line) return false;

  return /\b(kein|keine|keinen|keinem|nicht|nie|ohne|no|not|none|without|pas|sans|sin|ningun|ninguna|nessun|nessuna|sem)\b/i.test(line);
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
  if (/\b(kein\s+parkplatz|keine\s+parkplaetze|kein\s+parken|parkverbot|no\s+parking|sin\s+aparcamiento|sans\s+parking|senza\s+parcheggio|kein\s+lift|ohne\s+lift|no\s+elevator|no\s+lift)\b/i.test(normalized)) {
    return false;
  }

  return /\b(hund|dog|chien|perro|cane|cao|cão|oel|oil|huile|aceite|olio|scherben|glass|strom|kabel|wire|leiter|ladder|termin|appointment|schluessel|schlussel|key|parkplatz|parking|zugang|access)\b/i.test(normalized);
}

function isNonActionablePlanningHint(line: string): boolean {
  const normalized = normalizeSemanticText(line);
  if (!normalized) return true;

  return (
    /\b(parkplatz\s+kein\s+thema|parkplatz\s+nicht\s+wichtig|direkt\s+halten|genug\s+platz|direkt\s+vor\s+dem\s+haus\s+(?:halten|moeglich|moglich))\b/i.test(normalized) ||
    /\b(zugang\s+(?:frei|offen|unproblematisch)|tuer\s+offen|tur\s+offen|kunde\s+ist\s+vor\s+ort)\b/i.test(normalized)
  );
}

function isFalseCallbackHint(line: string): boolean {
  const normalized = normalizeSemanticText(line);
  if (!normalized) return false;

  if (!/\b(rueckruf|ruckruf|zurueckrufen|telefonisch|anruf|telefon)\b/i.test(normalized)) {
    return false;
  }

  // INTAKE_CALLBACK_NEGATION_SAFE_V16
  // A callback chip is allowed only for a positive request. These phrases are
  // explicit negative/door instructions and must never become "Rückruf".
  return (
    /\b(nicht\s+(?:telefonisch\s+)?(?:zurueckrufen|anrufen)|kein(?:e[nm]?)?\s+(?:telefonischer\s+)?(?:rueckruf|ruckruf|anruf)|rueckruf\s+(?:nicht\s+)?(?:noetig|nötig|erwuenscht|erwünscht)|nicht\s+erwuenscht|nicht\s+erwünscht)\b/i.test(normalized) ||
    /\b(klingeln|warten|haupteingang|kunde\s+ist\s+vor\s+ort|kundin\s+ist\s+vor\s+ort|oeffnet\s+die\s+tuer|offnet\s+die\s+tur|an\s+der\s+tuer|schluessel\s+wird\s+.*tuer)\b/i.test(normalized)
  );
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
function extractSemanticSpecialNotesFallback(
  text: string | null | undefined,
): { safetyWarnings: string[]; jobHints: string[] } {
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
  const oilContext = /\b(ausgelaufen|leaking|spill(?:ed)?|verschuttet|derrame|fuoriuscit|renverse|boden|floor|sol|suelo|pavimento)\b/i;
  const slipperySubject = /\b(rutschig|glatt|slippery|slick|glissant|resbaladiz|scivolos|escorregad|skluz)\b/i;

  const oil = actionableLineHas(oilSubject, oilContext) || actionableLineHas(oilContext, oilSubject);
  const slippery = actionableLineHas(slipperySubject);
  if (oil && slippery) {
    safetyWarnings.push("Rutschiger Boden wegen Öl");
  } else if (oil) {
    safetyWarnings.push("Öl auf dem Boden");
  } else if (slippery) {
    safetyWarnings.push("Rutschiger Boden");
  }

  const dogSubject = /\b(hund|dog|chien|perro|cane|cao|cão)\b/i;
  const dangerousDogContext = /\b(frei|frei\s+lauf|laeuft|läuft|free|loose|unleashed|libre|suelto|sciolto|livre|aggressiv|aggressive|bissig|beisst|beißt|unbeaufsichtigt|unguarded)\b/i;
  const friendlyDogContext = /\b(freundlich|friendly|gentil|amable|docile|brav|bravo|lieb|owner|besitzer|maitre|proprietaire|propietario|presente|vor\s+ort)\b/i;
  if (actionableLineHas(dogSubject, dangerousDogContext)) {
    safetyWarnings.push("Hund frei oder ungesichert vor Ort");
  } else if (actionableLineHas(dogSubject, friendlyDogContext)) {
    jobHints.push("Hund freundlich vor Ort");
  } else if (actionableLineHas(dogSubject)) {
    jobHints.push("Hund vor Ort");
  }

  const electricSubject = /\b(strom|elektr|electric|electrical|electricite|electricidad|corriente|elettric|kabel|cable|cables|draht|wire|wires|stromkabel)\b/i;
  const electricDangerContext = /\b(offen|blank|frei|defekt|kaputt|danger|peligro|pericol|perigo|dangereux|exposed|open|loose|sichtbar)\b/i;
  if (actionableLineHas(electricSubject, electricDangerContext)) {
    safetyWarnings.push("Offene Stromkabel / Stromgefahr");
  }

  if (actionableLineHas(/\b(asbest|asbestos|amiante|amianto)\b/i)) {
    safetyWarnings.push("Asbestverdacht");
  }

  if (actionableLineHas(/\b(schimmel|mold|mould|moisissure|moho|muffa|bolor)\b/i)) {
    safetyWarnings.push("Schimmel");
  }

  if (actionableLineHas(/\b(chemie|chemisch|chemical|chemicals|chimique|quimic|chimic|produto\s+quimico)\b/i)) {
    safetyWarnings.push("Chemische Stoffe");
  }

  if (actionableLineHas(/\b(feuer|brand|fire|feu|fuego|fuoco|incendio|incendie)\b/i)) {
    safetyWarnings.push("Brand-/Feuergefahr");
  }

  if (actionableLineHas(/\b(glasscherben|scherben|broken\s+glass|verre\s+casse|vidrio\s+roto|vetro\s+rotto)\b/i)) {
    safetyWarnings.push("Glasscherben");
  }

  if (
    actionableLineHas(/\b(absturz|sturz|fall\s+risk|fallgefahr|chute|caida|caduta)\b/i) ||
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
  const ladderRisk = /\b(absturz|sturz|instabil|gefahr|danger|warning|peligro|pericolo|perigo|hauteur|height|hoehe|höhe)\b/i;
  const ladderMaybe = /\b(eventuell|evtl|vielleicht|moeglich|möglich|possibly|maybe|peut\s+etre|peut-être|quizas|forse)\b/i;
  if (actionableLineHas(ladderSubject, ladderRisk)) {
    safetyWarnings.push("Leiterarbeit mit zusätzlichem Risiko");
  } else if (actionableLineHas(ladderSubject, ladderMaybe)) {
    jobHints.push("Leiter eventuell benötigt");
  } else if (actionableLineHas(ladderSubject, /\b(benoetigt|benötigt|noetig|nötig|erforderlich|required|needed|necessaire|necesaria|necessaria)\b/i)) {
    jobHints.push("Leiter benötigt");
  } else if (actionableLineHas(ladderSubject)) {
    jobHints.push("Leiter eventuell benötigt");
  }

  const hasExplicitCallback = normalizedLines.some((line) => {
    if (isNegatedSpecialNoteLine(line)) return false;
    if (/\b(klingeln|warten|doorbell|ring\s+the\s+bell|sonner|timbre|campanello|campainha)\b/i.test(line)) return false;
    return /\b(rueckruf|ruckruf|zurueckrufen|zurückrufen|call\s+back|please\s+call\s+back|telefonisch\s+anrufen|phone\s+back|rappeler|richiamare|devolver\s+la\s+llamada|ligar\s+de\s+volta)\b/i.test(line);
  });
  if (hasExplicitCallback) {
    jobHints.push("Rückruf vor Arbeitsbeginn");
  }

  const hasDifficultAccess = normalizedLines.some((line) =>
    /\b(schwer\s+zugaenglich|schwer\s+zugänglich|schwieriger\s+zugang|kein\s+lift|ohne\s+lift|no\s+elevator|no\s+lift|access\s+difficult|difficult\s+access|acces\s+difficile|sin\s+ascensor|senza\s+ascensore|acesso\s+dificil)\b/i.test(line),
  );
  if (hasDifficultAccess) {
    jobHints.push("Schwieriger Zugang");
  }

  if (actionableLineHas(/\b(hanglage|hang|steigung|slope|pente|pendiente|pendenza|declive)\b/i)) {
    jobHints.push("Hanglage");
  }

  const hasGoodParking = normalizedLines.some(
    (line) =>
      !isNegatedSpecialNoteLine(line) &&
      /\b(parkplatz|parking|aparcamiento|parcheggio)\b/i.test(line) &&
      /\b(vorhanden|reserviert|frei|innenhof|available|reserved|courtyard|disponible|riservato)\b/i.test(line),
  );
  const hasBadParking = normalizedLines.some(
    (line) =>
      /\b(parkplatz|parking|aparcamiento|parcheggio)\b/i.test(line) &&
      /\b(schwierig|kein|keine|parkverbot|difficult|no\s+parking|sin|sans|senza)\b/i.test(line),
  );
  if (hasGoodParking) {
    jobHints.push("Parkplatz vorhanden oder reserviert");
  } else if (hasBadParking) {
    jobHints.push("Parkplatz schwierig");
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
    piece: ["stueck", "stück", "stuck", "stk", "piece", "pieces", "piece", "pieces", "vitre", "vitres", "fenetre", "fenetres", "window", "windows", "anzahl", "einheit", "einheiten"],
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

  const joinWords =
    "(?:pro|je|per|par|à|a|/)";

  const priceNumber =
    "(\\d+(?:[.,]\\d{1,2})?)";




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
function stripNegatedCurrencyMentionsForIntake(
  text: string | null | undefined,
): string {
  let source = normalizeUnitText(text || "");
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

function detectCurrencyFromText(
  text: string | null | undefined,
): "CHF" | "EUR" | null {
  const source = stripNegatedCurrencyMentionsForIntake(text);

  if (!source) return null;

  const hasChf = /\b(chf|franken|fr\.?|sfr\.?|stutz)\b/i.test(source);
  const hasEur = /\b(eur|euro)\b|€/i.test(source);

  if (hasChf && !hasEur) return "CHF";
  if (hasEur && !hasChf) return "EUR";

  return null;
}

function findOriginalSegmentForWorkItem(
  item: { raw?: string | null; name?: string | null },
  fullText: string,
): string | null {
  const source = normalizeUnitText(fullText);
  if (!source) return null;

  const itemName = normalizeUnitText(item.name || "");
  const raw = normalizeUnitText(item.raw || "");

  const itemWords = [itemName, raw]
    .join(" ")
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w.length >= 4);

  if (itemWords.length === 0) return null;

  const segments = source
  .split(
        /\n{2,}|;|\bdanach\b|\bzusaetzlich\b|\bzusätzlich\b|\banschliessend\b|\banschließend\b|\bthen\b|\bafterwards\b|\badditional(?:ly)?\b|\balso\b|\bensuite\b|\bpuis\b|\bsupplémentaire\b|\badditionnel\b|\bpoi\b|\binoltre\b|\baggiuntivo\b/gi,
  )
  .map((p) => p.trim())
  .filter((p) => p.length >= 8);

  let best: { segment: string; score: number } | null = null;

  for (const segment of segments) {
    let score = 0;

    for (const word of itemWords) {
      if (segment.includes(word)) score += 10;
    }

    if (itemName && segment.includes(itemName)) score += 40;
    if (raw && segment.includes(raw)) score += 30;

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
    new RegExp(`\\d+(?:[.,]\\d{1,2})?\\s*${currencyWords}\\s*${unitJoin}\\s*${unitWords}`, "gi"),
    new RegExp(`${currencyWords}\\s*\\d+(?:[.,]\\d{1,2})?\\s*${unitJoin}\\s*${unitWords}`, "gi"),
  ];

  return patterns.reduce((sum, pattern) => sum + Array.from(source.matchAll(pattern)).length, 0);
}

function parseStructuredUnitPrice(value: unknown): number | null {
  const parsed = Number(String(value ?? "").replace("'", "").replace(",", "."));
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


function hasAmbiguousCompactLinePrice(text: string | null | undefined): boolean {
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
      /\b(reinigen|reinigung|schneiden|stutzen|pflegen|pflege|mähen|maehen|mähen|streichen|malen|entsorgen|entsorgung|abtransportieren|transportieren|fällen|faellen|montieren|demontieren|reparieren|ersetzen|liefern|räumen|raeumen|ausräumen|ausraeumen)\b/i.test(
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
    .replace(/\s+/g, " ")
    .trim();
}
function formatWorkNameForDisplay(value: string): string {
  const text = String(value || "")
    .replace(/ae/g, "ä")
    .replace(/oe/g, "ö")
    .replace(/ue/g, "ü")
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
      if (
        index === 0 ||
        forceUppercaseWords.includes(word)
      ) {
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

WICHTIG:
Ein Ort oder Kontext ist nicht automatisch die Leistung.
Wenn eine Formulierung sagt, dass etwas IN einem Bereich gemacht wird, muss die Handlung die Leistung bestimmen.
Die Leistung darf nur übernommen werden, wenn die evidence genau diese Handlung belegt.

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

CONFIDENCE:
- "hoch": eindeutig im Text belegt und keine Widersprüche.
- "mittel": wahrscheinlich, aber noch prüfbedürftig.
- "niedrig": unsicher. Werte bei niedrig möglichst null lassen.

--------------------------------------------------
AUSGABEFORMAT
--------------------------------------------------

{
  "kunde": {
    "name": null,
    "strasse": null,
    "hausnummer": null,
    "plz": null,
    "ort": null
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
- Preis aus einer anderen Zeile/anderen Leistung NIEMALS übernehmen.
- Pauschalpreise dürfen NIEMALS auf andere Positionen kopiert werden. Wenn eine Zeile "Eingangsbereich pauschal 120" sagt, gilt 120 nur für diese eine Position.
- Rechnungsadresse/Billing address/Rechnung geht an ist NIE eine Arbeitsposition und darf keine generische Leistung wie "Reinigung" erzeugen.
- Fremdsprachige Leistungen semantisch übersetzen: "Nettoyage des vitres" = Fenster reinigen, "Nettoyage du sol du garage" = Garageboden reinigen. Nicht auf falsche Katalogleistung wie Kellerboden/Farbreste ausweichen.
- Wenn bei einer Position kein eigener Preis steht → unit_price = null.
- Wenn mehrere Preise/Währungen im Text stehen, jede Position separat zuordnen; bei Unsicherheit unit_price = null und confidence = "niedrig".
- Keine Leistungen erfinden.
- Nicht versuchen, unbekannte Arbeiten einer bestehenden Leistung zuzuordnen.
- Wenn mehrere Arbeiten genannt werden, jede Arbeit separat ausgeben.
- Einheit und Menge gehören nur zu der Position, in deren Text sie stehen.

12. AUSFÜHRUNGSADRESSE / ARBEITSORT:
- Erkenne semantisch, ob neben der Rechnungsadresse ein anderer Ort genannt wird, an dem gearbeitet wird.
- Das gilt sprachunabhängig: z.B. Ausführungsadresse, Baustelle, Objekt, Arbeitsort, Einsatzort, job site, work address, service address, chantier, lugar de trabajo usw.
- Nutze nicht nur feste Wörter, sondern Bedeutung: Wo bekommt der Kunde die Rechnung? Wo wird tatsächlich gearbeitet?
- Wenn eindeutig anderer Arbeitsort vorhanden:
  auftrag.ausfuehrungsadresse.ist_abweichend = true
  name/strasse/plz/ort befüllen
  confidence = "hoch" oder "mittel"
  evidence = exakte Textstelle
- Wenn unsicher oder unvollständig: ist_abweichend = false und in besonderheiten kurz "Ausführungsadresse prüfen" aufnehmen.
- Keine Leistungsbeschreibung, Preise, Hinweise oder Sätze wie "Bitte reinigen..." in die Adresse schreiben.`;
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
  detectedCurrency ||
  (companySettings?.currency === "EUR" ? "EUR" : "CHF");
  const hauptsprache = (companySettings as any)?.hauptsprache || "Deutsch";

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
    userContent.push({ type: "text", text: `Nachricht:\n"${messageText}"` });
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

  if (!String(kundeData.name || "").trim()) {
    const billingNameFallback = extractBillingCustomerNameFallback(messageText);
    if (billingNameFallback) {
      kundeData.name = billingNameFallback;
      console.log(
        `[${source}] 🧾 Rechnungsnamen-Safety-Net griff: kunde.name='${billingNameFallback}' (LLM hatte leer/null geliefert)`,
      );
    }
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

    const { generateCustomerNumber } = await import("@/lib/customer-number");
    const customerNumber = await generateCustomerNumber();
    const customer = await prisma.customer.create({
      data: {
        customerNumber,
        name: kundeData.name || "",
        // phone/email stay conservatively null on webhook-created customers
        // (preserves pre-Phase-2b behavior; unchanged).
        phone: null,
        email: null,
        address: sanitized.street,
        plz: sanitized.plz,
        city:
          normalizeUnitText(sanitized.city) === "form" ? null : sanitized.city,
        notes: `${source}-Kunde`,
        ...(userId ? { userId } : {}),
      },
    });
    customerId = customer.id;
    customerWasNewlyCreated = true;
  } else {
    // Update existing customer with new data - only if it IMPROVES existing data
    const cust = await prisma.customer.findUnique({
      where: { id: customerId },
    });
    if (cust) {
      const { protectCustomerData } = await import("@/lib/data-protection");
      const safeCity =
        normalizeUnitText(addr.city) === "form" ? null : addr.city;
      const updates = protectCustomerData(cust, {
        address: addr.street,
        plz: addr.plz,
        city: safeCity,
      });
      if (Object.keys(updates).length > 0) {
        await prisma.customer.update({
          where: { id: customerId },
          data: updates,
        });
        console.log(
          `[${source}] Updated customer ${customerId} with improved fields:`,
          Object.keys(updates),
        );
      }
    }
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
      return value
        .map((item) => String(item || "").trim())
        .filter(Boolean);
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
  .filter((line) => !safetyMarkerRe.test(line) && !isLikelySafetyWarning(line))
  .map(stripSpecialMarker)
  .filter(Boolean);

  const semanticFallbackNotes = extractSemanticSpecialNotesFallback(
    [
      messageText,
      parsed.auftrag?.beschreibung,
      parsed.auftrag?.titel,
      Array.isArray(parsed.auftrag?.arbeitspositionen)
        ? parsed.auftrag.arbeitspositionen
            .map((item: any) => [item?.name, item?.raw].filter(Boolean).join(" "))
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

const hinweisItems = dedupeSpecialNoteLines([
  ...baseHinweisItems,
  ...semanticFallbackNotes.jobHints,
])
  .filter((line) => !isNonActionableSpecialNoteCandidate(line))
  .filter((line) => !isNonActionablePlanningHint(line))
  .filter((line) => !isFalseCallbackHint(line))
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
      [item.raw, item.name, item.einheit].filter(Boolean).join(" "),
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
      [item.raw, item.name].filter(Boolean).join(" "),
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
    [item.raw, item.name].filter(Boolean).join(" "),
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
        work: ["fenster", "fensterreinigung", "vitre", "vitres", "fenetre", "fenetres", "window", "windows", "reinigen", "reinigung", "nettoyage"],
      },
      {
        service: ["boden", "garage", "garagenboden", "lagerboden"],
        work: ["boden", "floor", "sol", "garage", "garagenboden", "lagerboden", "reinigen", "reinigung", "nettoyage"],
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
    if (["hoch", "high", "sicher", "certain"].includes(normalized)) return "hoch";
    if (["mittel", "medium", "wahrscheinlich", "probably"].includes(normalized)) return "mittel";
    if (["niedrig", "low", "unsicher", "uncertain"].includes(normalized)) return "niedrig";
    return "";
  };

  const findSemanticServiceForWorkItem = (item: AiWorkItem, services: any[]) => {
    const confidence = normalizeAiConfidence(
      item.service_confidence || item.confidence || null,
    );

    // INTAKE_SEMANTIC_ENGINE_V12:
    // If the AI itself marks the service as uncertain, do not guess via token matching.
    if (confidence === "niedrig") return null;

    const explicitId = String(item.service_id || item.matched_service_id || "").trim();
    if (explicitId) {
      const byId = services.find((service: any) => String(service.id) === explicitId);
      if (byId) return byId;
    }

    const explicitName = String(
      item.service_name || item.matched_service_name || "",
    ).trim();

    if (explicitName) {
      const normalizedExplicitName = normalizeServiceText(explicitName);

      const exact = services.find(
        (service: any) => normalizeServiceText(service.name) === normalizedExplicitName,
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
    const workName = normalizeServiceText(item.action_name || item.name || item.service_name || item.matched_service_name || "");
    const workRaw = normalizeServiceText([item.raw, item.evidence, item.context].filter(Boolean).join(" "));
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
        String(item.action_name || item.service_name || item.matched_service_name || item.name || raw || ""),
      );

      if (!detectedName || detectedName.length < 3) return null;

       const semanticMatchedService = findSemanticServiceForWorkItem(item, services);
       const semanticConfidence = normalizeAiConfidence(item.confidence || null);
       const matchedService =
         semanticMatchedService ||
         (semanticConfidence === "niedrig"
           ? null
           : strictMatchServiceForWorkItem(item, services));
const evidenceText = String(
  item.source_text || item.evidence || item.raw || "",
).trim();

const originalSegment =
  evidenceText ||
  findOriginalSegmentForWorkItem(
    item,
    `${messageText}\n${fullWorkText}`,
  ) ||
  findColonBlockForWorkItem(
    item,
    `${messageText}\n${fullWorkText}`,
  ) ||
  "";

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
  (
    hasLooseCurrencyAmount ||
    hasAmbiguousLinePrice ||
    hasNoPriceSignal
  ) && !hasExplicitUnitPrice;

const unitPrice = hasExplicitUnitPrice
  ? Number(detectedUnitPrice)
  : shouldBlockCatalogFallback
    ? 0
    : catalogUnitPrice;

const priceOverrideDetected =
  hasExplicitUnitPrice &&
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
  hasExplicitDetectedUnit &&
  serviceUnitType !== detectedUnitType;

const priceReviewReason = priceOverrideDetected
  ? `price_override:${String(matchedService.name || "Unbekannte Leistung")}:${catalogUnitPrice}:${unitPrice}`
  : shouldBlockCatalogFallback
    ? `price_unclear:${String(matchedService.name || "Unbekannte Leistung")}`
    : null;

const reviewReason = mismatchDetected
  ? `unit_mismatch:${String(matchedService.name || "Unbekannte Leistung")}:${serviceUnit}:${unit}:${detectedQuantity}`
  : priceReviewReason || quantityValidation.reason || null;

        return {
          serviceName: formatWorkNameForDisplay(
  String(matchedService.name || "Unbekannte Leistung"),
),
          description: String(
            raw || detectedName || fullWorkText || `${source}-Auftrag`,
          ),

          quantity: quantityValidation.quantity,
          unit,
          unitPrice,
          totalPrice: unitPrice * quantityValidation.quantity,
          needsReview: quantityValidation.needsReview || !!priceReviewReason,
          reviewReason,
          sourceText: originalSegment || raw || null,
          evidence: item.evidence || item.source_text || null,
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
const safeUnitPrice = confidence === "niedrig" ? 0 : detectedUnitPrice || 0;
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

  const intakeValidation = validateAndRepairParsedOrderItems({
    items: finalOrderItems,
    originalText: `${messageText}\n${fullWorkText}`,
    fallbackCurrency: intakeCurrency,
  });

  finalOrderItems = intakeValidation.items;

  // INTAKE_FLAT_TOTAL_LAST_GUARD_V8
  // Letzte Schutzschicht direkt vor Speichern: Pauschalpositionen haben
  // fachlich keine echte Menge, müssen aber mit Menge 1 gespeichert werden,
  // damit OrderItem.totalPrice und Order.totalPrice nicht fälschlich 0 bleiben.
  finalOrderItems = finalOrderItems.map((item) => {
    const unitType = getServiceUnitType(item.unit);
    const unitPriceValue = Number(item.unitPrice || 0);

    if (unitType !== "flat" || !Number.isFinite(unitPriceValue) || unitPriceValue <= 0) {
      return item;
    }

    const reviewReason = item.reviewReason || null;
    const onlyQuantityReview =
      reviewReason &&
      /menge|quantity|leistung_ist_pauschal|pauschal|pruefen|prüfen/i.test(reviewReason);

    return {
      ...item,
      quantity: 1,
      totalPrice: Math.round((unitPriceValue + Number.EPSILON) * 100) / 100,
      needsReview: onlyQuantityReview ? false : item.needsReview,
      reviewReason: onlyQuantityReview ? null : item.reviewReason,
    };
  });

  const aiExecutionAddress = parsed.auftrag?.ausfuehrungsadresse;
  const aiExecutionAddressText =
    aiExecutionAddress?.ist_abweichend === true
      ? [
          "Ausführungsadresse:",
          aiExecutionAddress?.name,
          aiExecutionAddress?.strasse,
          [aiExecutionAddress?.plz, aiExecutionAddress?.ort]
            .filter(Boolean)
            .join(" "),
          aiExecutionAddress?.evidence,
        ]
          .filter(Boolean)
          .join("\n")
      : "";

  const executionAddressCustomerContext = {
    customerAddress: addr.street,
    customerPlz: addr.plz,
    customerCity: addr.city,
  };

  const extractedExecutionAddress =
    // First pass: only the real customer message. This avoids polluted AI
    // evidence such as "Wohnanlage Seefeld Seefeldstrasse 8008".
    extractExecutionAddressFromText(messageText, executionAddressCustomerContext) ||
    // Second pass: full work text, if the webhook/transcript moved the address.
    extractExecutionAddressFromText(fullWorkText, executionAddressCustomerContext) ||
    // Last fallback: KI evidence only. Do not append special notes; those can
    // contain service/hint text and pollute the address fields.
    extractExecutionAddressFromText(aiExecutionAddressText, executionAddressCustomerContext);

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
    if (["stueck", "stück", "stk", "anzahl", "einheiten"].includes(v)) return "Stück";
    if (["kilogramm", "kg"].includes(v)) return "Kilogramm";
    if (["tonne", "tonnen", "to", "t"].includes(v)) return "Tonne";
    if (["liter", "ltr", "l"].includes(v)) return "Liter";
    if (["pauschal", "pauschale", "fixpreis", "festpreis"].includes(v)) return "Pauschal";

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

  // --- Auto-translation if message is not in hauptsprache ---
  let translationText = "";
  if (messageText.trim() && hauptsprache) {
    try {
      const transRes = await fetch(
        "https://api.openai.com/v1/chat/completions",
        {
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
                content: `Du bist ein Spracherkennungs- und Übersetzungsassistent. Analysiere den folgenden Text und bestimme die Sprache. Wenn der Text NICHT auf ${hauptsprache} ist, übersetze ihn auf ${hauptsprache}. Antworte NUR mit gültigem JSON:\n{"detected_language": "...", "is_target_language": true/false, "translation": "..." oder null falls keine Übersetzung nötig}\nKEINE Erklärungen, NUR JSON.`,
              },
              { role: "user", content: messageText },
            ],
            response_format: { type: "json_object" },
            max_tokens: 2600,
          }),
        },
      );
      if (transRes.ok) {
        const transResult = await transRes.json();
        const transContent = transResult?.choices?.[0]?.message?.content;
        if (transContent) {
          const transData = JSON.parse(transContent);
          if (
            transData &&
            !transData.is_target_language &&
            transData.translation
          ) {
            translationText = transData.translation;
            console.log(
              `[${source}] Auto-translated from ${transData.detected_language} to ${hauptsprache}`,
            );
          }
        }
      }
    } catch (e) {
      console.error(`[${source}] Translation failed:`, e);
    }
  }

  // --- Build notes ---
  const notesParts: string[] = [`${source}:\n${messageText}`];
  if (parsed.auftrag?.titel)
    notesParts.push(`\n[Titel: ${parsed.auftrag.titel}]`);
  if (parsed.system?.prioritaet === "hoch")
    notesParts.push(`[Priorität: hoch]`);
  if (translationText)
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
    ...quantityReviewReasons,
    ...unitMismatchReasons,
    ...intakeValidation.reviewReasons,
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
      notes: notesParts.join("\n"),
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
