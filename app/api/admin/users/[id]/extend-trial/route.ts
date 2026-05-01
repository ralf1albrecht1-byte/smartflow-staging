export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
  requireAdmin,
  unauthorizedResponse,
  forbiddenResponse,
  accountInactiveResponse,
} from '@/lib/get-session';

const SEVEN_DAYS_IN_MS = 7 * 24 * 60 * 60 * 1000;

export async function POST(
  _request: Request,
  { params }: { params: { id: string } },
) {
  try {
    await requireAdmin();
  } catch (e: any) {
    if (e?.code === 'ACCOUNT_INACTIVE') return accountInactiveResponse();
    if (e?.message === 'FORBIDDEN') return forbiddenResponse();
    return unauthorizedResponse();
  }

  const userId = params?.id;
  if (!userId) {
    return NextResponse.json({ error: 'Benutzer-ID fehlt.' }, { status: 400 });
  }

  try {
    const existing = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        trialEndDate: true,
      },
    });

    if (!existing) {
      return NextResponse.json({ error: 'Benutzer nicht gefunden.' }, { status: 404 });
    }

    const baseDate = existing.trialEndDate ?? new Date();
    const extendedTrialEndDate = new Date(baseDate.getTime() + SEVEN_DAYS_IN_MS);

    const user = await prisma.user.update({
      where: { id: userId },
      data: {
        trialEndDate: extendedTrialEndDate,
      },
      select: {
        id: true,
        trialEndDate: true,
      },
    });

    return NextResponse.json({ ok: true, user });
  } catch (error) {
    console.error('[admin/users/extend-trial] error:', error);
    return NextResponse.json(
      { error: 'Trial-Verlängerung fehlgeschlagen.' },
      { status: 500 },
    );
  }
}
