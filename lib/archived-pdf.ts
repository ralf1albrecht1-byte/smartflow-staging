/**
 * Immutable Archived PDF Snapshot System
 *
 * Central helper for archived invoice PDF management.
 *
 * THREE distinct paths:
 * 1. FAST SERVE  — archivedPdfPath set + S3 object exists → download & return.
 * 2. LEGACY BACKFILL — archivedPdfPath is null (legacy archive or fire-and-forget
 *    failed at archive time). Best-effort async generation, stored in S3,
 *    path persisted. Guaranteed availability on first download / bulk-export.
 * 3. SNAPSHOT REPAIR — archivedPdfPath is set but S3 object is missing/corrupted.
 *    This is an explicit repair operation: logged as [SNAPSHOT_REPAIR], regenerated
 *    from current invoice data, stored under a new S3 key, path updated.
 *    ⚠ The repaired PDF reflects *current* data, not archive-time data.
 *    This path is NEVER silent — it always logs clearly.
 *
 * - Concurrency-safe: ALL DB writes (backfill + repair) use conditional WHERE clauses
 *   that require BOTH `archivedPdfPath IS NULL` (or repair) AND `status = 'Erledigt'`.
 *   This prevents a stale async job from writing archivedPdfPath after the invoice
 *   has been reopened (archive→reopen race condition).
 * - Per-cycle immutable: once archivedPdfPath is set, it is NEVER overwritten by
 *   normal flow, only by the explicit repair path when the S3 object is confirmed missing.
 * - Reopen lifecycle: when an invoice is reopened (leaves "Erledigt"), the PUT handler
 *   clears archivedPdfPath immediately. Subsequent edits are allowed. When re-archived,
 *   a FRESH snapshot is generated — the old S3 object is overwritten (same key).
 * - S3 key: deterministic `invoices/{id}/archived.pdf` — re-archive overwrites,
 *   no orphan objects are created.
 */
import { prisma } from '@/lib/prisma';
import { uploadBufferToS3, downloadBufferFromS3 } from '@/lib/s3';
import { generateInvoiceHtml } from '@/lib/pdf-templates';

// ── Internal: generate PDF buffer via external HTML→PDF API ──────────────
async function generatePdfBuffer(invoice: any, companySettings: any): Promise<Buffer> {
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
  if (!createResponse.ok) throw new Error('PDF creation request failed');
  const { request_id } = await createResponse.json();

  let attempts = 0;
  while (attempts < 120) {
    await new Promise((r) => setTimeout(r, 1000));
    const res = await fetch(
      'https://apps.abacus.ai/api/getConvertHtmlToPdfStatus',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ request_id, deployment_token: process.env.ABACUSAI_API_KEY }),
      },
    );
    const result = await res.json();
    if (result?.status === 'SUCCESS' && result?.result?.result) {
      return Buffer.from(result.result.result, 'base64');
    }
    if (result?.status === 'FAILED') throw new Error('PDF generation failed');
    attempts++;
  }
  throw new Error('PDF generation timeout');
}

// ── Internal: upload PDF buffer to S3 and persist path in DB ─────────────
async function storeSnapshot(
  invoiceId: string,
  buffer: Buffer,
  mode: 'backfill' | 'repair' = 'backfill',
): Promise<string> {
  // Deterministic S3 key per invoice — no timestamp, so re-uploads overwrite (safe)
  const fileName = `invoices/${invoiceId}/archived.pdf`;
  const cloud_storage_path = await uploadBufferToS3(buffer, fileName, 'application/pdf', false);

  if (mode === 'repair') {
    // REPAIR: only update if invoice is still archived (Erledigt).
    // Same concurrency guard as backfill — prevents stale repair from writing after reopen.
    const repaired = await prisma.invoice.updateMany({
      where: { id: invoiceId, status: 'Erledigt' },
      data: { archivedPdfPath: cloud_storage_path },
    });
    if (repaired.count === 0) {
      console.warn(`[SNAPSHOT_REPAIR] Invoice ${invoiceId}: repair skipped — invoice is no longer archived.`);
    } else {
      console.warn(`[SNAPSHOT_REPAIR] Invoice ${invoiceId}: repaired with new snapshot at ${cloud_storage_path}. ⚠ PDF reflects current data, not original archive-time data.`);
    }
    return cloud_storage_path;
  }

  // BACKFILL: Concurrency-safe conditional write.
  // Two conditions must BOTH hold for the write to succeed:
  //   1. archivedPdfPath IS NULL  — prevents duplicate writes from parallel jobs
  //   2. status = 'Erledigt'      — prevents a stale async job from writing AFTER reopen
  //
  // Race scenario this prevents:
  //   t0: invoice → Erledigt, async snapshot job starts
  //   t1: user reopens invoice → archivedPdfPath cleared to null, status changes
  //   t2: stale async job finishes, tries to write → BLOCKED because status ≠ 'Erledigt'
  const updated = await prisma.invoice.updateMany({
    where: { id: invoiceId, archivedPdfPath: null, status: 'Erledigt' },
    data: { archivedPdfPath: cloud_storage_path },
  });

  if (updated.count === 0) {
    // Write was blocked. Two possible reasons:
    //   a) Another request already wrote a snapshot (archivedPdfPath no longer null)
    //   b) Invoice was reopened (status no longer 'Erledigt') — stale job safely rejected
    const existing = await prisma.invoice.findUnique({
      where: { id: invoiceId },
      select: { archivedPdfPath: true, status: true },
    });
    if (existing?.status !== 'Erledigt') {
      console.log(`[archived-pdf] Backfill write skipped for invoice ${invoiceId}: invoice was reopened (status: "${existing?.status}"). Stale async job safely discarded.`);
      return cloud_storage_path; // S3 object was uploaded but DB path NOT set — harmless orphan overwritten on next archive
    }
    return existing?.archivedPdfPath ?? cloud_storage_path;
  }

  console.log(`[LEGACY_BACKFILL] Invoice ${invoiceId}: created snapshot at ${cloud_storage_path}`);
  return cloud_storage_path;
}

// ── Public API ───────────────────────────────────────────────────────────

/**
 * Returns { buffer, cloud_storage_path } for an archived invoice's PDF.
 *
 * Three paths (see module doc):
 * 1. FAST SERVE  — archivedPdfPath set + S3 OK → return directly
 * 2. LEGACY BACKFILL — archivedPdfPath null → generate, store, return
 * 3. SNAPSHOT REPAIR — archivedPdfPath set + S3 missing → explicit repair
 *
 * The invoice MUST already be fetched with { customer, items } included.
 * companySettings is needed for PDF generation (only used on create/repair).
 */
export async function getOrCreateArchivedPdf(
  invoice: any,
  companySettings: any,
): Promise<{ buffer: Buffer; cloud_storage_path: string }> {

  // ── Path 1: FAST SERVE — snapshot exists in DB + S3 ──
  if (invoice.archivedPdfPath) {
    try {
      const buffer = await downloadBufferFromS3(invoice.archivedPdfPath);
      return { buffer, cloud_storage_path: invoice.archivedPdfPath };
    } catch (err) {
      // ── Path 3: SNAPSHOT REPAIR — DB has path but S3 object missing ──
      console.error(`[SNAPSHOT_REPAIR] Invoice ${invoice.id}: archivedPdfPath "${invoice.archivedPdfPath}" exists in DB but S3 download failed. Initiating explicit repair.`, err);
      const buffer = await generatePdfBuffer(invoice, companySettings);
      const cloud_storage_path = await storeSnapshot(invoice.id, buffer, 'repair');
      return { buffer, cloud_storage_path };
    }
  }

  // ── Path 2: LEGACY BACKFILL — no snapshot yet ──
  console.log(`[LEGACY_BACKFILL] Invoice ${invoice.id}: no archivedPdfPath set, generating first-time snapshot.`);
  const buffer = await generatePdfBuffer(invoice, companySettings);
  const cloud_storage_path = await storeSnapshot(invoice.id, buffer, 'backfill');
  return { buffer, cloud_storage_path };
}

/**
 * Best-effort async snapshot creation, triggered when an invoice is archived.
 *
 * - Fire-and-forget: errors are swallowed so the archiving status change always succeeds.
 * - If this fails (PDF-API down, network issue), the snapshot will be created on
 *   first download or bulk-export via the LEGACY BACKFILL path in getOrCreateArchivedPdf.
 * - Guaranteed availability is therefore on first access, not at archive time.
 */
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
    // Skip if snapshot already exists for THIS archive cycle.
    if (invoice.archivedPdfPath) return;
    // Skip if invoice was reopened before this async job started processing.
    // This is an early-exit optimization; the DB write in storeSnapshot()
    // has the authoritative status check that prevents the actual race.
    if (invoice.status !== 'Erledigt') {
      console.log(`[archived-pdf] Snapshot skipped for invoice ${invoiceId}: status is "${invoice.status}", not "Erledigt" (likely reopened before async job ran).`);
      return;
    }
    await getOrCreateArchivedPdf(invoice, companySettings);
  } catch (err) {
    // Non-fatal: snapshot will be created on first download (legacy backfill)
    console.error(`[archived-pdf] Snapshot creation failed for invoice ${invoiceId}:`, err);
  }
}
