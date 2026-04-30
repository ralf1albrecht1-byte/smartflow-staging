export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { requireUserId, handleAuthError } from '@/lib/get-session';
import { resetTestCounters } from '@/lib/doc-numbers';

export async function POST() {
  try {
    let userId: string;
    try { userId = await requireUserId(); } catch (e) { return handleAuthError(e); }

    const result = await resetTestCounters(userId);
    const parts: string[] = [];
    if (result.offersReset > 0) parts.push(`${result.offersReset} Test-Angebot${result.offersReset === 1 ? '' : 'e'}`);
    if (result.invoicesReset > 0) parts.push(`${result.invoicesReset} Test-Rechnung${result.invoicesReset === 1 ? '' : 'en'}`);
    if (result.ordersReset > 0) parts.push(`${result.ordersReset} verknüpfte${result.ordersReset === 1 ? 'r' : ''} Auftrag${result.ordersReset === 1 ? '' : 'e'}`);
    const message = parts.length > 0
      ? `${parts.join(', ')} in den Papierkorb verschoben. Test-Nummern starten wieder bei 001.`
      : 'Keine aktiven Test-Daten gefunden.';
    return NextResponse.json({
      success: true,
      message,
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
