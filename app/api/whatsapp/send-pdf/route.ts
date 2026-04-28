/**
 * POST /api/whatsapp/send-pdf
 *
 * Server-side flow for the "PDF an WhatsApp senden" button.
 *
 * What it does (in order):
 *   1. Authenticate the operator (`requireUserId`).
 *   2. Validate body: `{ kind: 'offer'|'invoice', id: string }`.
 *   3. Resolve the recipient: the operator's PRIMARY business WhatsApp number
 *      (CompanySettings.whatsappIntakeNumber || CompanySettings.telefon).
 *      NEVER the customer number, NEVER telefon2.
 *   4. Generate the PDF buffer server-side via `lib/pdf-buffer.ts`.
 *      For archived invoices the immutable snapshot is reused.
 *   5. Upload the PDF to S3 in the `public/uploads/` prefix so Twilio
 *      can fetch it as MMS media (Twilio cannot use signed URLs that
 *      change Content-Disposition).
 *   6. Send the media via Twilio Programmable Messaging using
 *      `lib/twilio-outbound.ts` (TWILIO_WHATSAPP_FROM).
 *   7. Audit-log success or failure.
 *
 * Returns JSON:
 *   200 { ok: true, messageSid }            → PDF queued/sent to operator
 *   400 { ok: false, errorCode, error }     → bad input / no recipient
 *   401 { error: 'Nicht autorisiert' }      → not logged in
 *   500 { ok: false, errorCode, error }     → PDF or Twilio failure
 */

export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireUserId, unauthorizedResponse, getSessionUser } from '@/lib/get-session';
import { logAuditAsync, EVENTS, AREAS } from '@/lib/audit';
import { generateOfferPdfBuffer, generateInvoicePdfBuffer } from '@/lib/pdf-buffer';
import { uploadBufferToS3, getFileUrl, deleteFile } from '@/lib/s3';
import { sendWhatsAppMedia } from '@/lib/twilio-outbound';
import { normalizePhoneE164 } from '@/lib/normalize';

type Kind = 'offer' | 'invoice';

export async function POST(request: Request) {
  let userId: string;
  try {
    userId = await requireUserId();
  } catch {
    return unauthorizedResponse();
  }

  let body: any = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, errorCode: 'BAD_BODY', error: 'Ungültige Anfrage.' },
      { status: 400 },
    );
  }

  const kind: Kind | undefined =
    body?.kind === 'offer' || body?.kind === 'invoice' ? body.kind : undefined;
  const id: string | undefined =
    typeof body?.id === 'string' && body.id.length > 0 ? body.id : undefined;

  if (!kind || !id) {
    return NextResponse.json(
      { ok: false, errorCode: 'BAD_BODY', error: 'Fehlende Felder kind/id.' },
      { status: 400 },
    );
  }

  const su = await getSessionUser();
  const failEvent =
    kind === 'offer' ? EVENTS.OFFER_PDF_TWILIO_FAILED : EVENTS.INVOICE_PDF_TWILIO_FAILED;
  const okEvent =
    kind === 'offer' ? EVENTS.OFFER_PDF_TWILIO_SENT : EVENTS.INVOICE_PDF_TWILIO_SENT;
  const targetType = kind === 'offer' ? 'Offer' : 'Invoice';
  const area = kind === 'offer' ? AREAS.OFFERS : AREAS.INVOICES;

  // 1) Resolve recipient: operator's own primary business WhatsApp number.
  const settings = await prisma.companySettings.findFirst({ where: { userId } });
  const recipientRaw = settings?.whatsappIntakeNumber || settings?.telefon || null;
  const recipientE164 = normalizePhoneE164(recipientRaw);
  if (!recipientE164) {
    logAuditAsync({
      userId,
      userEmail: su?.email,
      userRole: su?.role,
      action: failEvent,
      area,
      targetType,
      targetId: id,
      success: false,
      errorMessage: 'no_business_number',
      details: { kind },
      request,
    });
    return NextResponse.json(
      {
        ok: false,
        errorCode: 'NO_BUSINESS_NUMBER',
        error:
          'Keine WhatsApp-Nummer für den Betrieb hinterlegt. Bitte unter Einstellungen → Kontakt die Hauptnummer (Telefon) oder die WhatsApp-Empfangsnummer eintragen.',
      },
      { status: 400 },
    );
  }

  // 2) Generate the PDF buffer.
  let pdf;
  try {
    pdf =
      kind === 'offer'
        ? await generateOfferPdfBuffer(id, userId)
        : await generateInvoicePdfBuffer(id, userId);
  } catch (err: any) {
    const code = err?.message === 'OFFER_NOT_FOUND' || err?.message === 'INVOICE_NOT_FOUND'
      ? 'NOT_FOUND'
      : 'PDF_FAILED';
    const status = code === 'NOT_FOUND' ? 404 : 500;
    logAuditAsync({
      userId,
      userEmail: su?.email,
      userRole: su?.role,
      action: failEvent,
      area,
      targetType,
      targetId: id,
      success: false,
      errorMessage: err?.message || 'pdf_failed',
      details: { kind, stage: 'generate_pdf' },
      request,
    });
    return NextResponse.json(
      {
        ok: false,
        errorCode: code,
        error:
          code === 'NOT_FOUND'
            ? 'Dokument nicht gefunden.'
            : 'PDF konnte nicht erstellt werden. Bitte erneut versuchen.',
      },
      { status },
    );
  }

  // 3) Upload PDF to PUBLIC S3 so Twilio can fetch it as media.
  let publicMediaUrl: string;
  let cloudPath: string;
  try {
    cloudPath = await uploadBufferToS3(
      pdf.buffer,
      pdf.fileName,
      'application/pdf',
      true, // isPublic
    );
    publicMediaUrl = await getFileUrl(cloudPath, true);
  } catch (err: any) {
    console.error('[send-pdf] S3 upload failed', err);
    logAuditAsync({
      userId,
      userEmail: su?.email,
      userRole: su?.role,
      action: failEvent,
      area,
      targetType,
      targetId: id,
      success: false,
      errorMessage: err?.message || 'upload_failed',
      details: { kind, stage: 'upload_pdf' },
      request,
    });
    return NextResponse.json(
      {
        ok: false,
        errorCode: 'UPLOAD_FAILED',
        error:
          'Das PDF konnte nicht für den Versand bereitgestellt werden. Bitte erneut versuchen.',
      },
      { status: 500 },
    );
  }

  // 4) Send via Twilio.
  const custLabel = pdf.customerName && pdf.customerName.trim() && !pdf.customerName.startsWith('⚠️') ? pdf.customerName.trim() : 'Kunde';
  const docLabel = kind === 'offer' ? 'Angebot' : 'Rechnung';
  const messageBody = `${docLabel} für ${custLabel}\nBitte prüfen und an den Kunden weiterleiten.`;

  const tw = await sendWhatsAppMedia({
    to: recipientE164,
    mediaUrl: publicMediaUrl,
    body: messageBody,
  });

  if (!tw.ok) {
    // Clean up public S3 PDF immediately on Twilio failure — no need to keep it accessible
    deleteFile(cloudPath).catch((e) => console.warn('[send-pdf] cleanup after Twilio fail:', e));
    logAuditAsync({
      userId,
      userEmail: su?.email,
      userRole: su?.role,
      action: failEvent,
      area,
      targetType,
      targetId: id,
      success: false,
      errorMessage: tw.errorMessage || tw.errorCode || 'twilio_failed',
      details: {
        kind,
        stage: 'twilio_send',
        twilioErrorCode: tw.errorCode,
        twilioCode: tw.twilioCode,
        twilioStatus: tw.twilioStatus,
      },
      request,
    });
    const status =
      tw.errorCode === 'NO_FROM_NUMBER' || tw.errorCode === 'NO_ACCOUNT_SID' || tw.errorCode === 'NO_AUTH_TOKEN'
        ? 503
        : tw.errorCode === 'INVALID_TO'
          ? 400
          : 502;
    return NextResponse.json(
      {
        ok: false,
        errorCode: tw.errorCode || 'TWILIO_FAILED',
        error: tw.errorMessage || 'WhatsApp-Versand fehlgeschlagen.',
      },
      { status },
    );
  }

  logAuditAsync({
    userId,
    userEmail: su?.email,
    userRole: su?.role,
    action: okEvent,
    area,
    targetType,
    targetId: id,
    details: {
      kind,
      documentNumber: pdf.documentNumber,
      customerName: pdf.customerName,
      recipient: recipientE164,
      messageSid: tw.messageSid,
    },
    request,
  });

  // 5) Cleanup: delete the PUBLIC S3 PDF after a delay.
  // Twilio needs ~30 s to fetch the media; we wait 2 min to be safe,
  // then remove the file so it's no longer world-readable.
  setTimeout(async () => {
    try {
      await deleteFile(cloudPath);
      console.log(`[send-pdf] Cleaned up public S3 PDF: ${cloudPath}`);
    } catch (err) {
      // Non-fatal — worst case the file stays publicly accessible
      console.warn(`[send-pdf] Failed to clean up public S3 PDF: ${cloudPath}`, err);
    }
  }, 2 * 60 * 1000);

  return NextResponse.json({
    ok: true,
    messageSid: tw.messageSid,
    recipient: recipientE164,
  });
}
