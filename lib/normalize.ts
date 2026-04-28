/**
 * Normalize and trim customer data before saving.
 * - trim() all string fields
 * - Capitalize first letter of each word (for name, city)
 * - Email → lowercase
 */

// ─────────────────────────────────────────────────────────────
// Paket A: Phone Number Foundation
// Single source of truth for business phone-number normalization.
// Produces a canonical E.164 form (`+...`) used for storage AND lookup.
// ─────────────────────────────────────────────────────────────

/**
 * Normalize a business phone number to canonical E.164 (international) form.
 *
 * Rules (practical, not strict E.164):
 *  - strip spaces, dashes, parentheses, dots
 *  - keep a leading '+'
 *  - leading '00' → '+' (e.g. 0041 → +41)
 *  - leading '0' with no '+' → treat as Swiss national (0 prefix stripped, '+41' prepended)
 *    This mirrors the installed base of Swiss accounts; other countries must enter '+' explicitly.
 *  - after cleanup, must contain ONLY '+' followed by digits, with 8..15 digits total.
 *
 * Returns:
 *  - canonical E.164 string (e.g. '+41766232723') if valid
 *  - null if input is empty / whitespace / clearly invalid
 *
 * This is the SINGLE source of truth — called by:
 *   - PUT /api/settings (server-side normalize at save)
 *   - UI Einstellungen (onBlur normalize for instant feedback)
 *   - lib/phone-resolver (normalize incoming webhook number for comparison)
 */
export function normalizePhoneE164(value: string | null | undefined): string | null {
  if (value == null) return null;
  const raw = String(value).trim();
  if (!raw) return null;

  // Strip spaces, dashes, parens, dots
  let cleaned = raw.replace(/[\s\-\(\)\.]/g, '');

  // 00XX... → +XX...
  if (cleaned.startsWith('00')) cleaned = '+' + cleaned.slice(2);

  // Leading 0 (no +) → assume Swiss national: 0766... → +4176...
  if (cleaned.startsWith('0') && !cleaned.startsWith('+')) cleaned = '+41' + cleaned.slice(1);

  // Bare digits without +: assume already international, prefix '+'
  if (!cleaned.startsWith('+') && /^\d+$/.test(cleaned)) cleaned = '+' + cleaned;

  // Final validation: '+' followed by 8..15 digits (E.164 max = 15)
  if (!/^\+\d{8,15}$/.test(cleaned)) return null;

  return cleaned;
}

/**
 * Returns true if two phone numbers are considered equal after normalization.
 * Convenient for equality checks without each caller repeating the normalize step.
 *
 * @deprecated Use `phoneEqualsStrict` from `@/lib/phone` for all read-path
 *   (match/search/dedupe) comparisons. This legacy helper relies on the
 *   pragmatic `normalizePhoneE164` (CH-fallback on leading `0`, digit-only
 *   regex) and is intentionally kept only for write-path normalization at
 *   save time (Einstellungen, Signup, Customer create/update) where the
 *   historical behaviour is required. For all NEW call sites, prefer
 *   `phoneEqualsStrict` (libphonenumber-js, no default region).
 */
export function phoneEquals(a: string | null | undefined, b: string | null | undefined): boolean {
  const na = normalizePhoneE164(a);
  const nb = normalizePhoneE164(b);
  if (!na || !nb) return false;
  return na === nb;
}

/** Capitalize first letter of each word */
export function capitalizeWords(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  // Capitalize first letter of each word, preserve German prefixes like "von", "der"
  return trimmed.replace(/\b\w/g, (c, index) => {
    // Keep lowercase for common German/Swiss name prefixes after first word
    const preceding = trimmed.slice(0, index).trim();
    const word = trimmed.slice(index).split(/\s/)[0].toLowerCase();
    if (preceding && ['von', 'van', 'der', 'de', 'du', 'la', 'le', 'di', 'el', 'al'].includes(word)) {
      return c.toLowerCase();
    }
    return c.toUpperCase();
  });
}

/** Trim a string field, return null if empty */
export function trimField(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed || null;
}

/**
 * Paket O: whitelist of valid ISO-2 country codes we actively support for
 * autocomplete (CH, DE, AT, FR, IT, LI) plus OTHER for the "Andere / manuell"
 * escape hatch. Anything outside this list is normalized back to CH to keep
 * the DB clean. If the caller passes no value at all, we keep it undefined so
 * Prisma's schema-level default ("CH") is used on create, and the existing
 * value is kept on update.
 */
const SUPPORTED_COUNTRIES = new Set(['CH', 'DE', 'AT', 'FR', 'IT', 'LI', 'OTHER']);

export function normalizeCountry(value: string | null | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (value === null) return 'CH';
  const trimmed = String(value).trim().toUpperCase();
  if (!trimmed) return 'CH';
  return SUPPORTED_COUNTRIES.has(trimmed) ? trimmed : 'CH';
}

/** Normalize customer data for saving */
export function normalizeCustomerData(data: {
  name?: string | null;
  address?: string | null;
  plz?: string | null;
  city?: string | null;
  country?: string | null;
  phone?: string | null;
  email?: string | null;
  notes?: string | null;
  customerNumber?: string | null;
}) {
  const normalizedCountry = normalizeCountry(data?.country);
  return {
    name: capitalizeWords(data?.name) || data?.name?.trim() || '',
    address: trimField(data?.address),
    plz: trimField(data?.plz),
    city: capitalizeWords(data?.city),
    // Paket O: only include country in the output when the caller provided one
    // so create/update semantics are preserved (omit -> use schema default or
    // keep existing value).
    ...(normalizedCountry !== undefined ? { country: normalizedCountry } : {}),
    phone: trimField(data?.phone),
    email: data?.email?.trim()?.toLowerCase() || null,
    notes: trimField(data?.notes),
    ...(data?.customerNumber !== undefined ? { customerNumber: data.customerNumber } : {}),
  };
}
