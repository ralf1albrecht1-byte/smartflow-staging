export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { normalizeCustomerData } from '@/lib/normalize';
import { requireUserId, unauthorizedResponse, getSessionUser } from '@/lib/get-session';
import { logAuditAsync } from '@/lib/audit';
import { getCustomerDeleteBlockerCounts, isCustomerDeleteBlocked, formatCustomerDeleteBlockerMessage } from '@/lib/customer-links';


export async function GET(request: Request, { params }: { params: { id: string } }) {
  let userId: string;
  try { userId = await requireUserId(); } catch { return unauthorizedResponse(); }
  try {
    const customer = await prisma.customer.findFirst({ where: { id: params?.id, userId }, include: { orders: { orderBy: { date: 'desc' } }, invoices: { orderBy: { invoiceDate: 'desc' } }, offers: { orderBy: { offerDate: 'desc' } } } });
    if (!customer) return NextResponse.json({ error: 'Nicht gefunden' }, { status: 404 });
    return NextResponse.json(customer);
  } catch (error: any) {
    console.error(error);
    return NextResponse.json({ error: 'Fehler' }, { status: 500 });
  }
}

export async function PUT(request: Request, { params }: { params: { id: string } }) {
  let userId: string;
  try { userId = await requireUserId(); } catch { return unauthorizedResponse(); }
  try {
    const existing = await prisma.customer.findFirst({ where: { id: params?.id, userId } });
    if (!existing) return NextResponse.json({ error: 'Nicht gefunden' }, { status: 404 });
    const raw = await request.json();
    const data = normalizeCustomerData(raw);
    const oldCustomer = existing;

    // ─────────────────────────────────────────────────────────────
    // Phase 2f: opt-in clear-protection.
    //
    // Semantics:
    //   - Fields OMITTED from the payload  → keep existing DB value
    //     (we simply don't put them in updateData, Prisma ignores undefined).
    //   - Field PRESENT with non-empty value → write normalized value.
    //   - Field PRESENT with empty/null value AND existing DB value is set
    //     → require the caller to opt-in via `fieldsToClear: ['plz', ...]`.
    //       If the field name is NOT in fieldsToClear we reject with 400 so
    //       stale client state cannot silently wipe a good record.
    //   - Field PRESENT with empty/null AND existing DB value is empty
    //     → no-op, allowed.
    //
    // The intent is to stop the UX regression where reopening an "Bearbeiten"
    // dialog on a customer that had e.g. street/plz filled could reset those
    // to empty just because the form was initialised from stale local state.
    // ─────────────────────────────────────────────────────────────
    const fieldsToClearRaw = Array.isArray(raw?.fieldsToClear) ? raw.fieldsToClear : [];
    const fieldsToClear = new Set<string>(
      fieldsToClearRaw.filter((v: unknown): v is string => typeof v === 'string'),
    );

    const PROTECTED_FIELDS: Array<{ key: 'name' | 'address' | 'plz' | 'city' | 'phone' | 'email'; normalizedValue: string | null }> = [
      { key: 'name',    normalizedValue: data.name?.trim() ? data.name : null },
      { key: 'address', normalizedValue: data.address ?? null },
      { key: 'plz',     normalizedValue: data.plz ?? null },
      { key: 'city',    normalizedValue: data.city ?? null },
      { key: 'phone',   normalizedValue: data.phone ?? null },
      { key: 'email',   normalizedValue: data.email ?? null },
    ];

    for (const { key, normalizedValue } of PROTECTED_FIELDS) {
      const isPresent = Object.prototype.hasOwnProperty.call(raw ?? {}, key);
      if (!isPresent) continue;
      const existingValue = (existing as any)[key] as string | null | undefined;
      const existingHas = !!(existingValue && String(existingValue).trim());
      const willClear = !normalizedValue || !String(normalizedValue).trim();
      if (existingHas && willClear && !fieldsToClear.has(key)) {
        const su = await getSessionUser();
        logAuditAsync({
          userId: su?.id,
          userEmail: su?.email,
          userRole: su?.role,
          action: 'CUSTOMER_UPDATE_REJECTED',
          area: 'CUSTOMERS',
          targetType: 'Customer',
          targetId: params?.id,
          details: { field: key, reason: 'would_clear_existing_value' },
          request,
        });
        return NextResponse.json({
          error: `Feld "${key}" würde einen bestehenden Wert löschen. Bitte explizit über fieldsToClear freigeben.`,
          field: key,
          reason: 'would_clear_existing_value',
        }, { status: 400 });
      }
    }

    // Paket O: country is optional. If normalizeCustomerData returned a country
    // value, include it in the update; otherwise omit the key so Prisma keeps
    // the existing DB value.
    // Phase 2f: only include a field in updateData when the caller actually
    // sent it. Omitted fields keep their existing DB value.
    const updateData: any = {};
    if (Object.prototype.hasOwnProperty.call(raw ?? {}, 'name'))    updateData.name    = data.name;
    if (Object.prototype.hasOwnProperty.call(raw ?? {}, 'address')) updateData.address = data.address;
    if (Object.prototype.hasOwnProperty.call(raw ?? {}, 'plz'))     updateData.plz     = data.plz;
    if (Object.prototype.hasOwnProperty.call(raw ?? {}, 'city'))    updateData.city    = data.city;
    if (Object.prototype.hasOwnProperty.call(raw ?? {}, 'phone'))   updateData.phone   = data.phone;
    if (Object.prototype.hasOwnProperty.call(raw ?? {}, 'email'))   updateData.email   = data.email;
    if (Object.prototype.hasOwnProperty.call(raw ?? {}, 'notes'))   updateData.notes   = data.notes;
    if (data.country !== undefined) updateData.country = data.country;
    if (raw?.customerNumber !== undefined) updateData.customerNumber = raw.customerNumber;

    const customer = await prisma.customer.update({ where: { id: params?.id }, data: updateData });

    // Audit: any field that was explicitly cleared via fieldsToClear.
    if (fieldsToClear.size > 0) {
      const su2 = await getSessionUser();
      const clearedNow: string[] = [];
      fieldsToClear.forEach((key) => {
        const ov = (existing as any)[key];
        if (ov && String(ov).trim()) clearedNow.push(key);
      });
      if (clearedNow.length > 0) {
        logAuditAsync({
          userId: su2?.id,
          userEmail: su2?.email,
          userRole: su2?.role,
          action: 'CUSTOMER_FIELDS_CLEARED',
          area: 'CUSTOMERS',
          targetType: 'Customer',
          targetId: params?.id,
          details: { fields: clearedNow },
          request,
        });
      }
    }
    const su = await getSessionUser();
    logAuditAsync({ userId: su?.id, userEmail: su?.email, userRole: su?.role, action: 'CUSTOMER_UPDATE', area: 'CUSTOMERS', targetType: 'Customer', targetId: params?.id, request });
    const addressChanged = oldCustomer && (oldCustomer.name !== data.name || oldCustomer.address !== data.address || oldCustomer.plz !== data.plz || oldCustomer.city !== data.city);
    if (addressChanged) {
      const hasName = !!data.name?.trim();
      const hasAddress = !!data.address?.trim() || (!!data.plz?.trim() && !!data.city?.trim());
      if (hasName && hasAddress) {
        await prisma.order.updateMany({ where: { customerId: params?.id, deletedAt: null, needsReview: true }, data: { needsReview: false, reviewReasons: [] } });
      }
    }
    return NextResponse.json(customer);
  } catch (error: any) {
    console.error(error);
    return NextResponse.json({ error: 'Fehler beim Aktualisieren' }, { status: 500 });
  }
}

export async function DELETE(request: Request, { params }: { params: { id: string } }) {
  let userId: string;
  try { userId = await requireUserId(); } catch { return unauthorizedResponse(); }
  try {
    const existing = await prisma.customer.findFirst({ where: { id: params?.id, userId } });
    if (!existing) return NextResponse.json({ error: 'Nicht gefunden' }, { status: 404 });

    // CANONICAL block-rule (Paket K): see lib/customer-links.ts → getCustomerDeleteBlockerCounts.
    // Shared with Papierkorb hard-delete + auto-cleanup so both paths use the
    // EXACT same "active vs history" distinction. Pure history alone does not
    // block. Archived invoices (status='Erledigt') still block for accounting.
    const counts = await getCustomerDeleteBlockerCounts(prisma, params.id, userId);
    if (isCustomerDeleteBlocked(counts)) {
      return NextResponse.json({
        error: formatCustomerDeleteBlockerMessage(counts),
        activeOrders: counts.activeOrders,
        activeOffers: counts.activeOffers,
        activeInvoices: counts.activeInvoices,
        archivedInvoices: counts.archivedInvoices,
        historicalOrders: counts.historicalOrders,
        historicalOffers: counts.historicalOffers,
        // keep legacy fields for any older client (aliased to active counts)
        totalOrders: counts.activeOrders, totalOffers: counts.activeOffers, currentInvoices: counts.activeInvoices,
        blocked: true,
      }, { status: 409 });
    }

    await prisma.customer.update({ where: { id: params?.id }, data: { deletedAt: new Date() } });
    const su = await getSessionUser();
    logAuditAsync({ userId: su?.id, userEmail: su?.email, userRole: su?.role, action: 'CUSTOMER_DELETE', area: 'CUSTOMERS', targetType: 'Customer', targetId: params?.id, request });
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error(error);
    return NextResponse.json({ error: 'Fehler beim Löschen' }, { status: 500 });
  }
}
