/**
 * Phase 2f: Customer → Form merge helper.
 *
 * Single source of truth for populating an inline customer form (used by
 * Auftrag/Angebot/Rechnung/Kundenpflege screens) from a selected customer
 * record.
 *
 * STRICT RULE (Issue 1 — fallback customer sanitization):
 *   Internal fallback names (e.g. "⚠️ Unbekannt (WhatsApp)") MUST NEVER
 *   appear in any editable input field. They are sanitized to '' here,
 *   at the single merge point, so ALL UI paths stay clean.
 *
 * Copy rule (non-destructive):
 *   for each field:
 *     custVal = sanitized + trimmed selectedCustomer[field]
 *     formVal = trim(currentForm[field])
 *     result  = custVal || formVal || ''
 *
 * After the merge we run autoFillCustomerFromNotes so that any field still
 * empty can be back-filled from free-text notes (email/phone/street/plz/city).
 */

import { autoFillCustomerFromNotes } from './extract-from-notes';

export interface CustomerFormShape {
  name: string;
  phone: string;
  email: string;
  address: string;
  plz: string;
  city: string;
  country: string;
}

// ─── Fallback customer detection ────────────────────────────────────
// Internal names created by order-intake.ts for stub/fallback customers.
// These MUST NEVER appear in any user-facing input field.
const FALLBACK_NAME_PATTERNS = ['⚠️ Unbekannt (WhatsApp)', '⚠️ Unbekannt (Telegram)'];

/** Returns true if `name` is an internal fallback marker. */
export function isFallbackCustomerName(name: string | null | undefined): boolean {
  if (!name) return false;
  const t = name.trim();
  return FALLBACK_NAME_PATTERNS.some(p => t === p);
}

function s(value: unknown): string {
  if (value == null) return '';
  return String(value).trim();
}

/**
 * Merge a (freshly-loaded) customer record into an existing form.
 *
 * Customer DB values are the sole source of truth. The `currentForm` is only
 * used as a fallback for fields the DB doesn't have — but callers should pass
 * a BLANK form to avoid any stale-state risk (see openCustomerEditor).
 *
 * Fallback customer names are stripped to '' so the name input stays empty.
 */
export function mergeCustomerIntoForm(
  currentForm: Partial<CustomerFormShape> | null | undefined,
  selectedCustomer: Partial<CustomerFormShape> | null | undefined,
  notes?: string | null,
): CustomerFormShape {
  const f = currentForm ?? {};
  const c = selectedCustomer ?? {};

  // Sanitize: if customer name is a fallback marker, treat it as empty.
  const custName = s(c.name);
  const safeName = isFallbackCustomerName(custName) ? '' : custName;

  // For each field: customer value wins if non-empty, then form value, then ''.
  const merged: CustomerFormShape = {
    name:    safeName || s(f.name) || '',
    phone:   s(c.phone)   || s(f.phone)   || '',
    email:   s(c.email)   || s(f.email)   || '',
    address: s(c.address) || s(f.address) || '',
    plz:     s(c.plz)     || s(f.plz)     || '',
    city:    s(c.city)    || s(f.city)    || '',
    country: s(c.country) || s(f.country) || 'CH',
  };

  // Back-fill from notes ONLY into still-empty slots. autoFillCustomerFromNotes
  // preserves any non-empty value it already sees.
  // SKIP note extraction entirely for fallback customers — their notes contain
  // only [META]-tagged system data that must never populate customer fields.
  if (isFallbackCustomerName(s(c.name))) {
    return merged;
  }

  const afterNotes = autoFillCustomerFromNotes(
    {
      name: merged.name,
      phone: merged.phone,
      email: merged.email,
      address: merged.address,
      plz: merged.plz,
      city: merged.city,
    },
    notes ?? null,
  );

  return {
    ...afterNotes,
    country: merged.country,
  };
}
