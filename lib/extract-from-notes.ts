/**
 * Extrahiert Kundendaten (Telefon, E-Mail, Strasse, PLZ, Ort) aus Freitext-Nachrichten.
 * Wird verwendet, um beim "Kunde bearbeiten" fehlende Felder automatisch vorzufüllen.
 *
 * ─── Layer 2 of three-layer customer-data-pollution defense ───
 * Webhook-fallback orders write notes that contain SYSTEM metadata (sender
 * profile name, Twilio inbound number, ISO timestamps, audio duration, etc.)
 * Without sanitization, a regex like /\b([1-9]\d{3,4})\b/ would happily turn
 * "2026-04-26T13:31" (the timestamp "Empfangen") into PLZ = 2026, and the
 * Twilio sandbox number "+14155238886" into the customer's phone.
 *
 * `sanitizeNotesForExtraction` therefore strips every line we know to be
 * pure metadata BEFORE the regex run. It uses two complementary strategies:
 *
 *   A) Drop every line starting with `[META]` (the new explicit marker
 *      added by lib/order-intake.ts).
 *   B) Drop legacy lines that match well-known metadata patterns:
 *      `Quelle:`, `Absender:`, `Empfangen:`, `Audiodauer:`, `Grund:`,
 *      `Telefon (Absender…):`, `Audio-Verbrauch …`. These existed before
 *      Layer 1 and may still be present on legacy orders / DB rows.
 *   C) Strip ISO-timestamps (e.g. `2026-04-26T13:31:00.628Z`) anywhere in
 *      the surviving text — defense in depth in case a legacy raw text
 *      copied a timestamp into the user-visible part.
 *   D) Strip the Twilio sandbox number `+14155238886` (and the bare-digit
 *      forms `14155238886` / `4155238886`) anywhere in the surviving text.
 */

export interface ExtractedCustomerData {
  phone: string | null;
  email: string | null;
  street: string | null;
  plz: string | null;
  city: string | null;
}

// ─────────────────────────────────────────────────────────────────────────
// Sanitization helpers
// ─────────────────────────────────────────────────────────────────────────

/** Twilio WhatsApp sandbox sender number(s) that must NEVER end up in the
 *  customer's `phone` field. Conservative list — extend if other Twilio
 *  numbers appear in the wild. */
const TWILIO_SANDBOX_NUMBERS: string[] = [
  '+14155238886',
  '14155238886',
  '4155238886',
];

/** Common system-metadata line patterns (legacy, no [META] prefix yet). */
const LEGACY_META_LINE_PATTERNS: RegExp[] = [
  /^\s*Quelle\s*:/i,
  /^\s*Absender\s*:/i,
  /^\s*Absender\s*\(/i,
  /^\s*Empfangen\s*:/i,
  /^\s*Audiodauer\s*:/i,
  /^\s*Audio-Verbrauch\b/i,
  /^\s*Grund\s*:/i,
  /^\s*Telefon\s*\(Absender/i,
  /^\s*Telefon\s*:/i, // legacy: plain "Telefon: <sender#>" line from older
                       // intake fallbacks. Only system-injected, never user.
  /^\s*Hinweis\s*:/i,
];

/**
 * Sanitize raw notes by dropping metadata lines and stripping
 * timestamp/twilio fragments. Pure function, deterministic.
 */
export function sanitizeNotesForExtraction(text: string | null | undefined): string {
  if (!text) return '';
  const lines = String(text).split(/\r?\n/);
  const kept = lines.filter(line => {
    const trimmed = line.trim();
    if (!trimmed) return false;
    // (A) Explicit Layer-1 marker.
    if (/^\s*\[META\]/i.test(trimmed)) return false;
    // (B) Legacy metadata lines.
    for (const pat of LEGACY_META_LINE_PATTERNS) {
      if (pat.test(trimmed)) return false;
    }
    return true;
  });
  let cleaned = kept.join('\n');
  // (C) Strip ISO-8601 timestamps anywhere (date with optional time).
  cleaned = cleaned.replace(
    /\b\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,6})?)?(?:Z|[+\-]\d{2}:?\d{2})?)?\b/g,
    ' ',
  );
  // (D) Strip Twilio sandbox numbers.
  for (const num of TWILIO_SANDBOX_NUMBERS) {
    // Use literal includes/replace — these are pure digits/+ which are not
    // regex meta-characters except the leading +, so we can build a literal
    // regex from the escaped form.
    const escaped = num.replace(/[+]/g, '\\+');
    cleaned = cleaned.replace(new RegExp(escaped, 'g'), ' ');
  }
  return cleaned;
}

export function extractCustomerDataFromText(text: string | null | undefined): ExtractedCustomerData {
  const result: ExtractedCustomerData = { phone: null, email: null, street: null, plz: null, city: null };
  if (!text || !text.trim()) return result;

  // Layer 2 — drop metadata lines and timestamp/twilio fragments BEFORE any
  // regex scan. Operating on the sanitized buffer means none of the
  // downstream patterns can ever match a system-derived value.
  const sanitized = sanitizeNotesForExtraction(text);
  if (!sanitized.trim()) return result;

  // ---- Telefon ----
  // Swiss patterns: +41 79 123 45 67, 079 123 45 67, 0564261234, 056 426 12 34
  // Also short numbers like "086577" and patterns with "tell/tel/telefon" keyword
  // Phase: also handle spaced digits from audio transcription: "0 8 7 6 5 4 3 2 1"

  // Pre-process: collapse spaced single digits that form a phone number.
  // Audio transcription often spells out: "0 8 7 6 5 4 3 2 1" or "zero eight seven..."
  // We normalize sequences of 6+ single digits separated by spaces: "0 8 7 6 ..." → "0876..."
  const spacedDigitNormalized = sanitized.replace(
    /\b(\d(?:\s+\d){5,})\b/g,
    (match) => match.replace(/\s+/g, ''),
  );

  // Also handle keyword-triggered extraction: "meine Telefonnummer ist 0 8 7 6 5 4 3 2 1"
  // or "my number is 0 8 7 ..." — extract digits after the keyword even when spaced
  const keywordPhoneMatch = sanitized.match(
    /(?:telefonnummer|phone\s*number|nummer|number|rufnummer|handy|mobile|mobil)\s+(?:ist|is|lautet)?\s*((?:\d\s*){6,})/i,
  );
  let keywordExtractedPhone: string | null = null;
  if (keywordPhoneMatch) {
    const digits = keywordPhoneMatch[1].replace(/\s+/g, '');
    if (digits.length >= 6) {
      keywordExtractedPhone = digits;
    }
  }

  const phonePatterns = [
    /(?:\+41|0041)\s*\(?0?\)?\s*\d{1,2}\s*\d{3}\s*\d{2}\s*\d{2}/,
    /0\d{1,2}\s+\d{3}\s+\d{2}\s+\d{2}/,
    /0\d{9}/,
    /0\d{4,}/,  // short numbers like 086577
    /(?:tel(?:l|efon)?|telefon|nr)[:\s.]*(\+?\d[\d\s\-\/]{4,})/i, // "tell 086577", "tel: 079..."
  ];

  // Try keyword extraction first (most explicit signal)
  if (keywordExtractedPhone) {
    result.phone = keywordExtractedPhone;
  }

  // Then try standard patterns on the spaced-digit-normalized text
  if (!result.phone) {
    for (const pat of phonePatterns) {
      const m = spacedDigitNormalized.match(pat);
      if (m) {
        result.phone = (m[1] || m[0]).replace(/[\s\-\/]+/g, ' ').trim();
        break;
      }
    }
  }

  // Fallback: try standard patterns on original sanitized text
  if (!result.phone) {
    for (const pat of phonePatterns) {
      const m = sanitized.match(pat);
      if (m) {
        result.phone = (m[1] || m[0]).replace(/[\s\-\/]+/g, ' ').trim();
        break;
      }
    }
  }

  // ---- E-Mail ----
  const emailMatch = sanitized.match(/[\w.+\-]+@[\w.\-]+\.[a-z]{2,}/i);
  if (emailMatch) result.email = emailMatch[0];

  // ---- Strasse + Hausnummer ----
  // Match patterns like "Schartenstrasse 27", "Landstr. 5", "Bahnhofstr 15a", "hindenburgstr 21"
  const streetPatterns = [
    /([A-Za-zÄÖÜäöüß]+(?:strasse|straße|str\.?)\s+\d+[a-z]?)/i,
    /([A-Za-zÄÖÜäöüß]+(?:weg|gasse|platz|rain|acher?|matte?|feld|berg|bühl|halde|graben|ring|allee|promenade)\s+\d+[a-z]?)/i,
  ];
  for (const pat of streetPatterns) {
    const m = sanitized.match(pat);
    if (m) {
      // Capitalize first letter
      const raw = (m[1]?.trim() || m[0].trim());
      result.street = raw.charAt(0).toUpperCase() + raw.slice(1);
      break;
    }
  }

  // ---- PLZ ----
  // Swiss 4-digit PLZ or German 5-digit PLZ
  const plzMatch = sanitized.match(/\b([1-9]\d{3,4})\b/);
  if (plzMatch) result.plz = plzMatch[1];

  // ---- Ort ----
  // Blocklist: common English/German words that are NOT city names.
  // These get false-matched by "in <Word>" patterns (e.g. "in addition", "in order").
  const NOT_A_CITY = new Set([
    // English
    'addition', 'order', 'general', 'case', 'total', 'fact', 'particular',
    'detail', 'advance', 'progress', 'process', 'front', 'return', 'response',
    'short', 'between', 'about', 'after', 'before', 'time', 'place', 'the',
    'this', 'that', 'which', 'with', 'from', 'your', 'our', 'their',
    'other', 'some', 'any', 'all', 'each', 'every', 'both', 'either',
    'neither', 'such', 'more', 'most', 'very', 'just', 'also', 'too',
    'only', 'still', 'already', 'even', 'now', 'then', 'here', 'there',
    'where', 'when', 'how', 'what', 'who', 'why', 'but', 'and', 'not',
    'yes', 'please', 'thanks', 'thank', 'hello', 'good', 'great', 'sure',
    'well', 'right', 'left', 'first', 'last', 'next', 'new', 'old', 'long',
    'terms', 'touch', 'mind', 'need', 'hope', 'fact', 'love', 'view',
    'itself', 'itself', 'full', 'half', 'part', 'hand', 'turn', 'line',
    'request', 'contact', 'question', 'summary', 'regard', 'regards',
    // German (non-city words often following "in")
    'der', 'die', 'das', 'den', 'dem', 'ein', 'eine', 'einem', 'einen', 'einer',
    'ordnung', 'zukunft', 'richtung', 'diesem', 'dieser', 'diesen', 'seinem',
    'ihrem', 'meinem', 'deinem', 'unserem', 'eurem', 'welchem', 'jedem', 'jeder',
    'kuerze', 'sachen', 'bezug', 'hinblick', 'zusammenhang', 'etwa', 'ungefaehr',
    'etwa', 'circa', 'zwischen', 'verbindung', 'anschluss', 'letzter',
  ]);

  /** Check if a word is likely NOT a city name */
  const isNotCity = (w: string) => {
    const lower = w.toLowerCase();
    return NOT_A_CITY.has(lower) ||
      /strasse|straße|str|weg|gasse|platz|ring|allee/.test(lower) ||
      lower.length < 3 ||
      // Pure English gerunds/verb forms ending in -ing, -tion, -ment, -ness, -able, -ible
      /(?:ing|tion|sion|ment|ness|able|ible|ous|ive|ful|less)$/i.test(lower);
  };

  // After PLZ: "5430 Wettingen" or "77978 seelbach"
  if (plzMatch) {
    const idx = sanitized.indexOf(plzMatch[0]) + plzMatch[0].length;
    const after = sanitized.substring(idx).trim();
    const cityMatch = after.match(/^([A-Za-zÄÖÜäöüß]+)/u);
    if (cityMatch && !isNotCity(cityMatch[1])) {
      const c = cityMatch[1].trim();
      result.city = c.charAt(0).toUpperCase() + c.slice(1);
    }
  }
  // Fallback: "in Wettingen", "in wettingen" pattern (case insensitive)
  // Filter out articles and known non-city words
  if (!result.city) {
    const inCityMatch = sanitized.match(/\bin\s+(?:der|die|das|den|dem)\s+/i)
      ? null
      : sanitized.match(/\bin\s+([A-Za-zÄÖÜäöüß]{3,})/i);
    if (inCityMatch && !isNotCity(inCityMatch[1])) {
      const c = inCityMatch[1].trim();
      result.city = c.charAt(0).toUpperCase() + c.slice(1);
    }
  }
  // Second fallback: "wohne in wettingen" with article -> "in der Schartenstraße 27 in Wittingen"
  if (!result.city) {
    // Match all "in <Word>" and take the last one that's not a blocked word or street-related
    const allInMatches = [...sanitized.matchAll(/\bin\s+([A-Za-zÄÖÜäöüß]{3,})/gi)];
    for (let i = allInMatches.length - 1; i >= 0; i--) {
      const c = allInMatches[i][1];
      if (!isNotCity(c)) {
        result.city = c.charAt(0).toUpperCase() + c.slice(1);
        break;
      }
    }
  }

  return result;
}

/**
 * Merges extracted data into customer fields, only filling empty ones.
 */
export function autoFillCustomerFromNotes(
  currentCust: { name: string; phone: string; email: string; address: string; plz: string; city: string },
  notes: string | null | undefined
): { name: string; phone: string; email: string; address: string; plz: string; city: string } {
  if (!notes) return { ...currentCust };
  const extracted = extractCustomerDataFromText(notes);
  return {
    name: currentCust.name,
    phone: currentCust.phone || extracted.phone || '',
    email: currentCust.email || extracted.email || '',
    address: currentCust.address || extracted.street || '',
    plz: currentCust.plz || extracted.plz || '',
    city: currentCust.city || extracted.city || '',
  };
}
