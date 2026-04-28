/**
 * Block U — Admin-Endpoint: Konto reaktivieren.
 *
 * Body: { requestId?: string }
 *
 * Setzt accountStatus='active', blockedAt=null, blockedReason=null,
 * accessEndsAt=null, cancellationAcceptedAt=null. NICHT möglich, wenn
 * der User bereits anonymisiert ist (irreversibel).
 */
export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin, getSessionUser, unauthorizedResponse, forbiddenResponse, accountInactiveResponse } from '@/lib/get-session';
import { logAuditAsync, EVENTS, AREAS } from '@/lib/audit';

export async function POST(request: Request, { params }: { params: { id: string } }) {
  let adminId: string;
  try { adminId = await requireAdmin(); } catch (e: any) {
    if (e?.code === 'ACCOUNT_INACTIVE') return accountInactiveResponse();
    if (e.message === 'FORBIDDEN') return forbiddenResponse();
    return unauthorizedResponse();
  }
  const admin = await getSessionUser();
  const targetId = params.id;

  try {
    const body = await request.json().catch(() => ({}));
    const requestId: string | undefined = typeof body?.requestId === 'string' ? body.requestId : undefined;

    const target = await prisma.user.findUnique({ where: { id: targetId }, select: { id: true, email: true, accountStatus: true, anonymizedAt: true, blockedAt: true, accessEndsAt: true } });
    if (!target) return NextResponse.json({ error: 'Benutzer nicht gefunden.' }, { status: 404 });
    if (target.anonymizedAt) {
      return NextResponse.json({ error: 'Anonymisierte Konten können nicht reaktiviert werden.' }, { status: 400 });
    }

    const updated = await prisma.user.update({
      where: { id: targetId },
      data: {
        accountStatus: 'active',
        blockedAt: null,
        blockedReason: null,
        accessEndsAt: null,
        cancellationAcceptedAt: null,
      },
    });

    if (requestId) {
      try {
        await prisma.complianceRequest.updateMany({
          where: { id: requestId, userId: targetId },
          data: { updatedAt: new Date() },
        });
      } catch { /* ignore */ }
    }

    logAuditAsync({
      userId: adminId,
      userEmail: admin?.email || null,
      userRole: admin?.role || 'admin',
      action: EVENTS.ACCOUNT_REACTIVATED,
      area: AREAS.ACCOUNT,
      targetType: 'User',
      targetId,
      success: true,
      details: {
        targetEmail: target.email,
        previousStatus: target.accountStatus,
        requestId: requestId || null,
      },
      request,
    });

    return NextResponse.json({ ok: true, user: { id: updated.id, accountStatus: updated.accountStatus, blockedAt: updated.blockedAt, blockedReason: updated.blockedReason, accessEndsAt: updated.accessEndsAt, anonymizedAt: updated.anonymizedAt } });
  } catch (error) {
    console.error('[admin/users/unblock] error:', error);
    return NextResponse.json({ error: 'Fehler beim Reaktivieren.' }, { status: 500 });
  }
}
