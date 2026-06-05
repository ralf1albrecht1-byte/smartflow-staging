/**
 * Generates customer numbers independently for each user and data scope.
 * TEST and LIVE may both have K-001 without colliding.
 */
import { prisma } from '@/lib/prisma';
import { getActiveDataScope, type DataScope } from '@/lib/data-scope';

function customerNumberSeq(value: string | null | undefined): number | null {
  const match = String(value || '').trim().match(/^K-(\d+)$/i);
  if (!match) return null;
  const parsed = Number.parseInt(match[1], 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function counterName(userId: string, dataScope: DataScope): string {
  return `customer:${userId}:${dataScope.toLowerCase()}`;
}

export async function generateCustomerNumber(
  userId: string,
  requestedScope?: DataScope,
): Promise<string> {
  const dataScope = requestedScope || await getActiveDataScope(userId);
  const name = counterName(userId, dataScope);

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const existingNumbers = await prisma.customer.findMany({
      where: { userId, dataScope, customerNumber: { not: null } },
      select: { customerNumber: true },
    });
    const maxExisting = existingNumbers.reduce((max, row) => {
      const seq = customerNumberSeq(row.customerNumber);
      return seq != null && seq > max ? seq : max;
    }, 0);

    await prisma.counter.updateMany({
      where: { name, value: { lt: maxExisting } },
      data: { value: maxExisting },
    });

    const counter = await prisma.counter.upsert({
      where: { name },
      update: { value: { increment: 1 } },
      create: { name, value: maxExisting + 1 },
    });

    const number = `K-${String(counter.value).padStart(3, '0')}`;
    const existing = await prisma.customer.findFirst({
      where: { userId, dataScope, customerNumber: number },
      select: { id: true },
    });
    if (!existing) return number;
  }

  return `K-${Date.now().toString(36).toUpperCase()}`;
}
