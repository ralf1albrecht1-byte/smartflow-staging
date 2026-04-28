/**
 * Block U Test Cleanup — restores test_block_u_session_test to active and
 * optionally deletes ALL test_block_u_* users + compliance requests.
 *
 * Set CLEANUP=full to delete; otherwise just reactivates session_test.
 */
import { prisma } from '../lib/prisma';

async function main() {
  console.log('=== Block U Test Cleanup ===\n');

  // 1) Reactivate test_block_u_session_test (was blocked from Test 4)
  const sessionUser = await prisma.user.findUnique({
    where: { email: 'test_block_u_session_test@example.test' },
    select: { id: true, accountStatus: true, blockedAt: true },
  });
  if (sessionUser) {
    if (sessionUser.accountStatus === 'blocked') {
      await prisma.user.update({
        where: { id: sessionUser.id },
        data: {
          accountStatus: 'active',
          blockedAt: null,
          blockedReason: null,
        },
      });
      console.log('✓ Reactivated test_block_u_session_test');
    } else {
      console.log(`session_test already in status ${sessionUser.accountStatus}`);
    }
  }

  if (process.env.CLEANUP === 'full') {
    console.log('\n=== Full cleanup: deleting all test_block_u_* users ===');

    const users = await prisma.user.findMany({
      where: {
        OR: [
          { email: { startsWith: 'test_block_u_' } },
          { email: { startsWith: 'anon-' } },
        ],
      },
      select: { id: true, email: true },
    });
    console.log(`Found ${users.length} test users to delete`);

    for (const u of users) {
      // Delete dependent rows first
      await prisma.complianceRequest.deleteMany({ where: { userId: u.id } });
      await prisma.consentRecord.deleteMany({ where: { userId: u.id } });
      await prisma.session.deleteMany({ where: { userId: u.id } });
      await prisma.account.deleteMany({ where: { userId: u.id } });
      await prisma.customer.deleteMany({ where: { userId: u.id } });
      await prisma.user.delete({ where: { id: u.id } });
      console.log(`  Deleted ${u.email}`);
    }

    // Delete remaining test_u compliance requests (in case any orphaned)
    const orphans = await prisma.complianceRequest.deleteMany({
      where: { notes: { startsWith: 'Test U:' } },
    });
    console.log(`  Deleted ${orphans.count} orphan compliance requests`);
  } else {
    console.log('\nFull cleanup skipped. Set CLEANUP=full to delete all test users.');
  }

  console.log('\n=== Done ===');
}

main().then(() => prisma.$disconnect()).catch(e => { console.error(e); prisma.$disconnect(); process.exit(1); });
