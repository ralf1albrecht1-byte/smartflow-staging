/**
 * Intake sanitization — defense-in-depth for customer master data on CREATE.
 *
 * Problem class addressed:
 *   On weak matches (name-only, possible-match, no match), the LLM-driven intake
 *   pipeline must NEVER silently persist address or contact fields into a NEW
 *   customer record unless those values are actually present in the incoming
 *   message (text / transcript / OCR). Without this guard, the LLM can copy
 *   fields from the `bestehende_kunden` prompt list into its `kunde.*` output,
 *   which then gets written 1:1 when a new customer is created.
 *
 * Scope:
 *   - Applies ONLY to the create-new-customer branch of intake pipelines
 *     (order-intake.ts, quick-intake/route.ts).
 *   - Does NOT apply when verifyCustomerMatch returned 'auto_assign' and we
 *     update/improve an existing customer — that path goes through
 *     lib/data-protection.ts (protectCustomerData) and deals with a confirmed
 *     strong-signal match.
 *   - Does NOT apply to user-initiated manual writes (customer edit forms,
 *     manual merge).
 *
 * Contract:
 *   Each field is kept only if a normalized form of it appears as a substring
 *   in the normalized raw-text corpus of the incoming message. Otherwise it is
 *   dropped to null. No guessing, no inference from other fields.
 */

export interface SanitizeInput {
  /** Raw text of the incoming message (text + audio transcript + OCR — whatever the user actually sent). */
  rawText: string | null | undefined;
  street: string | null | undefined;
  plz: string | null | undefined;
  city: string | null | undefined;
  phone?: string | null | undefined;
  email?: string | null | undefined;
}

export interface SanitizeResult {
  street: string | null;
  plz: string | null;
  city: string | null;
  phone: string | null;
  email: string | null;
  /** Fields that were present on input but got dropped because they did not appear in rawText. */
  dropped: string[];
}

/**
 * Normalize a string for tolerant substring matching.
 * Lowercase, fold common Swiss/German umlauts, collapse whitespace,
 * strip punctuation, unify `str.`/`strasse`/`straße`.
 */
export function normalizeForMatch(s: string | null | undefined): string {
  if (!s) return '';
  return s
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/straße/g, 'strasse')
    // Unify "str." → "strasse". We deliberately only target the abbreviation
    // *with dot*; bare "str" without dot is often part of another word
    // (e.g. "struktur") and folding it would cause false positives.
    .replace(/str\./g, 'strasse')
    .replace(/[^\p{L}\p{N}\s@+\-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Normalize a phone string to a bare-digit form for substring comparison. */
function normalizePhoneDigits(s: string | null | undefined): string {
  if (!s) return '';
  return s.replace(/\D+/g, '');
}

// ─────────────────────────────────────────────────────────────────────────
// Phase 2c: Exact-match normalizers.
//
// Exported so lib/exact-customer-match.ts can reuse the SAME normalization
// used by sanitizeNewCustomerFields. Do not fork/copy these elsewhere.
// ─────────────────────────────────────────────────────────────────────────

/** Normalize a customer name for exact-match comparison (case/whitespace folded). */
export function normalizeNameForMatch(s: string | null | undefined): string {
  return normalizeForMatch(s);
}

/** Normalize a street (with or without house number) for exact-match comparison. */
export function normalizeStreetForMatch(s: string | null | undefined): string {
  return normalizeForMatch(s);
}

/** Normalize a city for exact-match comparison. */
export function normalizeCityForMatch(s: string | null | undefined): string {
  return normalizeForMatch(s);
}

/**
 * Normalize a PLZ for exact-match comparison.
 * Strips non-digits; returns '' if fewer than 4 digits (ambiguous).
 */
export function normalizePlzForMatch(s: string | null | undefined): string {
  const digits = (s || '').replace(/\D+/g, '');
  return digits.length >= 4 ? digits : '';
}

/**
 * Return true if `value` is demonstrably present in `rawText`.
 * Uses normalizeForMatch on both sides (umlaut/strasse/str. tolerant).
 * For short values (< 2 chars normalized) returns false — too ambiguous.
 */
function textContains(rawText: string, value: string): boolean {
  const n = normalizeForMatch(value);
  if (n.length < 2) return false;
  return normalizeForMatch(rawText).includes(n);
}

/**
 * Sanitize candidate customer master data for a NEW-customer create path.
 *
 * Rule: a field is kept only if its normalized form is present in the
 * normalized raw-text corpus. Otherwise → null.
 *
 * Special cases:
 *   - PLZ: must appear as an exact digit-run in rawText (after digit extraction).
 *   - Phone: must share a digit-run of ≥ 6 digits with rawText (avoids matching
 *     random 3-digit sequences like area codes or house numbers).
 *   - Email: must appear verbatim (case-insensitive) in rawText.
 *   - Street: normalized substring (tolerant to str./strasse/umlauts).
 *   - City: normalized substring.
 */
export function sanitizeNewCustomerFields(input: SanitizeInput): SanitizeResult {
  const raw = (input.rawText || '').trim();
  const dropped: string[] = [];

  const out: SanitizeResult = {
    street: null,
    plz: null,
    city: null,
    phone: null,
    email: null,
    dropped,
  };

  // If there is no raw text at all, we cannot verify anything → drop every
  // auto-derived field. The customer will be created with just a name.
  // (An empty raw text means the message was image-only; the intake pipeline
  // already marks those as needs_review, so losing address data is acceptable
  // and strictly safer than persisting LLM-invented values.)
  const hasRaw = raw.length > 0;

  // ── street ──
  if (input.street && input.street.trim()) {
    if (hasRaw && textContains(raw, input.street)) {
      out.street = input.street.trim();
    } else {
      dropped.push('street');
    }
  }

  // ── plz ──
  if (input.plz && String(input.plz).trim()) {
    const plz = String(input.plz).trim();
    const digits = plz.replace(/\D+/g, '');
    if (hasRaw && digits.length >= 4 && new RegExp(`(?<!\\d)${digits}(?!\\d)`).test(raw)) {
      out.plz = plz;
    } else {
      dropped.push('plz');
    }
  }

  // ── city ──
  if (input.city && input.city.trim()) {
    if (hasRaw && textContains(raw, input.city)) {
      out.city = input.city.trim();
    } else {
      dropped.push('city');
    }
  }

  // ── phone ──
  if (input.phone && input.phone.trim()) {
    const rawDigits = normalizePhoneDigits(raw);
    const pDigits = normalizePhoneDigits(input.phone);
    // Require at least a 6-digit contiguous overlap (tail of the phone number)
    // to count as "present in the message". 6 digits is short enough to allow
    // different prefix formats (+41 / 0041 / 0), long enough to avoid matching
    // PLZ or house-number sequences.
    const tail = pDigits.length >= 6 ? pDigits.slice(-6) : pDigits;
    if (hasRaw && tail.length >= 6 && rawDigits.includes(tail)) {
      out.phone = input.phone.trim();
    } else {
      dropped.push('phone');
    }
  }

  // ── email ──
  if (input.email && input.email.trim()) {
    const email = input.email.trim();
    if (hasRaw && raw.toLowerCase().includes(email.toLowerCase())) {
      out.email = email;
    } else {
      dropped.push('email');
    }
  }

  return out;
}
