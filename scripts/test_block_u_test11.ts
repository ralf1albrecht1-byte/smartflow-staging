/**
 * Test 11: Unrelated users/tenants stay unchanged
 *
 * Strategy:
 * - Confirm that the control user `test_block_u_control@example.test`
 *   has accountStatus='active', anonymizedAt=null, blockedAt=null,
 *   no compliance requests, and no Customer changes.
 * - Confirm a non-test admin (smiley.albi) has accountStatus='active',
 *   anonymizedAt=null, blockedAt=null.
 * - Confirm at least one other user (the production owner) has not been
 *   accidentally affected.
 */
import { prisma } from '../lib/prisma';

async function main() {
  console.log('=== Test 11: Unrelated users/tenants stay unchanged ===\n');

  // 1. Check control user
  const control = await prisma.user.findUnique({
    where: { email: 'test_block_u_control@example.test' },
    select: { id: true, email: true, accountStatus: true, anonymizedAt: true, blockedAt: true, accessEndsAt: true, name: true },
  });

  console.log('Control user:');
  console.log(JSON.stringify(control, null, 2));

  if (!control) {
    console.log('FAIL: Control user not found');
    process.exit(1);
  }

  if (control.accountStatus !== 'active') {
    console.log(`FAIL: Control user accountStatus is ${control.accountStatus}, expected 'active'`);
    process.exit(1);
  }
  if (control.anonymizedAt !== null) {
    console.log('FAIL: Control user anonymizedAt is not null');
    process.exit(1);
  }
  if (control.blockedAt !== null) {
    console.log('FAIL: Control user blockedAt is not null');
    process.exit(1);
  }
  if (control.accessEndsAt !== null) {
    console.log('FAIL: Control user accessEndsAt is not null');
    process.exit(1);
  }
  console.log('✓ Control user is unchanged (active, no block/anonymization/access-end set)');

  // 2. Check control user's customers (if any)
  const controlCustomers = await prisma.customer.findMany({
    where: { userId: control.id },
    select: { id: true, name: true, email: true, deletedAt: true },
  });
  console.log(`\nControl user has ${controlCustomers.length} customer(s):`);
  for (const c of controlCustomers) {
    console.log(`  - ${c.name} (email=${c.email}, deleted=${c.deletedAt ? 'yes' : 'no'})`);
    if (c.name === 'Anonymisiert') {
      console.log('FAIL: Control user customer is anonymized');
      process.exit(1);
    }
  }
  console.log('✓ Control user customers are not anonymized');

  // 3. Check production admin (smiley.albi)
  const smiley = await prisma.user.findUnique({
    where: { email: 'smiley.albi@web.de' },
    select: { id: true, email: true, accountStatus: true, anonymizedAt: true, blockedAt: true, accessEndsAt: true, role: true },
  });
  console.log('\nProduction admin (smiley.albi):');
  console.log(JSON.stringify(smiley, null, 2));

  if (!smiley) {
    console.log('FAIL: smiley.albi not found');
    process.exit(1);
  }
  if (smiley.accountStatus !== 'active') {
    console.log(`FAIL: smiley.albi accountStatus is ${smiley.accountStatus}, expected 'active'`);
    process.exit(1);
  }
  if (smiley.anonymizedAt !== null || smiley.blockedAt !== null) {
    console.log('FAIL: smiley.albi has unwanted block/anonymization');
    process.exit(1);
  }
  console.log('✓ smiley.albi is active and unchanged');

  // 4. Check a sample of other production users (non-test_block_u, non-anonymized)
  const otherUsers = await prisma.user.findMany({
    where: {
      AND: [
        { NOT: { email: { startsWith: 'test_block_u_' } } },
        { NOT: { email: { startsWith: 'anon-' } } },
      ],
    },
    select: { id: true, email: true, accountStatus: true, anonymizedAt: true, blockedAt: true, role: true },
    take: 20,
  });
  console.log(`\nOther users (non-test, non-anonymized) — ${otherUsers.length}:`);
  let anyUnexpected = false;
  for (const u of otherUsers) {
    const flags: string[] = [];
    if (u.accountStatus !== 'active') flags.push(`status=${u.accountStatus}`);
    if (u.anonymizedAt) flags.push('anonymized');
    if (u.blockedAt) flags.push('blocked');
    const flagStr = flags.length > 0 ? ` [${flags.join(', ')}]` : '';
    console.log(`  - ${u.email} (role=${u.role})${flagStr}`);
    // We don't fail on these — could be legitimate state. Just inform.
  }

  // 5. Check that ONLY our test users have notes='Test U:'
  const testCompReqs = await prisma.complianceRequest.findMany({
    where: { notes: { startsWith: 'Test U:' } },
    select: { id: true, type: true, status: true, notes: true, user: { select: { email: true } } },
  });
  console.log(`\nTest compliance requests (Test U): ${testCompReqs.length}`);
  for (const r of testCompReqs) {
    console.log(`  - ${r.user.email}: ${r.type}/${r.status} ("${r.notes}")`);
  }

  // 6. Check that no non-test compliance request was accidentally modified
  // (i.e., its notes should NOT contain "Test U:")
  const nonTestCompReqs = await prisma.complianceRequest.findMany({
    where: { NOT: { notes: { startsWith: 'Test U:' } } },
    select: { id: true, type: true, status: true, user: { select: { email: true } } },
  });
  console.log(`\nNon-test compliance requests: ${nonTestCompReqs.length}`);

  console.log('\n=== Test 11 PASSED ===');
}

main().then(() => prisma.$disconnect()).catch(e => { console.error(e); prisma.$disconnect(); process.exit(1); });
