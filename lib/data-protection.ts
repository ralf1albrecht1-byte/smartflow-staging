/**
 * Customer Data Protection:
 * New data may only IMPROVE existing data, never downgrade.
 * "Better" = longer / more complete / not empty when existing is empty.
 * Applies ONLY to automatic processes (webhooks, auto-fill, quick-intake).
 * Manual editing (user decides) is NOT affected.
 */

/**
 * Returns the "better" value: the one that is longer/more complete.
 * If newVal is empty/null/undefined, keeps existing.
 * If existing is empty/null/undefined, uses newVal.
 * If both have values, uses the longer one (trimmed).
 */
export function betterValue(existing: string | null | undefined, incoming: string | null | undefined): string | null | undefined {
  const ex = (existing ?? '').trim();
  const inc = (incoming ?? '').trim();
  if (!inc) return existing; // incoming empty → keep existing
  if (!ex) return incoming;  // existing empty → use incoming
  // Both have values → keep the longer/more complete one
  return inc.length > ex.length ? incoming : existing;
}

/**
 * Given existing customer data and incoming (auto-detected) data,
 * returns an updates object with ONLY fields that improve the existing data.
 * Returns empty object if nothing improves.
 */
export function protectCustomerData(
  existing: { address?: string | null; plz?: string | null; city?: string | null; phone?: string | null; email?: string | null },
  incoming: { address?: string | null; plz?: string | null; city?: string | null; phone?: string | null; email?: string | null }
): Record<string, string> {
  const updates: Record<string, string> = {};
  const fields = ['address', 'plz', 'city', 'phone', 'email'] as const;

  for (const field of fields) {
    const better = betterValue(existing[field], incoming[field]);
    // Only add to updates if the better value differs from existing AND is non-empty
    if (better && better !== existing[field]) {
      updates[field] = better.trim();
    }
  }

  return updates;
}
