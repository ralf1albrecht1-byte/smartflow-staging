/**
 * lib/pdf-buffer.ts
 *
 * Server-side helpers that produce a PDF Buffer for an Offer or Invoice.
 *
 * Used by the new Twilio-WhatsApp send flow (`/api/whatsapp/send-pdf`)
 * which needs the raw PDF bytes to upload to S3 (so Twilio can fetch
 * them as MMS media).
 *
 * For Invoices with status = 'Erledigt' we MUST serve the immutable
 * archived snapshot (same rule as `/api/invoices/[id]/pdf`). Live
 * generation is only used for non-archived invoices and for offers.
 *
 * The live-generation path uses the same Abacus.AI HTML→PDF service as
 * the existing PDF download routes — keeping output byte-identical so
 * the operator gets exactly what they would have downloaded.
 */

import { prisma } from '@/lib/prisma';
import { generateOfferHtml, generateInvoiceHtml } from '@/lib/pdf-templates';
import { getOrCreateArchivedPdf } from '@/lib/archived-pdf';

export interface PdfBufferResult {
  buffer: Buffer;
  /** A safe, human-readable filename (e.g. "angebot_A-2025-001.pdf"). */
  fileName: string;
  /** The number on the document (offerNumber / invoiceNumber). */
  documentNumber: string;
  /** The customer name (or null when not linked). */
  customerName: string | null;
}

async function htmlToPdfBuffer(html_content: string): Promise<Buffer> {
  const createResponse = await fetch(
    'https://apps.abacus.ai/api/createConvertHtmlToPdfRequest',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        deployment_token: process.env.ABACUSAI_API_KEY,
        html_content,
        pdf_options: {
          format: 'A4',
          margin: { top: '15mm', right: '15mm', bottom: '15mm', left: '15mm' },
          print_background: true,
        },
        base_url: process.env.NEXTAUTH_URL || '',
      }),
    },
  );
  if (!createResponse.ok) {
    throw new Error('PDF service rejected request');
  }
  const { request_id } = await createResponse.json();
  let attempts = 0;
  while (attempts < 120) {
    await new Promise((r) => setTimeout(r, 1000));
    const res = await fetch(
      'https://apps.abacus.ai/api/getConvertHtmlToPdfStatus',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          request_id,
          deployment_token: process.env.ABACUSAI_API_KEY,
        }),
      },
    );
    const result = await res.json();
    if (result?.status === 'SUCCESS' && result?.result?.result) {
      return Buffer.from(result.result.result, 'base64');
    }
    if (result?.status === 'FAILED') {
      throw new Error('PDF conversion failed');
    }
    attempts++;
  }
  throw new Error('PDF conversion timed out');
}

function safeFileName(prefix: string, num: string, customerName?: string | null): string {
  const safe = String(num || '').replace(/[^a-zA-Z0-9._-]+/g, '_');
  // Sanitize customer name: keep alphanumeric + common chars, replace rest with underscore
  let namePart = '';
  if (customerName && customerName.trim()) {
    namePart = '_' + customerName.trim()
      .replace(/[äÄ]/g, 'ae').replace(/[öÖ]/g, 'oe').replace(/[üÜ]/g, 'ue').replace(/[ß]/g, 'ss')
      .replace(/[^a-zA-Z0-9 _-]/g, '')
      .replace(/\s+/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '')
      .substring(0, 40); // limit length
    if (namePart === '_') namePart = '';
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
  const html_content = generateOfferHtml(
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
    companySettings,
  );
  const buffer = await htmlToPdfBuffer(html_content);
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
  // Archived invoices: use immutable snapshot, same rule as the PDF route.
  if (invoice.status === 'Erledigt') {
    const { buffer } = await getOrCreateArchivedPdf(invoice, companySettings);
    return {
      buffer,
      fileName: safeFileName('Rechnung', invoice.invoiceNumber, invoice.customer?.name),
      documentNumber: invoice.invoiceNumber,
      customerName: invoice.customer?.name ?? null,
    };
  }
  const html_content = generateInvoiceHtml(
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
    companySettings,
  );
  const buffer = await htmlToPdfBuffer(html_content);
  return {
    buffer,
    fileName: safeFileName('Rechnung', invoice.invoiceNumber, invoice.customer?.name),
    documentNumber: invoice.invoiceNumber,
    customerName: invoice.customer?.name ?? null,
  };
}
