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

    const req = await prisma.audioMinuteRequest.findUnique({ where: { id: requestId } });
    if (!req) {
      return NextResponse.json({ error: 'Anfrage nicht gefunden' }, { status: 404 });
    }
    if (req.status !== 'open') {
      return NextResponse.json({ error: 'Anfrage wurde bereits bearbeitet' }, { status: 409 });
    }

    const updated = await prisma.audioMinuteRequest.update({
      where: { id: requestId },
      data: { status: 'rejected' },
    });

    return NextResponse.json({ success: true, request: updated });
  } catch (error: any) {
    console.error('[audio-minutes/reject] error:', error);
    return NextResponse.json({ error: 'Ablehnung fehlgeschlagen' }, { status: 500 });
  }
}
