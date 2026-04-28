export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireUserId, unauthorizedResponse } from '@/lib/get-session';

export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    let userId: string;
    try { userId = await requireUserId(); } catch { return unauthorizedResponse(); }

    const body = await request.json().catch(() => ({}));
    const order = await prisma.order.findFirst({ where: { id: params.id, userId } });
    if (!order) return NextResponse.json({ error: 'Nicht gefunden' }, { status: 404 });

    let cleaned = (order.specialNotes || '')
      .split('\n')
      .filter((line: string) => !line.includes('Möglicher Duplikat'))
      .join('\n')
      .trim() || null;

    const updateData: any = { specialNotes: cleaned };
    if (body.customerId) {
      updateData.customerId = body.customerId;
    }

    const updated = await prisma.order.update({
      where: { id: params.id },
      data: updateData,
      include: { customer: true },
    });

    return NextResponse.json(updated);
  } catch (error: any) {
    console.error('[clear-duplicate]', error);
    return NextResponse.json({ error: 'Fehler' }, { status: 500 });
  }
}
