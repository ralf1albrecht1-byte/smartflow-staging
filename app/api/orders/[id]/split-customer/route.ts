/**
 * Phase 2d — Undo auto-reuse.
 * Splits the order off the auto-reused customer and binds it to a fresh
 * customer with only the name copied over (empty address / phone / email).
 *
 * Safety rules (enforced here, in order):
 * 1) Auth + tenancy: userId from session must match order.userId.
 * 2) The order MUST carry an `AUTO_REUSED*` tag in reviewReasons
 *    (otherwise nothing to undo → 409).
 * 3) The order MUST NOT have any follow-up document:
 *    invoiceId === null AND offerId === null (otherwise 409).
 * 4) The current customer's customerNumber MUST match the tag's customer
 *    number (otherwise the state has already been manually changed → 409).
 *
 * On success: create new customer (name only), reassign order, strip every
 * AUTO_REUSED* tag from reviewReasons, write audit CUSTOMER_REUSE_UNDONE.
 */
export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireUserId, unauthorizedResponse } from '@/lib/get-session';
import { logAuditAsync } from '@/lib/audit';
import { generateCustomerNumber } from '@/lib/customer-number';

export async function POST(
  _request: Request,
  { params }: { params: { id: string } }
) {
  try {
    let userId: string;
    try {
      userId = await requireUserId();
    } catch {
      return unauthorizedResponse();
    }

    const order = await prisma.order.findFirst({
      where: { id: params.id, userId },
      include: { customer: true },
    });
    if (!order) {
      return NextResponse.json({ error: 'Auftrag nicht gefunden' }, { status: 404 });
    }

    // (2) Auto-reuse tag required
    const autoTag = (order.reviewReasons ?? []).find(
      (r: any) => r === 'AUTO_REUSED' || r.startsWith('AUTO_REUSED:') || r.startsWith('AUTO_REUSED_NEAR_EXACT:')
    );
    if (!autoTag) {
      return NextResponse.json(
        { error: 'Dieser Auftrag wurde nicht automatisch wiederverwendet — nichts zum Rückgängigmachen.' },
        { status: 409 }
      );
    }

    // (3) No follow-up document
    if (order.invoiceId || order.offerId) {
      return NextResponse.json(
        {
          error:
            'Rückgängig nicht möglich: Dem Auftrag ist bereits eine Rechnung oder ein Angebot zugeordnet. Bitte zuerst das Folgedokument stornieren.',
        },
        { status: 409 }
      );
    }

    // (4) Tag's customerNumber must match current customer
    // Tag formats: AUTO_REUSED:<cno>  or  AUTO_REUSED_NEAR_EXACT:<cno>:<plz|city>_completed
    const parts = autoTag.split(':');
    const tagType = parts[0]; // 'AUTO_REUSED' or 'AUTO_REUSED_NEAR_EXACT'
    const tagCustomerNumber = parts.length >= 2 ? parts[1] : '';
    const completedPart = parts.length >= 3 ? parts[2] : '';
    if (!order.customer || !tagCustomerNumber || order.customer.customerNumber !== tagCustomerNumber) {
      return NextResponse.json(
        {
          error:
            'Der aktuell zugeordnete Kunde stimmt nicht mehr mit der Auto-Wiederverwendung überein. Rückgängigmachen nicht möglich.',
        },
        { status: 409 }
      );
    }

    const sourceCustomer = order.customer;

    // Block A fix: the intake's pre-suggestion address state is derived from
    // the AUTO_REUSED tag. The source customer is ONLY READ — never modified.
    //
    //  - AUTO_REUSED / AUTO_REUSED:<cno>
    //       → incoming intake had name + street + plz + city (all 4 matched).
    //       → restore all 4 on the new split customer.
    //
    //  - AUTO_REUSED_NEAR_EXACT:<cno>:plz_completed
    //       → incoming had name + street + city, ZIP was EMPTY.
    //       → restore name + street + city, keep plz empty.
    //
    //  - AUTO_REUSED_NEAR_EXACT:<cno>:city_completed
    //       → incoming had name + street + plz, city was EMPTY.
    //       → restore name + street + plz, keep city empty.
    const newCustomerData: {
      customerNumber: string;
      name: string;
      phone: null;
      email: null;
      address: string | null;
      plz: string | null;
      city: string | null;
      country: string;
      notes: null;
      userId: string | null;
    } = {
      customerNumber: '', // set below
      name: sourceCustomer.name || '',
      phone: null,
      email: null,
      address: null,
      plz: null,
      city: null,
      country: sourceCustomer.country || 'CH',
      notes: null,
      userId,
    };

    if (tagType === 'AUTO_REUSED') {
      // Incoming had all 4 fields — restore them.
      newCustomerData.address = sourceCustomer.address || null;
      newCustomerData.plz = sourceCustomer.plz || null;
      newCustomerData.city = sourceCustomer.city || null;
    } else if (tagType === 'AUTO_REUSED_NEAR_EXACT') {
      // Street always matched. Restore it.
      newCustomerData.address = sourceCustomer.address || null;
      if (completedPart === 'plz_completed') {
        // Intake had city, was missing plz.
        newCustomerData.city = sourceCustomer.city || null;
        // plz stays null (what was in the intake)
      } else if (completedPart === 'city_completed') {
        // Intake had plz, was missing city.
        newCustomerData.plz = sourceCustomer.plz || null;
        // city stays null (what was in the intake)
      }
    }

    const newCustomerNumber = await generateCustomerNumber();
    newCustomerData.customerNumber = newCustomerNumber;
    const newCustomer = await prisma.customer.create({
      data: newCustomerData,
    });

    // Strip every AUTO_REUSED* tag from reviewReasons
    const cleanedReasons = (order.reviewReasons ?? []).filter(
      (r: any) =>
        r !== 'AUTO_REUSED' &&
        !r.startsWith('AUTO_REUSED:') &&
        !r.startsWith('AUTO_REUSED_NEAR_EXACT:')
    );

    const updated = await prisma.order.update({
      where: { id: params.id },
      data: {
        customerId: newCustomer.id,
        reviewReasons: cleanedReasons,
      },
      include: { customer: true },
    });

    logAuditAsync({
      userId,
      action: 'CUSTOMER_REUSE_UNDONE',
      area: 'CUSTOMERS',
      targetType: 'Order',
      targetId: updated.id,
      success: true,
      details: {
        fromCustomerId: sourceCustomer.id,
        fromCustomerNumber: sourceCustomer.customerNumber,
        toCustomerId: newCustomer.id,
        toCustomerNumber: newCustomer.customerNumber,
        removedTag: autoTag,
        restoredFields: {
          name: !!newCustomer.name,
          address: !!newCustomer.address,
          plz: !!newCustomer.plz,
          city: !!newCustomer.city,
        },
      },
    });

    return NextResponse.json({
      success: true,
      order: updated,
      newCustomer: {
        id: newCustomer.id,
        customerNumber: newCustomer.customerNumber,
        name: newCustomer.name,
        address: newCustomer.address,
        plz: newCustomer.plz,
        city: newCustomer.city,
        country: newCustomer.country,
      },
    });
  } catch (error: any) {
    console.error('[split-customer] error', error);
    return NextResponse.json(
      { error: 'Interner Fehler beim Rückgängigmachen.' },
      { status: 500 }
    );
  }
}
