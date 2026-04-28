export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSessionUser } from '@/lib/get-session';
import { logAuditAsync, EVENTS, AREAS } from '@/lib/audit';
import { downloadBufferFromS3 } from '@/lib/s3';

/**
 * Block T-auto — Owner/Admin Download für vorbereitete Datenexporte.
 *
 * GET /api/compliance/requests/[id]/download
 *
 * Auth-Regeln:
 *  - Eingeloggt sein (sonst 401).
 *  - Owner der Anfrage ODER Admin sein (sonst 403).
 *  - Anfrage muss type === 'data_export' sein (sonst 400).
 *  - exportFileKey muss gesetzt sein (sonst 404).
 *  - exportExpiresAt darf nicht in der Vergangenheit liegen (sonst 410).
 *
 * Verhalten:
 *  - Lädt das ZIP serverseitig aus S3 (privater Bereich) und streamt es
 *    an den Client zurück. KEIN öffentlicher Link, KEIN Pre-signed URL.
 *  - Erfolgreicher Download: setzt `downloadedAt = now()` und auditet
 *    DATA_EXPORT_DOWNLOADED.
 *  - Status BLEIBT in_progress — Admin schliesst manuell auf completed.
 *  - Filename: smartflow-datenexport-YYYY-MM-DD-REQUESTID.zip (deutsch).
 */
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const sessionUser = await getSessionUser();
  if (!sessionUser) {
    return NextResponse.json({ error: 'Nicht autorisiert' }, { status: 401 });
  }

  // 1. Anfrage laden.
  const reqRow = await prisma.complianceRequest.findUnique({
    where: { id: params.id },
    include: { user: { select: { id: true, email: true } } },
  });
  if (!reqRow) {
    // Kein Audit-Log mit DENIED — wir wissen nicht ob die ID existiert.
    return NextResponse.json({ error: 'Anfrage nicht gefunden' }, { status: 404 });
  }

  // 2. Owner-/Admin-Check.
  const isOwner = reqRow.userId === sessionUser.id;
  const isAdmin = sessionUser.role === 'admin';
  if (!isOwner && !isAdmin) {
    logAuditAsync({
      userId: sessionUser.id,
      userEmail: sessionUser.email,
      userRole: sessionUser.role,
      action: EVENTS.DATA_EXPORT_DOWNLOAD_DENIED,
      area: AREAS.COMPLIANCE,
      targetType: 'ComplianceRequest',
      targetId: reqRow.id,
      success: false,
      errorMessage: 'forbidden_not_owner_or_admin',
      details: {
        requestId: reqRow.id,
        affectedUserId: reqRow.userId,
        affectedUserEmail: reqRow.user?.email ?? null,
        performedByUserId: sessionUser.id,
        performedByEmail: sessionUser.email,
        reason: 'forbidden_not_owner_or_admin',
      },
      request: _request,
    });
    return NextResponse.json({ error: 'Keine Berechtigung' }, { status: 403 });
  }

  // 3. Typ-Check.
  if (reqRow.type !== 'data_export') {
    return NextResponse.json(
      { error: 'Download ist nur für Datenexport-Anfragen verfügbar.' },
      { status: 400 },
    );
  }

  // 4. Bereitschafts-Check.
  if (!reqRow.exportFileKey) {
    // Falls Generierung fehlgeschlagen ist, geben wir den Fehler zurück.
    if (reqRow.exportGenerationError) {
      return NextResponse.json(
        {
          error: 'Datenexport konnte nicht erstellt werden.',
          detail: reqRow.exportGenerationError,
          code: 'generation_failed',
        },
        { status: 404 },
      );
    }
    return NextResponse.json(
      { error: 'Datenexport ist noch nicht bereit.', code: 'not_ready' },
      { status: 404 },
    );
  }

  // 5. Ablauf-Check.
  const now = new Date();
  if (reqRow.exportExpiresAt && reqRow.exportExpiresAt.getTime() < now.getTime()) {
    logAuditAsync({
      userId: sessionUser.id,
      userEmail: sessionUser.email,
      userRole: sessionUser.role,
      action: EVENTS.DATA_EXPORT_EXPIRED,
      area: AREAS.COMPLIANCE,
      targetType: 'ComplianceRequest',
      targetId: reqRow.id,
      success: false,
      errorMessage: 'export_expired',
      details: {
        requestId: reqRow.id,
        affectedUserId: reqRow.userId,
        affectedUserEmail: reqRow.user?.email ?? null,
        performedByUserId: sessionUser.id,
        performedByEmail: sessionUser.email,
        exportReadyAtIso: reqRow.exportReadyAt?.toISOString?.() ?? null,
        exportExpiresAtIso: reqRow.exportExpiresAt?.toISOString?.() ?? null,
      },
      request: _request,
    });
    return NextResponse.json(
      {
        error: 'Der Datenexport ist abgelaufen. Bitte stelle eine neue Anfrage.',
        code: 'expired',
      },
      { status: 410 },
    );
  }

  // 6. ZIP aus S3 streamen.
  let buffer: Buffer;
  try {
    buffer = await downloadBufferFromS3(reqRow.exportFileKey);
  } catch (err: any) {
    const errMsg = err?.message ? String(err.message).slice(0, 300) : 'unknown_error';
    console.error('DATA_EXPORT_DOWNLOAD: S3 fetch failed', err);
    logAuditAsync({
      userId: sessionUser.id,
      userEmail: sessionUser.email,
      userRole: sessionUser.role,
      action: EVENTS.DATA_EXPORT_DOWNLOAD_DENIED,
      area: AREAS.COMPLIANCE,
      targetType: 'ComplianceRequest',
      targetId: reqRow.id,
      success: false,
      errorMessage: errMsg,
      details: {
        requestId: reqRow.id,
        affectedUserId: reqRow.userId,
        affectedUserEmail: reqRow.user?.email ?? null,
        performedByUserId: sessionUser.id,
        performedByEmail: sessionUser.email,
        reason: 's3_fetch_failed',
      },
      request: _request,
    });
    return NextResponse.json(
      { error: 'Datei konnte nicht geladen werden.', detail: errMsg },
      { status: 500 },
    );
  }

  // 7. downloadedAt persistieren (best-effort — kein Fail wenn DB hakt).
  try {
    await prisma.complianceRequest.update({
      where: { id: reqRow.id },
      data: { downloadedAt: now },
    });
  } catch (updErr) {
    console.error('DATA_EXPORT_DOWNLOAD: failed to persist downloadedAt', updErr);
  }

  // 8. Audit Erfolg.
  logAuditAsync({
    userId: sessionUser.id,
    userEmail: sessionUser.email,
    userRole: sessionUser.role,
    action: EVENTS.DATA_EXPORT_DOWNLOADED,
    area: AREAS.COMPLIANCE,
    targetType: 'ComplianceRequest',
    targetId: reqRow.id,
    success: true,
    details: {
      requestId: reqRow.id,
      affectedUserId: reqRow.userId,
      affectedUserEmail: reqRow.user?.email ?? null,
      performedByUserId: sessionUser.id,
      performedByEmail: sessionUser.email,
      isOwnerDownload: isOwner,
      isAdminDownload: isAdmin && !isOwner,
      sizeBytes: buffer.byteLength,
      timestampIso: now.toISOString(),
    },
    request: _request,
  });

  // 9. Filename: smartflow-datenexport-YYYY-MM-DD-REQUESTID.zip (deutsch konsistent).
  const dateBase = reqRow.exportReadyAt ?? reqRow.exportGeneratedAt ?? reqRow.requestedAt ?? now;
  const y = dateBase.getUTCFullYear();
  const m = String(dateBase.getUTCMonth() + 1).padStart(2, '0');
  const d = String(dateBase.getUTCDate()).padStart(2, '0');
  const filename = `smartflow-datenexport-${y}-${m}-${d}-${reqRow.id}.zip`;

  const headers = new Headers();
  headers.set('Content-Type', 'application/zip');
  headers.set('Content-Length', String(buffer.byteLength));
  headers.set(
    'Content-Disposition',
    `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
  );
  headers.set('Cache-Control', 'no-store, max-age=0');
  return new NextResponse(buffer, { status: 200, headers });
}
