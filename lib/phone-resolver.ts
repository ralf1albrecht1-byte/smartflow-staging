/**
 * Resolves a userId from an incoming phone number by matching against
 * CompanySettings.telefon and CompanySettings.telefon2.
 *
 * CRITICAL: No fallbacks! If no exact match is found, returns null.
 * This ensures messages only land in the correct account.
 *
 * Paket A: Uses the shared `normalizePhoneE164` from `lib/normalize.ts` as the
 * single source of truth for phone-number canonicalization. A suffix-match
 * fallback remains for legacy rows that may not yet have been re-saved since
 * server-side normalization was introduced.
 */
import { prisma } from '@/lib/prisma';
import { normalizePhoneE164 } from '@/lib/normalize';

/**
 * Produce the lookup key for comparison: the canonical E.164 form when possible,
 * otherwise a best-effort cleanup that preserves the raw digits. Returning a
 * non-null string means "this value can be compared"; returning '' means
 * "nothing reliable to compare".
 */
function toLookupKey(phone: string | null | undefined): string {
  if (!phone) return '';
  // Try strict canonical form first (the form that ::/api/settings now stores)
  const canonical = normalizePhoneE164(phone);
  if (canonical) return canonical;
  // Fallback for legacy / partial inputs: strip formatting, keep raw prefix
  const cleaned = String(phone).replace(/[\s\-\(\)\.]/g, '');
  return cleaned;
}

/** Last 9 digits (Swiss mobile length) for suffix fallback matching. */
function suffixKey(key: string): string {
  if (!key) return '';
  return key.replace(/^\+/, '').slice(-9);
}

/**
 * Finds the userId whose CompanySettings.telefon or telefon2 matches the given phone number.
 * Matching order:
 *   1. exact canonical (E.164) match against either number
 *   2. last-9-digit suffix match (legacy safety net)
 *
 * Returns userId or null if no match.
 */
export async function resolveUserIdByPhone(incomingPhone: string): Promise<string | null> {
  if (!incomingPhone) return null;

  const lookup = toLookupKey(incomingPhone);
  if (!lookup || lookup.replace(/\D/g, '').length < 8) return null;

  const lookupSuffix = suffixKey(lookup);

  console.log(`[PhoneResolver] Looking up phone: ${incomingPhone} (canonical: ${lookup}, suffix: ${lookupSuffix})`);

  // Load all CompanySettings with phone numbers
  const allSettings = await prisma.companySettings.findMany({
    where: {
      OR: [
        { telefon: { not: null } },
        { telefon2: { not: null } },
      ],
    },
    select: { userId: true, telefon: true, telefon2: true, firmenname: true },
  });

  // Pass 1: exact canonical match
  for (const s of allSettings) {
    const t1 = toLookupKey(s.telefon);
    const t2 = toLookupKey(s.telefon2);

    if ((t1 && t1 === lookup) || (t2 && t2 === lookup)) {
      console.log(`[PhoneResolver] ✅ Exact match: ${incomingPhone} → userId ${s.userId} (${s.firmenname || 'no name'})`);
      return s.userId;
    }
  }

  // Pass 2: suffix match — safety net for legacy rows (not yet re-saved through normalized PUT)
  for (const s of allSettings) {
    const t1 = suffixKey(toLookupKey(s.telefon));
    const t2 = suffixKey(toLookupKey(s.telefon2));

    if ((t1 && t1.length >= 8 && t1 === lookupSuffix) ||
        (t2 && t2.length >= 8 && t2 === lookupSuffix)) {
      console.log(`[PhoneResolver] ✅ Suffix match: ${incomingPhone} → userId ${s.userId} (${s.firmenname || 'no name'})`);
      return s.userId;
    }
  }

  console.log(`[PhoneResolver] ❌ No match found for ${incomingPhone} among ${allSettings.length} accounts`);
  return null;
}
