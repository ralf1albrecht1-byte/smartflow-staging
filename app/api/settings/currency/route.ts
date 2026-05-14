export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireUserId, handleAuthError } from '@/lib/get-session';

export async function PUT(request: Request) {
  try {
    let userId: string;
    try {
      userId = await requireUserId();
    } catch (e) {
      return handleAuthError(e);
    }

    const body = await request.json();
    const currency = body?.currency === 'EUR' ? 'EUR' : 'CHF';

    const existing = await prisma.companySettings.findFirst({
      where: { userId },
      select: { id: true },
    });

    if (!existing) {
      const created = await prisma.companySettings.create({
        data: { userId, currency },
        select: { currency: true },
      });

      return NextResponse.json(created);
    }

    const updated = await prisma.companySettings.update({
      where: { id: existing.id },
      data: { currency },
      select: { currency: true },
    });

    return NextResponse.json(updated);
  } catch (error) {
    console.error('PUT /api/settings/currency error:', error);
    return NextResponse.json({ error: 'Fehler beim Speichern der Währung' }, { status: 500 });
  }
}