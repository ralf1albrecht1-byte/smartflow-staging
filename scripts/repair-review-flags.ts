/**
 * One-time repair script: Fix stale needsReview flags on existing orders.
 *
 * Problem: quick-intake set needsReview=true whenever specialNotes was non-empty,
 * including for harmless operational notes like "Hund auf Grundstück" or "Leiter nötig".
 *
 * This script evaluates each needsReview=true order and:
 * 1. If the customer has incomplete data → sets reviewReasons=['incomplete_customer_data'], keeps needsReview=true
 * 2. If specialNotes contains system keywords (Kundentreffer/Konflikt/Zuordnung) → sets reviewReasons=['uncertain_assignment'], keeps needsReview=true
 * 3. Otherwise (only hazard/operational notes) → sets needsReview=false, reviewReasons=[]
 *
 * Run: npx ts-node scripts/repair-review-flags.ts
 * Or:  npx tsx scripts/repair-review-flags.ts
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_URL } },
});

const SYSTEM_KEYWORDS = /Kundentreffer|prüfen|Confidence|⚠️|🚨|Kundendaten|Konflikt|Zuordnung|manuelle.*prüfung|Priorität.*HOCH/i;

async function main() {
  console.log('=== Repair Review Flags ===');
  console.log('Database:', process.env.DATABASE_URL?.replace(/:[^:@]+@/, ':***@'));

  // Find all orders with needsReview=true
  const orders = await prisma.order.findMany({
    where: { needsReview: true, deletedAt: null },
    include: { customer: { select: { id: true, name: true, address: true, plz: true, city: true } } },
  });

  console.log(`Found ${orders.length} orders with needsReview=true`);

  let fixedToFalse = 0;
  let keptWithCustomerData = 0;
  let keptWithAssignment = 0;

  for (const order of orders) {
    const reasons: string[] = [];
    const cust = order.customer;

    // Check 1: Customer data incomplete?
    const nameEmpty = !cust?.name?.trim() || cust.name.trim() === 'Unbekannt' || cust.name.trim() === '';
    const addressEmpty = !cust?.address?.trim();
    const plzEmpty = !cust?.plz?.trim();
    const cityEmpty = !cust?.city?.trim();
    if (nameEmpty || addressEmpty || plzEmpty || cityEmpty) {
      // Customer data is genuinely incomplete — this is a valid review reason
      // But we DON'T store 'incomplete_customer_data' in reviewReasons because
      // that category is computed dynamically from the Customer table.
      // We keep needsReview=true only if there are also assignment issues.
    }

    // Check 2: System keywords in specialNotes → uncertain assignment
    if (order.specialNotes && SYSTEM_KEYWORDS.test(order.specialNotes)) {
      reasons.push('uncertain_assignment');
    }

    // Decision:
    // - If system keywords found → keep needsReview, set reviewReasons
    // - If only customer data incomplete (no system keywords) → needsReview=false
    //   (because the dashboard will dynamically detect incomplete customer data)
    // - If neither → needsReview=false (was wrongly set due to hazard notes)
    if (reasons.length > 0) {
      await prisma.order.update({
        where: { id: order.id },
        data: { reviewReasons: reasons, needsReview: true },
      });
      keptWithAssignment++;
      console.log(`  ✅ ${order.id} → reviewReasons=[${reasons.join(',')}] (kept needsReview=true)`);
    } else {
      await prisma.order.update({
        where: { id: order.id },
        data: { reviewReasons: [], needsReview: false },
      });
      fixedToFalse++;
      console.log(`  🔧 ${order.id} → needsReview=false (was only hazard/operational notes or customer data issue)`);
    }
  }

  console.log('\n=== Summary ===');
  console.log(`Total processed: ${orders.length}`);
  console.log(`Fixed to false (no real review reason): ${fixedToFalse}`);
  console.log(`Kept with uncertain_assignment: ${keptWithAssignment}`);
  console.log('Done.');

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error('Repair failed:', e);
  process.exit(1);
});
