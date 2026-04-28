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

    // Auto-cleanup: delete items older than 6 months
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    
    await prisma.order.deleteMany({ where: { deletedAt: { not: null, lt: sixMonthsAgo }, userId } });
    await prisma.offer.deleteMany({ where: { deletedAt: { not: null, lt: sixMonthsAgo }, userId } });
    await prisma.invoice.deleteMany({ where: { deletedAt: { not: null, lt: sixMonthsAgo }, userId } });
    const oldCustomers = await prisma.customer.findMany({
      where: { deletedAt: { not: null, lt: sixMonthsAgo }, userId },
      select: { id: true },
    });
    // Paket K: use the canonical "active vs history" rule so auto-cleanup is
    // consistent with hard-delete (history alone does not block; archived
    // invoices DO block).
    for (const c of oldCustomers) {
      const counts = await getCustomerDeleteBlockerCounts(prisma, c.id, userId);
      if (!isCustomerDeleteBlocked(counts)) {
        await prisma.order.deleteMany({ where: { customerId: c.id } });
        await prisma.offer.deleteMany({ where: { customerId: c.id } });
        await prisma.invoice.deleteMany({ where: { customerId: c.id } });
        await prisma.customer.delete({ where: { id: c.id } });
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
        switch (type) {
          case 'order': {
            // Guarded hard-delete: row must be in trash AND belong to user.
            const r = await prisma.order.deleteMany({ where: { id, userId, deletedAt: { not: null } } });
            if (r.count === 0) {
              return NextResponse.json({ error: 'Auftrag nicht im Papierkorb (bereits wiederhergestellt oder gelöscht). Bitte Papierkorb neu laden.' }, { status: 404 });
            }
            break;
          }
          case 'offer': {
            const r = await prisma.offer.deleteMany({ where: { id, userId, deletedAt: { not: null } } });
            if (r.count === 0) {
              return NextResponse.json({ error: 'Angebot nicht im Papierkorb (bereits wiederhergestellt oder gelöscht). Bitte Papierkorb neu laden.' }, { status: 404 });
            }
            break;
          }
          case 'invoice': {
            const r = await prisma.invoice.deleteMany({ where: { id, userId, deletedAt: { not: null } } });
            if (r.count === 0) {
              return NextResponse.json({ error: 'Rechnung nicht im Papierkorb (bereits wiederhergestellt oder gelöscht). Bitte Papierkorb neu laden.' }, { status: 404 });
            }
            break;
          }
          case 'customer': {
            // Customer must be in trash AND belong to user before we even run the blocker check.
            const item = await prisma.customer.findFirst({ where: { id, userId, deletedAt: { not: null } } });
            if (!item) {
              return NextResponse.json({ error: 'Kunde nicht im Papierkorb (bereits wiederhergestellt oder gelöscht). Bitte Papierkorb neu laden.' }, { status: 404 });
            }
            // Paket K: CANONICAL delete rule — same as DELETE /api/customers/[id].
            // Pure history does NOT block; any active order/offer/invoice or any
            // archived invoice (status='Erledigt') blocks permanent delete.
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
            // No active records, no archived invoices → only pure history remains.
            // Hard-delete linked HISTORICAL records (the trash rule guarantees no
            // active ones exist at this point) so the customer row can be removed
            // without FK conflicts. Explicit userId guard keeps cross-tenant
            // safety even if the customerId guard above were bypassed.
            await prisma.order.deleteMany({ where: { customerId: id, userId } });
            await prisma.offer.deleteMany({ where: { customerId: id, userId } });
            await prisma.invoice.deleteMany({ where: { customerId: id, userId } });
            const r = await prisma.customer.deleteMany({ where: { id, userId, deletedAt: { not: null } } });
            if (r.count === 0) {
              // Extremely unlikely after the findFirst above, but keep the invariant strict.
              return NextResponse.json({ error: 'Kunde konnte nicht gelöscht werden' }, { status: 409 });
            }
            break;
          }
          default:
            return NextResponse.json({ error: 'Unbekannter Typ' }, { status: 400 });
        }
      } catch (err: any) {
        console.error('Papierkorb delete error:', err);
        // Give the UI a meaningful reason so it never shows a false-success toast.
        const code = err?.code as string | undefined;
        let msg = 'Endgültiges Löschen fehlgeschlagen';
        if (code === 'P2003') msg = 'Endgültiges Löschen blockiert: Eintrag ist noch verknüpft';
        else if (code === 'P2025') msg = 'Eintrag nicht mehr vorhanden';
        return NextResponse.json({ error: msg, code: code || null }, { status: 500 });
      }
      const su2 = await getSessionUser();
      logAuditAsync({ userId: su2?.id, userEmail: su2?.email, userRole: su2?.role, action: 'PERMANENT_DELETE', area: 'PAPIERKORB', targetType: type, targetId: id, request });
      return NextResponse.json({ success: true, message: 'Endgültig gelöscht' });
    }

    if (action === 'empty') {
      await prisma.order.deleteMany({ where: { deletedAt: { not: null }, userId } });
      await prisma.offer.deleteMany({ where: { deletedAt: { not: null }, userId } });
      await prisma.invoice.deleteMany({ where: { deletedAt: { not: null }, userId } });

      // Paket K: use the canonical rule (same as hard-delete). A trashed
      // customer that has ONLY history remaining should be permanently deleted
      // when the user empties trash; one with archived invoices or with active
      // records must still stay in trash (blocked).
      const trashedCustomers = await prisma.customer.findMany({
        where: { deletedAt: { not: null }, userId },
        select: { id: true },
      });
      for (const c of trashedCustomers) {
        const counts = await getCustomerDeleteBlockerCounts(prisma, c.id, userId);
        if (!isCustomerDeleteBlocked(counts)) {
          // Clear residual history records so the customer row can be removed.
          await prisma.order.deleteMany({ where: { customerId: c.id } });
          await prisma.offer.deleteMany({ where: { customerId: c.id } });
          await prisma.invoice.deleteMany({ where: { customerId: c.id } });
          await prisma.customer.delete({ where: { id: c.id } });
        }
      }
      const su3 = await getSessionUser();
      logAuditAsync({ userId: su3?.id, userEmail: su3?.email, userRole: su3?.role, action: 'EMPTY_TRASH', area: 'PAPIERKORB', request });
      return NextResponse.json({ success: true, message: 'Papierkorb geleert' });
    }

    return NextResponse.json({ error: 'Unbekannte Aktion' }, { status: 400 });
  } catch (error: any) {
    console.error('Papierkorb POST error:', error);
    return NextResponse.json({ error: 'Fehler' }, { status: 500 });
  }
}
