import { prisma } from '@/lib/prisma';

/**

* Generates the next document number for offers or invoices.
* Format: TEST-ANG-YYYY-XXX  or  ANG-YYYY-XXX
* ```
      TEST-RE-YYYY-XXX   or  RE-YYYY-XXX
  ```
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

export async function resetTestCounters(userId: string): Promise<{ offersReset: number; invoicesReset: number; ordersReset: number }> {
const testModus = await getTestModus(userId);
if (!testModus) {
throw new Error('Reset nur im Testmodus erlaubt');
}

const now = new Date();

const offersResult = await prisma.offer.updateMany({
where: {
offerNumber: { startsWith: 'TEST-' },
deletedAt: null,
userId,
},
data: { deletedAt: now },
});

const invoicesResult = await prisma.invoice.updateMany({
where: {
invoiceNumber: { startsWith: 'TEST-' },
deletedAt: null,
userId,
},
data: { deletedAt: now },
});

const testOfferIds = (await prisma.offer.findMany({
where: { offerNumber: { startsWith: 'TEST-' }, userId },
select: { id: true },
})).map((o: { id: string }) => o.id);

const testInvoiceIds = (await prisma.invoice.findMany({
where: { invoiceNumber: { startsWith: 'TEST-' }, userId },
select: { id: true },
})).map((i: { id: string }) => i.id);

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

return {
offersReset: offersResult.count,
invoicesReset: invoicesResult.count,
ordersReset,
};
}
