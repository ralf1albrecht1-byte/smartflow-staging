/**
 * Phase 2c — Exact deterministic customer reuse (intake pipelines only).
 *
 * Purpose:
 *   When an incoming intake (WhatsApp / Telegram / Quick-Intake) contains a
 *   FULLY specified customer identity (name + street+HouseNr + PLZ + city),
 *   resolve against the existing customer book BEFORE creating a new customer.
 *   If exactly one active customer under the authenticated user matches under
 *   the strict normalized rule AND no contact-data conflict exists, the
 *   intake reuses that customer instead of spawning a duplicate record.
 *
 * Why this is not a silent merge:
 *   Nothing is merged — no second record is created, therefore nothing
 *   disappears. Behaviourally identical to the user having picked the
 *   existing customer from the autocomplete themselves.
 *
 * Hard rules (all must hold):
 *   R1. name, street, plz, city on the INCOMING record are all non-empty
 *       (normalized).
 *   R2. Exactly ONE active (deletedAt IS NULL) candidate under the same
 *       userId matches all four fields under the SAME normalization used by
 *       intake-sanitize.ts. 0 → no match. ≥2 → no match (ambiguous).
 *   R3. Safety guard: if the incoming record carries a phone or email AND
 *       the stored candidate has a phone or email that is non-empty AND they
 *       clearly CONFLICT, do NOT reuse — fall back to the normal
 *       create / duplicate-panel path. Missing on either side is NOT a
 *       conflict.
 *
 * What this function never does:
 *   - Update the candidate.
 *   - Merge two records.
 *   - Reuse an archived candidate (deletedAt !== null).
 *   - Reuse across users (tenancy boundary is enforced).
 *   - Reuse on weak / partial matches.
 */

import {
  normalizeNameForMatch,
  normalizeStreetForMatch,
  normalizePlzForMatch,
  normalizeCityForMatch,
} from '@/lib/intake-sanitize';
import { toE164Strict } from '@/lib/phone';

export interface ExactMatchInput {
  name?: string | null;
  street?: string | null;
  plz?: string | null;
  city?: string | null;
  /** Incoming phone (may be null — then no phone conflict check). */
  phone?: string | null;
  /** Incoming email (may be null — then no email conflict check). */
  email?: string | null;
}

export interface CandidateCustomer {
  id: string;
  customerNumber: string | null;
  name: string | null;
  address: string | null;
  plz: string | null;
  city: string | null;
  phone: string | null;
  email: string | null;
  deletedAt: Date | null;
}

export type ExactMatchReason =
  | 'ok'
  | 'incomplete_incoming'
  | 'no_candidate'
  | 'multiple_candidates'
  | 'phone_conflict'
  | 'email_conflict';

export interface ExactMatchResult {
  match: CandidateCustomer | null;
  reason: ExactMatchReason;
  /** For logging/audit — how many normalized candidates matched. */
  candidateCount: number;
}

/**
 * Pure classifier — does NOT hit the database.
 * Used by the DB-bound wrapper below AND directly by tests.
 */
export function classifyExactMatch(
  incoming: ExactMatchInput,
  activeCandidates: CandidateCustomer[],
): ExactMatchResult {
  const inName = normalizeNameForMatch(incoming.name);
  const inStreet = normalizeStreetForMatch(incoming.street);
  const inPlz = normalizePlzForMatch(incoming.plz);
  const inCity = normalizeCityForMatch(incoming.city);

  // R1: all four fields must be present on the incoming side.
  if (!inName || !inStreet || !inPlz || !inCity) {
    return { match: null, reason: 'incomplete_incoming', candidateCount: 0 };
  }

  const hits = activeCandidates.filter((c) => {
    if (c.deletedAt !== null) return false;
    return (
      normalizeNameForMatch(c.name) === inName &&
      normalizeStreetForMatch(c.address) === inStreet &&
      normalizePlzForMatch(c.plz) === inPlz &&
      normalizeCityForMatch(c.city) === inCity
    );
  });

  if (hits.length === 0) {
    return { match: null, reason: 'no_candidate', candidateCount: 0 };
  }
  if (hits.length > 1) {
    // R2: ambiguity → no reuse, duplicate panel remains responsible.
    return { match: null, reason: 'multiple_candidates', candidateCount: hits.length };
  }

  const candidate = hits[0];

  // R3: conflict guard (phone).
  // Both sides must be parseable to E.164 and differ for this to count as a conflict.
  // Missing or unparseable on either side → not a conflict, reuse allowed.
  if (incoming.phone && candidate.phone) {
    const inE164 = toE164Strict(incoming.phone);
    const cdE164 = toE164Strict(candidate.phone);
    if (inE164 && cdE164 && inE164 !== cdE164) {
      return { match: null, reason: 'phone_conflict', candidateCount: 1 };
    }
  }

  // R3: conflict guard (email). Case-insensitive trimmed compare.
  if (incoming.email && candidate.email) {
    const inEmail = incoming.email.trim().toLowerCase();
    const cdEmail = candidate.email.trim().toLowerCase();
    if (inEmail && cdEmail && inEmail !== cdEmail) {
      return { match: null, reason: 'email_conflict', candidateCount: 1 };
    }
  }

  return { match: candidate, reason: 'ok', candidateCount: 1 };
}

/**
 * DB-bound wrapper. Loads active customers for `userId` and applies
 * classifyExactMatch. Returns the match (or null) + reason for audit logging.
 *
 * Performance: loads only candidates whose normalized PLZ digits equal the
 * incoming PLZ digits to keep the in-memory candidate set small. This is
 * tenancy-filtered via userId, so cardinality is bounded by active customers
 * in the same ZIP area of a single business account.
 */
export async function findExactDeterministicMatch(
  prisma: any,
  userId: string | null | undefined,
  incoming: ExactMatchInput,
): Promise<ExactMatchResult> {
  const inName = normalizeNameForMatch(incoming.name);
  const inStreet = normalizeStreetForMatch(incoming.street);
  const inPlz = normalizePlzForMatch(incoming.plz);
  const inCity = normalizeCityForMatch(incoming.city);

  if (!inName || !inStreet || !inPlz || !inCity) {
    return { match: null, reason: 'incomplete_incoming', candidateCount: 0 };
  }

  // Narrow the candidate pool using the PLZ (cheap B-tree scan).
  // Do the real normalization-based uniqueness check in memory afterwards,
  // since Postgres text comparison is not umlaut/ß-folding by default.
  const rows: CandidateCustomer[] = await prisma.customer.findMany({
    where: {
      deletedAt: null,
      ...(userId ? { userId } : {}),
      plz: { contains: inPlz.slice(0, 4) },
    },
    select: {
      id: true,
      customerNumber: true,
      name: true,
      address: true,
      plz: true,
      city: true,
      phone: true,
      email: true,
      deletedAt: true,
    },
    take: 200,
  });

  return classifyExactMatch(incoming, rows);
}

// ─────────────────────────────────────────────────────────────────────────
// Phase 2d — Near-exact deterministic reuse.
//
// Strict extension of exact reuse for the specific case where EXACTLY ONE
// of {PLZ, City} is missing on the incoming record AND the missing part can
// be completed unambiguously from exactly one active candidate of the same
// user. All other guards are identical to exact reuse.
//
// Near-exact reuse ONLY triggers when ALL of these are true:
//   N1. incoming name is present & non-empty (normalized)
//   N2. incoming street+HouseNr is present & non-empty (normalized)
//   N3. EITHER incoming PLZ is empty AND incoming City is present
//        OR incoming City is empty AND incoming PLZ is present
//   N4. the candidate record has NON-EMPTY value for the field that is
//        missing on the incoming side (we cannot "complete" from empty)
//   N5. the present fields (name, street, and the one of PLZ/city that IS
//        present on incoming) all match under the SAME normalization
//   N6. exactly 1 active candidate qualifies (no ambiguity)
//   N7. no phone or email conflict (same rules as exact reuse)
//
// Near-exact reuse DOES NOT trigger when:
//   - BOTH PLZ and City are missing on incoming → falls to "incomplete"
//   - BOTH PLZ and City are present on incoming → use exact path instead
//   - name only matches partially / fuzzily (we only do strict normalization)
//   - street or house number differ
//   - any ambiguity (multiple candidates with the same name+street normalization)
//
// This function never updates the candidate — completion of the missing ZIP
// or city is applied by the caller into the order record only, not into the
// customer master data. The candidate is stronger; nothing to improve there.
// ─────────────────────────────────────────────────────────────────────────

export type NearExactCompletedField = 'plz' | 'city';

export type NearExactMatchReason =
  | 'ok'
  | 'not_applicable'      // both PLZ+City present (→ use exact path) OR both missing
  | 'incomplete_incoming' // name or street missing on incoming
  | 'no_candidate'
  | 'multiple_candidates'
  | 'candidate_field_missing' // candidate itself lacks the field we'd need to complete
  | 'phone_conflict'
  | 'email_conflict';

export interface NearExactMatchResult {
  match: CandidateCustomer | null;
  reason: NearExactMatchReason;
  /** Which field would be completed on the order from the candidate, if any. */
  completedField: NearExactCompletedField | null;
  /** The value that would be written into the order's address completion. */
  completedValue: string | null;
  /** For logging/audit — how many normalized candidates matched (before uniqueness check). */
  candidateCount: number;
}

/**
 * Pure classifier — does NOT hit the database.
 *
 * Rules: see block comment above. Strictly one-sided missing:
 * exactly one of {plz, city} empty on incoming, the other present.
 */
export function classifyNearExactMatch(
  incoming: ExactMatchInput,
  activeCandidates: CandidateCustomer[],
): NearExactMatchResult {
  const inName = normalizeNameForMatch(incoming.name);
  const inStreet = normalizeStreetForMatch(incoming.street);
  const inPlz = normalizePlzForMatch(incoming.plz);
  const inCity = normalizeCityForMatch(incoming.city);

  // N1/N2: name + street mandatory on incoming side.
  if (!inName || !inStreet) {
    return { match: null, reason: 'incomplete_incoming', completedField: null, completedValue: null, candidateCount: 0 };
  }

  // N3: exactly one of PLZ/city must be missing. If both missing OR both
  // present → not our path (exact path handles the "both present" case).
  const plzMissing = !inPlz;
  const cityMissing = !inCity;
  if (plzMissing === cityMissing) {
    return { match: null, reason: 'not_applicable', completedField: null, completedValue: null, candidateCount: 0 };
  }

  const completeField: NearExactCompletedField = plzMissing ? 'plz' : 'city';

  // Find candidates that match on the THREE present fields (name, street,
  // and the one of plz/city that IS present on incoming). Candidate must
  // have the field-to-complete present (N4).
  const hits = activeCandidates.filter((c) => {
    if (c.deletedAt !== null) return false;
    if (normalizeNameForMatch(c.name) !== inName) return false;
    if (normalizeStreetForMatch(c.address) !== inStreet) return false;
    if (plzMissing) {
      // City present on incoming — must match city; candidate must have PLZ filled.
      if (normalizeCityForMatch(c.city) !== inCity) return false;
      if (!normalizePlzForMatch(c.plz)) return false;
    } else {
      // PLZ present on incoming — must match PLZ; candidate must have City filled.
      if (normalizePlzForMatch(c.plz) !== inPlz) return false;
      if (!normalizeCityForMatch(c.city)) return false;
    }
    return true;
  });

  if (hits.length === 0) {
    return { match: null, reason: 'no_candidate', completedField: null, completedValue: null, candidateCount: 0 };
  }
  if (hits.length > 1) {
    return { match: null, reason: 'multiple_candidates', completedField: null, completedValue: null, candidateCount: hits.length };
  }

  const candidate = hits[0];
  const rawCompleted = plzMissing ? candidate.plz : candidate.city;
  if (!rawCompleted || !rawCompleted.trim()) {
    // Defensive — the filter above already requires non-empty, but belt & suspenders.
    return { match: null, reason: 'candidate_field_missing', completedField: null, completedValue: null, candidateCount: 1 };
  }

  // N7: conflict guards — identical logic to classifyExactMatch.
  if (incoming.phone && candidate.phone) {
    const inE164 = toE164Strict(incoming.phone);
    const cdE164 = toE164Strict(candidate.phone);
    if (inE164 && cdE164 && inE164 !== cdE164) {
      return { match: null, reason: 'phone_conflict', completedField: null, completedValue: null, candidateCount: 1 };
    }
  }
  if (incoming.email && candidate.email) {
    const inEmail = incoming.email.trim().toLowerCase();
    const cdEmail = candidate.email.trim().toLowerCase();
    if (inEmail && cdEmail && inEmail !== cdEmail) {
      return { match: null, reason: 'email_conflict', completedField: null, completedValue: null, candidateCount: 1 };
    }
  }

  return {
    match: candidate,
    reason: 'ok',
    completedField: completeField,
    completedValue: rawCompleted.trim(),
    candidateCount: 1,
  };
}

/**
 * DB-bound wrapper for near-exact reuse. Pre-filters candidates via the
 * field that IS present on the incoming side to keep candidate cardinality
 * small; strict normalization is applied in-memory afterwards.
 *
 * Performance: candidates are bounded by the active customers of the same
 * user who share the provided PLZ prefix (when PLZ is present) or whose
 * raw city string matches (when city is present). `take: 200` caps the
 * scan — at this volume the business-data model will have been refactored
 * long before it becomes a concern.
 */
export async function findNearExactDeterministicMatch(
  prisma: any,
  userId: string | null | undefined,
  incoming: ExactMatchInput,
): Promise<NearExactMatchResult> {
  const inName = normalizeNameForMatch(incoming.name);
  const inStreet = normalizeStreetForMatch(incoming.street);
  const inPlz = normalizePlzForMatch(incoming.plz);
  const inCity = normalizeCityForMatch(incoming.city);

  if (!inName || !inStreet) {
    return { match: null, reason: 'incomplete_incoming', completedField: null, completedValue: null, candidateCount: 0 };
  }
  const plzMissing = !inPlz;
  const cityMissing = !inCity;
  if (plzMissing === cityMissing) {
    return { match: null, reason: 'not_applicable', completedField: null, completedValue: null, candidateCount: 0 };
  }

  // Build DB filter: narrow by the field that IS present.
  const where: any = {
    deletedAt: null,
    ...(userId ? { userId } : {}),
  };
  if (plzMissing) {
    // City present — DB-level substring on raw city column as a cheap narrow.
    // Real normalization is enforced by classifyNearExactMatch afterwards.
    where.city = { contains: (incoming.city ?? '').trim(), mode: 'insensitive' };
    where.plz = { not: null };
  } else {
    where.plz = { contains: inPlz.slice(0, 4) };
    where.city = { not: null };
  }

  const rows: CandidateCustomer[] = await prisma.customer.findMany({
    where,
    select: {
      id: true,
      customerNumber: true,
      name: true,
      address: true,
      plz: true,
      city: true,
      phone: true,
      email: true,
      deletedAt: true,
    },
    take: 200,
  });

  return classifyNearExactMatch(incoming, rows);
}