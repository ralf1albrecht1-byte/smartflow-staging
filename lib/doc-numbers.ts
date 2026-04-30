import { prisma } from '@/lib/prisma';

/**
 * Generates the next document number for offers or invoices.
 * Format: TEST-ANG-YYYY-XXX  or  ANG-YYYY-XXX
 *         TEST-RE-YYYY-XXX   or  RE-YYYY-XXX
 *
 * IMPORTANT: TEST and LIVE numbering are fully separated.
 * Each has its own independent sequence counter.
 *
 * `invoiceNumber` and `offerNumber` carry a GLOBAL @unique constraint
 * in the DB schema.  The sequence scan must therefore cover ALL rows
 * (not just the current user's) to avoid P2002 collisions when multiple
 * tenants share the same numbering namespace.
 *
 * The `userId` parameter is still needed to look up `testModus`.
 */

async function getTestModus(userId: string): Promise<boolean> {
  try {
    const settings = await prisma.companySettings.findFirst({ where: { userId } });
    return settings?.testModus ?? true;
  } catch {
    return true;
  }
}

/**
 * Extracts the sequence number from a document number.
 * Uses EXACT prefix matching — TEST and LIVE are separate namespaces.
 *
 * testModus=true  → matches only "TEST-ANG-2026-001"
 * testModus=false → matches only "ANG-2026-001" (must NOT start with TEST-)
 */
function extractSeqFromNumber(docNumber: string, prefix: string, year: number, testModus: boolean): number | null {
  if (testModus) {
    // Match exactly TEST-PREFIX-YEAR-SEQ
    const regex = new RegExp(`^TEST-${prefix}-${year}-(\\d+)$`);
    const match = docNumber.match(regex);
    return match ? parseInt(match[1], 10) : null;
  } else {
    // Match exactly PREFIX-YEAR-SEQ, must NOT start with TEST-
    if (docNumber.startsWith('TEST-')) return null;
    const regex = new RegExp(`^${prefix}-${year}-(\\d+)$`);
    const match = docNumber.match(regex);
    return match ? parseInt(match[1], 10) : null;
  }
}

export async function generateOfferNumber(userId: string): Promise<string> {
  const year = new Date().getFullYear();
  const testModus = await getTestModus(userId);

  // Scan ALL offers globally — offerNumber has a global @unique constraint.
  const offers = await prisma.offer.findMany({
    select: { offerNumber: true },
  });

  let maxSeq = 0;
  for (const o of offers) {
    const seq = extractSeqFromNumber(o.offerNumber, 'ANG', year, testModus);
    if (seq != null && seq > maxSeq) maxSeq = seq;
  }

  const nextSeq = maxSeq + 1;
  const seqStr = String(nextSeq).padStart(3, '0');
  return testModus ? `TEST-ANG-${year}-${seqStr}` : `ANG-${year}-${seqStr}`;
}

export async function generateInvoiceNumber(userId: string): Promise<string> {
  const year = new Date().getFullYear();
  const testModus = await getTestModus(userId);

  // Scan ALL invoices globally — invoiceNumber has a global @unique constraint.
  const invoices = await prisma.invoice.findMany({
    select: { invoiceNumber: true },
  });

  let maxSeq = 0;
  for (const i of invoices) {
    const seq = extractSeqFromNumber(i.invoiceNumber, 'RE', year, testModus);
    if (seq != null && seq > maxSeq) maxSeq = seq;
  }

  const nextSeq = maxSeq + 1;
  const seqStr = String(nextSeq).padStart(3, '0');
  return testModus ? `TEST-RE-${year}-${seqStr}` : `RE-${year}-${seqStr}`;
}

export async function resetTestCounters(userId: string): Promise<{ offersReset: number; invoicesReset: number; ordersReset: number }> {
  const testModus = await getTestModus(userId);
  if (!testModus) {
    throw new Error('Reset nur im Testmodus erlaubt');
  }

  const now = new Date();

  // Step 1: Soft-delete active TEST offers
  const offersResult = await prisma.offer.updateMany({
    where: {
      offerNumber: { startsWith: 'TEST-' },
      deletedAt: null,
      userId,
    },
    data: { deletedAt: now },
  });

  // Step 2: Soft-delete active TEST invoices
  const invoicesResult = await prisma.invoice.updateMany({
    where: {
      invoiceNumber: { startsWith: 'TEST-' },
      deletedAt: null,
      userId,
    },
    data: { deletedAt: now },
  });

  // Step 3: Soft-delete orders linked to TEST offers or TEST invoices.
  // Orders have no own number field, so we identify them by their FK link
  // to a TEST document (any TEST offer/invoice, including just-trashed ones).
  const testOfferIds = (await prisma.offer.findMany({
    where: { offerNumber: { startsWith: 'TEST-' }, userId },
    select: { id: true },
  })).map(o => o.id);

  const testInvoiceIds = (await prisma.invoice.findMany({
    where: { invoiceNumber: { startsWith: 'TEST-' }, userId },
    select: { id: true },
  })).map(i => i.id);

  let ordersReset = 0;
  if (testOfferIds.length > 0) {
    const r = await prisma.order.updateMany({
      where: { offerId: { in: testOfferIds }, deletedAt: null, userId },
      data: { deletedAt: now },
    });
    ordersReset += r.count;
  }
  if (testInvoiceIds.length > 0) {
    const r = await prisma.order.updateMany({
      where: { invoiceId: { in: testInvoiceIds }, deletedAt: null, userId },
      data: { deletedAt: now },
    });
    ordersReset += r.count;
  }

  // No explicit counter reset needed — the next TEST number is derived from
  // MAX(seq) across all existing TEST docs. Once they're all trashed/deleted,
  // the next TEST document will automatically start at 001.

  return {
    offersReset: offersResult.count,
    invoicesReset: invoicesResult.count,
    ordersReset,
  };
}
