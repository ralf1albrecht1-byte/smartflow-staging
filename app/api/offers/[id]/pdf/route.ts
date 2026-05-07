
export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import puppeteer from 'puppeteer';
import { prisma } from '@/lib/prisma';
import { generateOfferHtml } from '@/lib/pdf-templates';
import { toImageDataUrl } from '@/lib/pdf-image-data-url';
import { requireUserId, unauthorizedResponse, getSessionUser } from '@/lib/get-session';
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
    browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
      ],
    });

    const page = await browser.newPage();

    await page.setContent(html, {
      waitUntil: ['load', 'networkidle0'],
      timeout: 30000,
    });

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

    return Buffer.from(pdfBuffer);
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
  }
}

export async function GET(request: Request, { params }: { params: { id: string } }) {
  const ts = Date.now();
  const route = '/api/offers/[id]/pdf';

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

    const [offer, companySettings] = await Promise.all([
      prisma.offer.findFirst({
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

    if (!offer) {
      const existsForOther = await prisma.offer.findFirst({
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
        errorMessage: 'offer_pdf_not_found_for_user',
        details: { route, documentId: params?.id, reason },
        request,
      });

      return NextResponse.json(
        { error: 'Nicht gefunden' },
        { status: 404, headers: SECURITY_HEADERS }
      );
    }

    console.log(
      `[PDF-SECURITY] ${route} | OWNERSHIP_OK | userId=${userId} | docOwner=${offer.userId} | docId=${offer.id} | offerNumber=${offer.offerNumber} | ts=${ts}`
    );

    const offerCompanySettings = companySettings ? { ...companySettings } : companySettings;

    if (offerCompanySettings?.letterheadVisible === true && offerCompanySettings?.letterheadUrl) {
      const letterheadDataUrl = await toImageDataUrl(offerCompanySettings.letterheadUrl);
      offerCompanySettings.letterheadUrl = letterheadDataUrl;
    }

    const htmlContent = generateOfferHtml(
      {
        ...offer,
        subtotal: Number(offer?.subtotal ?? 0),
        vatAmount: Number(offer?.vatAmount ?? 0),
        total: Number(offer?.total ?? 0),
        items: offer?.items?.map((i: any) => ({
          ...i,
          quantity: Number(i?.quantity ?? 0),
          unitPrice: Number(i?.unitPrice ?? 0),
          totalPrice: Number(i?.totalPrice ?? 0),
        })),
      },
      offerCompanySettings
    );

    const pdfBuffer = await renderPdfFromHtml(htmlContent);

    console.log(
      `[PDF-SECURITY] ${route} | SERVED | userId=${userId} | docId=${offer.id} | offerNumber=${offer.offerNumber} | bytes=${pdfBuffer.length} | ts=${ts}`
    );

    logAuditAsync({
      userId,
      userEmail: su?.email,
      userRole: su?.role,
      action: EVENTS.OFFER_PDF_GENERATED,
      area: AREAS.PDF,
      targetType: 'Offer',
      targetId: offer.id,
      details: { offerNumber: offer.offerNumber, customerId: offer.customerId },
      request,
    });

    return new NextResponse(pdfBuffer, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${offer.offerNumber}.pdf"`,
        ...SECURITY_HEADERS,
      },
    });
  } catch (error: any) {
    console.error('Offer PDF error:', error);

    return NextResponse.json(
      { error: 'PDF fehlgeschlagen' },
      { status: 500, headers: SECURITY_HEADERS }
    );
  }
}