/**

* staging-fix-login.ts
*
* Diagnoses and fixes the staging admin login for [smiley.albi@web.de](mailto:smiley.albi@web.de).
*
* SAFETY GUARDS:
* 1. Refuses to run unless APP_ENV === "staging"
* 2. Prints DATABASE_URL host/database before any changes
* 3. Never runs against Production
* 4. Never deletes existing users
* 5. Only touches [smiley.albi@web.de](mailto:smiley.albi@web.de)
*
* Run on Railway staging:
* npx tsx scripts/staging-fix-login.ts
  */
  import { PrismaClient } from '@prisma/client';
  import bcrypt from 'bcryptjs';

const ADMIN_EMAIL = '[smiley.albi@web.de](mailto:smiley.albi@web.de)';
const ADMIN_PASSWORD = '1234Test';
const ADMIN_NAME = 'Ralf Albrecht';

const appEnv = (process.env.APP_ENV || '').trim().toLowerCase();
if (appEnv !== 'staging') {
console.error('\n❌ SAFETY BLOCK: APP_ENV is not "staging".');
console.error(`   Current APP_ENV = "${process.env.APP_ENV || '(not set)'}"`);
console.error('   This script may only run in a staging environment.');
console.error('   Set APP_ENV=staging in your Railway environment variables.\n');
process.exit(1);
}

const dbUrl = process.env.DATABASE_URL || '';
if (!dbUrl) {
console.error('\n❌ SAFETY BLOCK: DATABASE_URL is not set.');
console.error('   Cannot proceed without a database connection.\n');
process.exit(1);
}

let dbHost = '(unknown)';
let dbName = '(unknown)';

try {
const parsed = new URL(dbUrl);
dbHost = parsed.hostname;
dbName = parsed.pathname.replace(/^//, '') || '(default)';
} catch {
const hostMatch = dbUrl.match(/@([^:/]+)/);
const nameMatch = dbUrl.match(//([^?]+)(?|$)/);
if (hostMatch) dbHost = hostMatch[1];
if (nameMatch) dbName = nameMatch[1];
}

const KNOWN_PROD_HOSTS = ['db-37f1be1ce.db004.hosteddb.reai.io'];
const KNOWN_PROD_DBS = ['37f1be1ce'];

if (KNOWN_PROD_HOSTS.includes(dbHost) || KNOWN_PROD_DBS.includes(dbName)) {
console.error('\n❌ SAFETY BLOCK: DATABASE_URL points to a KNOWN PRODUCTION database!');
console.error(`   Host: ${dbHost}`);
console.error(`   Database: ${dbName}`);
console.error('   This script refuses to run against Production.');
console.error('   Fix DATABASE_URL in your Railway environment variables.\n');
process.exit(1);
}

console.log('\n── Staging Login Diagnostic & Fix ─────────────────────────────');
console.log(`APP_ENV:    ${process.env.APP_ENV}`);
console.log(`DB Host:    ${dbHost}`);
console.log(`DB Name:    ${dbName}`);
console.log(`Target:     ${ADMIN_EMAIL}`);
console.log(`Password:   ${ADMIN_PASSWORD}`);
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
console.log('❌ User NOT FOUND. Creating staging admin...');

```
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
  },
});

fixes.push('Created staging admin user from scratch');
console.log('✅ User created:', user.id);
```

} else {
console.log('✅ User found:', user.id);
console.log('   email:          ', user.email);
console.log('   name:           ', user.name);
console.log('   role:           ', user.role);
console.log('   emailVerified:  ', user.emailVerified);
console.log('   accountStatus:  ', (user as any).accountStatus);
console.log('   accessEndsAt:   ', (user as any).accessEndsAt);
console.log('   blockedAt:      ', (user as any).blockedAt);
console.log('   blockedReason:  ', (user as any).blockedReason);
console.log('   anonymizedAt:   ', (user as any).anonymizedAt);
console.log('   password set:   ', !!user.password);
console.log();

```
const newHash = await bcrypt.hash(ADMIN_PASSWORD, 10);

if (!user.password) {
  fixes.push('Password was NULL → set to ' + ADMIN_PASSWORD);
} else {
  const matches = await bcrypt.compare(ADMIN_PASSWORD, user.password);

  if (!matches) {
    fixes.push('Password hash did NOT match ' + ADMIN_PASSWORD + ' → reset');
  } else {
    console.log('✅ Password already matches ' + ADMIN_PASSWORD);
  }
}

const updateData: any = { password: newHash };

if (!user.emailVerified) {
  updateData.emailVerified = new Date();
  fixes.push('emailVerified was NULL → set to now()');
}

if ((user as any).accountStatus !== 'active') {
  updateData.accountStatus = 'active';
  fixes.push(`accountStatus was '${(user as any).accountStatus}' → set to 'active'`);
}

if ((user as any).accessEndsAt) {
  updateData.accessEndsAt = null;
  fixes.push(`accessEndsAt was ${(user as any).accessEndsAt} → cleared`);
}

if ((user as any).blockedAt) {
  updateData.blockedAt = null;
  updateData.blockedReason = null;
  fixes.push('blockedAt was set → cleared');
}

if ((user as any).anonymizedAt) {
  updateData.anonymizedAt = null;
  updateData.anonymizedBy = null;
  fixes.push('anonymizedAt was set → cleared');
}

if (user.role !== 'admin') {
  updateData.role = 'admin';
  fixes.push(`role was '${user.role}' → set to 'admin'`);
}

if (user.email !== ADMIN_EMAIL) {
  updateData.email = ADMIN_EMAIL;
  fixes.push(`email was '${user.email}' → normalized to '${ADMIN_EMAIL}'`);
}

await prisma.user.update({
  where: { id: user.id },
  data: updateData,
});

console.log('✅ User record updated (no deletions)');
```

}

let consentVersion = '1.0';

try {
const mod = await import('../lib/legal-versions');
if (mod.getCurrentVersion) {
consentVersion = mod.getCurrentVersion('terms');
}
} catch {
// use fallback
}

for (const docType of ['terms', 'privacy', 'avv'] as const) {
const existing = await prisma.consentRecord.findFirst({
where: { userId: user.id, documentType: docType },
});

```
if (!existing) {
  await prisma.consentRecord.create({
    data: {
      userId: user.id,
      documentType: docType,
      documentVersion: consentVersion,
      userAgent: 'staging-fix-script',
    },
  });

  fixes.push(`ConsentRecord '${docType}' was missing → created`);
}
```

}

const allUsers = await prisma.user.findMany({
where: { email: { equals: ADMIN_EMAIL, mode: 'insensitive' } },
select: { id: true, email: true, emailVerified: true, createdAt: true },
orderBy: { createdAt: 'asc' },
});

if (allUsers.length > 1) {
console.log(`\n⚠️  WARNING: ${allUsers.length} users with email ${ADMIN_EMAIL}:`);

```
allUsers.forEach(
  (
    u: {
      id: string;
      email: string;
      emailVerified: Date | null;
      createdAt: Date;
    },
    i: number
  ) => {
    console.log(`   [${i}] id=${u.id} verified=${u.emailVerified} created=${u.createdAt}`);
  }
);

console.log('   Login uses the VERIFIED + NEWEST one. Consider manual cleanup.');
console.log('   (This script does NOT delete any users.)');
```

}

console.log('\n── SUMMARY ─────────────────────────────────────────');
if (fixes.length === 0) {
console.log('No fixes needed — user was already correctly configured.');
console.log('\nIf login still fails, check Railway env vars:');
console.log('  • NEXTAUTH_SECRET must be set (any non-empty string)');
console.log('  • NEXTAUTH_URL must match your Railway app URL');
console.log('  • DATABASE_URL must point to staging DB');
} else {
console.log(`Applied ${fixes.length} fix(es):`);
fixes.forEach((f: string, i: number) => console.log(`  ${i + 1}. ${f}`));
}

console.log(`\n✅ Login should now work with:`);
console.log(`   Email:    ${ADMIN_EMAIL}`);
console.log(`   Password: ${ADMIN_PASSWORD}\n`);
}

main()
.catch((e: unknown) => {
console.error('\n❌ Script failed:', e);
process.exit(1);
})
.finally(() => prisma.$disconnect());
