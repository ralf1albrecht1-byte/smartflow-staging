import { prisma } from '../../lib/prisma';

/**
 * One-time data migration helper for trial rollout.
 *
 * - Non-admin users: accountStatus=trial, trialStart=now, trialEndDate=now+7d
 * - Admin users: accountStatus=active, no trial window
 */
async function run() {
  const now = new Date();
  const sevenDaysFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  const adminResult = await prisma.user.updateMany({
    where: {
      role: { equals: 'admin', mode: 'insensitive' },
    },
    data: {
      accountStatus: 'active',
      trialStart: null,
      trialEndDate: null,
    },
  });

  const nonAdminResult = await prisma.user.updateMany({
    where: {
      NOT: {
        role: { equals: 'admin', mode: 'insensitive' },
      },
    },
    data: {
      accountStatus: 'trial',
      trialStart: now,
      trialEndDate: sevenDaysFromNow,
      blockedAt: null,
      blockedReason: null,
    },
  });

  console.log('[migration-script] Admin users set active:', adminResult.count);
  console.log('[migration-script] Non-admin users set to trial:', nonAdminResult.count);
}

run()
  .catch((error) => {
    console.error('[migration-script] failed:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
