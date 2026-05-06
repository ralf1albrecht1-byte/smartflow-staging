export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSessionUser } from '@/lib/get-session';
import { logAuditAsync, EVENTS, AREAS } from '@/lib/audit';
import { buildUserDataExport } from '@/lib/data-export';
import { uploadBufferToS3 } from '@/lib/s3';
import { shouldSendEmail, getEmailSuppressionReason, getAppEnv } from '@/lib/env';
import { sendEmail } from '@/lib/mail';

/**
 * Block T-auto — Automatische Datenexport-Pipeline.
 *
 * Bei `data_export`-Anfragen wird die ZIP-Datei direkt im POST synchron
 * erzeugt, in S3 (privat) abgelegt und der User-Mail "Datenexport bereit"
 * versandt. Das Frontend zeigt während der Verarbeitung "Datenexport wird
 * vorbereitet…" und deaktiviert den Button, bis der POST abgeschlossen ist.
 *
 * Konstanten:
 *  - Ablauf nach 72 Stunden (= 72 * 3600 s)
 */
const EXPORT_EXPIRY_HOURS = 72;

/**
 * Block N — user-facing compliance requests.
 *
 * A request is *only* a tracked intent. The system performs no automatic
 * deletion or cancellation. Operators handle each request via the admin
 * console respecting the platform's retention/legal obligations.
 */
const ALLOWED_TYPES = new Set(['data_export', 'data_deletion', 'account_cancellation']);

/**
 * Block T — central definition of "active" compliance request statuses.
 * Both `open` and `in_progress` count as active. The duplicate-block
 * check uses this set so a user cannot file a second active request of
 * the same type while we are already processing one.
 */
const ACTIVE_STATUSES = ['open', 'in_progress'] as const;

const ADMIN_NOTIFY_EMAIL = process.env.ADMIN_EMAIL || 'kontakt@smartflowai.ch';

function typeEvent(type: string): string | null {
  if (type === 'data_export') return EVENTS.DATA_EXPORT_REQUESTED;
  if (type === 'data_deletion') return EVENTS.DATA_DELETION_REQUESTED;
  if (type === 'account_cancellation') return EVENTS.ACCOUNT_CANCELLATION_REQUESTED;
  return null;
}

function typeLabel(type: string): string {
  if (type === 'data_export') return 'Datenexport-Anfrage';
  if (type === 'data_deletion') return 'Löschanfrage';
  if (type === 'account_cancellation') return 'Kündigungsanfrage';
  return 'Compliance-Anfrage';
}

function typeSubject(type: string): string {
  if (type === 'data_export') return 'Neue Datenexport-Anfrage';
  if (type === 'data_deletion') return 'Neue Löschanfrage';
  if (type === 'account_cancellation') return 'Neue Kündigungsanfrage';
  return 'Neue Compliance-Anfrage';
}

function typeUserConfirmSubject(type: string): string {
  if (type === 'data_export') return 'Deine Datenexport-Anfrage wurde empfangen';
  if (type === 'data_deletion') return 'Deine Löschanfrage wurde empfangen';
  if (type === 'account_cancellation') return 'Deine Kündigungsanfrage wurde empfangen';
  return 'Deine Anfrage wurde empfangen';
}

function buildUserConfirmEmailHtml(type: string): string {
  const intro =
    type === 'data_export'
      ? 'wir haben deine Datenexport-Anfrage erhalten.<br>Der Export wird vorbereitet. Sobald er bereit ist, erhältst du eine weitere E-Mail.'
      : type === 'data_deletion'
      ? 'wir haben deine Löschanfrage erhalten.<br>Diese wird manuell geprüft. Daten mit gesetzlichen Aufbewahrungspflichten bleiben entsprechend gesperrt erhalten.'
      : 'wir haben deine Kündigungsanfrage erhalten.<br>Wir prüfen sie und melden uns zum weiteren Vorgehen.';

  const subject = typeUserConfirmSubject(type);

  return `
<!DOCTYPE html>
<html lang="de"><head><meta charset="utf-8"><title>${escapeHtml(subject)}</title></head>
<body style="font-family: Arial, sans-serif; color:#1f2937; line-height:1.6; max-width:560px; margin:0 auto; padding:24px;">
  <h2 style="margin:0 0 16px 0; color:#111827;">${escapeHtml(subject)}</h2>
  <p style="margin:0 0 16px 0;">Hallo,</p>
  <p style="margin:0 0 16px 0;">${intro}</p>
  <p style="margin:24px 0 0 0; color:#6b7280; font-size:13px;">Smartflow AI</p>
</body></html>`;
}

async function sendUserConfirmationEmail(opts: {
  type: string;
  userEmail: string;
}): Promise<{ ok: true; suppressed?: boolean; reason?: string } | { ok: false; errorMessage: string }> {
  try {
    if (!shouldSendEmail(opts.userEmail)) {
      const reason = getEmailSuppressionReason(opts.userEmail) || 'unknown';
      console.log(`[compliance.userConfirm] suppressed by env env=${getAppEnv()} reason=${reason}`);
      return { ok: true, suppressed: true, reason };
    }

    await sendEmail({
      to: opts.userEmail,
      subject: typeUserConfirmSubject(opts.type),
      html: buildUserConfirmEmailHtml(opts.type),
    });

    return { ok: true };
  } catch (err: any) {
    return {
      ok: false,
      errorMessage: err?.message ? String(err.message).slice(0, 300) : 'unknown_error',
    };
  }
}

/**
 * Block T-auto — User-Notification: "Datenexport ist bereit".
 *
 * KEINE ZIP-Datei im Anhang. Der Mailbody erklärt nur, dass der Export
 * im Tool zum Download bereitsteht (72h gültig) und linkt auf
 * Einstellungen → Daten & Kündigung.
 */
function buildExportReadyEmailHtml(opts: {
  expiresAt: Date;
}): string {
  const expiresFormatted = opts.expiresAt.toLocaleString('de-CH', {
    timeZone: 'Europe/Zurich',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  const subject = 'Dein Datenexport ist bereit';

  return `
<!DOCTYPE html>
<html lang="de"><head><meta charset="utf-8"><title>${escapeHtml(subject)}</title></head>
<body style="font-family: Arial, sans-serif; color:#1f2937; line-height:1.6; max-width:560px; margin:0 auto; padding:24px;">
  <h2 style="margin:0 0 16px 0; color:#111827;">${escapeHtml(subject)}</h2>
  <p style="margin:0 0 16px 0;">Hallo,</p>
  <p style="margin:0 0 16px 0;">dein Datenexport wurde erstellt und steht im Tool zum Download bereit.</p>
  <p style="margin:0 0 16px 0;">
    Bitte logge dich ein und gehe zu <strong>Einstellungen → Daten &amp; Kündigung</strong>,
    um den Export herunterzuladen.
  </p>
  <p style="margin:0 0 16px 0; padding:12px; background:#fffbeb; border-left:3px solid #f59e0b;">
    <strong>Wichtig:</strong> Der Download ist aus Sicherheitsgründen nur bis
    <strong>${escapeHtml(expiresFormatted)} (Europe/Zurich)</strong> verfügbar
    (72 Stunden). Danach kannst du jederzeit eine neue Anfrage stellen.
  </p>
  <p style="margin:0 0 16px 0; color:#6b7280; font-size:13px;">
    Aus Sicherheitsgründen verschicken wir den Export nicht per E-Mail.
    Der Download erfolgt ausschliesslich nach Login innerhalb des Tools.
  </p>
  <p style="margin:24px 0 0 0; color:#6b7280; font-size:13px;">Smartflow AI</p>
</body></html>`;
}

async function sendExportReadyEmail(opts: {
  userEmail: string;
  expiresAt: Date;
}): Promise<{ ok: true; suppressed?: boolean; reason?: string } | { ok: false; errorMessage: string }> {
  try {
    if (!shouldSendEmail(opts.userEmail)) {
      const reason = getEmailSuppressionReason(opts.userEmail) || 'unknown';
      console.log(`[compliance.exportReady] suppressed by env env=${getAppEnv()} reason=${reason}`);
      return { ok: true, suppressed: true, reason };
    }

    await sendEmail({
      to: opts.userEmail,
      subject: 'Dein Datenexport ist bereit',
      html: buildExportReadyEmailHtml({ expiresAt: opts.expiresAt }),
    });

    return { ok: true };
  } catch (err: any) {
    return {
      ok: false,
      errorMessage: err?.message ? String(err.message).slice(0, 300) : 'unknown_error',
    };
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildEmailHtml(opts: {
  type: string;
  userEmail: string;
  companyName: string | null;
  createdAt: Date;
}): string {
  const label = typeLabel(opts.type);
  const ts = opts.createdAt.toLocaleString('de-CH', { timeZone: 'Europe/Zurich' });
  const company = opts.companyName ? escapeHtml(opts.companyName) : '<em>nicht hinterlegt</em>';

  return `
<!DOCTYPE html>
<html lang="de"><head><meta charset="utf-8"><title>${escapeHtml(label)}</title></head>
<body style="font-family: Arial, sans-serif; color:#1f2937; line-height:1.5; max-width:640px; margin:0 auto; padding:24px;">
  <h2 style="margin:0 0 16px 0; color:#111827;">${escapeHtml(label)}</h2>
  <p style="margin:0 0 16px 0;">Es wurde eine neue Compliance-Anfrage über die Anwendung erstellt.</p>
  <table cellpadding="6" cellspacing="0" style="border-collapse:collapse; margin:0 0 16px 0;">
    <tr>
      <td style="border:1px solid #e5e7eb; background:#f9fafb;"><strong>Anfragetyp</strong></td>
      <td style="border:1px solid #e5e7eb;">${escapeHtml(label)}</td>
    </tr>
    <tr>
      <td style="border:1px solid #e5e7eb; background:#f9fafb;"><strong>User-Email</strong></td>
      <td style="border:1px solid #e5e7eb;">${escapeHtml(opts.userEmail)}</td>
    </tr>
    <tr>
      <td style="border:1px solid #e5e7eb; background:#f9fafb;"><strong>Firma</strong></td>
      <td style="border:1px solid #e5e7eb;">${company}</td>
    </tr>
    <tr>
      <td style="border:1px solid #e5e7eb; background:#f9fafb;"><strong>Erstellt</strong></td>
      <td style="border:1px solid #e5e7eb;">${escapeHtml(ts)}</td>
    </tr>
  </table>
  <p style="margin:16px 0 0 0; padding:12px; background:#fffbeb; border-left:3px solid #f59e0b;">
    Bitte im <strong>Admin → Datenschutz → Anfragen</strong> prüfen.
  </p>
</body></html>`;
}

async function sendComplianceNotificationEmail(opts: {
  type: string;
  userEmail: string;
  companyName: string | null;
  createdAt: Date;
}): Promise<{ ok: true; suppressed?: boolean; reason?: string } | { ok: false; errorMessage: string }> {
  try {
    if (!shouldSendEmail(ADMIN_NOTIFY_EMAIL)) {
      const reason = getEmailSuppressionReason(ADMIN_NOTIFY_EMAIL) || 'unknown';
      console.log(`[compliance.adminNotify] suppressed by env env=${getAppEnv()} reason=${reason}`);
      return { ok: true, suppressed: true, reason };
    }

    await sendEmail({
      to: ADMIN_NOTIFY_EMAIL,
      subject: typeSubject(opts.type),
      html: buildEmailHtml(opts),
    });

    return { ok: true };
  } catch (err: any) {
    return {
      ok: false,
      errorMessage: err?.message ? String(err.message).slice(0, 300) : 'unknown_error',
    };
  }
}

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Nicht autorisiert' }, { status: 401 });

  try {
    const requests = await prisma.complianceRequest.findMany({
      where: { userId: user.id },
      orderBy: { requestedAt: 'desc' },
    });

    return NextResponse.json({ requests });
  } catch (error) {
    console.error('GET compliance requests error:', error);
    return NextResponse.json({ error: 'Fehler beim Laden' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Nicht autorisiert' }, { status: 401 });

  try {
    const body = await request.json().catch(() => null);

    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Ungültige Anfrage' }, { status: 400 });
    }

    const type = String(body.type || '').toLowerCase();
    const notes = body.notes ? String(body.notes).slice(0, 1000) : null;

    if (!ALLOWED_TYPES.has(type)) {
      return NextResponse.json({ error: 'Anfragetyp nicht erlaubt' }, { status: 400 });
    }

    const existingActive = await prisma.complianceRequest.findFirst({
      where: { userId: user.id, type, status: { in: [...ACTIVE_STATUSES] } },
      orderBy: { requestedAt: 'desc' },
    });

    const nowForExpiryCheck = new Date();

    const existingExportExpired =
      type === 'data_export' &&
      !!existingActive &&
      !!existingActive.exportExpiresAt &&
      existingActive.exportExpiresAt.getTime() < nowForExpiryCheck.getTime();

    if (existingActive && !existingExportExpired) {
      logAuditAsync({
        userId: user.id,
        userEmail: user.email,
        userRole: user.role,
        action: EVENTS.COMPLIANCE_REQUEST_DUPLICATE_BLOCKED,
        area: AREAS.COMPLIANCE,
        targetType: 'ComplianceRequest',
        targetId: existingActive.id,
        success: true,
        details: {
          type,
          existingRequestId: existingActive.id,
          existingStatus: existingActive.status,
          existingRequestedAt: existingActive.requestedAt?.toISOString?.() ?? null,
        },
        request,
      });

      const exportSnapshot =
        type === 'data_export'
          ? {
              exportFileKey: existingActive.exportFileKey ?? null,
              exportReadyAt: existingActive.exportReadyAt ?? null,
              exportExpiresAt: existingActive.exportExpiresAt ?? null,
              downloadedAt: existingActive.downloadedAt ?? null,
              exportGenerationError: existingActive.exportGenerationError ?? null,
            }
          : null;

      return NextResponse.json(
        {
          error: 'Es gibt bereits eine offene Anfrage dieses Typs. Wir bearbeiten diese bereits.',
          code: 'duplicate_open',
          existingRequestId: existingActive.id,
          existingRequestedAt: existingActive.requestedAt ?? null,
          existingStatus: existingActive.status,
          existingType: type,
          ...(exportSnapshot ? { existingExportState: exportSnapshot } : {}),
        },
        { status: 409 },
      );
    }

    const created = await prisma.complianceRequest.create({
      data: {
        userId: user.id,
        type,
        status: 'open',
        notes,
      },
    });

    let companyName: string | null = null;

    try {
      const settings = await prisma.companySettings.findFirst({
        where: { userId: user.id },
        select: { firmenname: true },
      });

      companyName = settings?.firmenname?.trim() || null;
    } catch {
      // ignore — companyName remains null
    }

    const event = typeEvent(type);

    if (event) {
      logAuditAsync({
        userId: user.id,
        userEmail: user.email,
        userRole: user.role,
        action: event,
        area: AREAS.COMPLIANCE,
        targetType: 'ComplianceRequest',
        targetId: created.id,
        success: true,
        details: { type, userEmail: user.email, companyName },
        request,
      });
    }

    logAuditAsync({
      userId: user.id,
      userEmail: user.email,
      userRole: user.role,
      action: EVENTS.COMPLIANCE_REQUEST_CREATED,
      area: AREAS.COMPLIANCE,
      targetType: 'ComplianceRequest',
      targetId: created.id,
      success: true,
      details: { type, userEmail: user.email, companyName },
      request,
    });

    try {
      const mailRes = await sendComplianceNotificationEmail({
        type,
        userEmail: user.email,
        companyName,
        createdAt: created.requestedAt ?? new Date(),
      });

      if (mailRes.ok) {
        logAuditAsync({
          userId: user.id,
          userEmail: user.email,
          userRole: user.role,
          action: EVENTS.COMPLIANCE_REQUEST_EMAIL_SENT,
          area: AREAS.COMPLIANCE,
          targetType: 'ComplianceRequest',
          targetId: created.id,
          success: true,
          details: {
            type,
            recipient: ADMIN_NOTIFY_EMAIL,
            suppressed: mailRes.suppressed ?? false,
            reason: mailRes.reason ?? null,
          },
          request,
        });
      } else {
        logAuditAsync({
          userId: user.id,
          userEmail: user.email,
          userRole: user.role,
          action: EVENTS.COMPLIANCE_REQUEST_EMAIL_FAILED,
          area: AREAS.COMPLIANCE,
          targetType: 'ComplianceRequest',
          targetId: created.id,
          success: false,
          errorMessage: mailRes.errorMessage,
          details: { type, recipient: ADMIN_NOTIFY_EMAIL },
          request,
        });
      }
    } catch (mailErr: any) {
      try {
        logAuditAsync({
          userId: user.id,
          userEmail: user.email,
          userRole: user.role,
          action: EVENTS.COMPLIANCE_REQUEST_EMAIL_FAILED,
          area: AREAS.COMPLIANCE,
          targetType: 'ComplianceRequest',
          targetId: created.id,
          success: false,
          errorMessage: mailErr?.message ? String(mailErr.message).slice(0, 300) : 'unknown_error',
          details: { type, recipient: ADMIN_NOTIFY_EMAIL },
          request,
        });
      } catch {
        // swallow — never raise
      }
    }

    try {
      const userMailRes = await sendUserConfirmationEmail({
        type,
        userEmail: user.email,
      });

      if (userMailRes.ok) {
        logAuditAsync({
          userId: user.id,
          userEmail: user.email,
          userRole: user.role,
          action: EVENTS.COMPLIANCE_REQUEST_USER_CONFIRMATION_SENT,
          area: AREAS.COMPLIANCE,
          targetType: 'ComplianceRequest',
          targetId: created.id,
          success: true,
          details: {
            type,
            recipient: user.email,
            suppressed: userMailRes.suppressed ?? false,
            reason: userMailRes.reason ?? null,
          },
          request,
        });
      } else {
        logAuditAsync({
          userId: user.id,
          userEmail: user.email,
          userRole: user.role,
          action: EVENTS.COMPLIANCE_REQUEST_USER_CONFIRMATION_FAILED,
          area: AREAS.COMPLIANCE,
          targetType: 'ComplianceRequest',
          targetId: created.id,
          success: false,
          errorMessage: userMailRes.errorMessage,
          details: { type, recipient: user.email },
          request,
        });
      }
    } catch (userMailErr: any) {
      try {
        logAuditAsync({
          userId: user.id,
          userEmail: user.email,
          userRole: user.role,
          action: EVENTS.COMPLIANCE_REQUEST_USER_CONFIRMATION_FAILED,
          area: AREAS.COMPLIANCE,
          targetType: 'ComplianceRequest',
          targetId: created.id,
          success: false,
          errorMessage: userMailErr?.message ? String(userMailErr.message).slice(0, 300) : 'unknown_error',
          details: { type, recipient: user.email },
          request,
        });
      } catch {
        // swallow — never raise
      }
    }

    let finalRequest = created;

    if (type === 'data_export') {
      logAuditAsync({
        userId: user.id,
        userEmail: user.email,
        userRole: user.role,
        action: EVENTS.DATA_EXPORT_GENERATION_STARTED,
        area: AREAS.COMPLIANCE,
        targetType: 'ComplianceRequest',
        targetId: created.id,
        success: true,
        details: {
          requestId: created.id,
          affectedUserId: user.id,
          affectedUserEmail: user.email,
          performedByUserId: user.id,
          performedByEmail: user.email,
        },
        request,
      });

      try {
        const inProg = await prisma.complianceRequest.update({
          where: { id: created.id },
          data: { status: 'in_progress' },
        });

        finalRequest = inProg;
      } catch (e) {
        console.error('DATA_EXPORT_AUTO: failed to bump status to in_progress', e);
      }

      try {
        const pkg = await buildUserDataExport(user.id, { requestId: created.id });

        const cloud_storage_path = await uploadBufferToS3(
          pkg.buffer,
          `compliance-exports/${created.id}/${pkg.filename}`,
          'application/zip',
          false,
        );

        const now = new Date();
        const expiresAt = new Date(now.getTime() + EXPORT_EXPIRY_HOURS * 60 * 60 * 1000);

        const updated = await prisma.complianceRequest.update({
          where: { id: created.id },
          data: {
            status: 'in_progress',
            exportFileKey: cloud_storage_path,
            exportReadyAt: now,
            exportExpiresAt: expiresAt,
            exportGeneratedAt: now,
            exportGenerationError: null,
          },
        });

        finalRequest = updated;

        logAuditAsync({
          userId: user.id,
          userEmail: user.email,
          userRole: user.role,
          action: EVENTS.DATA_EXPORT_PREPARED,
          area: AREAS.COMPLIANCE,
          targetType: 'ComplianceRequest',
          targetId: created.id,
          success: true,
          details: {
            requestId: created.id,
            affectedUserId: user.id,
            affectedUserEmail: user.email,
            performedByUserId: user.id,
            performedByEmail: user.email,
            filename: pkg.filename,
            timestampIso: now.toISOString(),
            counts: pkg.counts,
            sizeBytes: pkg.buffer.byteLength,
            previousStatus: 'open',
            newStatus: 'in_progress',
            source: 'auto_user_request',
          },
          request,
        });

        try {
          const ready = await sendExportReadyEmail({ userEmail: user.email, expiresAt });

          if (ready.ok) {
            logAuditAsync({
              userId: user.id,
              userEmail: user.email,
              userRole: user.role,
              action: EVENTS.DATA_EXPORT_READY_EMAIL_SENT,
              area: AREAS.COMPLIANCE,
              targetType: 'ComplianceRequest',
              targetId: created.id,
              success: true,
              details: {
                requestId: created.id,
                affectedUserId: user.id,
                affectedUserEmail: user.email,
                recipient: user.email,
                timestampIso: new Date().toISOString(),
                suppressed: ready.suppressed ?? false,
                reason: ready.reason ?? null,
              },
              request,
            });
          } else {
            logAuditAsync({
              userId: user.id,
              userEmail: user.email,
              userRole: user.role,
              action: EVENTS.DATA_EXPORT_READY_EMAIL_FAILED,
              area: AREAS.COMPLIANCE,
              targetType: 'ComplianceRequest',
              targetId: created.id,
              success: false,
              errorMessage: ready.errorMessage,
              details: {
                requestId: created.id,
                affectedUserId: user.id,
                affectedUserEmail: user.email,
                recipient: user.email,
              },
              request,
            });
          }
        } catch (mailErr: any) {
          try {
            logAuditAsync({
              userId: user.id,
              userEmail: user.email,
              userRole: user.role,
              action: EVENTS.DATA_EXPORT_READY_EMAIL_FAILED,
              area: AREAS.COMPLIANCE,
              targetType: 'ComplianceRequest',
              targetId: created.id,
              success: false,
              errorMessage: mailErr?.message ? String(mailErr.message).slice(0, 300) : 'unknown_error',
              details: {
                requestId: created.id,
                affectedUserId: user.id,
                affectedUserEmail: user.email,
                recipient: user.email,
              },
              request,
            });
          } catch {
            // swallow
          }
        }
      } catch (genErr: any) {
        const errMsg = genErr?.message ? String(genErr.message).slice(0, 300) : 'unknown_error';

        console.error('DATA_EXPORT_AUTO: generation failed', genErr);

        try {
          const failed = await prisma.complianceRequest.update({
            where: { id: created.id },
            data: { exportGenerationError: errMsg },
          });

          finalRequest = failed;
        } catch (updErr) {
          console.error('DATA_EXPORT_AUTO: failed to persist generation error', updErr);
        }

        logAuditAsync({
          userId: user.id,
          userEmail: user.email,
          userRole: user.role,
          action: EVENTS.DATA_EXPORT_GENERATION_FAILED,
          area: AREAS.COMPLIANCE,
          targetType: 'ComplianceRequest',
          targetId: created.id,
          success: false,
          errorMessage: errMsg,
          details: {
            requestId: created.id,
            affectedUserId: user.id,
            affectedUserEmail: user.email,
            performedByUserId: user.id,
            performedByEmail: user.email,
            timestampIso: new Date().toISOString(),
          },
          request,
        });
      }
    }

    return NextResponse.json({ ok: true, request: finalRequest });
  } catch (error) {
    console.error('POST compliance request error:', error);
    return NextResponse.json({ error: 'Fehler' }, { status: 500 });
  }
}