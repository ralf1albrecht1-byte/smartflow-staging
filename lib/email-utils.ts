/**
 * lib/email-utils.ts — single source of truth for email normalization.
 *
 * Background
 * ----------
 * Postgres / Prisma `findUnique({ where: { email } })` is case-sensitive by
 * default. If a user signs up as `Ralf.seelbach@web.de` and later types
 * `ralf.seelbach@web.de` at login, those are two different rows. This caused
 * the production incident where verified users could not log in because the
 * browser auto-filled lowercase, matching an older unverified shadow account.
 *
 * Going forward, every code path that looks up or stores an email MUST run it
 * through `normalizeEmail()`. For lookups against legacy mixed-case data, use
 * Prisma's `mode: 'insensitive'` so we match either case.
 *
 * Idempotent: calling `normalizeEmail` on an already-normalized value is a
 * no-op and is safe to call multiple times.
 */

/**
 * Normalize an email for storage and comparison:
 *  - trim whitespace on both ends
 *  - lower-case the entire address
 *
 * Returns an empty string for non-string / null inputs so callers can do a
 * single truthy-check instead of dealing with undefined.
 */
export function normalizeEmail(input: unknown): string {
  if (typeof input !== 'string') return '';
  return input.trim().toLowerCase();
}

/**
 * Convenience predicate — returns true when both addresses normalise to the
 * same lower-case form. Centralised so callers don't reinvent the comparison.
 */
export function emailsEquivalent(a: unknown, b: unknown): boolean {
  const na = normalizeEmail(a);
  const nb = normalizeEmail(b);
  return na !== '' && na === nb;
}
