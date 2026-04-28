/**
 * lib/legal-versions.ts — Single source of truth for legal-document versions.
 *
 * Re-acceptance flow (server-enforced via app/(app)/layout.tsx):
 *   1. User logs in normally (login page does not block).
 *   2. On every protected route render, the server-side compliance gate looks
 *      up the latest ConsentRecord per documentType for the user.
 *   3. If the latest accepted version of ANY required document does not match
 *      the CURRENT_*_VERSION constant below → user is redirected to
 *      /onboarding/compliance and cannot use the app until they re-accept.
 *   4. Re-acceptance creates a NEW ConsentRecord row (append-only). Older
 *      rows remain for the audit trail.
 *
 * How to bump a version:
 *   - Update the relevant constant below to a new string (e.g. '2026-04-26').
 *   - Optionally update the date shown on the corresponding public page
 *     (/agb, /datenschutz, /avv) so users see the new "Stand" date.
 *   - Deploy. ALL existing users will be forced to re-accept on next visit.
 *   - Recommended format from now on: ISO date 'YYYY-MM-DD' so the audit
 *     log shows when the change was rolled out.
 *
 * History (manual changelog — append-only):
 *   - 'v1' — Initial release. Used since first compliance block.
 */

export const CURRENT_TERMS_VERSION = 'v1';
export const CURRENT_PRIVACY_VERSION = 'v1';
export const CURRENT_AVV_VERSION = 'v1';

export type LegalDocumentType = 'terms' | 'privacy' | 'avv';

export const REQUIRED_DOC_TYPES: readonly LegalDocumentType[] = [
  'terms',
  'privacy',
  'avv',
] as const;

/** Map a document type to its current required version. */
export function getCurrentVersion(docType: LegalDocumentType): string {
  switch (docType) {
    case 'terms':
      return CURRENT_TERMS_VERSION;
    case 'privacy':
      return CURRENT_PRIVACY_VERSION;
    case 'avv':
      return CURRENT_AVV_VERSION;
  }
}

export type ConsentStatus = 'ok' | 'missing' | 'outdated';

/**
 * Per-document acceptance status for a user.
 * - 'ok'       → latest accepted version matches the current constant
 * - 'missing'  → user has no ConsentRecord for this docType at all
 * - 'outdated' → user has a ConsentRecord but with an older version string
 */
export type ConsentStatusMap = Record<LegalDocumentType, ConsentStatus>;

/**
 * Minimal shape needed from a ConsentRecord row to compute status.
 * Caller must pass rows ordered by acceptedAt DESC (or unsorted — we
 * pick the latest per type internally).
 */
export interface ConsentRecordLike {
  documentType: string;
  documentVersion: string;
  acceptedAt?: Date | string;
}

/**
 * Compute per-type acceptance status from a list of ConsentRecord rows.
 * Picks the LATEST accepted row per documentType (by acceptedAt) and
 * compares its version against the corresponding current constant.
 */
export function computeConsentStatus(records: ConsentRecordLike[]): ConsentStatusMap {
  // Build: docType → latest record
  const latest = new Map<string, ConsentRecordLike>();
  for (const r of records || []) {
    const dt = String(r.documentType || '').toLowerCase();
    if (!REQUIRED_DOC_TYPES.includes(dt as LegalDocumentType)) continue;
    const prev = latest.get(dt);
    if (!prev) {
      latest.set(dt, r);
      continue;
    }
    const prevTs = prev.acceptedAt ? new Date(prev.acceptedAt).getTime() : 0;
    const curTs = r.acceptedAt ? new Date(r.acceptedAt).getTime() : 0;
    if (curTs > prevTs) latest.set(dt, r);
  }

  const out: ConsentStatusMap = { terms: 'missing', privacy: 'missing', avv: 'missing' };
  for (const docType of REQUIRED_DOC_TYPES) {
    const rec = latest.get(docType);
    if (!rec) {
      out[docType] = 'missing';
      continue;
    }
    const expected = getCurrentVersion(docType);
    out[docType] = rec.documentVersion === expected ? 'ok' : 'outdated';
  }
  return out;
}

/**
 * Returns true if the user must re-accept at least one legal document
 * (because it is missing OR outdated). Used by the compliance gate.
 */
export function needsReAcceptance(status: ConsentStatusMap): boolean {
  return REQUIRED_DOC_TYPES.some((t) => status[t] !== 'ok');
}

/**
 * Returns true if AT LEAST ONE doc has status 'outdated' (vs. only missing).
 * Used by the onboarding form to show the "AGB / Datenschutz aktualisiert"
 * header instead of the original "Compliance-Akzeptanz erforderlich".
 */
export function hasAnyOutdated(status: ConsentStatusMap): boolean {
  return REQUIRED_DOC_TYPES.some((t) => status[t] === 'outdated');
}
