export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireUserId, unauthorizedResponse } from '@/lib/get-session';
import { isArchivedInvoice } from '@/lib/customer-links';

export async function GET(request: Request, { params }: { params: { id: string } }) {
  try {
    let userId: string;
    try { userId = await requireUserId(); } catch { return unauthorizedResponse(); }

    const customer = await prisma.customer.findFirst({
      where: { id: params?.id, userId },
      include: {
        orders: {
          where: { deletedAt: null },
          orderBy: { date: 'desc' },
          select: {
            id: true,
            description: true,
            serviceName: true,
            status: true,
            date: true,
            totalPrice: true,
            specialNotes: true,
            needsReview: true,
            hinweisLevel: true,
            mediaUrl: true,
            mediaType: true,
            imageUrls: true,
            audioTranscript: true,
            offerId: true,
            invoiceId: true,
            createdAt: true,
            offer: { select: { id: true, offerNumber: true, status: true } },
            invoice: { select: { id: true, invoiceNumber: true, status: true } },
          },
        },
        offers: {
          where: { deletedAt: null },
          orderBy: { offerDate: 'desc' },
          select: {
            id: true,
            offerNumber: true,
            status: true,
            offerDate: true,
            total: true,
            notes: true,
            createdAt: true,
          },
        },
        invoices: {
          where: { deletedAt: null },
          orderBy: { invoiceDate: 'desc' },
          select: {
            id: true,
            invoiceNumber: true,
            status: true,
            invoiceDate: true,
            dueDate: true,
            total: true,
            notes: true,
            sourceOfferId: true,
            createdAt: true,
          },
        },
      },
    });
    if (!customer) return NextResponse.json({ error: 'Nicht gefunden' }, { status: 404 });

    // TRANSPARENCY FIX (Package E): the customer detail page now returns ALL
    // non-soft-deleted linked records (orders, offers, invoices) — including
    // converted orders (offerId/invoiceId set), closed offers (Angenommen /
    // Abgelehnt) and archived invoices (status='Erledigt').
    //
    // Rationale: the delete-block uses a STRICT rule (every non-soft-deleted
    // record blocks). Before Package E, the detail page filtered to only
    // "visible" records, so a customer could be blocked from deletion without
    // the detail view showing any reason. Now the user always sees the records
    // that block deletion.
    //
    // Status badges on each card (Offen / In Bearbeitung / Erledigt / Angenommen
    // / Abgelehnt / Entwurf / Gesendet / Bezahlt) continue to be rendered from
    // the same `status` field, so the context (converted vs active) remains
    // visually obvious.
    //
    // `archivedInvoicesCount` is kept for backward compatibility, but since
    // archived invoices now also appear in the `invoices` array, UI consumers
    // can simply count invoices with status='Erledigt' directly.
    const archivedInvoicesCount = customer.invoices.filter(isArchivedInvoice).length;

    return NextResponse.json({
      ...customer,
      archivedInvoicesCount,
    });
  } catch (error: any) {
    console.error('GET /api/customers/[id]/details error:', error);
    return NextResponse.json({ error: 'Fehler' }, { status: 500 });
  }
}
