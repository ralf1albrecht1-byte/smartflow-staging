export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin, unauthorizedResponse, forbiddenResponse } from '@/lib/get-session';

export async function GET(request: Request) {
  let userId: string;
  try { userId = await requireAdmin(); } catch (e: any) {
    if (e.message === 'FORBIDDEN') return forbiddenResponse();
    return unauthorizedResponse();
  }

  try {
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1');
    const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 100);
    const area = searchParams.get('area') || undefined;
    const action = searchParams.get('action') || undefined;
    const filterUserId = searchParams.get('userId') || undefined;
    const success = searchParams.get('success');
    const from = searchParams.get('from') || undefined;
    const to = searchParams.get('to') || undefined;
    const search = searchParams.get('search') || undefined;

    const where: any = {};
    if (area) where.area = area;
    if (action) where.action = action;
    if (filterUserId) where.userId = filterUserId;
    if (success === 'true') where.success = true;
    if (success === 'false') where.success = false;
    if (from || to) {
      where.createdAt = {};
      if (from) where.createdAt.gte = new Date(from);
      if (to) where.createdAt.lte = new Date(to + 'T23:59:59.999Z');
    }
    if (search) {
      where.OR = [
        { userEmail: { contains: search, mode: 'insensitive' } },
        { action: { contains: search, mode: 'insensitive' } },
        { details: { contains: search, mode: 'insensitive' } },
        { targetType: { contains: search, mode: 'insensitive' } },
        { targetId: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [logs, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.auditLog.count({ where }),
    ]);

    return NextResponse.json({ logs, total, page, limit, totalPages: Math.ceil(total / limit) });
  } catch (error: any) {
    console.error('Admin logs error:', error);
    return NextResponse.json({ error: 'Fehler beim Laden der Logs' }, { status: 500 });
  }
}
