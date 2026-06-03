export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireUserId, handleAuthError, getSessionUser } from '@/lib/get-session';
import { logAuditAsync } from '@/lib/audit';

const CONFIRM_TEXT = 'ECHTSTART';
const CUSTOMER_COUNTER_NAME = 'customer:global';

function isCompleteCustomer(customer: any): boolean {
  return Boolean(
    String(customer?.name || '').trim() &&
    String(customer?.address || '').trim() &&
    String(customer?.plz || '').trim() &&
    String(customer?.city || '').trim()
  );
}

function customerNumberSeq(value: string | null | undefined): number | null {
  const match = String(value || '').trim().match(/^K-(\d+)$/i);
  if (!match) return null;
  const n = Number.parseInt(match[1], 10);
  return Number.isFinite(n) ? n : null;
}

async function getSettings(userId: string) {
  return prisma.companySettings.findFirst({ where: { userId } });
}

async function buildPreview(userId: string) {
  const settings = await getSettings(userId);

  const [
    activeOrders,
    trashedOrders,
    activeOffers,
    trashedOffers,
    activeInvoices,
    trashedInvoices,
    activeCustomers,
    draftCustomers,
    trashedCustomers,
    testOffers,
    testInvoices,
    liveOffers,
    liveInvoices,
    customers,
  ] = await Promise.all([
    prisma.order.count({ where: { userId, deletedAt: null } }),
    prisma.order.count({ where: { userId, deletedAt: { not: null } } }),
    prisma.offer.count({ where: { userId, deletedAt: null } }),
    prisma.offer.count({ where: { userId, deletedAt: { not: null } } }),
    prisma.invoice.count({ where: { userId, deletedAt: null } }),
    prisma.invoice.count({ where: { userId, deletedAt: { not: null } } }),
    prisma.customer.count({ where: { userId, deletedAt: null, customerNumber: { not: null } } }),
    prisma.customer.count({ where: { userId, deletedAt: null, customerNumber: null } }),
    prisma.customer.count({ where: { userId, deletedAt: { not: null } } }),
    prisma.offer.count({ where: { userId, offerNumber: { startsWith: 'TEST-' } } }),
    prisma.invoice.count({ where: { userId, invoiceNumber: { startsWith: 'TEST-' } } }),
    prisma.offer.count({ where: { userId, NOT: { offerNumber: { startsWith: 'TEST-' } } } }),
    prisma.invoice.count({ where: { userId, NOT: { invoiceNumber: { startsWith: 'TEST-' } } } }),
    prisma.customer.findMany({
      where: { userId, deletedAt: null, customerNumber: { not: null } },
      orderBy: [{ customerNumber: 'asc' }, { name: 'asc' }],
      include: {
        _count: {
          select: {
            orders: true,
            offers: true,
            invoices: true,
            executionAddresses: true,
          },
        },
      },
    }),
  ]);

  const customerRows = customers.map((customer: any) => ({
    id: customer.id,
    customerNumber: customer.customerNumber,
    name: customer.name,
    address: customer.address,
    plz: customer.plz,
    city: customer.city,
    phone: customer.phone,
    email: customer.email,
    canKeep: isCompleteCustomer(customer),
    counts: {
      orders: customer?._count?.orders ?? 0,
      offers: customer?._count?.offers ?? 0,
      invoices: customer?._count?.invoices ?? 0,
      executionAddresses: customer?._count?.executionAddresses ?? 0,
    },
  }));

  const warnings: string[] = [];
  if (!settings?.testModus) warnings.push('Echter Betrieb ist bereits aktiv. Vorbereitung ist nur im Testmodus möglich.');
  if (liveOffers > 0 || liveInvoices > 0) {
    warnings.push('Es existieren bereits Dokumente ohne TEST-Prefix. Vor dem Neu-Start bitte prüfen, ob das echte Daten sind.');
  }
  if (draftCustomers > 0) warnings.push('Es gibt Kundenentwürfe ohne Kundennummer. Diese werden beim Echtstart entfernt, wenn sie nicht vorher vervollständigt werden.');

  return {
    testModus: settings?.testModus ?? true,
    counts: {
      activeOrders,
      trashedOrders,
      activeOffers,
      trashedOffers,
      activeInvoices,
      trashedInvoices,
      activeCustomers,
      draftCustomers,
      trashedCustomers,
      testOffers,
      testInvoices,
      liveOffers,
      liveInvoices,
    },
    customers: customerRows,
    warnings,
  };
}

export async function GET() {
  try {
    let userId: string;
    try {
      userId = await requireUserId();
    } catch (e) {
      return handleAuthError(e);
    }

    const preview = await buildPreview(userId);
    return NextResponse.json(preview);
  } catch (error: any) {
    console.error('GET /api/settings/prepare-live error:', error);
    return NextResponse.json({ error: 'Vorschau konnte nicht geladen werden.' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    let userId: string;
    try {
      userId = await requireUserId();
    } catch (e) {
      return handleAuthError(e);
    }

    const body = await request.json().catch(() => ({}));
    const confirmText = String(body?.confirmText || '').trim();
    const rawKeepCustomerIds: unknown[] = Array.isArray(body?.keepCustomerIds)
      ? body.keepCustomerIds
      : [];
    const keepCustomerIds: string[] = Array.from(
      new Set<string>(
        rawKeepCustomerIds
          .map((id: unknown) => String(id || '').trim())
          .filter((id: string) => id.length > 0)
      )
    );

    if (confirmText !== CONFIRM_TEXT) {
      return NextResponse.json({ error: `Bitte exakt ${CONFIRM_TEXT} bestätigen.` }, { status: 400 });
    }

    const settings = await getSettings(userId);
    if (!settings?.testModus) {
      return NextResponse.json({ error: 'Echter Betrieb ist bereits aktiv.' }, { status: 409 });
    }

    const keepCustomers = keepCustomerIds.length > 0
      ? await prisma.customer.findMany({
          where: { id: { in: keepCustomerIds }, userId, deletedAt: null },
          orderBy: [{ customerNumber: 'asc' }, { name: 'asc' }],
        })
      : [];

    if (keepCustomers.length !== keepCustomerIds.length) {
      return NextResponse.json({ error: 'Mindestens ein ausgewählter Kunde wurde nicht gefunden.' }, { status: 404 });
    }

    const incompleteKeep = keepCustomers.find((customer: any) => !isCompleteCustomer(customer));
    if (incompleteKeep) {
      return NextResponse.json({ error: `Kunde „${incompleteKeep.name || incompleteKeep.id}“ ist unvollständig und kann nicht übernommen werden.` }, { status: 409 });
    }

    const targetNumbers = keepCustomers.map((_: any, index: number) => `K-${String(index + 1).padStart(3, '0')}`);
    if (targetNumbers.length > 0) {
      const conflicts = await prisma.customer.findMany({
        where: {
          customerNumber: { in: targetNumbers },
          NOT: { id: { in: keepCustomerIds } },
        },
        select: { id: true, customerNumber: true, name: true },
      });
      if (conflicts.length > 0) {
        return NextResponse.json({
          error: 'Kundennummern können nicht ab K-001 neu vergeben werden, weil diese Nummern in der Datenbank bereits von anderen Kunden belegt sind.',
          conflicts,
        }, { status: 409 });
      }
    }

    const result = await prisma.$transaction(async (tx: any) => {
      const allOrderIds = (await tx.order.findMany({ where: { userId }, select: { id: true } })).map((row: any) => row.id);
      const allOfferIds = (await tx.offer.findMany({ where: { userId }, select: { id: true } })).map((row: any) => row.id);
      const allInvoiceIds = (await tx.invoice.findMany({ where: { userId }, select: { id: true } })).map((row: any) => row.id);

      const deletedOrderItems = allOrderIds.length > 0
        ? await tx.orderItem.deleteMany({ where: { orderId: { in: allOrderIds } } })
        : { count: 0 };
      const deletedOrderWorkSites = allOrderIds.length > 0
        ? await tx.orderWorkSite.deleteMany({ where: { orderId: { in: allOrderIds } } })
        : { count: 0 };
      const deletedOrders = await tx.order.deleteMany({ where: { userId } });

      const deletedInvoiceItems = allInvoiceIds.length > 0
        ? await tx.invoiceItem.deleteMany({ where: { invoiceId: { in: allInvoiceIds } } })
        : { count: 0 };
      const deletedInvoices = await tx.invoice.deleteMany({ where: { userId } });

      const deletedOfferItems = allOfferIds.length > 0
        ? await tx.offerItem.deleteMany({ where: { offerId: { in: allOfferIds } } })
        : { count: 0 };
      const deletedOffers = await tx.offer.deleteMany({ where: { userId } });

      const customersToDelete = (await tx.customer.findMany({
        where: keepCustomerIds.length > 0
          ? { userId, id: { notIn: keepCustomerIds } }
          : { userId },
        select: { id: true },
      })).map((row: any) => row.id);

      const deletedExecutionAddresses = customersToDelete.length > 0
        ? await tx.customerExecutionAddress.deleteMany({ where: { customerId: { in: customersToDelete } } })
        : { count: 0 };
      const deletedCustomers = customersToDelete.length > 0
        ? await tx.customer.deleteMany({ where: { id: { in: customersToDelete }, userId } })
        : { count: 0 };

      if (keepCustomerIds.length > 0) {
        await tx.customer.updateMany({ where: { id: { in: keepCustomerIds }, userId }, data: { customerNumber: null, deletedAt: null } });
      }

      for (let index = 0; index < keepCustomers.length; index++) {
        await tx.customer.update({
          where: { id: keepCustomers[index].id },
          data: { customerNumber: targetNumbers[index], deletedAt: null },
        });
      }

      const allNumberedCustomers = await tx.customer.findMany({
        where: { customerNumber: { not: null } },
        select: { customerNumber: true },
      });
      const maxCustomerSeq = allNumberedCustomers.reduce((max: number, row: any) => {
        const seq = customerNumberSeq(row.customerNumber);
        return seq != null && seq > max ? seq : max;
      }, 0);

      await tx.counter.upsert({
        where: { name: CUSTOMER_COUNTER_NAME },
        update: { value: maxCustomerSeq },
        create: { name: CUSTOMER_COUNTER_NAME, value: maxCustomerSeq },
      });

      await tx.companySettings.updateMany({ where: { userId }, data: { testModus: false } });

      return {
        keptCustomers: keepCustomers.length,
        deletedCustomers: deletedCustomers.count,
        deletedExecutionAddresses: deletedExecutionAddresses.count,
        deletedOrders: deletedOrders.count,
        deletedOrderItems: deletedOrderItems.count,
        deletedOrderWorkSites: deletedOrderWorkSites.count,
        deletedOffers: deletedOffers.count,
        deletedOfferItems: deletedOfferItems.count,
        deletedInvoices: deletedInvoices.count,
        deletedInvoiceItems: deletedInvoiceItems.count,
        nextCustomerNumber: `K-${String(maxCustomerSeq + 1).padStart(3, '0')}`,
      };
    }, { timeout: 30000 });

    const su = await getSessionUser();
    logAuditAsync({
      userId: su?.id,
      userEmail: su?.email,
      userRole: su?.role,
      action: 'PREPARE_LIVE_MODE',
      area: 'SETTINGS',
      targetType: 'CompanySettings',
      details: result,
      request,
    });

    return NextResponse.json({
      success: true,
      message: `Echter Betrieb vorbereitet. ${result.keptCustomers} Kunde${result.keptCustomers === 1 ? '' : 'n'} übernommen. Nächste Kundennummer: ${result.nextCustomerNumber}.`,
      ...result,
    });
  } catch (error: any) {
    console.error('POST /api/settings/prepare-live error:', error);
    return NextResponse.json({ error: error?.message || 'Echter Betrieb konnte nicht vorbereitet werden.' }, { status: 500 });
  }
}
