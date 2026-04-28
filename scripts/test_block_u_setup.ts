/**
 * Block U test setup — creates 8 test users to cover all 11 acceptance scenarios.
 *
 * Cleans up old test data first (only test_block_u_* users), then creates fresh.
 */
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { getCurrentVersion } from '../lib/legal-versions';

const prisma = new PrismaClient();

const TEST_PREFIX = 'test_block_u_';

async function ensureUser(opts: {
  emailKey: string;        // unique identifier suffix
  name: string;
  role?: 'user' | 'admin';
  accountStatus?: string;
  accessEndsAt?: Date | null;
  blockedAt?: Date | null;
  blockedReason?: string | null;
  anonymizedAt?: Date | null;
}) {
  const email = `${TEST_PREFIX}${opts.emailKey}@example.test`;
  const password = await bcrypt.hash('Test1234!', 10);
  const user = await prisma.user.upsert({
    where: { email },
    update: {
      name: opts.name,
      role: opts.role ?? 'user',
      accountStatus: opts.accountStatus ?? 'active',
      accessEndsAt: opts.accessEndsAt ?? null,
      blockedAt: opts.blockedAt ?? null,
      blockedReason: opts.blockedReason ?? null,
      anonymizedAt: opts.anonymizedAt ?? null,
      password,
      emailVerified: new Date(),
    },
    create: {
      email,
      name: opts.name,
      role: opts.role ?? 'user',
      accountStatus: opts.accountStatus ?? 'active',
      accessEndsAt: opts.accessEndsAt ?? null,
      blockedAt: opts.blockedAt ?? null,
      blockedReason: opts.blockedReason ?? null,
      anonymizedAt: opts.anonymizedAt ?? null,
      password,
      emailVerified: new Date(),
      acceptedTermsAt: new Date(),
    },
  });

  // Compliance records (3 documents) so that protected pages can be reached.
  for (const documentType of ['terms', 'privacy', 'avv'] as const) {
    const existing = await prisma.consentRecord.findFirst({
      where: { userId: user.id, documentType },
      select: { id: true },
    });
    if (!existing) {
      await prisma.consentRecord.create({
        data: {
          userId: user.id,
          documentType,
          documentVersion: getCurrentVersion(documentType),
          userAgent: 'block-u-test-setup',
        },
      });
    }
  }

  return user;
}

async function main() {
  // 1. Future-cancelled user: accessEndsAt in 7 days. Should login.
  const futureCancel = await ensureUser({
    emailKey: 'future_cancel',
    name: 'Future Cancel',
    accountStatus: 'cancelled',
    accessEndsAt: new Date(Date.now() + 7 * 24 * 3600 * 1000),
  });

  // 2. Past-cancelled user: accessEndsAt 1 day ago. Login blocked.
  const pastCancel = await ensureUser({
    emailKey: 'past_cancel',
    name: 'Past Cancel',
    accountStatus: 'cancelled',
    accessEndsAt: new Date(Date.now() - 24 * 3600 * 1000),
  });

  // 3. Blocked user: accountStatus='blocked', blockedAt now. Login blocked.
  const blockedU = await ensureUser({
    emailKey: 'blocked',
    name: 'Blocked User',
    accountStatus: 'blocked',
    blockedAt: new Date(),
    blockedReason: 'Test sperrung',
  });

  // 4. Anonymized user: should not be reactivatable.
  const anonU = await ensureUser({
    emailKey: 'anonymized',
    name: 'Anonymized User',
    accountStatus: 'anonymized',
    anonymizedAt: new Date(),
    blockedAt: new Date(),
    blockedReason: 'Anonymisiert',
  });

  // 5. Active control user: should never be touched by other admin actions.
  const controlU = await ensureUser({
    emailKey: 'control',
    name: 'Control User',
    accountStatus: 'active',
  });

  // 6. Active for "session kicked out" test (will be blocked mid-session).
  const sessionTest = await ensureUser({
    emailKey: 'session_test',
    name: 'Session Test User',
    accountStatus: 'active',
  });

  // 7. Data export test user.
  const dataExportU = await ensureUser({
    emailKey: 'data_export',
    name: 'Data Export User',
    accountStatus: 'active',
  });

  // 8. Second admin (so test 8 — last-admin-check — can succeed for a deletable secondary)
  const secondAdmin = await ensureUser({
    emailKey: 'second_admin',
    name: 'Second Admin',
    role: 'admin',
    accountStatus: 'active',
  });

  // 9. User to be anonymized (Test 5, 6).
  const anonTarget = await ensureUser({
    emailKey: 'to_anonymize',
    name: 'To Anonymize',
    accountStatus: 'active',
  });

  // 10. User for self-protection test on second admin (Test 7).
  // This user is the second admin actually.

  // 11. User for compliance request flows (Test 9).
  const deletionUser = await ensureUser({
    emailKey: 'deletion_user',
    name: 'Deletion User',
    accountStatus: 'active',
  });

  // Create some compliance requests for our test users.
  const reqsToCreate = [
    {
      userId: deletionUser.id,
      type: 'data_deletion',
      status: 'in_progress',
      notes: 'Test U: deletion completion guard',
    },
    {
      userId: dataExportU.id,
      type: 'data_export',
      status: 'open',
      notes: 'Test U: data export still works',
    },
    {
      userId: futureCancel.id,
      type: 'account_cancellation',
      status: 'open',
      notes: 'Test U: cancellation with future grace period',
    },
    {
      userId: anonTarget.id,
      type: 'data_deletion',
      status: 'in_progress',
      notes: 'Test U: anonymization flow',
    },
    {
      userId: blockedU.id,
      type: 'data_deletion',
      status: 'in_progress',
      notes: 'Test U: blocked → reactivate flow',
    },
    {
      userId: secondAdmin.id,
      type: 'data_deletion',
      status: 'in_progress',
      notes: 'Test U: admin self-block protection (secondary admin)',
    },
  ];

  // Remove existing test compliance requests first to avoid duplication.
  await prisma.complianceRequest.deleteMany({
    where: {
      notes: { startsWith: 'Test U:' },
    },
  });
  for (const r of reqsToCreate) {
    await prisma.complianceRequest.create({ data: r });
  }

  console.log('=== Test users seeded ===');
  console.log('All have password: Test1234!');
  console.log(JSON.stringify({
    futureCancel: futureCancel.email,
    pastCancel: pastCancel.email,
    blocked: blockedU.email,
    anonymized: anonU.email,
    control: controlU.email,
    sessionTest: sessionTest.email,
    dataExport: dataExportU.email,
    secondAdmin: secondAdmin.email,
    anonTarget: anonTarget.email,
    deletionUser: deletionUser.email,
  }, null, 2));

  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
