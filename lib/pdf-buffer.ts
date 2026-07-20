/**
 * lib/pdf-buffer.ts
 *
 * Server-side helpers that produce a PDF Buffer for an Offer or Invoice.
 *
 * Used by the Twilio-WhatsApp send flow (`/api/whatsapp/send-pdf`)
 * which needs the raw PDF bytes to upload to S3 so Twilio can fetch them.
 *
 * Invoices with status = 'Erledigt' still use the immutable archived snapshot.
 * Live PDF generation now uses local Puppeteer/Chromium on Railway.
 */

import puppeteer from 'puppeteer';

import { prisma } from '@/lib/prisma';
import { generateOfferHtml, generateInvoiceHtml } from '@/lib/pdf-templates';
import { getOrCreateArchivedPdf } from '@/lib/archived-pdf';

export interface PdfBufferResult {
  buffer: Buffer;
  fileName: string;
  documentNumber: string;
  customerName: string | null;
}

async function htmlToPdfBuffer(htmlContent: string): Promise<Buffer> {
  let browser: any = null;

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

    await page.setContent(htmlContent, {
      waitUntil: ['load', 'networkidle0'],
      timeout: 30000,
    });

    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: {
        top: '15mm',
        right: '15mm',
        bottom: '15mm',
        left: '15mm',
      },
    });

    return Buffer.from(pdf);
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
  }
}

function safeFileName(prefix: string, num: string, customerName?: string | null): string {
  const safe = String(num || '').replace(/[^a-zA-Z0-9._-]+/g, '_');

  let namePart = '';

  if (customerName && customerName.trim()) {
    namePart =
      '_' +
      customerName
        .trim()
        .replace(/[äÄ]/g, 'ae')
        .replace(/[öÖ]/g, 'oe')
        .replace(/[üÜ]/g, 'ue')
        .replace(/[ß]/g, 'ss')
        .replace(/[^a-zA-Z0-9 _-]/g, '')
        .replace(/\s+/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_|_$/g, '')
        .substring(0, 40);

    if (namePart === '_') {
      namePart = '';
    }
  }

  return `${prefix}_${safe || 'dokument'}${namePart}.pdf`;
}

export async function generateOfferPdfBuffer(
  offerId: string,
  userId: string,
): Promise<PdfBufferResult> {
  const [offer, companySettings] = await Promise.all([
    prisma.offer.findFirst({
      where: { id: offerId, userId },
      include: { customer: true, items: true },
    }),
    prisma.companySettings.findFirst({ where: { userId } }),
  ]);

  if (!offer) {
    throw new Error('OFFER_NOT_FOUND');
  }

  const htmlContent = generateOfferHtml(
    {
      ...offer,
      subtotal: Number(offer?.subtotal ?? 0),
      vatAmount: Number(offer?.vatAmount ?? 0),
      total: Number(offer?.total ?? 0),
      items: offer?.items?.map((item: any) => ({
        ...item,
        quantity: Number(item?.quantity ?? 0),
        unitPrice: Number(item?.unitPrice ?? 0),
        totalPrice: Number(item?.totalPrice ?? 0),
      })),
    },
    companySettings,
  );

  const buffer = await htmlToPdfBuffer(htmlContent);

  return {
    buffer,
    fileName: safeFileName('Angebot', offer.offerNumber, offer.customer?.name),
    documentNumber: offer.offerNumber,
    customerName: offer.customer?.name ?? null,
  };
}

export async function generateInvoicePdfBuffer(
  invoiceId: string,
  userId: string,
): Promise<PdfBufferResult> {
  const [invoice, companySettings] = await Promise.all([
    prisma.invoice.findFirst({
      where: { id: invoiceId, userId },
      include: { customer: true, items: true },
    }),
    prisma.companySettings.findFirst({ where: { userId } }),
  ]);

  if (!invoice) {
    throw new Error('INVOICE_NOT_FOUND');
  }

  if (invoice.status === 'Erledigt') {
    const { buffer } = await getOrCreateArchivedPdf(invoice, companySettings);

    return {
      buffer,
      fileName: safeFileName('Rechnung', invoice.invoiceNumber, invoice.customer?.name),
      documentNumber: invoice.invoiceNumber,
      customerName: invoice.customer?.name ?? null,
    };
  }

  const htmlContent = generateInvoiceHtml(
    {
      ...invoice,
      subtotal: Number(invoice?.subtotal ?? 0),
      vatAmount: Number(invoice?.vatAmount ?? 0),
      total: Number(invoice?.total ?? 0),
      items: invoice?.items?.map((item: any) => ({
        ...item,
        quantity: Number(item?.quantity ?? 0),
        unitPrice: Number(item?.unitPrice ?? 0),
        totalPrice: Number(item?.totalPrice ?? 0),
      })),
    },
    companySettings,
  );

  const buffer = await htmlToPdfBuffer(htmlContent);

  return {
    buffer,
    fileName: safeFileName('Rechnung', invoice.invoiceNumber, invoice.customer?.name),
    documentNumber: invoice.invoiceNumber,
    customerName: invoice.customer?.name ?? null,
  };
}