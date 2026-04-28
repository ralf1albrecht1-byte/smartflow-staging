export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
  requireAdmin,
  getSessionUser,
  unauthorizedResponse,
  forbiddenResponse,
} from '@/lib/get-session';
import { logAuditAsync, EVENTS, AREAS } from '@/lib/audit';
import { buildUserDataExport } from '@/lib/data-export';

/**
 * Block T — Admin-only data export package endpoint.
 *
 * POST /api/admin/compliance/requests/[id]/export
 *
 * Builds a ZIP package with all data scoped to the user who filed the
 * compliance request, returns it as a download, and:
 *   - logs DATA_EXPORT_PREPARED on success (or DATA_EXPORT_PREPARE_FAILED on error),
 *   - if the request is currently `open`, transitions it to `in_progress`,
 *   - appends an admin note "Datenexport wurde vorbereitet am [timestamp].".
 *
 * The request is NEVER auto-completed — the admin must manually mark it
 * `completed` after delivering the export to the customer.
 */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  let adminId: string;
  try {
    adminId = await requireAdmin();
  } catch (e: any) {
    if (e?.message === 'FORBIDDEN') return forbiddenResponse();
    return unauthorizedResponse();
  }
  const admin = await getSessionUser();

  // 1. Load the compliance request and validate type.
  // Block T-fix — explicit join to the affected user so we can audit the
  // affected user's email, not only the user-id.
  const reqRow = await prisma.complianceRequest.findUnique({
    where: { id: params.id },
    include: {
      user: { select: { id: true, email: true, name: true } },
    },
  });
  if (!reqRow) {
    return NextResponse.json({ error: 'Anfrage nicht gefunden' }, { status: 404 });
  }
  if (reqRow.type !== 'data_export') {
    return NextResponse.json(
      { error: 'Export ist nur für Anfragen vom Typ data_export verfügbar.' },
      { status: 400 },
    );
  }

  // 2. Build the export package.
  // Block T-fix — pass requestId so the filename uses YYYY-MM-DD-REQUESTID
  // (no email / no name / no firma).
  let pkg: Awaited<ReturnType<typeof buildUserDataExport>>;
  try {
    pkg = await buildUserDataExport(reqRow.userId, { requestId: reqRow.id });
  } catch (err: any) {
    const errorMessage = err?.message ? String(err.message).slice(0, 300) : 'unknown_error';
    logAuditAsync({
      userId: adminId,
      userEmail: admin?.email || null,
      userRole: admin?.role || 'admin',
      action: EVENTS.DATA_EXPORT_PREPARE_FAILED,
      area: AREAS.COMPLIANCE,
      targetType: 'ComplianceRequest',
      targetId: reqRow.id,
      success: false,
      errorMessage,
      details: {
        // Block T-fix — strukturierte, eindeutige Felder.
        requestId: reqRow.id,
        type: reqRow.type,
        affectedUserId: reqRow.userId,
        affectedUserEmail: reqRow.user?.email ?? null,
        performedByUserId: adminId,
        performedByEmail: admin?.email ?? null,
      },
      request,
    });
    return NextResponse.json(
      { error: 'Export konnte nicht erstellt werden.', detail: errorMessage },
      { status: 500 },
    );
  }

  // 3. Update request: bump open → in_progress and append admin note. Never
  //    auto-complete — admin manually marks completed after delivery.
  try {
    // Sauber formatierter Zeitstempel: TT.MM.JJJJ, HH:mm:ss (Europe/Zurich)
    const now = new Date();
    const dt = new Intl.DateTimeFormat('de-CH', {
      timeZone: 'Europe/Zurich',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).formatToParts(now);
    const get = (t: string) => dt.find((p) => p.type === t)?.value ?? '';
    const formatted = `${get('day')}.${get('month')}.${get('year')}, ${get('hour')}:${get('minute')}:${get('second')}`;
    const note = `Datenexport wurde vorbereitet am ${formatted}.`;

    // Bestehende manuelle Notizen werden NICHT gelöscht. Nur eine
    // automatische, sauber formatierte Zeile wird angefügt.
    const newAdminNotes = reqRow.adminNotes
      ? `${reqRow.adminNotes}\n${note}`.slice(0, 2000)
      : note;

    const data: { status?: string; adminNotes?: string } = { adminNotes: newAdminNotes };
    if (reqRow.status === 'open') data.status = 'in_progress';

    await prisma.complianceRequest.update({ where: { id: reqRow.id }, data });
  } catch (updErr) {
    // Non-fatal — the export ZIP is already built and will still be returned
    // to the admin. Log the failure so it can be investigated.
    console.error('DATA_EXPORT: failed to update compliance request status/note:', updErr);
  }

  // 4. Audit success.
  // Block T-fix — strukturierte Felder, damit sofort sichtbar ist:
  //   * wer den Export ausgeführt hat (performedBy*)
  //   * für welchen Nutzer (affected*)
  //   * welche Anfrage-ID
  //   * Filename + Counts (NIE Rohdaten)
  logAuditAsync({
    userId: adminId,
    userEmail: admin?.email || null,
    userRole: admin?.role || 'admin',
    action: EVENTS.DATA_EXPORT_PREPARED,
    area: AREAS.COMPLIANCE,
    targetType: 'ComplianceRequest',
    targetId: reqRow.id,
    success: true,
    details: {
      requestId: reqRow.id,
      affectedUserId: reqRow.userId,
      affectedUserEmail: reqRow.user?.email ?? null,
      performedByUserId: adminId,
      performedByEmail: admin?.email ?? null,
      filename: pkg.filename,
      timestampIso: new Date().toISOString(),
      counts: pkg.counts,
      previousStatus: reqRow.status,
      newStatus: reqRow.status === 'open' ? 'in_progress' : reqRow.status,
      sizeBytes: pkg.buffer.byteLength,
    },
    request,
  });

  // 5. Stream the ZIP back to the admin.
  const headers = new Headers();
  headers.set('Content-Type', 'application/zip');
  headers.set('Content-Length', String(pkg.buffer.byteLength));
  headers.set(
    'Content-Disposition',
    `attachment; filename="${pkg.filename}"; filename*=UTF-8''${encodeURIComponent(pkg.filename)}`,
  );
  // Force fresh download every time.
  headers.set('Cache-Control', 'no-store, max-age=0');
  return new NextResponse(pkg.buffer, { status: 200, headers });
}
