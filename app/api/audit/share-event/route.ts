export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSessionUser } from '@/lib/get-session';
import { logAuditAsync, EVENTS, AREAS, type AuditEvent } from '@/lib/audit';

/**
 * Client-side fire-and-forget endpoint for share/download audit events that
 * happen in the browser (e.g. user clicked "Download PDF" or sent the PDF
 * via WhatsApp). Whitelisted to a small set of events so callers cannot
 * spoof arbitrary audit rows.
 */
const WHITELIST: Set<AuditEvent> = new Set([
  EVENTS.OFFER_PDF_DOWNLOADED,
  EVENTS.INVOICE_PDF_DOWNLOADED,
  EVENTS.OFFER_PDF_SENT_TO_BUSINESS_WHATSAPP,
  EVENTS.INVOICE_PDF_SENT_TO_BUSINESS_WHATSAPP,
] as AuditEvent[]);

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: 'Nicht autorisiert' }, { status: 401 });
  }

  try {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Ungültige Anfrage' }, { status: 400 });
    }
    const { event, targetType, targetId, details } = body as {
      event?: string; targetType?: string; targetId?: string; details?: Record<string, any>;
    };
    if (!event || !WHITELIST.has(event as AuditEvent)) {
      return NextResponse.json({ error: 'Event nicht erlaubt' }, { status: 400 });
    }
    if (!targetId || (targetType !== 'Offer' && targetType !== 'Invoice')) {
      return NextResponse.json({ error: 'Ungültiges Ziel' }, { status: 400 });
    }

    // Verify ownership — never allow auditing rows from other users.
    if (targetType === 'Offer') {
      const exists = await prisma.offer.findFirst({
        where: { id: targetId, userId: user.id },
        select: { id: true, offerNumber: true, customer: { select: { name: true } } },
      });
      if (!exists) {
        return NextResponse.json({ error: 'Angebot nicht gefunden' }, { status: 404 });
      }
      logAuditAsync({
        userId: user.id,
        userEmail: user.email,
        userRole: user.role,
        action: event,
        area: AREAS.PDF,
        targetType: 'Offer',
        targetId: exists.id,
        success: true,
        details: {
          offerNumber: exists.offerNumber,
          customerName: exists.customer?.name || null,
          ...(details || {}),
        },
        request,
      });
    } else {
      const exists = await prisma.invoice.findFirst({
        where: { id: targetId, userId: user.id },
        select: { id: true, invoiceNumber: true, customer: { select: { name: true } } },
      });
      if (!exists) {
        return NextResponse.json({ error: 'Rechnung nicht gefunden' }, { status: 404 });
      }
      logAuditAsync({
        userId: user.id,
        userEmail: user.email,
        userRole: user.role,
        action: event,
        area: AREAS.PDF,
        targetType: 'Invoice',
        targetId: exists.id,
        success: true,
        details: {
          invoiceNumber: exists.invoiceNumber,
          customerName: exists.customer?.name || null,
          ...(details || {}),
        },
        request,
      });
    }

    return NextResponse.json({ ok: true });
  } catch (error: any) {
    console.error('Audit share-event error:', error);
    return NextResponse.json({ error: 'Fehler' }, { status: 500 });
  }
}
