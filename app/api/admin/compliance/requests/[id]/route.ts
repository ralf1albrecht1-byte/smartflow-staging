export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin, getSessionUser, unauthorizedResponse, forbiddenResponse, accountInactiveResponse } from '@/lib/get-session';
import { logAuditAsync, EVENTS, AREAS } from '@/lib/audit';

const ALLOWED_STATUSES = new Set(['open', 'in_progress', 'completed', 'rejected']);

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  let adminId: string;
  try {
    adminId = await requireAdmin();
  } catch (e: any) {
    if (e?.code === 'ACCOUNT_INACTIVE') return accountInactiveResponse();
    if (e.message === 'FORBIDDEN') return forbiddenResponse();
    return unauthorizedResponse();
  }
  const admin = await getSessionUser();

  try {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Ungültige Anfrage' }, { status: 400 });
    }
    const status = body.status ? String(body.status) : undefined;
    const adminNotes = body.adminNotes !== undefined ? String(body.adminNotes).slice(0, 2000) : undefined;

    if (status && !ALLOWED_STATUSES.has(status)) {
      return NextResponse.json({ error: 'Status nicht erlaubt' }, { status: 400 });
    }

    const existing = await prisma.complianceRequest.findUnique({ where: { id: params.id } });
    if (!existing) {
      return NextResponse.json({ error: 'Anfrage nicht gefunden' }, { status: 404 });
    }

    // Block U — Schutz: Löschungs-Anfragen dürfen NICHT als "completed" markiert
    // werden, solange technisch nichts passiert ist (Konto noch nicht
    // anonymisiert). Override über `body.force === true` möglich, mit
    // zusätzlicher Audit-Notiz.
    const force = body?.force === true;
    if (status === 'completed' && existing.type === 'data_deletion') {
      const target = await prisma.user.findUnique({
        where: { id: existing.userId },
        select: { id: true, email: true, anonymizedAt: true, accountStatus: true },
      });
      const technicalDone = !!(target?.anonymizedAt) || target?.accountStatus === 'anonymized';
      if (!technicalDone && !force) {
        logAuditAsync({
          userId: adminId,
          userEmail: admin?.email || null,
          userRole: admin?.role || 'admin',
          action: EVENTS.COMPLIANCE_DELETION_COMPLETION_BLOCKED,
          area: AREAS.COMPLIANCE,
          targetType: 'ComplianceRequest',
          targetId: existing.id,
          success: false,
          errorMessage: 'completion_attempt_without_technical_action',
          details: {
            type: existing.type,
            forUserId: existing.userId,
            anonymizedAt: target?.anonymizedAt || null,
            currentAccountStatus: target?.accountStatus || null,
          },
          request,
        });
        return NextResponse.json({
          error: 'Diese Löschanfrage kann nicht als „abgeschlossen" markiert werden, solange das Konto nicht anonymisiert oder gesperrt wurde. Bitte führen Sie zuerst die Aktion „Daten löschen/anonymisieren" aus.',
          code: 'DELETION_COMPLETION_BLOCKED',
        }, { status: 409 });
      }
    }

    const data: any = {};
    if (status) {
      data.status = status;
      if ((status === 'completed' || status === 'rejected') && !existing.completedAt) {
        data.completedAt = new Date();
      }
    }
    if (adminNotes !== undefined) data.adminNotes = adminNotes;

    const updated = await prisma.complianceRequest.update({ where: { id: params.id }, data });

    // Block R — emit specific status / note events alongside the legacy
    // COMPLIANCE_REQUEST_UPDATED event so admins can filter precisely.
    const statusChanged = !!status && status !== existing.status;
    const noteChanged = adminNotes !== undefined && adminNotes !== (existing.adminNotes ?? '');

    // Always keep the legacy event for backward-compat with existing audit rows.
    logAuditAsync({
      userId: adminId,
      userEmail: admin?.email || null,
      userRole: admin?.role || 'admin',
      action: EVENTS.COMPLIANCE_REQUEST_UPDATED,
      area: AREAS.COMPLIANCE,
      targetType: 'ComplianceRequest',
      targetId: updated.id,
      success: true,
      details: {
        previousStatus: existing.status,
        newStatus: updated.status,
        type: updated.type,
        forUserId: updated.userId,
        statusChanged,
        noteChanged,
      },
      request,
    });

    if (statusChanged) {
      logAuditAsync({
        userId: adminId,
        userEmail: admin?.email || null,
        userRole: admin?.role || 'admin',
        action: EVENTS.COMPLIANCE_REQUEST_STATUS_UPDATED,
        area: AREAS.COMPLIANCE,
        targetType: 'ComplianceRequest',
        targetId: updated.id,
        success: true,
        details: {
          previousStatus: existing.status,
          newStatus: updated.status,
          type: updated.type,
          forUserId: updated.userId,
        },
        request,
      });
    }

    if (noteChanged) {
      logAuditAsync({
        userId: adminId,
        userEmail: admin?.email || null,
        userRole: admin?.role || 'admin',
        action: EVENTS.COMPLIANCE_REQUEST_NOTE_UPDATED,
        area: AREAS.COMPLIANCE,
        targetType: 'ComplianceRequest',
        targetId: updated.id,
        success: true,
        details: {
          type: updated.type,
          forUserId: updated.userId,
          // Don't log the raw note content (may contain personal data) — just length + emptiness flags.
          hadNotePrevious: !!existing.adminNotes,
          hasNoteNow: !!updated.adminNotes,
          previousNoteLength: existing.adminNotes?.length ?? 0,
          newNoteLength: updated.adminNotes?.length ?? 0,
        },
        request,
      });
    }

    return NextResponse.json({ ok: true, request: updated });
  } catch (error) {
    console.error('Admin PATCH compliance request error:', error);
    return NextResponse.json({ error: 'Fehler' }, { status: 500 });
  }
}
