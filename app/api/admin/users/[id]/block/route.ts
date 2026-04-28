/**
 * Block U — Admin-Endpoint: Konto sofort sperren.
 *
 * Body: { reason?: string, requestId?: string }
 *
 * Setzt accountStatus='blocked', blockedAt=now, blockedReason=reason. Löscht
 * DB-Sessions als Best-Effort. Schreibt ACCOUNT_BLOCKED-Audit. Verhindert
 * Selbst-Sperre und das Sperren des letzten aktiven Admins.
 */
export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin, getSessionUser, unauthorizedResponse, forbiddenResponse, accountInactiveResponse } from '@/lib/get-session';
import { logAuditAsync, EVENTS, AREAS } from '@/lib/audit';
import { hasOtherActiveAdmin } from '@/lib/account-status';

export async function POST(request: Request, { params }: { params: { id: string } }) {
  let adminId: string;
  try { adminId = await requireAdmin(); } catch (e: any) {
    if (e?.code === 'ACCOUNT_INACTIVE') return accountInactiveResponse();
    if (e.message === 'FORBIDDEN') return forbiddenResponse();
    return unauthorizedResponse();
  }
  const admin = await getSessionUser();
  const targetId = params.id;

  if (adminId === targetId) {
    return NextResponse.json({ error: 'Sie können sich nicht selbst sperren.' }, { status: 400 });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const reason: string | null = typeof body?.reason === 'string' ? body.reason.slice(0, 500) : null;
    const requestId: string | undefined = typeof body?.requestId === 'string' ? body.requestId : undefined;

    const target = await prisma.user.findUnique({ where: { id: targetId }, select: { id: true, email: true, role: true, accountStatus: true, anonymizedAt: true } });
    if (!target) return NextResponse.json({ error: 'Benutzer nicht gefunden.' }, { status: 404 });
    if (target.anonymizedAt) {
      return NextResponse.json({ error: 'Konto ist bereits anonymisiert.' }, { status: 400 });
    }

    if ((target.role || '').toLowerCase() === 'admin') {
      const otherAdmins = await hasOtherActiveAdmin(targetId);
      if (!otherAdmins) {
        return NextResponse.json({ error: 'Der letzte aktive Admin kann nicht gesperrt werden.' }, { status: 400 });
      }
    }

    const now = new Date();
    const updated = await prisma.user.update({
      where: { id: targetId },
      data: {
        accountStatus: 'blocked',
        blockedAt: now,
        blockedReason: reason,
      },
    });

    // DB-Sessions entfernen (auch wenn JWT-Strategy aktiv ist). Schadet nicht.
    try { await prisma.session.deleteMany({ where: { userId: targetId } }); } catch { /* ignore */ }

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
      action: EVENTS.ACCOUNT_BLOCKED,
      area: AREAS.ACCOUNT,
      targetType: 'User',
      targetId,
      success: true,
      details: {
        targetEmail: target.email,
        previousStatus: target.accountStatus,
        reason: reason || null,
        requestId: requestId || null,
      },
      request,
    });

    return NextResponse.json({ ok: true, user: { id: updated.id, accountStatus: updated.accountStatus, blockedAt: updated.blockedAt, blockedReason: updated.blockedReason, accessEndsAt: updated.accessEndsAt, anonymizedAt: updated.anonymizedAt } });
  } catch (error) {
    console.error('[admin/users/block] error:', error);
    return NextResponse.json({ error: 'Fehler beim Sperren.' }, { status: 500 });
  }
}
