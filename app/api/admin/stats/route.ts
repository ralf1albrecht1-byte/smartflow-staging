export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin, unauthorizedResponse, forbiddenResponse } from '@/lib/get-session';

export async function GET() {
  try { await requireAdmin(); } catch (e: any) {
    if (e.message === 'FORBIDDEN') return forbiddenResponse();
    return unauthorizedResponse();
  }

  try {
    const now = new Date();
    const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const last7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const [recentLogins, failedLogins24h, failedLogins7d, passwordResets7d, signups7d, totalLogs, recentErrors, userCount] = await Promise.all([
      prisma.auditLog.findMany({
        where: { action: 'LOGIN', success: true, createdAt: { gte: last7d } },
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: { userEmail: true, ipAddress: true, createdAt: true },
      }),
      prisma.auditLog.count({
        where: { action: 'LOGIN_FAILED', createdAt: { gte: last24h } },
      }),
      prisma.auditLog.count({
        where: { action: 'LOGIN_FAILED', createdAt: { gte: last7d } },
      }),
      prisma.auditLog.count({
        where: { action: { in: ['PASSWORD_RESET_REQUEST', 'PASSWORD_RESET'] }, createdAt: { gte: last7d } },
      }),
      prisma.auditLog.count({
        where: { action: 'SIGNUP', createdAt: { gte: last7d } },
      }),
      prisma.auditLog.count(),
      prisma.auditLog.findMany({
        where: { success: false, createdAt: { gte: last7d } },
        orderBy: { createdAt: 'desc' },
        take: 10,
      }),
      prisma.user.count(),
    ]);

    return NextResponse.json({
      recentLogins,
      failedLogins24h,
      failedLogins7d,
      passwordResets7d,
      signups7d,
      totalLogs,
      recentErrors,
      userCount,
    });
  } catch (error: any) {
    console.error('Admin stats error:', error);
    return NextResponse.json({ error: 'Fehler' }, { status: 500 });
  }
}
