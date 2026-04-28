/**
 * Utility to split specialNotes into system hints vs. real job hints,
 * and further split job hints into hazards vs. operational notes.
 */

const SYSTEM_KEYWORDS = /Kundentreffer|prüfen|Confidence|⚠️|🚨|Kundendaten|Konflikt|Zuordnung|manuelle.*prüfung|Priorität.*HOCH/i;
const WARNING_KEYWORDS = /\b(hund|hunde|vorsicht|gefahr|achtung|leiter|hanglage|tor\s*geschlossen|tor\s*zu|bissig|aggressiv|dog|chien|ladder|échelle|steep|slope|pente|danger|caution|attention)\b/i;

/** Keywords that represent real physical hazards / danger — shown as RED badges */
const HAZARD_KEYWORDS = /\b(hund|hunde|bissig|aggressiv|gefahr|vorsicht|achtung|hanglage|steilhang|absturz|absturzgefahr|dog|chien|cane|perro|dangerous|dangereux|pericoloso|mordre|bite|beissen)\b/i;

/** Keywords that represent extra equipment / effort / logistic requirements — shown as AMBER/YELLOW badges */
const EQUIPMENT_KEYWORDS = /\b(leiter|ladder|échelle|steep|pente|slope|zufahrt|zugang|schwierig|eng|gerät|gerüst|hebebühne|kran|anhänger|tor\s*geschlossen|tor\s*zu|schlüssel|schwer\s*zugänglich|difficile.*accès|hard.*access|difficult.*access)\b/i;

/** Keywords that indicate the customer requests a callback — shown as special note */
const CALLBACK_KEYWORDS = /\b(bitte\s*(an)?rufen|bitte\s*zurückrufen|rückruf\s*(erwünscht|gewünscht|erbeten)|können\s*sie\s*mich\s*anrufen|bitte\s*telefonisch\s*melden|call\s*me(\s*back)?|please\s*call|rappel(ez)?|richiama(re|temi)?)\b/i;

export interface SplitNotes {
  systemHints: string[];
  jobHints: string[];
}

export interface SplitJobHints {
  hazards: string[];
  equipment: string[];
  operational: string[];
}

/**
 * Splits specialNotes text into system hints and real job hints.
 * Lines matching SYSTEM_KEYWORDS go to systemHints, everything else to jobHints.
 */
export function splitSpecialNotes(text: string | null | undefined): SplitNotes {
  if (!text || !text.trim()) return { systemHints: [], jobHints: [] };
  
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const systemHints: string[] = [];
  const jobHints: string[] = [];
  
  for (const line of lines) {
    if (SYSTEM_KEYWORDS.test(line)) {
      systemHints.push(line);
    } else {
      jobHints.push(line);
    }
  }
  
  return { systemHints, jobHints };
}

/**
 * Further splits job hints into three categories:
 * - hazards (real danger/warning) → RED badges: Hund, Hanglage, Absturzgefahr, bissig, Vorsicht
 * - equipment (extra requirements/effort) → AMBER/YELLOW badges: Leiter nötig, Zufahrt schwierig
 * - operational (other practical notes) → plain text
 */
export function splitJobHints(jobHints: string[]): SplitJobHints {
  const hazards: string[] = [];
  const equipment: string[] = [];
  const operational: string[] = [];
  
  for (const hint of jobHints) {
    if (HAZARD_KEYWORDS.test(hint)) {
      hazards.push(hint);
    } else if (EQUIPMENT_KEYWORDS.test(hint)) {
      equipment.push(hint);
    } else {
      operational.push(hint);
    }
  }
  
  return { hazards, equipment, operational };
}

/**
 * Checks if a text contains warning keywords that need special highlighting.
 */
export function hasWarningKeywords(text: string): boolean {
  return WARNING_KEYWORDS.test(text);
}

/**
 * Highlights warning keywords in text by wrapping them in spans.
 * Returns an array of React-compatible segments.
 */
export function getWarningSegments(text: string): Array<{ text: string; isWarning: boolean }> {
  if (!text) return [];
  
  const regex = /\b(hund|hunde|vorsicht|gefahr|achtung|leiter|hanglage|tor\s*geschlossen|tor\s*zu|bissig|aggressiv|dog|chien|ladder|échelle|steep|slope|danger|caution|attention)\b/gi;
  const segments: Array<{ text: string; isWarning: boolean }> = [];
  let lastIndex = 0;
  let match;
  
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ text: text.slice(lastIndex, match.index), isWarning: false });
    }
    segments.push({ text: match[0], isWarning: true });
    lastIndex = regex.lastIndex;
  }
  
  if (lastIndex < text.length) {
    segments.push({ text: text.slice(lastIndex), isWarning: false });
  }
  
  return segments.length > 0 ? segments : [{ text, isWarning: false }];
}

/**
 * Detects if a message contains a callback request from the customer.
 * Returns the normalized callback note or null.
 */
export function detectCallbackRequest(text: string | null | undefined): string | null {
  if (!text) return null;
  if (CALLBACK_KEYWORDS.test(text)) return 'Rückruf gewünscht';
  return null;
}

/**
 * Checks if a customer has complete address data (Straße + PLZ + Ort).
 */
export function hasCompleteAddress(customer: { address?: string | null; plz?: string | null; city?: string | null } | null | undefined): boolean {
  if (!customer) return false;
  return !!(customer.address?.trim() && customer.plz?.trim() && customer.city?.trim());
}