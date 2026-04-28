/**
 * Centralized customer matching logic.
 * Single source of truth for determining whether an incoming message/order
 * can be auto-assigned to an existing customer.
 *
 * MATCHING POLICY (v2 — hardened):
 * ═══════════════════════════════════════════════════════════════════
 *
 * AUTO-ASSIGN (strong unique signal required):
 *   - Phone match (strict E.164, libphonenumber-js parseAndKeepRawInput)
 *   - Email match (case-insensitive)
 *   These are the ONLY signals that allow silent auto-assignment.
 *
 * CONFIRMATION REQUIRED (high-confidence suggestion):
 *   - Exact full name + exact full address (street+PLZ+city) but no phone/email
 *   → "bestaetigungs_treffer" — shown as high-confidence suggestion, NOT auto-linked
 *
 * REVIEW / SUGGESTION ONLY:
 *   - Exact full name alone (no address, no phone, no email)
 *   - Partial name match
 *   - Same surname only
 *   - Same city only
 *   - Partial address only
 *   → "moeglicher_treffer" — flagged for manual review
 *
 * NEVER AUTO-ASSIGN:
 *   - Multiple possible matches
 *   - Any weak/partial signal without a strong unique identifier
 *
 * ═══════════════════════════════════════════════════════════════════
 *
 * PHASE 2a (Read-Path-Härtung) — Strong-Signal Phone:
 *   - Uses phoneEqualsStrict from @/lib/phone (strict libphonenumber-based).
 *   - Both sides MUST be parseable to the same E.164 number.
 *   - NO default country, NO CH-fallback, NO digit-suffix heuristics.
 *   - Unparseable incoming phone OR unparseable stored phone => no phone match.
 *   - Extension is ignored for comparison; display unchanged.
 *   - Legacy phoneEquals (from lib/normalize) is NOT used here anymore.
 *
 * Affects BOTH call sites of verifyCustomerMatch:
 *   - lib/order-intake.ts (WhatsApp/email intake pipeline)
 *   - app/api/quick-intake/route.ts (manuelle Schnellerfassung)
 *
 * Intended behaviour change: legacy CH-local numbers ('056 ...', '0766 ...')
 * stored as raw non-E.164 strings in Customer.phone no longer drive auto-assign
 * via phone signal alone. These rows are listed in the Dev-Review-CSV
 * (reports/phase2a-dev-falling-strong-signals.csv) and remain matchable via
 * email, name+address (bestaetigungs_treffer) and manual review.
 */

import { prisma } from '@/lib/prisma';
import { phoneEqualsStrict } from '@/lib/phone';

export type MatchVerdict =
  | 'auto_assign'           // Strong unique signal verified → safe to auto-link
  | 'bestaetigungs_treffer' // High-confidence (name+address) but needs confirmation
  | 'moeglicher_treffer'    // Weak match → review/suggestion only
  | 'kein_treffer';         // No match at all

export interface MatchResult {
  verdict: MatchVerdict;
  reason: string;
  candidateId: string | null;
}

interface IncomingData {
  phone?: string | null;
  email?: string | null;
  street?: string | null;
  plz?: string | null;
  city?: string | null;
  name?: string | null;
}

/**
 * Verify whether a candidate customer ID qualifies for auto-assignment
 * based on the incoming data.
 *
 * This is the SERVER-SIDE AUTHORITATIVE gate.
 * It NEVER trusts LLM output alone.
 */
export async function verifyCustomerMatch(
  candidateId: string,
  incoming: IncomingData,
): Promise<MatchResult> {
  if (!candidateId) {
    return { verdict: 'kein_treffer', reason: 'no_candidate_id', candidateId: null };
  }

  const cust = await prisma.customer.findUnique({
    where: { id: candidateId },
    select: { id: true, name: true, phone: true, email: true, address: true, plz: true, city: true, deletedAt: true },
  });
  if (!cust) {
    return { verdict: 'kein_treffer', reason: 'candidate_not_found', candidateId };
  }

  // ── ARCHIVED GUARD: never auto-assign to an archived/trashed customer ──
  if (cust.deletedAt !== null) {
    return { verdict: 'kein_treffer', reason: 'candidate_archived', candidateId };
  }

  // ── STRONG SIGNAL 1: Phone match (strict E.164, libphonenumber-js) ──
  // Phase 2a: uses phoneEqualsStrict (both sides parseable to same E.164);
  // NO default region, NO digit-suffix heuristics, NO CH-fallback.
  if (incoming.phone && cust.phone && phoneEqualsStrict(incoming.phone, cust.phone)) {
    return { verdict: 'auto_assign', reason: 'phone_match', candidateId };
  }

  // ── STRONG SIGNAL 2: Email match (case-insensitive) ──
  const inEmail = (incoming.email || '').trim().toLowerCase();
  const dbEmail = (cust.email || '').trim().toLowerCase();
  if (inEmail && dbEmail && inEmail === dbEmail) {
    return { verdict: 'auto_assign', reason: 'email_match', candidateId };
  }

  // ── CHECK ADDRESS MATCH ──
  const inStreet = normalizeStreet(incoming.street);
  const dbStreet = normalizeStreet(cust.address);
  const inPlz = (incoming.plz || '').trim();
  const dbPlz = (cust.plz || '').trim();
  const inCity = (incoming.city || '').trim().toLowerCase();
  const dbCity = (cust.city || '').trim().toLowerCase();

  const streetMatch = inStreet && dbStreet && inStreet.length > 3 && dbStreet.length > 3 &&
    (inStreet === dbStreet ||
      (inStreet.length > 5 && dbStreet.length > 5 &&
        (inStreet.includes(dbStreet) || dbStreet.includes(inStreet))));

  const plzMatch = inPlz && dbPlz && inPlz === dbPlz;
  const cityMatch = inCity && dbCity && inCity === dbCity;
  const fullAddressMatch = streetMatch && (plzMatch || cityMatch);

  // ── CHECK NAME MATCH ──
  const inName = (incoming.name || '').trim().toLowerCase();
  const dbName = (cust.name || '').trim().toLowerCase();
  const nameExactMatch = inName && dbName && inName.length > 1 && dbName.length > 1 && inName === dbName;

  // ── EXACT NAME + EXACT ADDRESS → confirmation required (NOT auto-assign) ──
  if (nameExactMatch && fullAddressMatch) {
    return { verdict: 'bestaetigungs_treffer', reason: 'name_and_address_match', candidateId };
  }

  // ── NAME-ONLY or partial match → suggestion/review only ──
  if (nameExactMatch || (inName && dbName && (inName.includes(dbName) || dbName.includes(inName)))) {
    return { verdict: 'moeglicher_treffer', reason: 'name_only', candidateId };
  }

  // ── ADDRESS-ONLY (no name match) → suggestion only ──
  if (fullAddressMatch) {
    return { verdict: 'moeglicher_treffer', reason: 'address_only_no_name', candidateId };
  }

  // ── No meaningful match ──
  return { verdict: 'moeglicher_treffer', reason: 'weak_signal', candidateId };
}

/**
 * Normalize a street string for comparison.
 */
function normalizeStreet(s: string | null | undefined): string {
  if (!s) return '';
  return s.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Map the old LLM abgleich status to the new verdict system.
 * Used in order-intake.ts to translate LLM output before server-side verification.
 */
export function mapLlmStatusToVerdict(
  llmStatus: string,
  serverResult: MatchResult,
): { finalVerdict: MatchVerdict; shouldAutoAssign: boolean } {
  // Server result is ALWAYS authoritative
  const v = serverResult.verdict;
  return {
    finalVerdict: v,
    shouldAutoAssign: v === 'auto_assign',
  };
}
