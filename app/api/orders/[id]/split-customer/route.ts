/**
 * Phase 2d — Undo auto-reuse.
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

    // FIX 1
    const autoTag = (order.reviewReasons ?? []).find(
      (r: string) =>
        r === 'AUTO_REUSED' ||
        r.startsWith('AUTO_REUSED:') ||
        r.startsWith('AUTO_REUSED_NEAR_EXACT:')
    );

    if (!autoTag) {
      return NextResponse.json(
        { error: 'Nicht automatisch wiederverwendet.' },
        { status: 409 }
      );
    }

    if (order.invoiceId || order.offerId) {
      return NextResponse.json(
        { error: 'Folgedokument vorhanden.' },
        { status: 409 }
      );
    }

    const parts = autoTag.split(':');
    const tagType = parts[0];
    const tagCustomerNumber = parts.length >= 2 ? parts[1] : '';
    const completedPart = parts.length >= 3 ? parts[2] : '';

    if (!order.customer || !tagCustomerNumber || order.customer.customerNumber !== tagCustomerNumber) {
      return NextResponse.json(
        { error: 'Kunde passt nicht mehr.' },
        { status: 409 }
      );
    }

    const sourceCustomer = order.customer;

    const newCustomerNumber = await generateCustomerNumber();

    const newCustomer = await prisma.customer.create({
      data: {
        customerNumber: newCustomerNumber,
        name: sourceCustomer.name || '',
        phone: null,
        email: null,
        address: sourceCustomer.address || null,
        plz: sourceCustomer.plz || null,
        city: sourceCustomer.city || null,
        country: sourceCustomer.country || 'CH',
        notes: null,
        userId,
      },
    });

    // FIX 2
    const cleanedReasons = (order.reviewReasons ?? []).filter(
      (r: string) =>
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
    });

    logAuditAsync({
      userId,
      action: 'CUSTOMER_REUSE_UNDONE',
      area: 'CUSTOMERS',
      targetType: 'Order',
      targetId: updated.id,
      success: true,
    });

    return NextResponse.json({
      success: true,
      order: updated,
    });

  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: 'Fehler' },
      { status: 500 }
    );
  }
}