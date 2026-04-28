/**
 * Phase 2a — Duplicate Scoring (read-only classification helper)
 *
 * Extracted from `app/api/customers/find-duplicates/route.ts` so the scoring
 * logic can be unit-tested in isolation.
 *
 * Phone-match policy (Phase 2a):
 *   Phone match is only counted when BOTH candidate and source phone are
 *   strictly parseable via `toE164Strict()` (from `lib/phone.ts`) AND their
 *   E.164 representations are exactly equal. No suffix match, no NSN fallback,
 *   no implicit country inference.
 *
 * Name/Address/PLZ/City/Email matching keeps its existing behaviour — this
 *   refactor does NOT touch name or address heuristics.
 *
 * Classification is purely informational and NEVER triggers silent
 * auto-linking on its own. It is consumed by the duplicate-review UI as a
 * suggestion ranking.
 */

import { toE164Strict } from '@/lib/phone';

export type MatchClass = 'EXAKT' | 'WAHRSCHEINLICH' | 'UNSICHER';

export interface ScoringSide {
  name: string;
  address?: string | null;
  plz?: string | null;
  city?: string | null;
  phone?: string | null;
  email?: string | null;
}

export interface ClassifyResult {
  classification: MatchClass;
  score: number;
}

export function normalizeForMatch(val: string | null | undefined): string {
  return (val || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Classify and score a candidate against a source customer record.
 *
 * Name match is the gate. Without a full-name match the candidate is
 * classified as UNSICHER with a token score (10). If name matches, the
 * remaining signals are additive — with phone now requiring a strict
 * libphonenumber-backed E.164 equality check.
 */
export function classifyMatch(
  source: ScoringSide,
  candidate: ScoringSide,
): ClassifyResult {
  const sName = normalizeForMatch(source.name);
  const cName = normalizeForMatch(candidate.name);
  const sAddr = normalizeForMatch(source.address);
  const cAddr = normalizeForMatch(candidate.address);
  const sPlz = normalizeForMatch(source.plz);
  const cPlz = normalizeForMatch(candidate.plz);
  const sCity = normalizeForMatch(source.city);
  const cCity = normalizeForMatch(candidate.city);
  const sEmail = normalizeForMatch(source.email);
  const cEmail = normalizeForMatch(candidate.email);

  // Phase 2a: strict E.164 phone match.
  // toE164Strict returns null for unparseable input (no country code, junk, BSUID only).
  // Match only when BOTH sides yield a non-null E.164 AND the values are identical.
  const sPhoneE164 = toE164Strict(source.phone ?? null);
  const cPhoneE164 = toE164Strict(candidate.phone ?? null);
  const phoneMatch = sPhoneE164 !== null && cPhoneE164 !== null && sPhoneE164 === cPhoneE164;

  let score = 0;

  // Name match (required for all classifications)
  const nameExact = sName === cName && sName.length > 0;
  if (nameExact) score += 40;
  else return { classification: 'UNSICHER', score: 10 };

  // Address match
  const addrExact = sAddr === cAddr && sAddr.length > 0;
  if (addrExact) score += 25;

  // PLZ match
  const plzExact = sPlz === cPlz && sPlz.length > 0;
  if (plzExact) score += 15;

  // City match
  const cityExact = sCity === cCity && sCity.length > 0;
  if (cityExact) score += 10;

  // Phone match (strict E.164 only)
  if (phoneMatch) score += 5;

  // Email match
  const emailMatch = sEmail === cEmail && sEmail.length > 0;
  if (emailMatch) score += 5;

  // EXAKT: Name + Strasse + (PLZ oder Ort) identisch
  if (nameExact && addrExact && (plzExact || cityExact)) {
    return { classification: 'EXAKT', score };
  }

  // WAHRSCHEINLICH: Name + mindestens ein weiteres Feld
  if (nameExact && (addrExact || plzExact || cityExact || phoneMatch || emailMatch)) {
    return { classification: 'WAHRSCHEINLICH', score };
  }

  // UNSICHER: nur Name-Match
  return { classification: 'UNSICHER', score };
}
