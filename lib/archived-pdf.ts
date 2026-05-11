
/**
 * Immutable Archived PDF Snapshot System
 */
import puppeteer from 'puppeteer';

import { prisma } from '@/lib/prisma';
import { uploadBufferToS3, downloadBufferFromS3 } from '@/lib/s3';
import { generateInvoiceHtml } from '@/lib/pdf-templates';

async function generatePdfBuffer(invoice: any, companySettings: any): Promise<Buffer> {
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

async function storeSnapshot(
  invoiceId: string,
  buffer: Buffer,
  mode: 'backfill' | 'repair' = 'backfill',
): Promise<string> {
  const fileName = `invoices/${invoiceId}/archived.pdf`;
  const cloud_storage_path = await uploadBufferToS3(buffer, fileName, 'application/pdf', false);

  if (mode === 'repair') {
    const repaired = await prisma.invoice.updateMany({
      where: { id: invoiceId, status: 'Erledigt' },
      data: { archivedPdfPath: cloud_storage_path },
    });

    if (repaired.count === 0) {
      console.warn(`[SNAPSHOT_REPAIR] Invoice ${invoiceId}: repair skipped — invoice is no longer archived.`);
    } else {
      console.warn(`[SNAPSHOT_REPAIR] Invoice ${invoiceId}: repaired with new snapshot at ${cloud_storage_path}.`);
    }

    return cloud_storage_path;
  }

  const updated = await prisma.invoice.updateMany({
    where: { id: invoiceId, archivedPdfPath: null, status: 'Erledigt' },
    data: { archivedPdfPath: cloud_storage_path },
  });

  if (updated.count === 0) {
    const existing = await prisma.invoice.findUnique({
      where: { id: invoiceId },
      select: { archivedPdfPath: true, status: true },
    });

    if (existing?.status !== 'Erledigt') {
      console.log(`[archived-pdf] Backfill write skipped for invoice ${invoiceId}: invoice was reopened.`);
      return cloud_storage_path;
    }

    return existing?.archivedPdfPath ?? cloud_storage_path;
  }

  console.log(`[LEGACY_BACKFILL] Invoice ${invoiceId}: created snapshot at ${cloud_storage_path}`);
  return cloud_storage_path;
}

export async function getOrCreateArchivedPdf(
  invoice: any,
  companySettings: any,
): Promise<{ buffer: Buffer; cloud_storage_path: string }> {
  if (invoice.archivedPdfPath) {
    try {
      const buffer = await downloadBufferFromS3(invoice.archivedPdfPath);
      return { buffer, cloud_storage_path: invoice.archivedPdfPath };
    } catch (err) {
      console.error(`[SNAPSHOT_REPAIR] Invoice ${invoice.id}: archived PDF missing, repairing.`, err);
      const buffer = await generatePdfBuffer(invoice, companySettings);
      const cloud_storage_path = await storeSnapshot(invoice.id, buffer, 'repair');
      return { buffer, cloud_storage_path };
    }
  }

  console.log(`[LEGACY_BACKFILL] Invoice ${invoice.id}: no archivedPdfPath set, generating snapshot.`);
  const buffer = await generatePdfBuffer(invoice, companySettings);
  const cloud_storage_path = await storeSnapshot(invoice.id, buffer, 'backfill');

  return { buffer, cloud_storage_path };
}

export async function createArchivedPdfSnapshot(
  invoiceId: string,
  userId: string,
): Promise<void> {
  try {
    const [invoice, companySettings] = await Promise.all([
      prisma.invoice.findFirst({
        where: { id: invoiceId, userId },
        include: { customer: true, items: true },
      }),
      prisma.companySettings.findFirst({ where: { userId } }),
    ]);

    if (!invoice) return;
    if (invoice.archivedPdfPath) return;

    if (invoice.status !== 'Erledigt') {
      console.log(`[archived-pdf] Snapshot skipped for invoice ${invoiceId}: status is "${invoice.status}".`);
      return;
    }

    await getOrCreateArchivedPdf(invoice, companySettings);
  } catch (err) {
    console.error(`[archived-pdf] Snapshot creation failed for invoice ${invoiceId}:`, err);
  }
}