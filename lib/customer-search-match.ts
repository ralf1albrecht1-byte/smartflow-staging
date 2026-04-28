/**
 * Customer-Search Ranking/Filter Helper (Phase 2a).
 *
 * Shared filter logic for:
 *   - components/customer-search-combobox.tsx (CustomerSearchCombobox)
 *   - app/(app)/kunden/page.tsx (Kundenliste)
 *
 * PHASE 2a POLICY:
 *   - When the user's query string parses strictly to E.164 (toE164Strict
 *     returns non-null), the phone field matches ONLY via phoneEqualsStrict.
 *     No digit-substring heuristics on phone in this case.
 *   - When the query does NOT parse to E.164 (typical free-text search "Müller",
 *     "4567", "0791234567", "+41" etc.), phone matching uses the legacy
 *     text-contains fallback on normalized digits: this keeps partial-digit
 *     UX (typing last 4 digits) working.
 *   - Name, customerNumber, email, city, plz, address always use text contains.
 *   - NO default country, NO CH-fallback on the strict path.
 *
 * INVARIANT:
 *   - Empty/whitespace query returns all customers (combobox: full list,
 *     Kundenliste: full list).
 *   - Strict-phone bucket ranks BEFORE name-starts-with in the combobox.
 */

import { toE164Strict, phoneEqualsStrict } from '@/lib/phone';

export interface CustomerSearchable {
  id: string;
  name: string;
  customerNumber?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  plz?: string | null;
  city?: string | null;
}

/**
 * Boolean membership: does this customer match the query at all?
 * Used by Kundenliste (page.tsx) — sort order is handled by the caller.
 */
export function matchesQuery(c: CustomerSearchable, query: string): boolean {
  const q = (query ?? '').trim().toLowerCase();
  if (!q) return true;

  const qNoSpaces = q.replace(/\s+/g, '');
  const queryPhoneE164 = toE164Strict(query);

  // --- Phone field ---
  let phoneMatches: boolean;
  if (queryPhoneE164) {
    // Strict E.164 path: both sides must parse to same E.164.
    phoneMatches = phoneEqualsStrict(c.phone ?? null, query);
  } else {
    // Text fallback: legacy digit-substring search on normalized phone.
    const phoneNorm = (c.phone ?? '').toLowerCase().replace(/\s+/g, '');
    phoneMatches = qNoSpaces.length > 0 && phoneNorm.length > 0 && phoneNorm.includes(qNoSpaces);
  }

  // --- Other fields: always text-contains ---
  const nameMatches = (c.name ?? '').toLowerCase().includes(q);
  const numberMatches = (c.customerNumber ?? '').toLowerCase().includes(q)
    || (c.customerNumber ?? '').toLowerCase() === qNoSpaces;
  const emailMatches = (c.email ?? '').toLowerCase().includes(q);
  const cityMatches = (c.city ?? '').toLowerCase().includes(q);
  const plzMatches = (c.plz ?? '').toLowerCase().includes(q);
  const addressMatches = (c.address ?? '').toLowerCase().includes(q);

  return phoneMatches || nameMatches || numberMatches || emailMatches
      || cityMatches || plzMatches || addressMatches;
}

/**
 * Ranked + filtered list for the combobox dropdown.
 *
 * Priority buckets (higher bucket ranks first):
 *   1. Exact customerNumber match (case-insensitive, with/without spaces)
 *   2. Strict E.164 phone match (only if the query itself is a valid E.164)
 *   3. Name starts with query
 *   4. Name contains query
 *   5. Phone text-contains (only when query is NOT a valid E.164 — legacy UX)
 *   6. Email contains query
 *
 * Customers not matching any bucket are excluded.
 */
export function rankCustomers<T extends CustomerSearchable>(customers: T[], query: string): T[] {
  const q = (query ?? '').trim().toLowerCase();
  if (!q) return customers;

  const qNoSpaces = q.replace(/\s+/g, '');
  const queryPhoneE164 = toE164Strict(query);

  const exactNumber: T[] = [];
  const phoneStrict: T[] = [];
  const nameStartsWith: T[] = [];
  const nameContains: T[] = [];
  const phoneTextContains: T[] = [];
  const emailContains: T[] = [];

  for (const c of customers) {
    const num = (c.customerNumber ?? '').toLowerCase();
    const name = (c.name ?? '').toLowerCase();
    const phoneNorm = (c.phone ?? '').toLowerCase().replace(/\s+/g, '');
    const email = (c.email ?? '').toLowerCase();

    if (num && (num === q || num === qNoSpaces)) {
      exactNumber.push(c);
    } else if (queryPhoneE164 && phoneEqualsStrict(c.phone ?? null, query)) {
      phoneStrict.push(c);
    } else if (name.startsWith(q)) {
      nameStartsWith.push(c);
    } else if (name.includes(q)) {
      nameContains.push(c);
    } else if (!queryPhoneE164 && qNoSpaces.length > 0 && phoneNorm.length > 0 && phoneNorm.includes(qNoSpaces)) {
      // Legacy text fallback — only when query is NOT strict E.164.
      phoneTextContains.push(c);
    } else if (email && email.includes(q)) {
      emailContains.push(c);
    }
  }

  return [...exactNumber, ...phoneStrict, ...nameStartsWith, ...nameContains, ...phoneTextContains, ...emailContains];
}
