export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { requireUserId, handleAuthError } from '@/lib/get-session';
import { resetTestCounters } from '@/lib/doc-numbers';

export async function POST() {
  try {
    let userId: string;
    try { userId = await requireUserId(); } catch (e) { return handleAuthError(e); }

    const result = await resetTestCounters(userId);
    return NextResponse.json({
      success: true,
      message: `${result.offersReset} Test-Angebote und ${result.invoicesReset} Test-Rechnungen in den Papierkorb verschoben.`,
      ...result,
    });
  } catch (error: any) {
    console.error('Reset test counters error:', error);
    return NextResponse.json(
      { error: error?.message || 'Fehler beim Zurücksetzen' },
      { status: 400 }
    );
  }
}
