/**
 * lib/phone.ts — Strict phone utility (Paket: Phase 1, additiv).
 *
 * CRITICAL: This module is NEW and ADDITIVE. It is NOT yet wired into any
 * production read/write path. Only the audit script (`scripts/audit-phone-normalization.ts`)
 * and unit tests in `tests/` may import from here until an explicit
 * activation phase is approved.
 *
 * Design rules (hard):
 *  - Uses libphonenumber-js with `/max` metadata for accurate validation.
 *  - Strict parsing: `{ extract: false }` — no substring extraction.
 *  - NO defaultCountry — we NEVER silently assume a region.
 *  - NO defaultCallingCode — we NEVER invent a country code.
 *  - National-only inputs (leading 0 without +) return null with MISSING_COUNTRY_CODE.
 *  - `00<digits>` is tolerated only as a shim for `+<digits>` (converted BEFORE parse).
 *  - `whatsapp:` channel prefix is stripped; BSUID-only payloads (no phone digits)
 *    are rejected with BSUID_ONLY.
 *  - Extensions are returned separately; they never appear inside normalizedE164.
 */

// We deliberately import from `libphonenumber-js/core` and pass metadata
// explicitly. This pattern works identically under Node (tsx), webpack (Next.js)
// and Jest/Vitest, while the sugar package `libphonenumber-js/max` breaks under
// some CommonJS resolvers because of its embedded `metadata.max.json.js`
// workaround. The end result — max-metadata strict parsing — is the same.
import {
  parsePhoneNumberWithError,
  ParseError,
  type PhoneNumber,
} from 'libphonenumber-js/core';
import metadata from 'libphonenumber-js/metadata.max.json';

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

export type ParseStatus =
  | 'PARSE_OK'
  | 'PARSE_OK_CHANNEL'
  | 'BSUID_ONLY'
  | 'MISSING_COUNTRY_CODE'
  | 'NOT_A_NUMBER'
  | 'INVALID_COUNTRY'
  | 'TOO_SHORT'
  | 'TOO_LONG'
  | 'UNKNOWN_PARSE_ERROR';

export type ReasonCode = 'PARSE_OK' | 'PHONE_UNPARSEABLE' | 'NEW_NULL' | 'COLLISION';

export interface SanitizeResult {
  /** The string that should be fed into the libphonenumber parser. */
  inputForParse: string;
  /** True if a `whatsapp:` prefix was present (and stripped). */
  hadWhatsappPrefix: boolean;
  /** True if the payload after channel-prefix stripping looks like a BSUID (no phone digits). */
  isBsuidOnly: boolean;
  /** True if we converted a leading `00` into `+` before parse. */
  maybeConverted00ToPlus: boolean;
}

export interface ParseResult {
  /** Canonical E.164 on success, or null on any failure. Extension is NEVER included. */
  normalizedE164: string | null;
  /** ISO-2 country inferred by libphonenumber, or null. */
  country: string | null;
  /** Raw extension digits (if any), or null. Separate from normalizedE164. */
  extension: string | null;
  /** Concrete parse status for telemetry / audit. */
  parseStatus: ParseStatus;
  /** Short reason code suitable for logs. */
  reasonCode: ReasonCode;
}

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

/**
 * Strip the `whatsapp:` channel prefix if present and detect whether the
 * remaining payload is a BSUID-only identifier (no leading '+' and no
 * phone-digit pattern we can hand off to libphonenumber).
 *
 * We also optionally convert a leading `00<digits>` into `+<digits>` because
 * that is a universally accepted international dialing prefix (e.g. in Europe)
 * and converting it here keeps the parser strict (we can still use
 * `extract:false` afterwards).
 */
export function sanitizePhoneInput(raw: string | null | undefined): SanitizeResult {
  const base: SanitizeResult = {
    inputForParse: '',
    hadWhatsappPrefix: false,
    isBsuidOnly: false,
    maybeConverted00ToPlus: false,
  };

  if (raw == null) return base;
  let s = String(raw).trim();
  if (!s) return base;

  // Strip "whatsapp:" channel prefix (case-insensitive). Also tolerate
  // legacy/alternate channel tags like "tel:" for robustness.
  const lower = s.toLowerCase();
  if (lower.startsWith('whatsapp:')) {
    base.hadWhatsappPrefix = true;
    s = s.slice('whatsapp:'.length).trim();
  } else if (lower.startsWith('tel:')) {
    s = s.slice('tel:'.length).trim();
  }

  if (!s) {
    // whatsapp: but empty payload
    base.isBsuidOnly = base.hadWhatsappPrefix;
    return base;
  }

  // Heuristic for BSUID-only payloads (Meta/Twilio synthetic IDs):
  // pattern like "CH.BSUID123ABC", "MX.BSUID-XYZ", etc. Contains letters
  // other than a possible leading `+`, AND contains no digit run of 8+.
  const looksLikeBsuid =
    /[A-Za-z]/.test(s.replace(/^\+/, '')) &&
    !/\d{8,}/.test(s.replace(/\D/g, ''));
  if (looksLikeBsuid) {
    base.isBsuidOnly = true;
    base.inputForParse = s;
    return base;
  }

  // Optional compatibility shim: leading 00<digits> → +<digits>. Only
  // triggered when followed directly by a digit (not "00-" or similar).
  if (/^00\d/.test(s)) {
    s = '+' + s.slice(2);
    base.maybeConverted00ToPlus = true;
  }

  base.inputForParse = s;
  return base;
}

/**
 * Map an arbitrary parse error (from libphonenumber-js ParseError or unknown)
 * to one of our concrete ParseStatus values.
 */
export function classifyParseError(error: unknown): ParseStatus {
  if (error instanceof ParseError) {
    switch (error.message) {
      case 'INVALID_COUNTRY':
        return 'INVALID_COUNTRY';
      case 'NOT_A_NUMBER':
        return 'NOT_A_NUMBER';
      case 'TOO_SHORT':
        return 'TOO_SHORT';
      case 'TOO_LONG':
        return 'TOO_LONG';
      default:
        return 'UNKNOWN_PARSE_ERROR';
    }
  }
  return 'UNKNOWN_PARSE_ERROR';
}

/**
 * Parse a raw phone string strictly. NO defaultCountry, NO defaultCallingCode,
 * NO substring extraction. Returns a full ParseResult for audit purposes.
 *
 * Rules:
 *  - Empty/whitespace → NOT_A_NUMBER.
 *  - `whatsapp:<BSUID>` → BSUID_ONLY, normalizedE164 null.
 *  - `whatsapp:+CC...` → parsed; parseStatus PARSE_OK_CHANNEL on success.
 *  - Leading `00<digits>` is converted to `+<digits>` BEFORE parse (opt-in shim).
 *  - Input without `+` (after channel/00 handling) and without clear international
 *    prefix → MISSING_COUNTRY_CODE, normalizedE164 null.
 */
export function parsePhoneStrict(raw: string | null | undefined): ParseResult {
  const fail = (parseStatus: ParseStatus): ParseResult => ({
    normalizedE164: null,
    country: null,
    extension: null,
    parseStatus,
    reasonCode: parseStatus === 'PARSE_OK' || parseStatus === 'PARSE_OK_CHANNEL' ? 'PARSE_OK' : 'PHONE_UNPARSEABLE',
  });

  if (raw == null) return fail('NOT_A_NUMBER');
  const asString = String(raw).trim();
  if (!asString) return fail('NOT_A_NUMBER');

  const sanitized = sanitizePhoneInput(asString);

  if (sanitized.isBsuidOnly) {
    return fail('BSUID_ONLY');
  }

  const input = sanitized.inputForParse;
  if (!input) return fail('NOT_A_NUMBER');

  // Hard rule: without a leading '+' after our sanitization we refuse to guess.
  // This means a pure national input (e.g. "0791234567", "01711234567") maps to
  // MISSING_COUNTRY_CODE and NEVER becomes a normalized E.164.
  if (!input.startsWith('+')) {
    return fail('MISSING_COUNTRY_CODE');
  }

  let phone: PhoneNumber;
  try {
    // core.parsePhoneNumberWithError takes metadata as a trailing argument.
    // We pass NO defaultCountry / defaultCallingCode by design; we ONLY set
    // `extract: false` to disable substring extraction.
    phone = parsePhoneNumberWithError(input, { extract: false }, metadata as any);
  } catch (err) {
    return fail(classifyParseError(err));
  }

  if (!phone || !phone.number) {
    return fail('NOT_A_NUMBER');
  }

  // Reject non-strict matches defensively. libphonenumber `number` is E.164.
  const e164 = phone.number;
  if (!/^\+\d{8,15}$/.test(e164)) {
    // Very short strings can still parse to non-valid numbers; reject.
    return fail('TOO_SHORT');
  }

  const parseStatus: ParseStatus = sanitized.hadWhatsappPrefix ? 'PARSE_OK_CHANNEL' : 'PARSE_OK';

  return {
    normalizedE164: e164,
    country: phone.country || null,
    extension: phone.ext || null,
    parseStatus,
    reasonCode: 'PARSE_OK',
  };
}

/** Convenience wrapper: return only the canonical E.164 (or null). */
export function toE164Strict(raw: string | null | undefined): string | null {
  return parsePhoneStrict(raw).normalizedE164;
}

/** True iff both inputs normalize to the same non-null E.164. */
export function phoneEqualsStrict(a: string | null | undefined, b: string | null | undefined): boolean {
  const na = toE164Strict(a);
  const nb = toE164Strict(b);
  if (!na || !nb) return false;
  return na === nb;
}

/**
 * Mask a phone-like value for log output.
 * Shows at most the last 3 digits; everything else becomes `*` or the original
 * `+<CC>` prefix (up to 3 leading digits) is preserved.
 * If no digits are extractable, returns '[redacted]'.
 */
export function maskPhoneForLog(rawOrNormalized: string | null | undefined): string {
  if (rawOrNormalized == null) return '[redacted]';
  const s = String(rawOrNormalized);
  const digitsOnly = s.replace(/\D/g, '');
  if (!digitsOnly) return '[redacted]';

  // Preserve a leading '+' if present in the raw form
  const hasPlus = s.trim().startsWith('+');
  const head = digitsOnly.slice(0, Math.min(3, Math.max(0, digitsOnly.length - 3)));
  const tail = digitsOnly.slice(-3);
  const stars = '*'.repeat(Math.max(0, digitsOnly.length - head.length - tail.length));
  return `${hasPlus ? '+' : ''}${head}${stars}${tail}`;
}
