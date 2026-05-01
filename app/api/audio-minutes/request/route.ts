export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireUserId, requireAdmin, handleAuthError, unauthorizedResponse, forbiddenResponse, accountInactiveResponse } from '@/lib/get-session';

const ALLOWED_MINUTES = new Set([30, 60, 120]);

export async function POST(request: Request) {
  try {
    const userId = await requireUserId();
    const body = await request.json().catch(() => ({}));
    const requestedMinutes = Number(body?.requestedMinutes);

    if (!ALLOWED_MINUTES.has(requestedMinutes)) {
      return NextResponse.json({ error: 'Nur 30, 60 oder 120 Minuten sind erlaubt' }, { status: 400 });
    }

    const created = await prisma.audioMinuteRequest.create({
      data: {
        userId,
        requestedMinutes,
        status: 'open',
      },
      select: {
        id: true,
        requestedMinutes: true,
        status: true,
        createdAt: true,
      },
    });

    return NextResponse.json({ success: true, request: created });
  } catch (error: any) {
    if (error?.message === 'UNAUTHORIZED' || error?.code === 'ACCOUNT_INACTIVE') {
      return handleAuthError(error);
    }
    console.error('[audio-minutes/request] error:', error);
    return NextResponse.json({ error: 'Anfrage konnte nicht erstellt werden' }, { status: 500 });
  }
}

export async function GET() {
  try {
    await requireAdmin();

    const requests = await prisma.audioMinuteRequest.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        userId: true,
        requestedMinutes: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        user: {
          select: {
            id: true,
            email: true,
            name: true,
            audioExtraMinutes: true,
            accountStatus: true,
            trialStart: true,
            trialEndDate: true,
          },
        },
      },
    });

    return NextResponse.json({ requests });
  } catch (error: any) {
    if (error?.code === 'ACCOUNT_INACTIVE') return accountInactiveResponse(error?.userMessage);
    if (error?.message === 'UNAUTHORIZED') return unauthorizedResponse();
    if (error?.message === 'FORBIDDEN') return forbiddenResponse();
    console.error('[audio-minutes/request GET] error:', error);
    return NextResponse.json({ error: 'Anfragen konnten nicht geladen werden' }, { status: 500 });
  }
}
