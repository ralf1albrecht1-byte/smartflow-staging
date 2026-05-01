export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
  requireAdmin,
  unauthorizedResponse,
  forbiddenResponse,
  accountInactiveResponse,
} from '@/lib/get-session';

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
      select: { id: true, accountStatus: true, anonymizedAt: true },
    });

    if (!existing) {
      return NextResponse.json({ error: 'Benutzer nicht gefunden.' }, { status: 404 });
    }

    if (existing.anonymizedAt) {
      return NextResponse.json(
        { error: 'Anonymisierte Konten können nicht freigeschaltet werden.' },
        { status: 400 },
      );
    }

    if (existing.accountStatus === 'active') {
      return NextResponse.json({ ok: true, alreadyActive: true });
    }

    const user = await prisma.user.update({
      where: { id: userId },
      data: {
        accountStatus: 'active',
        blockedAt: null,
        blockedReason: null,
      },
      select: {
        id: true,
        accountStatus: true,
        blockedAt: true,
        blockedReason: true,
      },
    });

    return NextResponse.json({ ok: true, user });
  } catch (error) {
    console.error('[admin/users/activate] error:', error);
    return NextResponse.json({ error: 'Freischalten fehlgeschlagen.' }, { status: 500 });
  }
}
