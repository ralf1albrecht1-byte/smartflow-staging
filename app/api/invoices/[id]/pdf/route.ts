export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import puppeteer from 'puppeteer';
import { prisma } from '@/lib/prisma';
import { generateInvoiceHtml } from '@/lib/pdf-templates';
import { toImageDataUrl } from '@/lib/pdf-image-data-url';
import { requireUserId, unauthorizedResponse, getSessionUser } from '@/lib/get-session';
import { getOrCreateArchivedPdf } from '@/lib/archived-pdf';
import { logAuditAsync, EVENTS, AREAS } from '@/lib/audit';

const SECURITY_HEADERS = {
  'Cache-Control': 'no-store, no-cache, must-revalidate, private, max-age=0',
  Pragma: 'no-cache',
  Expires: '0',
  Vary: 'Cookie',
  'CDN-Cache-Control': 'no-store',
  'Surrogate-Control': 'no-store',
};

async function renderPdfFromHtml(html: string): Promise<Buffer> {
  let browser: Awaited<ReturnType<typeof puppeteer.launch>> | null = null;

  try {
    // TEMP DEBUG: Before Puppeteer launch
    console.log('[PDF DEBUG] renderPdfFromHtml called, HTML length:', html.length);
    console.log('[PDF DEBUG] Attempting puppeteer.launch()...');

    browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
      ],
    });

    // TEMP DEBUG: After Puppeteer launch
    console.log('[PDF DEBUG] Puppeteer browser launched successfully');

    const page = await browser.newPage();
    console.log('[PDF DEBUG] New page created, setting content...');

    await page.setContent(html, {
      waitUntil: ['load', 'networkidle0'],
      timeout: 30000,
    });

    console.log('[PDF DEBUG] Content set, generating PDF...');

    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: {
        top: '15mm',
        right: '15mm',
        bottom: '15mm',
        left: '15mm',
      },
    });

    console.log('[PDF DEBUG] PDF buffer generated, size:', pdfBuffer.length);

    return Buffer.from(pdfBuffer);
  } catch (renderErr: any) {
    // TEMP DEBUG: Catch inside renderPdfFromHtml
    console.error('[PDF DEBUG] renderPdfFromHtml FAILED:', renderErr?.message);
    console.error('[PDF DEBUG] renderPdfFromHtml error name:', renderErr?.name);
    console.error('[PDF DEBUG] renderPdfFromHtml stack:', renderErr?.stack);
    throw renderErr;
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
  }
}

export async function GET(request: Request, { params }: { params: { id: string } }) {
  const ts = Date.now();
  const route = '/api/invoices/[id]/pdf';

  try {
    let userId: string;

    try {
      userId = await requireUserId();
    } catch {
      console.warn(`[PDF-SECURITY] ${route} | DENIED | reason=no_session | docId=${params?.id} | ts=${ts}`);
      return unauthorizedResponse();
    }

    const su = await getSessionUser();

    console.log(
      `[PDF-SECURITY] ${route} | AUTH_OK | userId=${userId} | email=${su?.email} | role=${su?.role} | docId=${params?.id} | ts=${ts}`
    );

    const [invoice, companySettings] = await Promise.all([
      prisma.invoice.findFirst({
        where: { id: params?.id, userId },
        include: { customer: true, items: true },
      }),
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
      const existsForOther = await prisma.invoice.findFirst({
        where: { id: params?.id },
        select: { userId: true },
      });

      const reason = existsForOther
        ? `belongs_to_other_user(owner=${existsForOther.userId})`
        : 'document_does_not_exist';

      console.warn(
        `[PDF-SECURITY] ${route} | DENIED | userId=${userId} | email=${su?.email} | role=${su?.role} | docId=${params?.id} | reason=${reason} | ts=${ts}`
      );

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
        { status: 404, headers: SECURITY_HEADERS }
      );
    }

    console.log(
      `[PDF-SECURITY] ${route} | OWNERSHIP_OK | userId=${userId} | docOwner=${invoice.userId} | docId=${invoice.id} | invoiceNumber=${invoice.invoiceNumber} | status=${invoice.status} | ts=${ts}`
    );

    if (invoice.status === 'Erledigt') {
      try {
        const { buffer } = await getOrCreateArchivedPdf(invoice, companySettings);

        console.log(
          `[PDF-SECURITY] ${route} | SERVED | userId=${userId} | docId=${invoice.id} | invoiceNumber=${invoice.invoiceNumber} | source=archived | bytes=${buffer.length} | ts=${ts}`
        );

        logAuditAsync({
          userId,
          userEmail: su?.email,
          userRole: su?.role,
          action: EVENTS.INVOICE_PDF_GENERATED,
          area: AREAS.PDF,
          targetType: 'Invoice',
          targetId: invoice.id,
          details: {
            invoiceNumber: invoice.invoiceNumber,
            source: 'archived_snapshot',
            customerId: invoice.customerId,
          },
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

        logAuditAsync({
          userId,
          userEmail: su?.email,
          userRole: su?.role,
          action: EVENTS.INVOICE_PDF_GENERATED,
          area: AREAS.PDF,
          targetType: 'Invoice',
          targetId: invoice.id,
          success: false,
          errorMessage: err?.message || 'Archived snapshot failed',
          details: { invoiceNumber: invoice.invoiceNumber, source: 'archived_snapshot' },
          request,
        });

        return NextResponse.json(
          { error: 'Archiviertes PDF konnte nicht geladen oder erstellt werden. Bitte versuchen Sie es später erneut.' },
          { status: 500, headers: SECURITY_HEADERS }
        );
      }
    }

    const invoiceCompanySettings = companySettings ? { ...companySettings } : companySettings;

    if (invoiceCompanySettings?.letterheadVisible === true && invoiceCompanySettings?.letterheadUrl) {
      const letterheadDataUrl = await toImageDataUrl(invoiceCompanySettings.letterheadUrl);
      invoiceCompanySettings.letterheadUrl = letterheadDataUrl;
    }

    const htmlContent = generateInvoiceHtml(
      {
        ...invoice,
        subtotal: Number(invoice?.subtotal ?? 0),
        vatAmount: Number(invoice?.vatAmount ?? 0),
        total: Number(invoice?.total ?? 0),
        items: invoice?.items?.map((i: any) => ({
          ...i,
          quantity: Number(i?.quantity ?? 0),
          unitPrice: Number(i?.unitPrice ?? 0),
          totalPrice: Number(i?.totalPrice ?? 0),
        })),
      },
      invoiceCompanySettings
    );

    const pdfBuffer = await renderPdfFromHtml(htmlContent);

    console.log(
      `[PDF-SECURITY] ${route} | SERVED | userId=${userId} | docId=${invoice.id} | invoiceNumber=${invoice.invoiceNumber} | source=live | bytes=${pdfBuffer.length} | ts=${ts}`
    );

    logAuditAsync({
      userId,
      userEmail: su?.email,
      userRole: su?.role,
      action: EVENTS.INVOICE_PDF_GENERATED,
      area: AREAS.PDF,
      targetType: 'Invoice',
      targetId: invoice.id,
      details: {
        invoiceNumber: invoice.invoiceNumber,
        source: 'live',
        customerId: invoice.customerId,
      },
      request,
    });

    return new NextResponse(pdfBuffer, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${invoice.invoiceNumber}.pdf"`,
        ...SECURITY_HEADERS,
      },
    });
  } catch (error: any) {
    // TEMP DEBUG: Detailed error logging for TEST environment
    console.error('[PDF DEBUG] Invoice PDF generation FAILED');
    console.error('[PDF DEBUG] Error name:', error?.name);
    console.error('[PDF DEBUG] Error message:', error?.message);
    console.error('[PDF DEBUG] Error stack:', error?.stack);
    console.error('[PDF DEBUG] Full error:', error);

    return NextResponse.json(
      {
        error: 'PDF fehlgeschlagen',
        // TEMP DEBUG: Include details in response for TEST environment
        debug: {
          name: error?.name || 'Unknown',
          message: error?.message || 'No message',
          stack: error?.stack?.split('\n').slice(0, 5).join('\n') || 'No stack',
        },
      },
      { status: 500, headers: SECURITY_HEADERS }
    );
  }
}