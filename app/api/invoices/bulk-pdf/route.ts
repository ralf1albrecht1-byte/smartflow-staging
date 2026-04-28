export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireUserId, unauthorizedResponse } from '@/lib/get-session';
import { getOrCreateArchivedPdf } from '@/lib/archived-pdf';
import JSZip from 'jszip';

// Safe threshold for v1: max 50 invoices per bulk export
const MAX_BULK_INVOICES = 50;
// Concurrency limit for parallel PDF retrieval/generation
const CONCURRENCY = 3;

function sanitizeFilename(name: string): string {
  return name.replace(/[/\\:*?"<>|]/g, '').replace(/\s+/g, ' ').trim();
}

function formatDateForFilename(dateStr: string): string {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return 'unbekannt';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const MONTH_NAMES_DE = ['Januar','Februar','März','April','Mai','Juni','Juli','August','September','Oktober','November','Dezember'];

/**
 * Retrieve or create the archived PDF snapshot for a single invoice.
 * Uses the shared getOrCreateArchivedPdf helper — most archived invoices
 * will already have a stored snapshot (fast S3 read), only legacy ones
 * need live generation on first access.
 */
async function getInvoicePdf(
  invoice: any,
  companySettings: any,
): Promise<{ buffer: Buffer; filename: string } | { error: string; invoiceNumber: string }> {
  try {
    const { buffer } = await getOrCreateArchivedPdf(invoice, companySettings);
    const customerName = sanitizeFilename(invoice.customer?.name || 'Unbekannt');
    const dateStr = formatDateForFilename(invoice.invoiceDate);
    const invNum = sanitizeFilename(invoice.invoiceNumber || 'Rechnung');
    const filename = `${invNum}_${customerName}_${dateStr}.pdf`;
    return { buffer, filename };
  } catch (e: any) {
    return { error: e?.message || 'Unbekannter Fehler', invoiceNumber: invoice.invoiceNumber };
  }
}

// Process items in batches with concurrency limit
async function processWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  let index = 0;
  async function worker() {
    while (index < items.length) {
      const currentIndex = index++;
      results[currentIndex] = await fn(items[currentIndex]);
    }
  }
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

export async function POST(request: Request) {
  try {
    let userId: string;
    try { userId = await requireUserId(); } catch { return unauthorizedResponse(); }

    const body = await request.json();
    const { year, month, dateFrom, dateTo } = body ?? {};

    // Build date filter for archived invoices
    const where: any = { userId, status: 'Erledigt', deletedAt: null };
    const dateConditions: any = {};

    if (dateFrom && dateTo) {
      // Custom date range
      dateConditions.gte = new Date(dateFrom);
      const toDate = new Date(dateTo);
      toDate.setHours(23, 59, 59, 999);
      dateConditions.lte = toDate;
    } else if (year && month) {
      // Specific year + month
      const y = parseInt(year, 10);
      const m = parseInt(month, 10);
      dateConditions.gte = new Date(y, m - 1, 1);
      dateConditions.lt = new Date(y, m, 1);
    } else if (year) {
      // Full year
      const y = parseInt(year, 10);
      dateConditions.gte = new Date(y, 0, 1);
      dateConditions.lt = new Date(y + 1, 0, 1);
    } else {
      return NextResponse.json({ error: 'Bitte Zeitraum auswählen' }, { status: 400 });
    }

    if (Object.keys(dateConditions).length > 0) {
      where.invoiceDate = dateConditions;
    }

    const invoices = await prisma.invoice.findMany({
      where,
      include: { customer: true, items: true },
      orderBy: { invoiceDate: 'asc' },
    });

    if (invoices.length === 0) {
      return NextResponse.json({ error: 'Keine archivierten Rechnungen im gewählten Zeitraum gefunden', count: 0 }, { status: 404 });
    }

    if (invoices.length > MAX_BULK_INVOICES) {
      return NextResponse.json(
        {
          error: `Zu viele Rechnungen (${invoices.length}). Maximal ${MAX_BULK_INVOICES} Rechnungen pro Export. Bitte einen kleineren Zeitraum wählen.`,
          count: invoices.length,
          limit: MAX_BULK_INVOICES,
        },
        { status: 400 },
      );
    }

    const companySettings = await prisma.companySettings.findFirst({ where: { userId } });

    // Retrieve stored snapshots (fast) or generate+store on first access (legacy backfill)
    const results = await processWithConcurrency(invoices, CONCURRENCY, (inv) =>
      getInvoicePdf(inv, companySettings),
    );

    const successes: { buffer: Buffer; filename: string }[] = [];
    const failures: { invoiceNumber: string; error: string }[] = [];
    const usedFilenames = new Set<string>();

    for (const result of results) {
      if ('buffer' in result) {
        // Avoid duplicate filenames
        let fname = result.filename;
        if (usedFilenames.has(fname)) {
          let counter = 2;
          const baseName = fname.replace(/\.pdf$/, '');
          while (usedFilenames.has(`${baseName}_${counter}.pdf`)) counter++;
          fname = `${baseName}_${counter}.pdf`;
        }
        usedFilenames.add(fname);
        successes.push({ buffer: result.buffer, filename: fname });
      } else {
        failures.push({ invoiceNumber: result.invoiceNumber, error: result.error });
      }
    }

    if (successes.length === 0) {
      return NextResponse.json(
        { error: 'Keine PDFs konnten generiert werden. Bitte später erneut versuchen.', failures },
        { status: 500 },
      );
    }

    // Build ZIP
    const zip = new JSZip();
    for (const s of successes) {
      zip.file(s.filename, s.buffer);
    }

    // Add CSV index
    const csvHeader = 'Rechnungsnummer;Datum;Kunde;Betrag CHF;Status';
    const csvRows = invoices.map((inv: any) => {
      const num = inv.invoiceNumber ?? '';
      const date = inv.invoiceDate ? new Date(inv.invoiceDate).toLocaleDateString('de-CH') : '';
      const customer = (inv as any).customer?.name ?? '';
      const amount = Number(inv.total ?? 0).toFixed(2);
      const failed = failures.some((f) => f.invoiceNumber === inv.invoiceNumber);
      const status = failed ? 'PDF fehlgeschlagen' : 'Archiviert';
      // Escape CSV fields that may contain semicolons or quotes
      const esc = (v: string) => v.includes(';') || v.includes('"') ? `"${v.replace(/"/g, '""')}"` : v;
      return [esc(num), esc(date), esc(customer), amount, status].join(';');
    });
    zip.file('index.csv', '\uFEFF' + csvHeader + '\n' + csvRows.join('\n'));

    const zipBuffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } });

    // Build ZIP filename
    let zipFilename: string;
    if (dateFrom && dateTo) {
      zipFilename = `archiv_rechnungen_${dateFrom}_bis_${dateTo}.zip`;
    } else if (year && month) {
      const m = parseInt(month, 10);
      zipFilename = `archiv_rechnungen_${year}_${String(m).padStart(2, '0')}.zip`;
    } else {
      zipFilename = `archiv_rechnungen_${year}_komplett.zip`;
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${zipFilename}"`,
    };

    // Include failure info in a custom header if there were partial failures
    if (failures.length > 0) {
      headers['X-Skipped-Count'] = String(failures.length);
      headers['X-Skipped-Invoices'] = failures.map((f) => f.invoiceNumber).join(',');
    }

    return new NextResponse(zipBuffer, { headers });
  } catch (error: any) {
    console.error('Bulk PDF export error:', error);
    return NextResponse.json({ error: 'Export fehlgeschlagen. Bitte später erneut versuchen.' }, { status: 500 });
  }
}
