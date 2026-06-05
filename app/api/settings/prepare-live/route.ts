export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireUserId, handleAuthError, getSessionUser } from '@/lib/get-session';
import { logAuditAsync } from '@/lib/audit';
import { DATA_SCOPE_LIVE, DATA_SCOPE_TEST } from '@/lib/data-scope';

const CONFIRM_TEXT = 'ECHTSTART';
const REPAIR_CONFIRM_TEXT = 'LIVE_REPARATUR';
const LIVE_STARTED_COUNTER_PREFIX = 'live-started:';

function isCompleteCustomer(customer: any): boolean {
  return Boolean(
    String(customer?.name || '').trim() &&
    String(customer?.address || '').trim() &&
    String(customer?.plz || '').trim() &&
    String(customer?.city || '').trim(),
  );
}

function liveStartedCounterName(userId: string): string {
  return `${LIVE_STARTED_COUNTER_PREFIX}${userId}`;
}

function customerCounterName(userId: string): string {
  return `customer:${userId}:live`;
}

async function getSettings(userId: string) {
  return prisma.companySettings.findFirst({ where: { userId } });
}

/**
 * Der Livebetrieb gilt als gestartet, wenn entweder der dauerhafte Start-Marker
 * existiert oder bereits irgendein LIVE-Datensatz vorhanden ist.
 *
 * Die Datenprüfung ist ein Sicherheits-Fallback für ältere Bestände, bei denen
 * der Marker eventuell noch nicht existiert. Dadurch kann ein vorhandener
 * Livebestand niemals versehentlich erneut initialisiert oder überschrieben
 * werden.
 */
async function hasLiveStarted(userId: string): Promise<boolean> {
  const [marker, liveCustomer, liveOrder, liveOffer, liveInvoice] = await Promise.all([
    prisma.counter.findUnique({
      where: { name: liveStartedCounterName(userId) },
      select: { id: true },
    }),
    prisma.customer.findFirst({
      where: { userId, dataScope: DATA_SCOPE_LIVE },
      select: { id: true },
    }),
    prisma.order.findFirst({
      where: { userId, dataScope: DATA_SCOPE_LIVE },
      select: { id: true },
    }),
    prisma.offer.findFirst({
      where: { userId, dataScope: DATA_SCOPE_LIVE },
      select: { id: true },
    }),
    prisma.invoice.findFirst({
      where: { userId, dataScope: DATA_SCOPE_LIVE },
      select: { id: true },
    }),
  ]);

  return Boolean(marker || liveCustomer || liveOrder || liveOffer || liveInvoice);
}

async function buildPreview(userId: string) {
  const settings = await getSettings(userId);
  const liveStarted = await hasLiveStarted(userId);

  const [
    testCustomers,
    liveCustomers,
    testOrders,
    liveOrders,
    testOffers,
    liveOffers,
    testInvoices,
    liveInvoices,
  ] = await Promise.all([
    prisma.customer.findMany({
      where: { userId, dataScope: DATA_SCOPE_TEST, deletedAt: null, customerNumber: { not: null } },
      orderBy: [{ customerNumber: 'asc' }, { name: 'asc' }],
      include: {
        _count: {
          select: {
            orders: { where: { dataScope: DATA_SCOPE_TEST, deletedAt: null } },
            offers: { where: { dataScope: DATA_SCOPE_TEST, deletedAt: null } },
            invoices: { where: { dataScope: DATA_SCOPE_TEST, deletedAt: null } },
            executionAddresses: { where: { deletedAt: null } },
          },
        },
      },
    }),
    prisma.customer.count({ where: { userId, dataScope: DATA_SCOPE_LIVE, deletedAt: null } }),
    prisma.order.count({ where: { userId, dataScope: DATA_SCOPE_TEST, deletedAt: null } }),
    prisma.order.count({ where: { userId, dataScope: DATA_SCOPE_LIVE, deletedAt: null } }),
    prisma.offer.count({ where: { userId, dataScope: DATA_SCOPE_TEST, deletedAt: null } }),
    prisma.offer.count({ where: { userId, dataScope: DATA_SCOPE_LIVE, deletedAt: null } }),
    prisma.invoice.count({ where: { userId, dataScope: DATA_SCOPE_TEST, deletedAt: null } }),
    prisma.invoice.count({ where: { userId, dataScope: DATA_SCOPE_LIVE, deletedAt: null } }),
  ]);

  const customers = testCustomers.map((customer: any) => ({
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

  /**
   * WICHTIG:
   * Ein beim ersten Echtstart bewusst leer gelassener Kundenbestand ist gültig
   * und darf NICHT als beschädigter Livebestand behandelt werden.
   *
   * Der frühere Ausdruck
   *   liveStarted && liveCustomers === 0
   * öffnete beim zweiten Wechsel fälschlich erneut die Kundenauswahl.
   *
   * Eine Live-Reparatur darf nur ausdrücklich und separat ausgelöst werden,
   * niemals automatisch allein aufgrund von 0 aktiven Live-Kunden.
   */
  const liveNeedsRepair = false;

  const warnings: string[] = [];
  if (liveStarted && liveCustomers === 0) {
    warnings.push(
      'Der Livebetrieb wurde bereits gestartet und enthält aktuell keine aktiven Live-Kunden. Das ist zulässig. Die einmalige Kundenübernahme bleibt abgeschlossen und gesperrt.',
    );
  } else if (liveStarted) {
    warnings.push(
      'Der Livebetrieb wurde bereits gestartet. Bestehende Live-Daten werden beim normalen Moduswechsel nicht verändert.',
    );
  }

  return {
    testModus: settings?.testModus ?? true,
    liveStarted,
    liveNeedsRepair,
    counts: {
      testCustomers: testCustomers.length,
      liveCustomers,
      testOrders,
      liveOrders,
      testOffers,
      liveOffers,
      testInvoices,
      liveInvoices,
    },
    customers,
    warnings,
  };
}

export async function GET() {
  try {
    let userId: string;
    try {
      userId = await requireUserId();
    } catch (error) {
      return handleAuthError(error);
    }
    return NextResponse.json(await buildPreview(userId));
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
    } catch (error) {
      return handleAuthError(error);
    }

    const body = await request.json().catch(() => ({}));
    const confirmText = String(body?.confirmText || '').trim();
    const repairExistingLive = body?.repairExistingLive === true;
    const keepCustomerIds = Array.from(
      new Set<string>(
        (Array.isArray(body?.keepCustomerIds) ? body.keepCustomerIds : [])
          .map((id: unknown) => String(id || '').trim())
          .filter(Boolean),
      ),
    );

    if (repairExistingLive) {
      if (confirmText !== REPAIR_CONFIRM_TEXT) {
        return NextResponse.json(
          { error: `Für die Live-Reparatur bitte exakt ${REPAIR_CONFIRM_TEXT} bestätigen.` },
          { status: 400 },
        );
      }
      if (keepCustomerIds.length === 0) {
        return NextResponse.json(
          { error: 'Für die Live-Reparatur muss mindestens ein TEST-Kunde ausgewählt werden.' },
          { status: 400 },
        );
      }
    } else if (confirmText !== CONFIRM_TEXT) {
      return NextResponse.json(
        { error: `Bitte exakt ${CONFIRM_TEXT} bestätigen.` },
        { status: 400 },
      );
    }

    const settings = await getSettings(userId);
    const liveStarted = await hasLiveStarted(userId);

    if (repairExistingLive && !liveStarted) {
      return NextResponse.json(
        { error: 'LIVE_REPARATUR ist nur bei bereits gestartetem Livebetrieb möglich.' },
        { status: 409 },
      );
    }
    if (liveStarted && !repairExistingLive) {
      return NextResponse.json(
        {
          error:
            'Der Livebetrieb wurde bereits gestartet. Die einmalige Kundenübernahme ist abgeschlossen und gesperrt.',
        },
        { status: 409 },
      );
    }
    if (!repairExistingLive && !settings?.testModus) {
      return NextResponse.json({ error: 'Der Livebetrieb ist bereits aktiv.' }, { status: 409 });
    }

    const testCustomers = await prisma.customer.findMany({
      where: {
        id: { in: keepCustomerIds },
        userId,
        dataScope: DATA_SCOPE_TEST,
        deletedAt: null,
      },
      include: {
        executionAddresses: { where: { deletedAt: null }, orderBy: { createdAt: 'asc' } },
      },
      orderBy: [{ customerNumber: 'asc' }, { name: 'asc' }],
    });

    if (testCustomers.length !== keepCustomerIds.length) {
      return NextResponse.json(
        { error: 'Mindestens ein ausgewählter TEST-Kunde wurde nicht gefunden.' },
        { status: 404 },
      );
    }

    const incomplete = testCustomers.find((customer: any) => !isCompleteCustomer(customer));
    if (incomplete) {
      return NextResponse.json(
        {
          error: `Kunde „${incomplete.name || incomplete.id}“ ist unvollständig und kann nicht übernommen werden.`,
        },
        { status: 409 },
      );
    }

    const result = await prisma.$transaction(async (tx: any) => {
      // Eine Reparatur ist ausschließlich innerhalb des LIVE-Scopes destruktiv.
      // TEST-Zeilen werden niemals geändert oder gelöscht.
      const liveOrderIds = (
        await tx.order.findMany({
          where: { userId, dataScope: DATA_SCOPE_LIVE },
          select: { id: true },
        })
      ).map((row: any) => row.id);

      const liveOfferIds = (
        await tx.offer.findMany({
          where: { userId, dataScope: DATA_SCOPE_LIVE },
          select: { id: true },
        })
      ).map((row: any) => row.id);

      const liveInvoiceIds = (
        await tx.invoice.findMany({
          where: { userId, dataScope: DATA_SCOPE_LIVE },
          select: { id: true },
        })
      ).map((row: any) => row.id);

      const liveCustomerIds = (
        await tx.customer.findMany({
          where: { userId, dataScope: DATA_SCOPE_LIVE },
          select: { id: true },
        })
      ).map((row: any) => row.id);

      if (liveOrderIds.length > 0) {
        await tx.orderItem.deleteMany({ where: { orderId: { in: liveOrderIds } } });
        await tx.orderWorkSite.deleteMany({ where: { orderId: { in: liveOrderIds } } });
        await tx.order.deleteMany({
          where: { id: { in: liveOrderIds }, userId, dataScope: DATA_SCOPE_LIVE },
        });
      }

      if (liveInvoiceIds.length > 0) {
        await tx.invoiceItem.deleteMany({ where: { invoiceId: { in: liveInvoiceIds } } });
        await tx.invoice.deleteMany({
          where: { id: { in: liveInvoiceIds }, userId, dataScope: DATA_SCOPE_LIVE },
        });
      }

      if (liveOfferIds.length > 0) {
        await tx.offerItem.deleteMany({ where: { offerId: { in: liveOfferIds } } });
        await tx.offer.deleteMany({
          where: { id: { in: liveOfferIds }, userId, dataScope: DATA_SCOPE_LIVE },
        });
      }

      if (liveCustomerIds.length > 0) {
        await tx.customerExecutionAddress.deleteMany({
          where: { customerId: { in: liveCustomerIds } },
        });
        await tx.customer.deleteMany({
          where: { id: { in: liveCustomerIds }, userId, dataScope: DATA_SCOPE_LIVE },
        });
      }

      const copiedCustomers: Array<{ id: string; customerNumber: string; name: string }> = [];

      for (let index = 0; index < testCustomers.length; index += 1) {
        const source: any = testCustomers[index];
        const customerNumber = `K-${String(index + 1).padStart(3, '0')}`;

        const created = await tx.customer.create({
          data: {
            customerNumber,
            dataScope: DATA_SCOPE_LIVE,
            name: source.name,
            address: source.address,
            plz: source.plz,
            city: source.city,
            country: source.country || 'CH',
            phone: source.phone,
            email: source.email,
            notes: source.notes,
            userId,
          },
        });

        for (const address of source.executionAddresses || []) {
          await tx.customerExecutionAddress.create({
            data: {
              customerId: created.id,
              userId,
              siteName: address.siteName,
              siteAddress: address.siteAddress,
              sitePlz: address.sitePlz,
              siteCity: address.siteCity,
              siteNote: address.siteNote,
              country: address.country || 'CH',
              usageCount: address.usageCount || 1,
              lastUsedAt: address.lastUsedAt || new Date(),
            },
          });
        }

        copiedCustomers.push({
          id: created.id,
          customerNumber,
          name: created.name,
        });
      }

      await tx.counter.upsert({
        where: { name: customerCounterName(userId) },
        update: { value: copiedCustomers.length },
        create: { name: customerCounterName(userId), value: copiedCustomers.length },
      });

      await tx.counter.upsert({
        where: { name: liveStartedCounterName(userId) },
        update: { value: 1 },
        create: { name: liveStartedCounterName(userId), value: 1 },
      });

      const companySettings = await tx.companySettings.findFirst({
        where: { userId },
        select: { id: true },
      });

      if (companySettings) {
        await tx.companySettings.update({
          where: { id: companySettings.id },
          data: { testModus: false },
        });
      } else {
        await tx.companySettings.create({
          data: { userId, testModus: false },
        });
      }

      return {
        mode: repairExistingLive ? 'repair' : 'start',
        copiedCustomers,
        removedLive: {
          customers: liveCustomerIds.length,
          orders: liveOrderIds.length,
          offers: liveOfferIds.length,
          invoices: liveInvoiceIds.length,
        },
        nextCustomerNumber: `K-${String(copiedCustomers.length + 1).padStart(3, '0')}`,
      };
    }, { timeout: 30000 });

    const su = await getSessionUser();
    logAuditAsync({
      userId: su?.id,
      userEmail: su?.email,
      userRole: su?.role,
      action: result.mode === 'repair' ? 'REPAIR_LIVE_SCOPE' : 'CREATE_LIVE_SCOPE',
      area: 'SETTINGS',
      targetType: 'CompanySettings',
      details: result,
      request,
    });

    return NextResponse.json({
      success: true,
      message:
        result.mode === 'repair'
          ? `Livebestand sicher neu aufgebaut. ${result.copiedCustomers.length} Kunde${
              result.copiedCustomers.length === 1 ? '' : 'n'
            } kopiert; TEST-Daten blieben unverändert.`
          : result.copiedCustomers.length === 0
            ? 'Livebetrieb ohne Kunden gestartet. TEST-Daten blieben vollständig unverändert.'
            : `Livebetrieb vorbereitet. ${result.copiedCustomers.length} Kunde${
                result.copiedCustomers.length === 1 ? '' : 'n'
              } kopiert; keine TEST-Aufträge oder Belege wurden übernommen.`,
      ...result,
    });
  } catch (error: any) {
    console.error('POST /api/settings/prepare-live error:', error);
    return NextResponse.json(
      { error: error?.message || 'Livebetrieb konnte nicht vorbereitet werden.' },
      { status: 500 },
    );
  }
}
