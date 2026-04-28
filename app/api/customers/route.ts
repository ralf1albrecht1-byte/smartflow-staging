export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { normalizeCustomerData } from '@/lib/normalize';
import { requireUserId, unauthorizedResponse, getSessionUser } from '@/lib/get-session';
import { logAuditAsync } from '@/lib/audit';
import { generateCustomerNumber } from '@/lib/customer-number';
import { countVisibleLinked, countTotalLinked } from '@/lib/customer-links';

export async function GET() {
  let userId: string;
  try { userId = await requireUserId(); } catch { return unauthorizedResponse(); }
  try {
    const customers = await prisma.customer.findMany({
      where: { deletedAt: null, userId },
      orderBy: { name: 'asc' },
      include: {
        orders: { where: { deletedAt: null }, select: { id: true, offerId: true, invoiceId: true } },
        offers: { where: { deletedAt: null }, select: { id: true, status: true } },
        invoices: { where: { deletedAt: null }, select: { id: true, sourceOfferId: true, status: true } },
      },
    });
    const result = customers.map((c: any) => {
      // `_count` = VISIBLE counts (Rule C). Matches what the user sees in the
      // module lists (/auftraege, /angebote default, /rechnungen, /archiv).
      // Used for the quick-glance badges/chips on the customer list row.
      const visible = countVisibleLinked(c.orders, c.offers, c.invoices);
      // `_totalCount` = STRICT block-rule counts. Counts EVERY non-soft-deleted
      // linked record regardless of conversion/status. Used by the delete
      // warning dialog to show the full blocking reason (incl. archived
      // invoices as their own line). Matches 1:1 the DELETE /api/customers/[id]
      // block rule so badge→warning→backend stay honest with each other.
      const strict = countTotalLinked(c.orders, c.offers, c.invoices);
      const { orders, offers, invoices, ...rest } = c;
      return {
        ...rest,
        _count: {
          orders: visible.orders,
          offers: visible.offers,
          invoices: visible.invoices,
        },
        _totalCount: {
          orders: strict.orders,
          offers: strict.offers,
          invoices: strict.currentInvoices,
          archivedInvoices: strict.archivedInvoices,
        },
      };
    });
    return NextResponse.json(result ?? []);
  } catch (error: any) {
    console.error(error);
    return NextResponse.json([], { status: 500 });
  }
}

export async function POST(request: Request) {
  let userId: string;
  try { userId = await requireUserId(); } catch { return unauthorizedResponse(); }
  try {
    const raw = await request.json();
    const data = normalizeCustomerData(raw);
    const customerNumber = raw?.customerNumber || await generateCustomerNumber();
    // Paket O: country is optional; when omitted, Prisma schema default ("CH") kicks in.
    const customer = await prisma.customer.create({
      data: {
        customerNumber,
        name: data.name || '',
        address: data.address,
        plz: data.plz,
        city: data.city,
        ...(data.country !== undefined ? { country: data.country } : {}),
        phone: data.phone,
        email: data.email,
        notes: data.notes,
        userId,
      },
    });
    const su = await getSessionUser();
    logAuditAsync({ userId: su?.id, userEmail: su?.email, userRole: su?.role, action: 'CUSTOMER_CREATE', area: 'CUSTOMERS', targetType: 'Customer', targetId: customer.id, request });
    return NextResponse.json(customer);
  } catch (error: any) {
    console.error(error);
    return NextResponse.json({ error: 'Fehler beim Erstellen' }, { status: 500 });
  }
}
