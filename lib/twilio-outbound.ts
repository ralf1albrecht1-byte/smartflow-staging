/**
 * lib/twilio-outbound.ts
 *
 * Server-only helper to send WhatsApp messages with media attachments via
 * the Twilio Programmable Messaging REST API.
 *
 * Used by `/api/whatsapp/send-pdf` to deliver the generated PDF directly
 * into the operator's own WhatsApp chat (the BUSINESS owner's number,
 * never the end customer).
 *
 * Required env vars:
 *   - TWILIO_ACCOUNT_SID    (already set; used for inbound webhook auth)
 *   - TWILIO_AUTH_TOKEN     (already set; used for inbound webhook auth)
 *   - TWILIO_WHATSAPP_FROM  (NEW) — Twilio sender, e.g.
 *                                  `whatsapp:+14155238886` (sandbox) or
 *                                  `whatsapp:+41xxxxxxxxx` (Business API).
 *
 * Twilio API:
 *   POST https://api.twilio.com/2010-04-01/Accounts/{SID}/Messages.json
 *     From:     whatsapp:+SENDER
 *     To:       whatsapp:+RECIPIENT
 *     Body:     short text (optional but recommended)
 *     MediaUrl: publicly fetchable HTTPS URL to the PDF
 */

import { normalizePhoneE164 } from '@/lib/normalize';

export type TwilioOutboundConfigError =
  | 'NO_ACCOUNT_SID'
  | 'NO_AUTH_TOKEN'
  | 'NO_FROM_NUMBER';

export interface TwilioOutboundResult {
  ok: boolean;
  /** Twilio message SID on success. */
  messageSid?: string;
  /** A short stable error code (NO_FROM_NUMBER, INVALID_TO, TWILIO_REJECTED, NETWORK). */
  errorCode?: TwilioOutboundConfigError | 'INVALID_TO' | 'TWILIO_REJECTED' | 'NETWORK';
  /** Human-readable error message (German) for the toast layer. */
  errorMessage?: string;
  /** HTTP status from Twilio if applicable. */
  twilioStatus?: number;
  /** Raw Twilio error code (e.g. 63016, 21408). */
  twilioCode?: number;
}

export interface SendWhatsAppMediaParams {
  /** Operator's own E.164 phone number ("+41…"). Will be wrapped with "whatsapp:" prefix. */
  to: string;
  /** Public HTTPS URL Twilio can fetch (max 5 MB for WhatsApp media). */
  mediaUrl: string;
  /** Short message body shown above the media in WhatsApp. */
  body: string;
}

/**
 * Sends a WhatsApp message with a single media attachment via Twilio.
 * Returns a structured result instead of throwing — the caller decides
 * how to surface failures to the user.
 */
export async function sendWhatsAppMedia(
  params: SendWhatsAppMediaParams,
): Promise<TwilioOutboundResult> {
  const accountSid = process.env.TWILIO_ACCOUNT_SID || '';
  const authToken = process.env.TWILIO_AUTH_TOKEN || '';
  const fromRaw = process.env.TWILIO_WHATSAPP_FROM || '';

  if (!accountSid) {
    return {
      ok: false,
      errorCode: 'NO_ACCOUNT_SID',
      errorMessage:
        'Twilio ist nicht vollständig konfiguriert (TWILIO_ACCOUNT_SID fehlt).',
    };
  }
  if (!authToken) {
    return {
      ok: false,
      errorCode: 'NO_AUTH_TOKEN',
      errorMessage:
        'Twilio ist nicht vollständig konfiguriert (TWILIO_AUTH_TOKEN fehlt).',
    };
  }
  if (!fromRaw) {
    return {
      ok: false,
      errorCode: 'NO_FROM_NUMBER',
      errorMessage:
        'WhatsApp-Versand ist nicht konfiguriert. Es ist keine Twilio-Absendernummer (TWILIO_WHATSAPP_FROM) hinterlegt.',
    };
  }

  // Normalize the recipient. Accept already-prefixed input gracefully.
  const toClean = params.to.replace(/^whatsapp:/i, '').trim();
  const toE164 = normalizePhoneE164(toClean);
  if (!toE164) {
    return {
      ok: false,
      errorCode: 'INVALID_TO',
      errorMessage:
        'Die hinterlegte Betriebs-WhatsApp-Nummer ist ungültig. Bitte unter Einstellungen → Kontakt korrigieren.',
    };
  }

  // Twilio expects "whatsapp:+E164" both for From and To.
  const fromForApi = fromRaw.startsWith('whatsapp:') ? fromRaw : `whatsapp:${fromRaw}`;
  const toForApi = `whatsapp:${toE164}`;

  const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
  const formBody = new URLSearchParams();
  formBody.set('From', fromForApi);
  formBody.set('To', toForApi);
  formBody.set('Body', params.body);
  formBody.set('MediaUrl', params.mediaUrl);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization:
          'Basic ' + Buffer.from(`${accountSid}:${authToken}`).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: formBody.toString(),
    });

    let payload: any = null;
    try {
      payload = await res.json();
    } catch {
      // ignore; some 5xx pages may not be JSON
    }

    if (!res.ok) {
      const twilioCode =
        typeof payload?.code === 'number' ? payload.code : undefined;
      const twilioMsg =
        typeof payload?.message === 'string' ? payload.message : '';
      console.error('[twilio-outbound] Twilio error', {
        status: res.status,
        code: twilioCode,
        message: twilioMsg,
      });
      return {
        ok: false,
        errorCode: 'TWILIO_REJECTED',
        errorMessage: `WhatsApp-Versand wurde von Twilio abgelehnt${
          twilioCode ? ` (Code ${twilioCode})` : ''
        }. Bitte Konfiguration und Empfängernummer prüfen.`,
        twilioStatus: res.status,
        twilioCode,
      };
    }

    const messageSid =
      typeof payload?.sid === 'string' ? payload.sid : undefined;
    return { ok: true, messageSid };
  } catch (err: any) {
    console.error('[twilio-outbound] Network/Fetch failure', err);
    return {
      ok: false,
      errorCode: 'NETWORK',
      errorMessage:
        'Verbindung zu Twilio fehlgeschlagen. Bitte erneut versuchen.',
    };
  }
}
