import { prisma } from '@/lib/prisma';

/**
 * Generates the next document number for offers or invoices.
 * Format: [TEST-]ANG-YYYY-XXX or [TEST-]RE-YYYY-XXX
 *
 * IMPORTANT: `invoiceNumber` and `offerNumber` carry a GLOBAL @unique
 * constraint in the DB schema.  The sequence scan must therefore cover
 * ALL rows (not just the current user's) to avoid P2002 collisions when
 * multiple tenants share the same numbering namespace.
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

function extractSeqFromNumber(docNumber: string, prefix: string, year: number): number | null {
  const regex = new RegExp(`(?:TEST-)?${prefix}-${year}-(\\d+)$`);
  const match = docNumber.match(regex);
  if (match) return parseInt(match[1], 10);
  return null;
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
    const seq = extractSeqFromNumber(o.offerNumber, 'ANG', year);
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
    const seq = extractSeqFromNumber(i.invoiceNumber, 'RE', year);
    if (seq != null && seq > maxSeq) maxSeq = seq;
  }

  const nextSeq = maxSeq + 1;
  const seqStr = String(nextSeq).padStart(3, '0');
  return testModus ? `TEST-RE-${year}-${seqStr}` : `RE-${year}-${seqStr}`;
}

export async function resetTestCounters(userId: string): Promise<{ offersReset: number; invoicesReset: number }> {
  const testModus = await getTestModus(userId);
  if (!testModus) {
    throw new Error('Reset nur im Testmodus erlaubt');
  }
  
  const offersResult = await prisma.offer.updateMany({
    where: {
      offerNumber: { startsWith: 'TEST-' },
      deletedAt: null,
      userId,
    },
    data: { deletedAt: new Date() },
  });
  
  const invoicesResult = await prisma.invoice.updateMany({
    where: {
      invoiceNumber: { startsWith: 'TEST-' },
      deletedAt: null,
      userId,
    },
    data: { deletedAt: new Date() },
  });
  
  return {
    offersReset: offersResult.count,
    invoicesReset: invoicesResult.count,
  };
}
