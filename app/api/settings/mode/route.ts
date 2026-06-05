export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireUserId, handleAuthError, getSessionUser } from '@/lib/get-session';
import { logAuditAsync } from '@/lib/audit';
import { DATA_SCOPE_LIVE } from '@/lib/data-scope';

function liveStartedCounterName(userId: string): string {
  return `live-started:${userId}`;
}

async function hasExistingLivebetrieb(userId: string): Promise<boolean> {
  const [marker, liveCustomer, liveOrder, liveOffer, liveInvoice] = await Promise.all([
    prisma.counter.findUnique({
      where: { name: liveStartedCounterName(userId) },
      select: { id: true },
    }),
    prisma.customer.findFirst({
      where: { userId, dataScope: DATA_SCOPE_LIVE },
      select: { id: true },
    }),
    prisma.order.findFirst({
      where: { userId, dataScope: DATA_SCOPE_LIVE },
      select: { id: true },
    }),
    prisma.offer.findFirst({
      where: { userId, dataScope: DATA_SCOPE_LIVE },
      select: { id: true },
    }),
    prisma.invoice.findFirst({
      where: { userId, dataScope: DATA_SCOPE_LIVE },
      select: { id: true },
    }),
  ]);

  return Boolean(marker || liveCustomer || liveOrder || liveOffer || liveInvoice);
}

/**
 * Schaltet ausschließlich zwischen TEST und dem bereits gestarteten LIVE-Scope.
 *
 * Diese Route:
 * - übernimmt keine Kunden,
 * - vergibt keine Nummern,
 * - löscht keine Daten,
 * - speichert keine anderen Firmeneinstellungen.
 */
export async function PATCH(request: Request) {
  try {
    let userId: string;

    try {
      userId = await requireUserId();
    } catch (error) {
      return handleAuthError(error);
    }

    const body = await request.json().catch(() => null);
    if (!body || typeof body.testModus !== 'boolean') {
      return NextResponse.json(
        { error: 'Ungültiger Moduswechsel.' },
        { status: 400 },
      );
    }

    const nextTestModus = body.testModus;

    if (!nextTestModus) {
      const liveStarted = await hasExistingLivebetrieb(userId);

      if (!liveStarted) {
        return NextResponse.json(
          {
            error:
              'Livebetrieb wurde noch nicht gestartet. Bitte zuerst den sicheren Echtstart ausführen.',
          },
          { status: 409 },
        );
      }
    }

    const existing = await prisma.companySettings.findFirst({
      where: { userId },
      select: { id: true, testModus: true },
    });

    const settings = existing
      ? await prisma.companySettings.update({
          where: { id: existing.id },
          data: { testModus: nextTestModus },
          select: { id: true, testModus: true },
        })
      : await prisma.companySettings.create({
          data: {
            userId,
            testModus: nextTestModus,
          },
          select: { id: true, testModus: true },
        });

    const sessionUser = await getSessionUser();
    logAuditAsync({
      userId: sessionUser?.id,
      userEmail: sessionUser?.email,
      userRole: sessionUser?.role,
      action: nextTestModus ? 'SWITCH_TO_TEST_MODE' : 'SWITCH_TO_LIVE_MODE',
      area: 'SETTINGS',
      targetType: 'CompanySettings',
      targetId: settings.id,
      details: {
        testModus: settings.testModus,
        mode: settings.testModus ? 'TEST' : 'LIVE',
      },
      request,
    });

    return NextResponse.json({
      success: true,
      testModus: settings.testModus,
      mode: settings.testModus ? 'TEST' : 'LIVE',
    });
  } catch (error) {
    console.error('PATCH /api/settings/mode error:', error);
    return NextResponse.json(
      { error: 'Modus konnte nicht gewechselt werden.' },
      { status: 500 },
    );
  }
}
