/**
 * lib/whatsapp-share.ts
 *
 * Helper to share generated PDFs (offers/invoices) via WhatsApp.
 *
 * IMPORTANT BUSINESS LOGIC:
 *   The recipient is ALWAYS the business owner / tool user, NEVER the
 *   end customer. The PDF is sent to the company's PRIMARY business
 *   WhatsApp number so the owner can review it and forward it from
 *   their own WhatsApp to the customer.
 *
 *   The recipient is resolved server-side from CompanySettings:
 *     1) `whatsappIntakeNumber` (preferred when explicitly set).
 *     2) `telefon` (primary business number).
 *   `telefon2` and `Customer.phone` are NEVER used.
 *
 * NEW FLOW (server-side via Twilio):
 *   The button now triggers a single POST to `/api/whatsapp/send-pdf`,
 *   which:
 *     1. Generates the PDF on the server.
 *     2. Uploads it to public S3.
 *     3. Sends it via Twilio Programmable Messaging directly to the
 *        operator's own WhatsApp — the file lands as a real attachment
 *        in the chat, ready to be forwarded.
 *
 *   The legacy "download + open wa.me" workaround is no longer needed.
 */

export type WhatsAppShareKind = 'offer' | 'invoice';

export type WhatsAppShareResult =
  | { ok: true; messageSid?: string; recipient?: string }
  | {
      ok: false;
      reason:
        | 'no_business_number'
        | 'pdf_failed'
        | 'upload_failed'
        | 'twilio_not_configured'
        | 'twilio_invalid_to'
        | 'twilio_rejected'
        | 'twilio_network'
        | 'unauthorized'
        | 'unknown';
      message?: string;
    };

export interface SendPdfViaTwilioWhatsAppParams {
  /** What to send: an offer or an invoice. */
  kind: WhatsAppShareKind;
  /** ID of the offer/invoice. */
  id: string;
}

/**
 * Sends the generated PDF to the operator's BUSINESS WhatsApp number via
 * Twilio. The recipient is resolved server-side; the client only passes
 * the document kind and id.
 */
export async function sendPdfToBusinessWhatsApp(
  params: SendPdfViaTwilioWhatsAppParams,
): Promise<WhatsAppShareResult> {
  let res: Response;
  try {
    res = await fetch('/api/whatsapp/send-pdf', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: params.kind, id: params.id }),
    });
  } catch (err) {
    console.error('[whatsapp-share] Network failure calling send-pdf', err);
    return { ok: false, reason: 'unknown' };
  }

  let data: any = null;
  try {
    data = await res.json();
  } catch {
    // ignore parse errors
  }

  if (res.ok && data?.ok) {
    return { ok: true, messageSid: data.messageSid, recipient: data.recipient };
  }

  if (res.status === 401) {
    return { ok: false, reason: 'unauthorized', message: data?.error };
  }

  // Map server errorCode to a stable client reason.
  const code = String(data?.errorCode || '').toUpperCase();
  switch (code) {
    case 'NO_BUSINESS_NUMBER':
      return { ok: false, reason: 'no_business_number', message: data?.error };
    case 'NOT_FOUND':
    case 'PDF_FAILED':
      return { ok: false, reason: 'pdf_failed', message: data?.error };
    case 'UPLOAD_FAILED':
      return { ok: false, reason: 'upload_failed', message: data?.error };
    case 'NO_FROM_NUMBER':
    case 'NO_ACCOUNT_SID':
    case 'NO_AUTH_TOKEN':
      return { ok: false, reason: 'twilio_not_configured', message: data?.error };
    case 'INVALID_TO':
      return { ok: false, reason: 'twilio_invalid_to', message: data?.error };
    case 'TWILIO_REJECTED':
    case 'TWILIO_FAILED':
      return { ok: false, reason: 'twilio_rejected', message: data?.error };
    case 'NETWORK':
      return { ok: false, reason: 'twilio_network', message: data?.error };
    default:
      return { ok: false, reason: 'unknown', message: data?.error };
  }
}

/** Predefined message text label — kept for backwards compatibility / docs. */
export const WHATSAPP_OFFER_MESSAGE =
  'Hier ist das erstellte Angebot als PDF. Bitte prüfen und an den Kunden weiterleiten.';

/** Predefined message text label — kept for backwards compatibility / docs. */
export const WHATSAPP_INVOICE_MESSAGE =
  'Hier ist die erstellte Rechnung als PDF. Bitte prüfen und an den Kunden weiterleiten.';
