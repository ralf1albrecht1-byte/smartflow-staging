import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const ADMIN_EMAIL = '[smiley.albi@web.de](mailto:smiley.albi@web.de)';
const ADMIN_PASSWORD = '1234Test';
const ADMIN_NAME = 'Ralf Albrecht';

const appEnv = (process.env.APP_ENV || '').trim().toLowerCase();

if (appEnv !== 'staging') {
console.error('\n❌ SAFETY BLOCK: APP_ENV is not "staging".');
console.error(`Current APP_ENV = "${process.env.APP_ENV || '(not set)'}"`);
process.exit(1);
}

const dbUrl = process.env.DATABASE_URL || '';

if (!dbUrl) {
console.error('\n❌ SAFETY BLOCK: DATABASE_URL is not set.');
process.exit(1);
}

let dbHost = '(unknown)';
let dbName = '(unknown)';

try {
const parsed = new URL(dbUrl);
dbHost = parsed.hostname;
dbName = parsed.pathname.startsWith('/') ? parsed.pathname.slice(1) : parsed.pathname;
if (!dbName) dbName = '(default)';
} catch {
dbHost = '(unknown)';
dbName = '(unknown)';
}

const KNOWN_PROD_HOSTS = ['db-37f1be1ce.db004.hosteddb.reai.io'];
const KNOWN_PROD_DBS = ['37f1be1ce'];

if (KNOWN_PROD_HOSTS.includes(dbHost) || KNOWN_PROD_DBS.includes(dbName)) {
console.error('\n❌ SAFETY BLOCK: DATABASE_URL points to a KNOWN PRODUCTION database!');
console.error(`Host: ${dbHost}`);
console.error(`Database: ${dbName}`);
process.exit(1);
}

console.log('\n── Staging Login Diagnostic & Fix ─────────────────────────────');
console.log(`APP_ENV: ${process.env.APP_ENV}`);
console.log(`DB Host: ${dbHost}`);
console.log(`DB Name: ${dbName}`);
console.log(`Target: ${ADMIN_EMAIL}`);
console.log();

const prisma = new PrismaClient();

async function main() {
const fixes: string[] = [];

let user = await prisma.user.findFirst({
where: { email: { equals: ADMIN_EMAIL, mode: 'insensitive' } },
orderBy: [
{ emailVerified: { sort: 'desc', nulls: 'last' } },
{ createdAt: 'desc' },
],
});

if (!user) {
const hash = await bcrypt.hash(ADMIN_PASSWORD, 10);


user = await prisma.user.create({
  data: {
    email: ADMIN_EMAIL,
    name: ADMIN_NAME,
    password: hash,
    emailVerified: new Date(),
    acceptedTermsAt: new Date(),
    role: 'admin',
    accountStatus: 'active',
  } as any,
});

fixes.push('Created staging admin user');
console.log('✅ User created:', user.id);


} else {
const newHash = await bcrypt.hash(ADMIN_PASSWORD, 10);


await prisma.user.update({
  where: { id: user.id },
  data: {
    password: newHash,
    email: ADMIN_EMAIL,
    name: user.name || ADMIN_NAME,
    role: 'admin',
    emailVerified: user.emailVerified || new Date(),
    accountStatus: 'active',
    accessEndsAt: null,
    blockedAt: null,
    blockedReason: null,
    anonymizedAt: null,
    anonymizedBy: null,
  } as any,
});

fixes.push('Updated staging admin login fields');
console.log('✅ User updated:', user.id);


}

for (const docType of ['terms', 'privacy', 'avv'] as const) {
const existing = await prisma.consentRecord.findFirst({
where: { userId: user.id, documentType: docType },
});

if (!existing) {
  await prisma.consentRecord.create({
    data: {
      userId: user.id,
      documentType: docType,
      documentVersion: 'legal-2026-04-29',
      userAgent: 'staging-fix-script',
    } as any,
  });

  fixes.push(`Created missing consent: ${docType}`);
}


}

console.log('\n── SUMMARY ─────────────────────────────────────────');
fixes.forEach((fix, i) => console.log(`${i + 1}. ${fix}`));

console.log('\n✅ Login should now work with:');
console.log(`Email: ${ADMIN_EMAIL}`);
console.log(`Password: ${ADMIN_PASSWORD}`);
}

main()
.catch((e) => {
console.error('\n❌ Script failed:', e);
process.exit(1);
})
.finally(() => prisma.$disconnect());
