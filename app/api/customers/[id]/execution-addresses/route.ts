export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getActiveDataScope } from '@/lib/data-scope';
import { requireUserId, unauthorizedResponse } from '@/lib/get-session';

export async function GET(_request: Request, { params }: { params: { id: string } }) {
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

    const executionAddresses = await prisma.customerExecutionAddress.findMany({
      where: { customerId: params.id, deletedAt: null },
      orderBy: [{ lastUsedAt: 'desc' }, { updatedAt: 'desc' }],
      select: {
        id: true,
        siteName: true,
        siteAddress: true,
        sitePlz: true,
        siteCity: true,
        siteNote: true,
        country: true,
        usageCount: true,
        lastUsedAt: true,
      },
    });

    return NextResponse.json(executionAddresses);
  } catch (error) {
    console.error('GET /api/customers/[id]/execution-addresses error:', error);
    return NextResponse.json({ error: 'Fehler beim Laden der Ausführungsorte' }, { status: 500 });
  }
}
