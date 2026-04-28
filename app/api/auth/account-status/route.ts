/**
 * Block U — Lightweight account-status check endpoint.
 *
 * Used by the client-side `<AccountStatusGuard />` component on every
 * SPA navigation to verify the user is still active.  Returns a minimal
 * JSON payload to keep the round-trip fast.
 *
 * Responses:
 *   200 { active: true }           — user is active, carry on.
 *   401 { active: false, code }    — no session / expired JWT.
 *   403 { active: false, code }    — account blocked/expired/anonymized.
 */
export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { getUserId } from '@/lib/get-session';
import { getEffectiveStatusForUserId, statusCode } from '@/lib/account-status';

export async function GET() {
  try {
    const userId = await getUserId();
    if (!userId) {
      return NextResponse.json({ active: false, code: 'NO_SESSION' }, { status: 401 });
    }

    const eff = await getEffectiveStatusForUserId(userId);
    if (!eff.canAccess) {
      return NextResponse.json(
        { active: false, code: statusCode(eff.status) },
        { status: 403 },
      );
    }

    return NextResponse.json({ active: true });
  } catch (err) {
    console.error('[account-status-check] error:', err);
    // On DB errors, don't kick the user out — return 200 as safe fallback.
    return NextResponse.json({ active: true });
  }
}
