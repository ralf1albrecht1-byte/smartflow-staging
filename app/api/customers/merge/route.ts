export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireUserId, unauthorizedResponse, getSessionUser } from '@/lib/get-session';
import { logAuditAsync } from '@/lib/audit';

/**
 * Parse a customerNumber like "K-007" → 7, or null if unparseable.
 * Used for deterministic merge-direction enforcement.
 */
function parseCustomerNumeric(cn: string | null | undefined): number | null {
  if (!cn) return null;
  const m = cn.match(/K-(\d+)/i);
  return m ? parseInt(m[1], 10) : null;
}

export async function POST(request: Request) {
  try {
    let userId: string;
    try { userId = await requireUserId(); } catch { return unauthorizedResponse(); }
    const su = await getSessionUser();

    const { keepId, mergeId, resolvedValues, contextCustomerId } = await request.json();
    if (!keepId || !mergeId) {
      return NextResponse.json({ error: 'keepId und mergeId erforderlich' }, { status: 400 });
    }
    if (keepId === mergeId) {
      return NextResponse.json({ error: 'Kann nicht mit sich selbst zusammenführen' }, { status: 400 });
    }

    // Load both customers — MUST be active (deletedAt: null) and belong to user
    const [keepCustomer, mergeCustomer] = await Promise.all([
      prisma.customer.findFirst({
        where: { id: keepId, userId, deletedAt: null },
        include: {
          _count: {
            select: {
              orders: { where: { deletedAt: null } },
              offers: { where: { deletedAt: null } },
              invoices: { where: { deletedAt: null } },
            },
          },
        },
      }),
      prisma.customer.findFirst({
        where: { id: mergeId, userId, deletedAt: null },
        include: {
          _count: {
            select: {
              orders: { where: { deletedAt: null } },
              offers: { where: { deletedAt: null } },
              invoices: { where: { deletedAt: null } },
            },
          },
        },
      }),
    ]);

    if (!keepCustomer) return NextResponse.json({ error: 'Kunde (behalten) nicht gefunden oder bereits archiviert' }, { status: 404 });
    if (!mergeCustomer) return NextResponse.json({ error: 'Kunde (Duplikat) nicht gefunden oder bereits archiviert' }, { status: 404 });

    // ═══ MERGE-DIRECTION ENFORCEMENT ═══
    // The customer with the LOWER customerNumber (= older/original identity) ALWAYS survives.
    // This protects against the UI accidentally sending the wrong keepId/mergeId
    // (e.g., user opens merge from the newer duplicate's page and the newer one would survive).
    // resolvedValues contains absolute field values — NOT references to primary/secondary —
    // so swapping direction is safe: the user's chosen field values are applied regardless.
    let primaryId = keepId;
    let secondaryId = mergeId;
    let primaryCustomer = keepCustomer;
    let secondaryCustomer = mergeCustomer;
    let directionSwapped = false;

    const keepNum = parseCustomerNumeric(keepCustomer.customerNumber);
    const mergeNum = parseCustomerNumeric(mergeCustomer.customerNumber);

    if (keepNum !== null && mergeNum !== null && mergeNum < keepNum) {
      // The "duplicate" has a LOWER number → it's actually the original → swap direction
      primaryId = mergeId;
      secondaryId = keepId;
      primaryCustomer = mergeCustomer;
      secondaryCustomer = keepCustomer;
      directionSwapped = true;
      console.log(`[merge] Direction swapped: keeping ${primaryCustomer.customerNumber} (lower), deleting ${secondaryCustomer.customerNumber}`);
    } else if (keepNum === null && mergeNum !== null) {
      // keepCustomer has NO number, mergeCustomer has one → keep the one with the number
      primaryId = mergeId;
      secondaryId = keepId;
      primaryCustomer = mergeCustomer;
      secondaryCustomer = keepCustomer;
      directionSwapped = true;
      console.log(`[merge] Direction swapped: keeping ${primaryCustomer.customerNumber} (has number), deleting unnumbered`);
    }

    // Snapshot the customerNumber BEFORE the transaction — this is the immutable identity
    const preservedCustomerNumber = primaryCustomer.customerNumber;

    // === FIELD VALUES ===
    // resolvedValues contains the actual chosen values per field (already resolved by the UI)
    // This eliminates the primary/secondary label confusion entirely.
    type MergeField = 'name' | 'address' | 'plz' | 'city' | 'phone' | 'email';
    const fields: MergeField[] = ['name', 'address', 'plz', 'city', 'phone', 'email'];
    const mergedData: Record<string, string | null> = {};

    if (resolvedValues && typeof resolvedValues === 'object') {
      // New mode: UI sends the actual resolved values per field.
      // CRITICAL: Use `f in resolvedValues` — NOT `!== null`.
      // The UI may explicitly send null when user chose an empty field.
      // Only fall back to primary/secondary if the field is entirely absent.
      for (const f of fields) {
        if (f in resolvedValues) {
          // User explicitly chose this value (may be null = empty field)
          mergedData[f] = resolvedValues[f] != null ? String(resolvedValues[f]).trim() || null : null;
        } else {
          // Field not in resolvedValues — keep primary, fill from secondary
          mergedData[f] = (primaryCustomer as any)[f] || (secondaryCustomer as any)[f] || null;
        }
      }
    } else {
      // Fallback: no resolvedValues → keep primary values, fill empty from secondary
      for (const f of fields) {
        const pVal = ((primaryCustomer as any)[f] || '').trim();
        const sVal = ((secondaryCustomer as any)[f] || '').trim();
        mergedData[f] = pVal || sVal || null;
      }
    }

    // === TRANSACTION: Merge everything ===
    // WICHTIG: specialNotes enthält nur echte Auftragshinweise (Hund, Hanglage etc.)
    // und darf NICHT gelöscht werden! Nur needsReview wird zurückgesetzt.
    await prisma.$transaction([
      // Transfer ALL orders from secondary → primary (including archived/deleted)
      prisma.order.updateMany({
        where: { customerId: secondaryId },
        data: { customerId: primaryId, needsReview: false, reviewReasons: [] },
      }),
      // Clear needsReview on primary's orders (duplicate resolved)
      prisma.order.updateMany({
        where: { customerId: primaryId, needsReview: true },
        data: { needsReview: false, reviewReasons: [] },
      }),
      // Transfer ALL offers (including archived/deleted)
      prisma.offer.updateMany({
        where: { customerId: secondaryId },
        data: { customerId: primaryId },
      }),
      // Transfer ALL invoices (including archived/deleted)
      prisma.invoice.updateMany({
        where: { customerId: secondaryId },
        data: { customerId: primaryId },
      }),
      // Update primary with merged field values.
      // CRITICAL: customerNumber is explicitly set to the preserved value — belt-and-suspenders
      // guard that ensures the original identity can NEVER be overwritten during merge,
      // even if mergedData somehow contained a customerNumber key (it shouldn't, but safety first).
      prisma.customer.update({
        where: { id: primaryId },
        data: {
          ...mergedData,
          customerNumber: preservedCustomerNumber, // IMMUTABLE — never changes during merge
          notes: [
            primaryCustomer.notes,
            secondaryCustomer.notes
              ? `[Zusammengeführt von ${secondaryCustomer.customerNumber || secondaryCustomer.name}: ${secondaryCustomer.notes}]`
              : `[Zusammengeführt von ${secondaryCustomer.customerNumber || secondaryCustomer.name}]`,
          ].filter(Boolean).join('\n'),
        },
      }),
      // Soft-delete secondary
      prisma.customer.update({
        where: { id: secondaryId },
        data: {
          deletedAt: new Date(),
          notes: [
            secondaryCustomer.notes,
            `[Zusammengeführt mit ${primaryCustomer.customerNumber || primaryCustomer.name} am ${new Date().toLocaleDateString('de-CH')}]`,
          ].filter(Boolean).join('\n'),
        },
      }),
    ]);

    // === POST-MERGE: Belt-and-suspenders reactivation ===
    // The primary customer MUST be active after receiving all records.
    // This should always be the case (WHERE deletedAt: null), but guard against
    // any edge case where the customer could have been archived between our
    // findFirst and the transaction commit.
    await prisma.customer.update({
      where: { id: primaryId },
      data: { deletedAt: null },
    });

    // === POST-MERGE VALIDATION ===
    // 1. Verify customerNumber immutability
    const primaryAfterMerge = await prisma.customer.findUnique({ where: { id: primaryId }, select: { customerNumber: true } });
    if (primaryAfterMerge?.customerNumber !== preservedCustomerNumber) {
      console.error('[merge] CRITICAL: customerNumber changed during merge!', {
        primaryId, expected: preservedCustomerNumber, actual: primaryAfterMerge?.customerNumber,
      });
      return NextResponse.json({ error: 'Merge-Fehler: Kundennummer wurde verändert. Bitte Support kontaktieren.' }, { status: 500 });
    }

    // 2. Verify no dangling active references to secondary
    const [danglingOrders, danglingOffers, danglingInvoices, secondaryStillActive] = await Promise.all([
      prisma.order.count({ where: { customerId: secondaryId, deletedAt: null } }),
      prisma.offer.count({ where: { customerId: secondaryId, deletedAt: null } }),
      prisma.invoice.count({ where: { customerId: secondaryId, deletedAt: null } }),
      prisma.customer.findFirst({ where: { id: secondaryId, deletedAt: null } }),
    ]);

    if (danglingOrders > 0 || danglingOffers > 0 || danglingInvoices > 0 || secondaryStillActive) {
      // This should never happen due to transaction, but safety check
      console.error('[merge] POST-MERGE VALIDATION FAILED:', {
        secondaryId, danglingOrders, danglingOffers, danglingInvoices,
        secondaryStillActive: !!secondaryStillActive,
      });

      logAuditAsync({
        userId: su?.id, userEmail: su?.email, userRole: su?.role,
        action: 'CUSTOMER_MERGE_FAILED', area: 'CUSTOMERS',
        success: false,
        details: {
          kept: { id: primaryId, name: primaryCustomer.name, customerNumber: primaryCustomer.customerNumber },
          duplicate: { id: secondaryId, name: secondaryCustomer.name, customerNumber: secondaryCustomer.customerNumber },
          reason: 'post_merge_validation_failed',
        },
        request,
      });

      return NextResponse.json({
        error: 'Zusammenführung fehlgeschlagen – Validierung ergab inkonsistente Daten. Bitte Seite neu laden und erneut versuchen.',
      }, { status: 500 });
    }

    // Get final counts
    const [orderCount, offerCount, invoiceCount] = await Promise.all([
      prisma.order.count({ where: { customerId: primaryId, deletedAt: null } }),
      prisma.offer.count({ where: { customerId: primaryId, deletedAt: null } }),
      prisma.invoice.count({ where: { customerId: primaryId, deletedAt: null } }),
    ]);

    // Audit log — full merge traceability
    logAuditAsync({
      userId: su?.id, userEmail: su?.email, userRole: su?.role,
      action: 'CUSTOMER_MERGE', area: 'CUSTOMERS',
      targetType: 'Customer', targetId: primaryId,
      success: true,
      details: {
        kept: { id: primaryId, name: primaryCustomer.name, customerNumber: primaryCustomer.customerNumber },
        duplicate: { id: secondaryId, name: secondaryCustomer.name, customerNumber: secondaryCustomer.customerNumber },
        directionSwapped,
        reason: directionSwapped ? 'auto_corrected_to_keep_lower_number' : 'user_selected',
        counts: { orders: orderCount, offers: offerCount, invoices: invoiceCount },
      },
      request,
    });

    return NextResponse.json({
      success: true,
      message: 'Kunden erfolgreich zusammengeführt',
      primaryCustomer: { id: primaryId, name: primaryCustomer.name, customerNumber: primaryCustomer.customerNumber },
      secondaryCustomer: { id: secondaryId, name: secondaryCustomer.name, customerNumber: secondaryCustomer.customerNumber },
      directionSwapped,
      counts: { orders: orderCount, offers: offerCount, invoices: invoiceCount },
    });
  } catch (error: any) {
    console.error('POST /api/customers/merge error:', error);
    return NextResponse.json({ error: 'Fehler beim Zusammenführen' }, { status: 500 });
  }
}