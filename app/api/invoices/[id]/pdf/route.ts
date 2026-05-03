export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { generateInvoiceHtml } from '@/lib/pdf-templates';
import { requireUserId, unauthorizedResponse, getSessionUser } from '@/lib/get-session';
import { getOrCreateArchivedPdf } from '@/lib/archived-pdf';
import { logAuditAsync, EVENTS, AREAS } from '@/lib/audit';

/** Anti-cache headers — CRITICAL for tenant isolation.
 *  Without these, a reverse proxy/CDN could serve User A's PDF to User B.
 *  - Vary: Cookie → tells ANY proxy/CDN that the response depends on the session cookie
 *  - CDN-Cache-Control: no-store → Cloudflare/CDN-level no-cache directive
 *  - Surrogate-Control: no-store → Varnish/Fastly/nginx proxy-level no-cache directive
 */
const SECURITY_HEADERS = {
  'Cache-Control': 'no-store, no-cache, must-revalidate, private, max-age=0',
  'Pragma': 'no-cache',
  'Expires': '0',
  'Vary': 'Cookie',
  'CDN-Cache-Control': 'no-store',
  'Surrogate-Control': 'no-store',
};

export async function GET(request: Request, { params }: { params: { id: string } }) {
  const ts = Date.now();
  const route = '/api/invoices/[id]/pdf';
  try {
    let userId: string;
    try { userId = await requireUserId(); } catch {
      console.warn(`[PDF-SECURITY] ${route} | DENIED | reason=no_session | docId=${params?.id} | ts=${ts}`);
      return unauthorizedResponse();
    }

    const su = await getSessionUser();
    console.log(`[PDF-SECURITY] ${route} | AUTH_OK | userId=${userId} | email=${su?.email} | role=${su?.role} | docId=${params?.id} | ts=${ts}`);

    const [invoice, companySettings] = await Promise.all([
      prisma.invoice.findFirst({ where: { id: params?.id, userId }, include: { customer: true, items: true } }),
      prisma.companySettings.findFirst({
        where: { userId },
        select: {
          firmenname: true,
          firmaRechtlich: true,
          ansprechpartner: true,
          telefon: true,
          telefon2: true,
          email: true,
          supportEmail: true,
          webseite: true,
          strasse: true,
          hausnummer: true,
          plz: true,
          ort: true,
          iban: true,
          bank: true,
          mwstAktiv: true,
          mwstNummer: true,
          mwstSatz: true,
          mwstHinweis: true,
          documentTemplate: true,
          letterheadUrl: true,
          letterheadName: true,
          letterheadVisible: true,
        },
      }),
    ]);

    if (!invoice) {
      const existsForOther = await prisma.invoice.findFirst({ where: { id: params?.id }, select: { userId: true } });
      const reason = existsForOther
        ? `belongs_to_other_user(owner=${existsForOther.userId})`
        : 'document_does_not_exist';
      console.warn(`[PDF-SECURITY] ${route} | DENIED | userId=${userId} | email=${su?.email} | role=${su?.role} | docId=${params?.id} | reason=${reason} | ts=${ts}`);

      logAuditAsync({
        userId,
        userEmail: su?.email,
        userRole: su?.role,
        action: EVENTS.FILE_ACCESS_DENIED,
        area: AREAS.SECURITY,
        success: false,
        errorMessage: 'invoice_pdf_not_found_for_user',
        details: { route, documentId: params?.id, reason },
        request,
      });
      return NextResponse.json(
        { error: 'Nicht gefunden' },
        { status: 404, headers: SECURITY_HEADERS },
      );
    }

    console.log(`[PDF-SECURITY] ${route} | OWNERSHIP_OK | userId=${userId} | docOwner=${invoice.userId} | docId=${invoice.id} | invoiceNumber=${invoice.invoiceNumber} | status=${invoice.status} | ts=${ts}`);

    // ── Archived invoices: serve immutable stored snapshot — NEVER live generation ──
    if (invoice.status === 'Erledigt') {
      try {
        const { buffer } = await getOrCreateArchivedPdf(invoice, companySettings);
        console.log(`[PDF-SECURITY] ${route} | SERVED | userId=${userId} | docId=${invoice.id} | invoiceNumber=${invoice.invoiceNumber} | source=archived | bytes=${buffer.length} | ts=${ts}`);
        logAuditAsync({
          userId, userEmail: su?.email, userRole: su?.role,
          action: EVENTS.INVOICE_PDF_GENERATED, area: AREAS.PDF,
          targetType: 'Invoice', targetId: invoice.id,
          details: { invoiceNumber: invoice.invoiceNumber, source: 'archived_snapshot', customerId: invoice.customerId },
          request,
        });
        return new NextResponse(buffer, {
          headers: {
            'Content-Type': 'application/pdf',
            'Content-Disposition': `attachment; filename="${invoice.invoiceNumber}.pdf"`,
            ...SECURITY_HEADERS,
          },
        });
      } catch (err: any) {
        console.error(`[pdf] Archived snapshot failed for ${invoice.id}:`, err);
        const su = await getSessionUser();
        logAuditAsync({
          userId, userEmail: su?.email, userRole: su?.role,
          action: EVENTS.INVOICE_PDF_GENERATED, area: AREAS.PDF,
          targetType: 'Invoice', targetId: invoice.id,
          success: false, errorMessage: err?.message || 'Archived snapshot failed',
          details: { invoiceNumber: invoice.invoiceNumber, source: 'archived_snapshot' },
          request,
        });
        return NextResponse.json(
          { error: 'Archiviertes PDF konnte nicht geladen oder erstellt werden. Bitte versuchen Sie es später erneut.' },
          { status: 500, headers: SECURITY_HEADERS },
        );
      }
    }

    // ── Non-archived invoices only: live generation ──
    const html_content = generateInvoiceHtml({
      ...invoice,
      subtotal: Number(invoice?.subtotal ?? 0),
      vatAmount: Number(invoice?.vatAmount ?? 0),
      total: Number(invoice?.total ?? 0),
      items: invoice?.items?.map((i: any) => ({ ...i, quantity: Number(i?.quantity ?? 0), unitPrice: Number(i?.unitPrice ?? 0), totalPrice: Number(i?.totalPrice ?? 0) })),
    }, companySettings);

    const createResponse = await fetch('https://apps.abacus.ai/api/createConvertHtmlToPdfRequest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deployment_token: process.env.ABACUSAI_API_KEY, html_content, pdf_options: { format: 'A4', margin: { top: '15mm', right: '15mm', bottom: '15mm', left: '15mm' }, print_background: true }, base_url: process.env.NEXTAUTH_URL || '' }),
    });
    if (!createResponse.ok) {
      const su = await getSessionUser();
      logAuditAsync({
        userId, userEmail: su?.email, userRole: su?.role,
        action: EVENTS.INVOICE_PDF_GENERATED, area: AREAS.PDF,
        targetType: 'Invoice', targetId: invoice.id,
        success: false, errorMessage: 'PDF service rejected request',
        details: { invoiceNumber: invoice.invoiceNumber, source: 'live' },
        request,
      });
      return NextResponse.json({ error: 'PDF-Fehler' }, { status: 500, headers: SECURITY_HEADERS });
    }
    const { request_id } = await createResponse.json();
    let attempts = 0;
    while (attempts < 120) {
      await new Promise(r => setTimeout(r, 1000));
      const res = await fetch('https://apps.abacus.ai/api/getConvertHtmlToPdfStatus', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id, deployment_token: process.env.ABACUSAI_API_KEY }) });
      const result = await res.json();
      if (result?.status === 'SUCCESS' && result?.result?.result) {
        const pdfBuffer = Buffer.from(result.result.result, 'base64');
        console.log(`[PDF-SECURITY] ${route} | SERVED | userId=${userId} | docId=${invoice.id} | invoiceNumber=${invoice.invoiceNumber} | source=live | bytes=${pdfBuffer.length} | ts=${ts}`);
        logAuditAsync({
          userId, userEmail: su?.email, userRole: su?.role,
          action: EVENTS.INVOICE_PDF_GENERATED, area: AREAS.PDF,
          targetType: 'Invoice', targetId: invoice.id,
          details: { invoiceNumber: invoice.invoiceNumber, source: 'live', customerId: invoice.customerId },
          request,
        });
        return new NextResponse(pdfBuffer, {
          headers: {
            'Content-Type': 'application/pdf',
            'Content-Disposition': `attachment; filename="${invoice.invoiceNumber}.pdf"`,
            ...SECURITY_HEADERS,
          },
        });
      }
      if (result?.status === 'FAILED') {
        const su = await getSessionUser();
        logAuditAsync({
          userId, userEmail: su?.email, userRole: su?.role,
          action: EVENTS.INVOICE_PDF_GENERATED, area: AREAS.PDF,
          targetType: 'Invoice', targetId: invoice.id,
          success: false, errorMessage: 'PDF conversion failed',
          details: { invoiceNumber: invoice.invoiceNumber, source: 'live' },
          request,
        });
        return NextResponse.json({ error: 'PDF fehlgeschlagen' }, { status: 500, headers: SECURITY_HEADERS });
      }
      attempts++;
    }
    return NextResponse.json({ error: 'Timeout' }, { status: 500, headers: SECURITY_HEADERS });
  } catch (error: any) {
    console.error(error);
    return NextResponse.json({ error: 'Fehler' }, { status: 500, headers: SECURITY_HEADERS });
  }
}
