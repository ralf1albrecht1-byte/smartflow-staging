export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin, unauthorizedResponse, forbiddenResponse, accountInactiveResponse } from '@/lib/get-session';

export async function POST(request: Request) {
  try {
    await requireAdmin();
  } catch (error: any) {
    if (error?.code === 'ACCOUNT_INACTIVE') return accountInactiveResponse(error?.userMessage);
    if (error?.message === 'UNAUTHORIZED') return unauthorizedResponse();
    if (error?.message === 'FORBIDDEN') return forbiddenResponse();
    return NextResponse.json({ error: 'Nicht autorisiert' }, { status: 401 });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const requestId = body?.requestId as string | undefined;

    if (!requestId) {
      return NextResponse.json({ error: 'requestId fehlt' }, { status: 400 });
    }

    const approved = await prisma.$transaction(async (tx) => {
      const req = await tx.audioMinuteRequest.findUnique({ where: { id: requestId } });
      if (!req) throw new Error('REQUEST_NOT_FOUND');
      if (req.status !== 'open') throw new Error('REQUEST_NOT_OPEN');

      const user = await tx.user.update({
        where: { id: req.userId },
        data: {
          audioExtraMinutes: {
            increment: req.requestedMinutes,
          },
        },
        select: {
          id: true,
          email: true,
          audioExtraMinutes: true,
        },
      });

      const updatedRequest = await tx.audioMinuteRequest.update({
        where: { id: req.id },
        data: { status: 'approved' },
      });

      return { user, updatedRequest };
    });

    return NextResponse.json({ success: true, approved });
  } catch (error: any) {
    if (error?.message === 'REQUEST_NOT_FOUND') {
      return NextResponse.json({ error: 'Anfrage nicht gefunden' }, { status: 404 });
    }
    if (error?.message === 'REQUEST_NOT_OPEN') {
      return NextResponse.json({ error: 'Anfrage wurde bereits bearbeitet' }, { status: 409 });
    }

    console.error('[audio-minutes/approve] error:', error);
    return NextResponse.json({ error: 'Freigabe fehlgeschlagen' }, { status: 500 });
  }
}
