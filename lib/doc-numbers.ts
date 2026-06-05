import { prisma } from '@/lib/prisma';
import { DATA_SCOPE_TEST } from '@/lib/data-scope';

/**

* Generates the next document number for offers or invoices.
* Format: TEST-ANG-YYYY-XXX  or  ANG-YYYY-XXX
* ```
      TEST-RE-YYYY-XXX   or  RE-YYYY-XXX
  ```
*
* IMPORTANT: TEST and LIVE numbering are fully separated by prefix.
* Each namespace calculates the next sequence from existing document numbers.
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

function extractSeqFromNumber(docNumber: string, prefix: string, year: number, testModus: boolean): number | null {
if (testModus) {
const regex = new RegExp(`^TEST-${prefix}-${year}-(\\d+)$`);
const match = docNumber.match(regex);
return match ? parseInt(match[1], 10) : null;
} else {
if (docNumber.startsWith('TEST-')) return null;
const regex = new RegExp(`^${prefix}-${year}-(\\d+)$`);
const match = docNumber.match(regex);
return match ? parseInt(match[1], 10) : null;
}
}

export async function generateOfferNumber(userId: string): Promise<string> {
const year = new Date().getFullYear();
const testModus = await getTestModus(userId);

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

/**
 * Moves the complete active TEST business dataset to the trash.
 *
 * Safety invariants:
 * - Only rows belonging to this user are touched.
 * - Only rows with dataScope = TEST are touched.
 * - LIVE customers, orders, offers and invoices remain unchanged.
 * - Services, company settings, counters and audit logs remain unchanged.
 * - Customer execution addresses stay attached to their soft-deleted customer,
 *   so restoring the customer also makes its addresses available again.
 * - Number counters are not reset because trashed numbers remain reserved.
 */
export type ResetTestDataResult = {
  offersReset: number;
  invoicesReset: number;
  ordersReset: number;
  customersReset: number;
};

export async function resetTestCounters(userId: string): Promise<ResetTestDataResult> {
  const testModus = await getTestModus(userId);
  if (!testModus) {
    throw new Error('Testdaten können nur im Testmodus in den Papierkorb verschoben werden');
  }

  const now = new Date();

  return prisma.$transaction(
    async (tx: any) => {
      // Soft-delete every active TEST document, including free-standing orders.
      const ordersResult = await tx.order.updateMany({
        where: {
          userId,
          dataScope: DATA_SCOPE_TEST,
          deletedAt: null,
        },
        data: { deletedAt: now },
      });

      const offersResult = await tx.offer.updateMany({
        where: {
          userId,
          dataScope: DATA_SCOPE_TEST,
          deletedAt: null,
        },
        data: { deletedAt: now },
      });

      const invoicesResult = await tx.invoice.updateMany({
        where: {
          userId,
          dataScope: DATA_SCOPE_TEST,
          deletedAt: null,
        },
        data: { deletedAt: now },
      });

      // Customers are soft-deleted only after their TEST documents were moved.
      // Their execution addresses remain linked and are hidden with the customer.
      const customersResult = await tx.customer.updateMany({
        where: {
          userId,
          dataScope: DATA_SCOPE_TEST,
          deletedAt: null,
        },
        data: { deletedAt: now },
      });

      return {
        offersReset: offersResult.count,
        invoicesReset: invoicesResult.count,
        ordersReset: ordersResult.count,
        customersReset: customersResult.count,
      };
    },
    { timeout: 20000 },
  );
}
