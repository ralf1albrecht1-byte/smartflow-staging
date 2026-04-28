export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { extractCustomerDataFromText } from '@/lib/extract-from-notes';
import { protectCustomerData } from '@/lib/data-protection';
import { requireUserId, unauthorizedResponse } from '@/lib/get-session';
import { logAuditAsync } from '@/lib/audit';

/**
 * ─── Layer 3 of three-layer customer-data-pollution defense ───
 *
 * Some customer rows are intentional fallback/stub records created by the
 * webhook intake when no real customer data was identified (e.g. the
 * "⚠️ Unbekannt (WhatsApp)" / "⚠️ Unbekannt (Telegram)" buckets created in
 * lib/order-intake.ts). Their order notes legitimately contain system
 * metadata that must NOT be back-filled into the customer master record:
 *   - Twilio sandbox sender phone numbers
 *   - ISO timestamps (which the regex would treat as PLZ candidates)
 *   - Profile names instead of customer names
 *
 * Layer 1 (notes formatting) and Layer 2 (extraction sanitization) already
 * remove the bulk of that pollution. Layer 3 adds an extra hard skip: even
 * if a future caller forgets the [META] prefix, an order note belonging to
 * a stub customer can never overwrite the customer master row.
 *
 * The skip is keyed on the leading warning glyph + word ("⚠️ Unbekannt"),
 * which is a deliberate naming convention from order-intake.ts. Real
 * customers do not have that prefix because the create-customer form
 * forbids leading whitespace/emoji and the LLM-driven intake never
 * generates the warning glyph.
 */
function isFallbackStubCustomerName(name: string | null | undefined): boolean {
  if (!name) return false;
  // Trim leading whitespace only; we DO want the leading ⚠️ to be present.
  const t = name.trimStart();
  return t.startsWith('⚠️ Unbekannt');
}

export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    let userId: string;
    try { userId = await requireUserId(); } catch { return unauthorizedResponse(); }

    const customer = await prisma.customer.findFirst({ where: { id: params.id, userId } });
    if (!customer) return NextResponse.json({ error: 'Kunde nicht gefunden' }, { status: 404 });

    // Layer 3 — stop dead for fallback/stub customers. Return the row as-is.
    if (isFallbackStubCustomerName(customer.name)) {
      logAuditAsync({
        userId,
        action: 'CUSTOMER_AUTOFILL_SKIPPED_FALLBACK',
        area: 'CUSTOMER',
        targetType: 'Customer',
        targetId: customer.id,
        success: true,
        details: {
          reason: 'fallback_stub_customer',
          customerName: customer.name,
        },
      });
      return NextResponse.json(customer);
    }

    const orders = await prisma.order.findMany({
      where: { customerId: params.id, notes: { not: null } },
      select: { notes: true },
      orderBy: { createdAt: 'desc' },
    });

    if (orders.length === 0) {
      return NextResponse.json(customer);
    }

    const allNotes = orders.map((o: any) => o.notes).filter(Boolean).join('\n');
    // extractCustomerDataFromText already calls sanitizeNotesForExtraction
    // internally (Layer 2), so [META] lines, ISO timestamps and Twilio
    // sandbox numbers are stripped before any regex runs.
    const extracted = extractCustomerDataFromText(allNotes);

    const incoming: Record<string, string | null> = {};
    if (extracted.street) incoming.address = extracted.street;
    if (extracted.plz) incoming.plz = extracted.plz;
    if (extracted.city) incoming.city = extracted.city;
    if (extracted.phone) incoming.phone = extracted.phone;
    if (extracted.email) incoming.email = extracted.email;

    const updates = protectCustomerData(customer, incoming);

    if (Object.keys(updates).length === 0) {
      return NextResponse.json(customer);
    }

    const updated = await prisma.customer.update({
      where: { id: params.id },
      data: updates,
    });

    logAuditAsync({
      userId,
      action: 'CUSTOMER_AUTOFILL_APPLIED',
      area: 'CUSTOMER',
      targetType: 'Customer',
      targetId: updated.id,
      success: true,
      details: {
        fields: Object.keys(updates),
      },
    });

    return NextResponse.json(updated);
  } catch (error: any) {
    console.error('[auto-fill] Fehler:', error);
    return NextResponse.json({ error: 'Fehler' }, { status: 500 });
  }
}
