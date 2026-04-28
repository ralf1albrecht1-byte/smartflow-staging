export const dynamic = 'force-dynamic';
import { prisma } from '@/lib/prisma';
import { requireAdmin, unauthorizedResponse, forbiddenResponse } from '@/lib/get-session';

/**
 * Block N: CSV export of audit logs. Mirrors the filters from
 * `app/api/admin/logs/route.ts`. Hard-capped at 10000 rows so the response
 * stays well below platform limits.
 */

function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export async function GET(request: Request) {
  try {
    await requireAdmin();
  } catch (e: any) {
    if (e.message === 'FORBIDDEN') return forbiddenResponse();
    return unauthorizedResponse();
  }

  try {
    const { searchParams } = new URL(request.url);
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

    const logs = await prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 10000,
    });

    const header = [
      'createdAt', 'action', 'area', 'success',
      'userEmail', 'userRole', 'userId',
      'targetType', 'targetId',
      'source', 'ipAddress', 'userAgent',
      'errorMessage', 'details',
    ];
    const lines: string[] = [header.join(',')];
    for (const log of logs) {
      lines.push([
        log.createdAt.toISOString(),
        log.action,
        log.area,
        String(log.success),
        log.userEmail || '',
        log.userRole || '',
        log.userId || '',
        log.targetType || '',
        log.targetId || '',
        (log as any).source || '',
        log.ipAddress || '',
        (log as any).userAgent || '',
        (log as any).errorMessage || '',
        log.details || '',
      ].map(csvEscape).join(','));
    }
    const csv = lines.join('\n');
    const filename = `audit_${new Date().toISOString().slice(0, 10)}.csv`;
    return new Response('\uFEFF' + csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  } catch (error: any) {
    console.error('Audit CSV export error:', error);
    return new Response('Fehler beim Export', { status: 500 });
  }
}
