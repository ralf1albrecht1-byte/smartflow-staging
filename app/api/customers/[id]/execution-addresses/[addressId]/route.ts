export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getActiveDataScope } from '@/lib/data-scope';
import { requireUserId, unauthorizedResponse, getSessionUser } from '@/lib/get-session';
import { logAuditAsync } from '@/lib/audit';

export async function DELETE(
  request: Request,
  { params }: { params: { id: string; addressId: string } },
) {
  let userId: string;
  try { userId = await requireUserId(); } catch { return unauthorizedResponse(); }
  const dataScope = await getActiveDataScope(userId);

  try {
    const customer = await prisma.customer.findFirst({
      where: { id: params.id, userId, dataScope, deletedAt: null },
      select: { id: true },
    });

    if (!customer) {
      return NextResponse.json({ error: 'Kunde nicht gefunden' }, { status: 404 });
    }

    const existing = await prisma.customerExecutionAddress.findFirst({
      where: {
        id: params.addressId,
        customerId: params.id,
        deletedAt: null,
      },
      select: { id: true },
    });

    if (!existing) {
      return NextResponse.json({ error: 'Ausführungsort nicht gefunden' }, { status: 404 });
    }

    await prisma.customerExecutionAddress.update({
      where: { id: existing.id },
      data: { deletedAt: new Date() },
    });

    const su = await getSessionUser();
    logAuditAsync({
      userId: su?.id,
      userEmail: su?.email,
      userRole: su?.role,
      action: 'CUSTOMER_EXECUTION_ADDRESS_DELETE',
      area: 'CUSTOMERS',
      targetType: 'CustomerExecutionAddress',
      targetId: existing.id,
      details: { customerId: params.id },
      request,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('DELETE /api/customers/[id]/execution-addresses/[addressId] error:', error);
    return NextResponse.json({ error: 'Fehler beim Löschen des Ausführungsorts' }, { status: 500 });
  }
}
