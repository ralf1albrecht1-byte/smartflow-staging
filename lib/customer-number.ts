/**
 * Generates globally unique customer numbers.
 * Uses a SINGLE global counter (not per-user) to avoid unique constraint collisions.
 * Includes retry logic for race conditions.
 */
import { prisma } from '@/lib/prisma';

const COUNTER_NAME = 'customer:global';

export async function generateCustomerNumber(): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const counter = await prisma.counter.upsert({
        where: { name: COUNTER_NAME },
        update: { value: { increment: 1 } },
        create: { name: COUNTER_NAME, value: 1 },
      });
      const number = 'K-' + String(counter.value).padStart(3, '0');

      // Verify it doesn't exist yet (race condition safety)
      const existing = await prisma.customer.findFirst({
        where: { customerNumber: number },
        select: { id: true },
      });
      if (!existing) return number;

      console.warn(`[CustomerNumber] K-${String(counter.value).padStart(3, '0')} already exists, retrying (attempt ${attempt + 1})`);
      // Number exists — loop will increment again
    } catch (err: any) {
      if (err.code === 'P2002') {
        console.warn(`[CustomerNumber] Unique constraint hit, retrying (attempt ${attempt + 1})`);
        continue;
      }
      throw err;
    }
  }

  // Ultimate fallback: timestamp-based number
  const ts = Date.now().toString(36).toUpperCase();
  return `K-${ts}`;
}
