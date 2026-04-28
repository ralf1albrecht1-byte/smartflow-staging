export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin, unauthorizedResponse, forbiddenResponse } from '@/lib/get-session';

export async function GET(request: Request) {
  try {
    await requireAdmin();
  } catch (e: any) {
    if (e.message === 'FORBIDDEN') return forbiddenResponse();
    return unauthorizedResponse();
  }

  try {
    const { searchParams } = new URL(request.url);
    const documentType = searchParams.get('documentType') || undefined;
    const userId = searchParams.get('userId') || undefined;
    const where: any = {};
    if (documentType) where.documentType = documentType;
    if (userId) where.userId = userId;
    const records = await prisma.consentRecord.findMany({
      where,
      orderBy: { acceptedAt: 'desc' },
      take: 500,
      include: { user: { select: { id: true, email: true, name: true } } },
    });
    return NextResponse.json({ records });
  } catch (error) {
    console.error('Admin GET consent error:', error);
    return NextResponse.json({ error: 'Fehler' }, { status: 500 });
  }
}
