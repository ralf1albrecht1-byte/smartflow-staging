/**
 * Block U — Admin-Endpoint: Zugriffs-Enddatum für einen User setzen.
 *
 * Body: { accessEndsAt: ISO-8601 string | null, requestId?: string }
 * - accessEndsAt = null → entfernt das Ablaufdatum und setzt Status zurück auf 'active'
 *   (sofern nicht 'blocked' oder 'anonymized').
 * - accessEndsAt = ISO-Datum → setzt das Ablaufdatum + accountStatus='cancelled'.
 *   In der Vergangenheit → User ist sofort blockiert.
 *   In der Zukunft  → User kann bis dahin weiter login.
 *
 * Schreibt einen Audit-Eintrag (ACCOUNT_ACCESS_END_SET / _CLEARED) und
 * hängt eine Admin-Notiz an die referenzierte ComplianceRequest, falls
 * `requestId` mitgegeben wird.
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

  if (adminId === targetId) {
    return NextResponse.json({ error: 'Sie können Ihren eigenen Zugang nicht beenden.' }, { status: 400 });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const requestId: string | undefined = typeof body?.requestId === 'string' ? body.requestId : undefined;
    const raw = body?.accessEndsAt;
    let accessEndsAt: Date | null = null;
    if (raw === null || raw === '') {
      accessEndsAt = null;
    } else if (typeof raw === 'string') {
      const d = new Date(raw);
      if (isNaN(d.getTime())) {
        return NextResponse.json({ error: 'Ungültiges Datum.' }, { status: 400 });
      }
      accessEndsAt = d;
    } else {
      return NextResponse.json({ error: 'accessEndsAt erforderlich (ISO-Datum oder null).' }, { status: 400 });
    }

    const target = await prisma.user.findUnique({ where: { id: targetId }, select: { id: true, email: true, accountStatus: true, anonymizedAt: true } });
    if (!target) return NextResponse.json({ error: 'Benutzer nicht gefunden.' }, { status: 404 });
    if (target.anonymizedAt) {
      return NextResponse.json({ error: 'Anonymisierte Konten können nicht mehr geändert werden.' }, { status: 400 });
    }

    const data: any = { accessEndsAt };
    if (accessEndsAt === null) {
      // Aufheben: nur dann auf 'active' zurück, wenn nicht aktiv blockiert.
      if (target.accountStatus !== 'blocked') {
        data.accountStatus = 'active';
        data.cancellationAcceptedAt = null;
      }
    } else {
      // Datum setzen → Kündigung markieren.
      data.accountStatus = 'blocked' === target.accountStatus ? 'blocked' : 'cancelled';
      data.cancellationAcceptedAt = new Date();
    }

    const updated = await prisma.user.update({ where: { id: targetId }, data });

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
      action: accessEndsAt ? EVENTS.ACCOUNT_ACCESS_END_SET : EVENTS.ACCOUNT_ACCESS_END_CLEARED,
      area: AREAS.ACCOUNT,
      targetType: 'User',
      targetId,
      success: true,
      details: {
        targetEmail: target.email,
        accessEndsAt: accessEndsAt ? accessEndsAt.toISOString() : null,
        previousStatus: target.accountStatus,
        newStatus: updated.accountStatus,
        requestId: requestId || null,
      },
      request,
    });

    return NextResponse.json({ ok: true, user: { id: updated.id, accountStatus: updated.accountStatus, accessEndsAt: updated.accessEndsAt, cancellationAcceptedAt: updated.cancellationAcceptedAt, anonymizedAt: updated.anonymizedAt, blockedAt: updated.blockedAt } });
  } catch (error) {
    console.error('[admin/users/access] error:', error);
    return NextResponse.json({ error: 'Fehler beim Speichern.' }, { status: 500 });
  }
}
