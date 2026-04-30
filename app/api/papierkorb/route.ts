export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireUserId, unauthorizedResponse, getSessionUser } from '@/lib/get-session';
import { logAuditAsync } from '@/lib/audit';
import { getCustomerDeleteBlockerCounts, isCustomerDeleteBlocked, formatCustomerDeleteBlockerMessage } from '@/lib/customer-links';

// GET: Fetch all soft-deleted items for the current user
export async function GET() {
  try {
    let userId: string;
    try { userId = await requireUserId(); } catch { return unauthorizedResponse(); }

    // Auto-cleanup: delete items older than 6 months (strict FK-safe order)
    // Same strategy as "empty": collect linked orders via offerId/invoiceId,
    // delete order chains first, then offers/invoices become unblocked.
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

    const oldOrderIds = (await prisma.order.findMany({
      where: { deletedAt: { not: null, lt: sixMonthsAgo }, userId },
      select: { id: true },
    })).map((o: any) => o.id);

    const oldOfferIds = (await prisma.offer.findMany({
      where: { deletedAt: { not: null, lt: sixMonthsAgo }, userId },
      select: { id: true },
    })).map((o: any) => o.id);

    const oldInvoiceIds = (await prisma.invoice.findMany({
      where: { deletedAt: { not: null, lt: sixMonthsAgo }, userId },
      select: { id: true },
    })).map((o: any) => o.id);

    // Collect orders linked to old offers/invoices via FK
    const autoLinkedConds: any[] = [];
    if (oldOfferIds.length > 0) autoLinkedConds.push({ offerId: { in: oldOfferIds } });
    if (oldInvoiceIds.length > 0) autoLinkedConds.push({ invoiceId: { in: oldInvoiceIds } });

    let autoLinkedOrderIds: string[] = [];
    if (autoLinkedConds.length > 0) {
      autoLinkedOrderIds = (await prisma.order.findMany({
        where: { userId, OR: autoLinkedConds },
        select: { id: true },
      })).map((o: any) => o.id);
    }

    const allOldOrderIds = [...new Set([...oldOrderIds, ...autoLinkedOrderIds])];

    if (allOldOrderIds.length > 0 || oldOfferIds.length > 0 || oldInvoiceIds.length > 0) {
      await prisma.$transaction(async (tx: any) => {
        // 1. Orders first (items then orders)
        if (allOldOrderIds.length > 0) {
          await tx.orderItem.deleteMany({ where: { orderId: { in: allOldOrderIds } } });
          await tx.order.deleteMany({ where: { id: { in: allOldOrderIds }, userId } });
        }
        // 2. Invoices
        if (oldInvoiceIds.length > 0) {
          await tx.invoiceItem.deleteMany({ where: { invoiceId: { in: oldInvoiceIds } } });
          await tx.invoice.deleteMany({ where: { id: { in: oldInvoiceIds }, userId, deletedAt: { not: null } } });
        }
        // 3. Offers
        if (oldOfferIds.length > 0) {
          await tx.offerItem.deleteMany({ where: { offerId: { in: oldOfferIds } } });
          await tx.offer.deleteMany({ where: { id: { in: oldOfferIds }, userId, deletedAt: { not: null } } });
        }
      }, { timeout: 20000 });
    }

    // Auto-cleanup customers (canonical blocker check)
    const oldCustomers = await prisma.customer.findMany({
      where: { deletedAt: { not: null, lt: sixMonthsAgo }, userId },
      select: { id: true },
    });
    for (const c of oldCustomers) {
      const counts = await getCustomerDeleteBlockerCounts(prisma, c.id, userId);
      if (!isCustomerDeleteBlocked(counts)) {
        await prisma.$transaction(async (tx: any) => {
          await tx.orderItem.deleteMany({ where: { order: { customerId: c.id, userId } } });
          await tx.order.deleteMany({ where: { customerId: c.id, userId } });
          await tx.offerItem.deleteMany({ where: { offer: { customerId: c.id, userId } } });
          await tx.offer.deleteMany({ where: { customerId: c.id, userId } });
          await tx.invoiceItem.deleteMany({ where: { invoice: { customerId: c.id, userId } } });
          await tx.invoice.deleteMany({ where: { customerId: c.id, userId } });
          await tx.customer.deleteMany({ where: { id: c.id, userId, deletedAt: { not: null } } });
        }, { timeout: 15000 });
      }
    }

    const [orders, offers, invoices, customers] = await Promise.all([
      prisma.order.findMany({
        where: { deletedAt: { not: null }, userId },
        include: { customer: { select: { name: true } }, items: true },
        orderBy: { deletedAt: 'desc' },
      }),
      prisma.offer.findMany({
        where: { deletedAt: { not: null }, userId },
        include: { customer: { select: { name: true } }, items: true },
        orderBy: { deletedAt: 'desc' },
      }),
      prisma.invoice.findMany({
        where: { deletedAt: { not: null }, userId },
        include: { customer: { select: { name: true } }, items: true },
        orderBy: { deletedAt: 'desc' },
      }),
      prisma.customer.findMany({
        where: { deletedAt: { not: null }, userId },
        orderBy: { deletedAt: 'desc' },
      }),
    ]);

    return NextResponse.json({ orders, offers, invoices, customers });
  } catch (error: any) {
    console.error('Papierkorb GET error:', error);
    return NextResponse.json({ orders: [], offers: [], invoices: [], customers: [] }, { status: 500 });
  }
}

// POST: Restore or permanently delete
export async function POST(request: Request) {
  try {
    let userId: string;
    try { userId = await requireUserId(); } catch { return unauthorizedResponse(); }

    const { action, type, id } = await request.json();

    // --- HOTFIX 2026-04-18: strict trash invariant -----------------------------
    // Trash actions (restore / delete) are ONLY legal on rows that are actually
    // in trash (deletedAt IS NOT NULL) AND belong to the current user. Using
    // updateMany / deleteMany with the full guard avoids the previous bug where
    // `findFirst({ id, userId })` + `update|delete({ where: { id } })` could
    // operate on an already-active row (e.g. restored in another tab / another
    // session), producing a silent false-success and — via the adjacent mobile
    // "Wiederherstellen" / "Löschen" buttons — the illusion that a permanent-
    // delete re-activated the row. This invariant is now enforced at the DB
    // layer and makes the two intents impossible to mix.
    // -----------------------------------------------------------------------------

    if (action === 'restore') {
      if (!id || typeof id !== 'string') return NextResponse.json({ error: 'Ungültige Anfrage' }, { status: 400 });
      let affected = 0;
      try {
        switch (type) {
          case 'order': {
            const r = await prisma.order.updateMany({ where: { id, userId, deletedAt: { not: null } }, data: { deletedAt: null } });
            affected = r.count; break;
          }
          case 'offer': {
            const r = await prisma.offer.updateMany({ where: { id, userId, deletedAt: { not: null } }, data: { deletedAt: null } });
            affected = r.count; break;
          }
          case 'invoice': {
            const r = await prisma.invoice.updateMany({ where: { id, userId, deletedAt: { not: null } }, data: { deletedAt: null } });
            affected = r.count; break;
          }
          case 'customer': {
            const r = await prisma.customer.updateMany({ where: { id, userId, deletedAt: { not: null } }, data: { deletedAt: null } });
            affected = r.count; break;
          }
          default:
            return NextResponse.json({ error: 'Unbekannter Typ' }, { status: 400 });
        }
      } catch (err: any) {
        console.error('Papierkorb restore error:', err);
        return NextResponse.json({ error: 'Wiederherstellen fehlgeschlagen', code: err?.code || null }, { status: 500 });
      }
      if (affected === 0) {
        // Nothing matched: the row is not (or no longer) in trash, or does not belong to the user.
        return NextResponse.json({ error: 'Eintrag nicht im Papierkorb (bereits wiederhergestellt oder gelöscht)' }, { status: 404 });
      }
      const su = await getSessionUser();
      logAuditAsync({ userId: su?.id, userEmail: su?.email, userRole: su?.role, action: 'RESTORE', area: 'PAPIERKORB', targetType: type, targetId: id, request });
      return NextResponse.json({ success: true, message: 'Wiederhergestellt' });
    }

    if (action === 'delete') {
      if (!id || typeof id !== 'string') return NextResponse.json({ error: 'Ungültige Anfrage' }, { status: 400 });
      try {
        let deleted: Record<string, number> = {};
        switch (type) {
          case 'order': {
            // Single order: delete items → order in one transaction
            const result = await prisma.$transaction(async (tx: any) => {
              const dItems = await tx.orderItem.deleteMany({ where: { orderId: id } });
              const dOrder = await tx.order.deleteMany({ where: { id, userId, deletedAt: { not: null } } });
              return { orderItems: dItems.count, orders: dOrder.count };
            }, { timeout: 15000 });
            if (result.orders === 0) {
              return NextResponse.json({ error: 'Auftrag nicht im Papierkorb (bereits wiederhergestellt oder gelöscht). Bitte Papierkorb neu laden.' }, { status: 404 });
            }
            deleted = result;
            break;
          }
          case 'offer': {
            // Collect ALL orders linked via offerId (trashed or not), then cascade-delete everything
            const linkedOrderIds = (await prisma.order.findMany({
              where: { offerId: id, userId },
              select: { id: true },
            })).map((o: any) => o.id);

            const result = await prisma.$transaction(async (tx: any) => {
              // 1. Linked order items
              const dOrdItems = linkedOrderIds.length > 0
                ? await tx.orderItem.deleteMany({ where: { orderId: { in: linkedOrderIds } } })
                : { count: 0 };
              // 2. Linked orders
              const dOrders = linkedOrderIds.length > 0
                ? await tx.order.deleteMany({ where: { id: { in: linkedOrderIds }, userId } })
                : { count: 0 };
              // 3. Offer items
              const dOfferItems = await tx.offerItem.deleteMany({ where: { offerId: id } });
              // 4. Offer itself (must be trashed + owned)
              const dOffer = await tx.offer.deleteMany({ where: { id, userId, deletedAt: { not: null } } });
              // 5. Verify no straggler orders still reference this offer
              if (dOffer.count > 0) {
                const stragglers = await tx.order.count({ where: { offerId: id, userId } });
                if (stragglers > 0) {
                  throw new Error(`STRAGGLER_ORDERS: ${stragglers} orders still reference deleted offer ${id}`);
                }
              }
              return { orderItems: dOrdItems.count, orders: dOrders.count, offerItems: dOfferItems.count, offers: dOffer.count };
            }, { timeout: 15000 });
            if (result.offers === 0) {
              return NextResponse.json({ error: 'Angebot nicht im Papierkorb (bereits wiederhergestellt oder gelöscht). Bitte Papierkorb neu laden.' }, { status: 404 });
            }
            deleted = result;
            break;
          }
          case 'invoice': {
            // Collect ALL orders linked via invoiceId (trashed or not), then cascade-delete everything
            const linkedOrderIds = (await prisma.order.findMany({
              where: { invoiceId: id, userId },
              select: { id: true },
            })).map((o: any) => o.id);

            const result = await prisma.$transaction(async (tx: any) => {
              // 1. Linked order items
              const dOrdItems = linkedOrderIds.length > 0
                ? await tx.orderItem.deleteMany({ where: { orderId: { in: linkedOrderIds } } })
                : { count: 0 };
              // 2. Linked orders
              const dOrders = linkedOrderIds.length > 0
                ? await tx.order.deleteMany({ where: { id: { in: linkedOrderIds }, userId } })
                : { count: 0 };
              // 3. Invoice items
              const dInvItems = await tx.invoiceItem.deleteMany({ where: { invoiceId: id } });
              // 4. Invoice itself (must be trashed + owned)
              const dInvoice = await tx.invoice.deleteMany({ where: { id, userId, deletedAt: { not: null } } });
              // 5. Verify no straggler orders still reference this invoice
              if (dInvoice.count > 0) {
                const stragglers = await tx.order.count({ where: { invoiceId: id, userId } });
                if (stragglers > 0) {
                  throw new Error(`STRAGGLER_ORDERS: ${stragglers} orders still reference deleted invoice ${id}`);
                }
              }
              return { orderItems: dOrdItems.count, orders: dOrders.count, invoiceItems: dInvItems.count, invoices: dInvoice.count };
            }, { timeout: 15000 });
            if (result.invoices === 0) {
              return NextResponse.json({ error: 'Rechnung nicht im Papierkorb (bereits wiederhergestellt oder gelöscht). Bitte Papierkorb neu laden.' }, { status: 404 });
            }
            deleted = result;
            break;
          }
          case 'customer': {
            // Customer must be in trash AND belong to user
            const item = await prisma.customer.findFirst({ where: { id, userId, deletedAt: { not: null } } });
            if (!item) {
              return NextResponse.json({ error: 'Kunde nicht im Papierkorb (bereits wiederhergestellt oder gelöscht). Bitte Papierkorb neu laden.' }, { status: 404 });
            }
            // Paket K: CANONICAL delete rule — same as DELETE /api/customers/[id]
            const counts = await getCustomerDeleteBlockerCounts(prisma, id, userId);
            if (isCustomerDeleteBlocked(counts)) {
              return NextResponse.json({
                error: formatCustomerDeleteBlockerMessage(counts),
                activeOrders: counts.activeOrders,
                activeOffers: counts.activeOffers,
                activeInvoices: counts.activeInvoices,
                archivedInvoices: counts.archivedInvoices,
                historicalOrders: counts.historicalOrders,
                historicalOffers: counts.historicalOffers,
                blocked: true,
              }, { status: 409 });
            }
            // Transactional: delete all linked items + records + customer
            const result = await prisma.$transaction(async (tx: any) => {
              const dOrdItems = await tx.orderItem.deleteMany({ where: { order: { customerId: id, userId } } });
              const dOrders = await tx.order.deleteMany({ where: { customerId: id, userId } });
              const dOffItems = await tx.offerItem.deleteMany({ where: { offer: { customerId: id, userId } } });
              const dOffers = await tx.offer.deleteMany({ where: { customerId: id, userId } });
              const dInvItems = await tx.invoiceItem.deleteMany({ where: { invoice: { customerId: id, userId } } });
              const dInvoices = await tx.invoice.deleteMany({ where: { customerId: id, userId } });
              const dCustomer = await tx.customer.deleteMany({ where: { id, userId, deletedAt: { not: null } } });
              return {
                orderItems: dOrdItems.count, orders: dOrders.count,
                offerItems: dOffItems.count, offers: dOffers.count,
                invoiceItems: dInvItems.count, invoices: dInvoices.count,
                customers: dCustomer.count,
              };
            }, { timeout: 15000 });
            if (result.customers === 0) {
              return NextResponse.json({ error: 'Kunde konnte nicht gelöscht werden' }, { status: 409 });
            }
            deleted = result;
            break;
          }
          default:
            return NextResponse.json({ error: 'Unbekannter Typ' }, { status: 400 });
        }
        console.log('[PAPIERKORB] delete single:', { type, id, deleted });
      } catch (err: any) {
        console.error('Papierkorb delete error:', err);
        const code = err?.code as string | undefined;
        let msg = 'Endgültiges Löschen fehlgeschlagen';
        if (code === 'P2003') msg = 'Endgültiges Löschen blockiert: Eintrag ist noch verknüpft';
        else if (code === 'P2025') msg = 'Eintrag nicht mehr vorhanden';
        else if (String(err?.message).startsWith('STRAGGLER_ORDERS')) msg = 'Löschen fehlgeschlagen: Verknüpfte Aufträge konnten nicht entfernt werden';
        return NextResponse.json({ success: false, error: msg, code: code || null }, { status: 500 });
      }
      const su2 = await getSessionUser();
      logAuditAsync({ userId: su2?.id, userEmail: su2?.email, userRole: su2?.role, action: 'PERMANENT_DELETE', area: 'PAPIERKORB', targetType: type, targetId: id, request });
      return NextResponse.json({ success: true, message: 'Endgültig gelöscht' });
    }

    if (action === 'empty') {
      try {
        // ── Pre-flight: gather IDs of ALL trashed records ──────────────────
        const trashedOrderIds = (await prisma.order.findMany({
          where: { deletedAt: { not: null }, userId },
          select: { id: true },
        })).map((o: any) => o.id);

        const trashedOfferIds = (await prisma.offer.findMany({
          where: { deletedAt: { not: null }, userId },
          select: { id: true },
        })).map((o: any) => o.id);

        const trashedInvoiceIds = (await prisma.invoice.findMany({
          where: { deletedAt: { not: null }, userId },
          select: { id: true },
        })).map((o: any) => o.id);

        const trashedCustomerRows = await prisma.customer.findMany({
          where: { deletedAt: { not: null }, userId },
          select: { id: true },
        });

        // ── Collect orders linked to trashed offers/invoices via FK ────────
        // These orders reference trashed offers/invoices and MUST be deleted
        // (or unlinked) first, otherwise the offer/invoice delete is blocked.
        const linkedOrderConditions: any[] = [];
        if (trashedOfferIds.length > 0) {
          linkedOrderConditions.push({ offerId: { in: trashedOfferIds } });
        }
        if (trashedInvoiceIds.length > 0) {
          linkedOrderConditions.push({ invoiceId: { in: trashedInvoiceIds } });
        }

        let linkedOrderIds: string[] = [];
        if (linkedOrderConditions.length > 0) {
          linkedOrderIds = (await prisma.order.findMany({
            where: { userId, OR: linkedOrderConditions },
            select: { id: true },
          })).map((o: any) => o.id);
        }

        // Merge: all orders to delete = trashed orders ∪ linked orders (deduplicated)
        const allOrderIdsToDelete = [...new Set([...trashedOrderIds, ...linkedOrderIds])];

        // Determine which customers are safe to delete (canonical blocker check)
        const safeCustomerIds: string[] = [];
        for (const c of trashedCustomerRows) {
          const counts = await getCustomerDeleteBlockerCounts(prisma, c.id, userId);
          if (!isCustomerDeleteBlocked(counts)) safeCustomerIds.push(c.id);
        }

        // If nothing to delete at all, return early
        if (
          allOrderIdsToDelete.length === 0 &&
          trashedOfferIds.length === 0 &&
          trashedInvoiceIds.length === 0 &&
          safeCustomerIds.length === 0
        ) {
          return NextResponse.json({
            success: false,
            error: 'Keine Daten gelöscht — mögliche Verknüpfungsblockade oder Papierkorb ist bereits leer',
          }, { status: 409 });
        }

        // ── Transactional delete in strict FK-safe order ──────────────────
        // 1. OrderItems → Orders (clears all FK references to offers/invoices)
        // 2. InvoiceItems → Invoices
        // 3. OfferItems → Offers
        // 4. Customer chains → Customers
        const deleted = await prisma.$transaction(async (tx: any) => {
          // ─ Step 1: Delete all collected orders (trashed + linked) ────────
          const dOrderItems = allOrderIdsToDelete.length > 0
            ? await tx.orderItem.deleteMany({ where: { orderId: { in: allOrderIdsToDelete } } })
            : { count: 0 };

          const dOrders = allOrderIdsToDelete.length > 0
            ? await tx.order.deleteMany({ where: { id: { in: allOrderIdsToDelete }, userId } })
            : { count: 0 };

          // ─ Step 2: Delete trashed invoices (now unblocked) ──────────────
          const diItems = trashedInvoiceIds.length > 0
            ? await tx.invoiceItem.deleteMany({ where: { invoiceId: { in: trashedInvoiceIds } } })
            : { count: 0 };

          const dInvoices = trashedInvoiceIds.length > 0
            ? await tx.invoice.deleteMany({ where: { id: { in: trashedInvoiceIds }, userId, deletedAt: { not: null } } })
            : { count: 0 };

          // ─ Step 3: Delete trashed offers (now unblocked) ────────────────
          const doItems = trashedOfferIds.length > 0
            ? await tx.offerItem.deleteMany({ where: { offerId: { in: trashedOfferIds } } })
            : { count: 0 };

          const dOffers = trashedOfferIds.length > 0
            ? await tx.offer.deleteMany({ where: { id: { in: trashedOfferIds }, userId, deletedAt: { not: null } } })
            : { count: 0 };

          // ─ Step 4: Validation — no straggler orders should remain ───────
          if (trashedOfferIds.length > 0 || trashedInvoiceIds.length > 0) {
            const stragglerConditions: any[] = [];
            if (trashedOfferIds.length > 0) stragglerConditions.push({ offerId: { in: trashedOfferIds } });
            if (trashedInvoiceIds.length > 0) stragglerConditions.push({ invoiceId: { in: trashedInvoiceIds } });
            const stragglers = await tx.order.count({
              where: { userId, OR: stragglerConditions },
            });
            if (stragglers > 0) {
              throw new Error(`STRAGGLER_ORDERS: ${stragglers} orders still reference deleted offers/invoices`);
            }
          }

          // ─ Step 5: Customers — clear residual history then delete ───────
          let customerCount = 0;
          for (const cid of safeCustomerIds) {
            await tx.orderItem.deleteMany({ where: { order: { customerId: cid, userId } } });
            await tx.order.deleteMany({ where: { customerId: cid, userId } });
            await tx.offerItem.deleteMany({ where: { offer: { customerId: cid, userId } } });
            await tx.offer.deleteMany({ where: { customerId: cid, userId } });
            await tx.invoiceItem.deleteMany({ where: { invoice: { customerId: cid, userId } } });
            await tx.invoice.deleteMany({ where: { customerId: cid, userId } });
            const rc = await tx.customer.deleteMany({ where: { id: cid, userId, deletedAt: { not: null } } });
            customerCount += rc.count;
          }

          return {
            orderItems: dOrderItems.count,
            orders: dOrders.count,
            invoiceItems: diItems.count,
            invoices: dInvoices.count,
            offerItems: doItems.count,
            offers: dOffers.count,
            customers: customerCount,
          };
        }, { timeout: 30000 });

        const totalDeleted = deleted.invoices + deleted.offers + deleted.orders + deleted.customers;

        if (totalDeleted === 0) {
          console.warn('[PAPIERKORB] empty: transaction completed but 0 parent records deleted', deleted);
          return NextResponse.json({
            success: false,
            error: 'Keine Daten gelöscht — mögliche Verknüpfungsblockade',
          }, { status: 409 });
        }

        console.log('[PAPIERKORB] empty: deleted', deleted);
        const su3 = await getSessionUser();
        logAuditAsync({ userId: su3?.id, userEmail: su3?.email, userRole: su3?.role, action: 'EMPTY_TRASH', area: 'PAPIERKORB', details: deleted, request });
        return NextResponse.json({ success: true, message: 'Papierkorb geleert', deleted });
      } catch (emptyErr: any) {
        console.error('[PAPIERKORB] empty failed:', emptyErr);
        const code = emptyErr?.code as string | undefined;
        let msg = 'Papierkorb leeren fehlgeschlagen';
        if (code === 'P2003') msg = 'Löschen blockiert: Verknüpfungen vorhanden';
        else if (String(emptyErr?.message).startsWith('STRAGGLER_ORDERS')) msg = 'Löschen fehlgeschlagen: Verknüpfte Aufträge konnten nicht entfernt werden';
        return NextResponse.json({ success: false, error: msg, code: code || null }, { status: 500 });
      }
    }

    return NextResponse.json({ error: 'Unbekannte Aktion' }, { status: 400 });
  } catch (error: any) {
    console.error('Papierkorb POST error:', error);
    return NextResponse.json({ error: 'Fehler' }, { status: 500 });
  }
}
