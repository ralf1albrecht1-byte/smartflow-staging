export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireUserId, unauthorizedResponse, getSessionUser } from '@/lib/get-session';
import { logAuditAsync } from '@/lib/audit';
import { createArchivedPdfSnapshot } from '@/lib/archived-pdf';
import { assertCustomerNotArchived, CustomerArchivedError } from '@/lib/customer-links';

export async function GET(request: Request, { params }: { params: { id: string } }) {
  let userId: string;
  try { userId = await requireUserId(); } catch { return unauthorizedResponse(); }
  try {
    const invoice = await prisma.invoice.findFirst({ where: { id: params?.id, userId }, include: { customer: true, items: true, orders: true } });
    if (!invoice) return NextResponse.json({ error: 'Nicht gefunden' }, { status: 404 });
    return NextResponse.json({ ...invoice, subtotal: Number(invoice?.subtotal ?? 0), vatAmount: Number(invoice?.vatAmount ?? 0), total: Number(invoice?.total ?? 0), items: invoice?.items?.map((i: any) => ({ ...i, quantity: Number(i?.quantity ?? 0), unitPrice: Number(i?.unitPrice ?? 0), totalPrice: Number(i?.totalPrice ?? 0) })) ?? [] });
  } catch (error: any) {
    console.error(error);
    return NextResponse.json({ error: 'Fehler' }, { status: 500 });
  }
}

export async function PUT(request: Request, { params }: { params: { id: string } }) {
  let userId: string;
  try { userId = await requireUserId(); } catch { return unauthorizedResponse(); }
  try {
    const existing = await prisma.invoice.findFirst({ where: { id: params?.id, userId } });
    if (!existing) return NextResponse.json({ error: 'Nicht gefunden' }, { status: 404 });
    const data = await request.json();

    // ── Guard: block data-changing edits on archived (Erledigt) invoices ──
    // Allowed on archived: status changes (e.g. re-open) and notes.
    // Blocked on archived: items, dates, vatRate — these would create a mismatch
    // with the immutable archived PDF snapshot.
    if (existing.status === 'Erledigt') {
      const hasDataEdit = Array.isArray(data?.items) || data?.invoiceDate !== undefined || data?.dueDate !== undefined || data?.vatRate !== undefined;
      if (hasDataEdit) {
        return NextResponse.json(
          { error: 'Archivierte Rechnungen (Status „Erledigt") können nicht mehr inhaltlich bearbeitet werden. Das archivierte PDF bleibt unverändert. Ändern Sie zuerst den Status, um die Rechnung wieder zu öffnen.' },
          { status: 400 },
        );
      }
    }

    // ── REOPEN: invalidate archived PDF snapshot when leaving "Erledigt" ──
    // When an invoice is reopened (status moves AWAY from Erledigt), the old
    // snapshot is immediately invalidated. This ensures that if the invoice is
    // later edited and re-archived, a FRESH snapshot is generated from the
    // updated content — the old snapshot is never served again.
    const isReopen = existing.status === 'Erledigt' && data?.status !== undefined && data.status !== 'Erledigt';
    if (isReopen && existing.archivedPdfPath) {
      console.log(`[archived-pdf] REOPEN: clearing archivedPdfPath for invoice ${params?.id} (was: ${existing.archivedPdfPath})`);
    }

    // Guard: reject reassignment to an archived customer
    if (data?.customerId && data.customerId !== existing.customerId) {
      await assertCustomerNotArchived(prisma, data.customerId);
    }

    const updateData: any = {};
    if (data?.customerId) updateData.customerId = data.customerId;
    if (isReopen) {
      // Explicitly null out the archived snapshot — mandatory on reopen
      updateData.archivedPdfPath = null;
    }
    if (data?.status !== undefined) updateData.status = data.status;
    if (data?.notes !== undefined) updateData.notes = data.notes;
    if (data?.invoiceDate !== undefined) updateData.invoiceDate = new Date(data.invoiceDate);
    if (data?.dueDate !== undefined) updateData.dueDate = data.dueDate ? new Date(data.dueDate) : null;
    if (Array.isArray(data?.items)) {
      const vatRate = data.vatRate !== undefined && data.vatRate !== null ? Number(data.vatRate) : 8.1;
      let subtotal = 0;
      const itemsData = data.items.map((item: any) => {
        const qty = Number(item?.quantity ?? 0); const price = Number(item?.unitPrice ?? 0); const totalPrice = qty * price; subtotal += totalPrice;
        return { description: item?.description ?? '', quantity: qty, unit: item?.unit ?? 'Stunde', unitPrice: price, totalPrice };
      });
      const vatAmount = subtotal * (vatRate / 100); const total = subtotal + vatAmount;
      updateData.subtotal = subtotal; updateData.vatRate = vatRate; updateData.vatAmount = vatAmount; updateData.total = total;
      await prisma.invoiceItem.deleteMany({ where: { invoiceId: params?.id } });
      await prisma.invoiceItem.createMany({ data: itemsData.map((item: any) => ({ ...item, invoiceId: params?.id })) });
    }
    const invoice = await prisma.invoice.update({ where: { id: params?.id }, data: updateData, include: { customer: true, items: true } });
    const su = await getSessionUser();
    logAuditAsync({ userId: su?.id, userEmail: su?.email, userRole: su?.role, action: 'INVOICE_UPDATE', area: 'INVOICES', targetType: 'Invoice', targetId: params?.id, request });

    // Trigger PDF snapshot when invoice is archived (status → Erledigt).
    // Fire-and-forget (best-effort async): archiving succeeds even if PDF generation fails.
    // If the invoice was previously archived, reopened, edited, and re-archived,
    // archivedPdfPath was cleared on reopen (see above), so this creates a FRESH snapshot.
    if (data?.status === 'Erledigt' && existing.status !== 'Erledigt') {
      createArchivedPdfSnapshot(params?.id, userId).catch(() => {});
    }

    return NextResponse.json({ ...invoice, subtotal: Number(invoice?.subtotal ?? 0), vatAmount: Number(invoice?.vatAmount ?? 0), total: Number(invoice?.total ?? 0), items: invoice?.items?.map((i: any) => ({ ...i, quantity: Number(i?.quantity ?? 0), unitPrice: Number(i?.unitPrice ?? 0), totalPrice: Number(i?.totalPrice ?? 0) })) ?? [] });
  } catch (error: any) {
    if (error instanceof CustomerArchivedError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    console.error(error);
    return NextResponse.json({ error: 'Fehler' }, { status: 500 });
  }
}

export async function DELETE(request: Request, { params }: { params: { id: string } }) {
  let userId: string;
  try { userId = await requireUserId(); } catch { return unauthorizedResponse(); }
  try {
    const existing = await prisma.invoice.findFirst({ where: { id: params?.id, userId } });
    if (!existing) return NextResponse.json({ error: 'Nicht gefunden' }, { status: 404 });
    await prisma.order.updateMany({ where: { invoiceId: params?.id }, data: { invoiceId: null } });
    await prisma.invoice.update({ where: { id: params?.id }, data: { deletedAt: new Date() } });
    const su = await getSessionUser();
    logAuditAsync({ userId: su?.id, userEmail: su?.email, userRole: su?.role, action: 'INVOICE_DELETE', area: 'INVOICES', targetType: 'Invoice', targetId: params?.id, request });
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error(error);
    return NextResponse.json({ error: 'Fehler' }, { status: 500 });
  }
}
