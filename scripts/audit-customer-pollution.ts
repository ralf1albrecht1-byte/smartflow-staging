/* eslint-disable no-console */
/**

* scripts/audit-customer-pollution.ts
*
* READ-ONLY audit script.
  */

import { PrismaClient } from '@prisma/client';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';

const AUDIT_DB = (process.env.AUDIT_DB || 'dev').toLowerCase();
const AUDIT_LIMIT = process.env.AUDIT_LIMIT ? Number(process.env.AUDIT_LIMIT) : 10_000;

const REPORTS_DIR = path.resolve(__dirname, '../reports');
const CSV_PATH = path.join(REPORTS_DIR, 'customer-pollution-audit.csv');
const MD_PATH = path.join(REPORTS_DIR, 'customer-pollution-audit-summary.md');

const TWILIO_SANDBOX_DIGITS: string[] = ['14155238886', '4155238886'];
const SUSPICIOUS_YEAR_LIKE_PLZ = /^20[2-3]\d$/;

function looksSuspiciousCity(c: string | null | undefined): { suspicious: boolean; reason: string } {
if (!c) return { suspicious: false, reason: '' };
const t = c.trim();
if (!t) return { suspicious: false, reason: '' };
if (t.length < 2) return { suspicious: true, reason: 'city_too_short' };
if (/^\d+$/.test(t)) return { suspicious: true, reason: 'city_digits_only' };
if (/^T\d/.test(t)) return { suspicious: true, reason: 'city_looks_like_iso_time' };
return { suspicious: false, reason: '' };
}

function maskPhone(p: string | null | undefined): string {
if (!p) return '';
const t = p.trim();
if (t.length <= 4) return '****';
return `${t.slice(0, 3)}***${t.slice(-2)}`;
}

function maskName(n: string | null | undefined): string {
if (!n) return '';
const t = n.trim();
if (t.startsWith('⚠️ Unbekannt')) return t;
if (t.length <= 2) return `${t[0] || '?'}*`;
return `${t[0]}***${t[t.length - 1]}`;
}

function extractIsoYearsFromText(text: string): string[] {
const years = new Set<string>();
const re = /\b(20\d{2})-\d{2}-\d{2}/g;
let m: RegExpExecArray | null;

while ((m = re.exec(text)) !== null) {
years.add(m[1]);
}

return Array.from(years);
}

function phoneTailMatchesNotes(phoneDigits: string, notesText: string): boolean {
if (!phoneDigits || phoneDigits.length < 6) return false;
const tail = phoneDigits.slice(-6);
const noteDigits = notesText.replace(/\D+/g, '');
return noteDigits.includes(tail);
}

function csvEscape(s: string | null | undefined): string {
const t = (s ?? '').toString();
if (/[",\n\r]/.test(t)) return `"${t.replace(/"/g, '""')}"`;
return t;
}

async function main(): Promise<void> {
const databaseUrl =
AUDIT_DB === 'prod'
? process.env.PROD_DATABASE_URL
: process.env.DATABASE_URL;

if (!databaseUrl) {
console.error(`[audit] No ${AUDIT_DB === 'prod' ? 'PROD_DATABASE_URL' : 'DATABASE_URL'} in env. Aborting.`);
process.exit(1);
}

const prisma = new PrismaClient({
datasources: { db: { url: databaseUrl } },
});

console.log(`[audit] Connected to ${AUDIT_DB.toUpperCase()} database. Limit per table: ${AUDIT_LIMIT}`);

const customers = await prisma.customer.findMany({
where: { deletedAt: null },
select: {
id: true,
userId: true,
name: true,
phone: true,
address: true,
plz: true,
city: true,
},
take: AUDIT_LIMIT,
orderBy: { createdAt: 'desc' },
});

console.log(`[audit] Loaded ${customers.length} customer rows.`);

const findings: Array<{
customerId: string;
userId: string | null;
nameMasked: string;
nameStartsWithFallback: boolean;
phoneMasked: string;
plz: string | null;
city: string | null;
address: string | null;
reasons: string[];
}> = [];

type Finding = (typeof findings)[number];

let suspiciousCount = 0;
let twilioPhoneCount = 0;
let yearLikePlzCount = 0;
let suspiciousCityCount = 0;
let phoneFromMetaCount = 0;

for (const c of customers) {
const reasons: string[] = [];
const phoneDigits = (c.phone || '').replace(/\D+/g, '');
const isFallback = (c.name || '').trimStart().startsWith('⚠️ Unbekannt');

```
if (phoneDigits) {
  if (TWILIO_SANDBOX_DIGITS.some((d: string) => phoneDigits === d || phoneDigits.endsWith(d))) {
    reasons.push('phone_is_twilio_sandbox');
    twilioPhoneCount++;
  }
}

if (c.plz && SUSPICIOUS_YEAR_LIKE_PLZ.test(String(c.plz).trim())) {
  reasons.push('plz_looks_like_year');
  yearLikePlzCount++;
}

const cityCheck = looksSuspiciousCity(c.city);

if (cityCheck.suspicious) {
  reasons.push(cityCheck.reason);
  suspiciousCityCount++;
}

if (reasons.length === 0) continue;

if (phoneDigits && phoneDigits.length >= 6) {
  const orders: Array<{ notes: string | null }> = await prisma.order.findMany({
    where: { customerId: c.id, notes: { not: null } },
    select: { notes: true },
  });

  const allNotes = orders.map((o: { notes: string | null }) => o.notes || '').join('\n');

  const metaLines = allNotes
    .split(/\r?\n/)
    .filter((l: string) => /\[META\]/i.test(l) || /Telefon\s*\(Absender/i.test(l) || /^\s*Telefon\s*:/i.test(l))
    .join('\n');

  if (metaLines && phoneTailMatchesNotes(phoneDigits, metaLines)) {
    reasons.push('phone_matches_meta_sender');
    phoneFromMetaCount++;
  }

  if (c.plz && SUSPICIOUS_YEAR_LIKE_PLZ.test(String(c.plz).trim())) {
    const years = extractIsoYearsFromText(allNotes);

    if (years.includes(String(c.plz).trim())) {
      reasons.push('plz_matches_iso_year_in_notes');
    }
  }
}

findings.push({
  customerId: c.id,
  userId: c.userId,
  nameMasked: maskName(c.name),
  nameStartsWithFallback: isFallback,
  phoneMasked: maskPhone(c.phone),
  plz: c.plz,
  city: c.city,
  address: c.address,
  reasons,
});

suspiciousCount++;
```

}

await prisma.$disconnect();

await fs.mkdir(REPORTS_DIR, { recursive: true });

const csvHeader = [
'customerId',
'userId',
'nameMasked',
'nameStartsWithFallback',
'phoneMasked',
'plz',
'city',
'address',
'reasons',
].join(',');

const csvRows = findings.map((f: Finding) =>
[
f.customerId,
f.userId || '',
csvEscape(f.nameMasked),
f.nameStartsWithFallback ? 'true' : 'false',
csvEscape(f.phoneMasked),
csvEscape(f.plz),
csvEscape(f.city),
csvEscape(f.address),
csvEscape(f.reasons.join('|')),
].join(','),
);

await fs.writeFile(CSV_PATH, [csvHeader, ...csvRows].join('\n'), 'utf8');
console.log(`[audit] CSV written: ${CSV_PATH}  (${csvRows.length} rows)`);

const md = [
`# Customer pollution audit (${AUDIT_DB.toUpperCase()})`,
'',
`Generated: ${new Date().toISOString()}`,
`Customers scanned: **${customers.length}** (limit ${AUDIT_LIMIT})`,
`Suspect customers: **${suspiciousCount}**`,
'',
'## Breakdown by reason',
'',
'| Reason | Count |',
'|---|---|',
`| phone_is_twilio_sandbox | ${twilioPhoneCount} |`,
`| plz_looks_like_year | ${yearLikePlzCount} |`,
`| city_too_short / city_digits_only / city_looks_like_iso_time | ${suspiciousCityCount} |`,
`| phone_matches_meta_sender (cross-check vs order notes) | ${phoneFromMetaCount} |`,
'',
'## Top 50 suspect rows (masked)',
'',
'| customerId | userId | name | fallback? | phone | plz | city | reasons |',
'|---|---|---|---|---|---|---|---|',
...findings.slice(0, 50).map((f: Finding) =>
`| ${f.customerId} | ${f.userId || '—'} | ${f.nameMasked || '—'} | ${f.nameStartsWithFallback ? 'yes' : 'no'} | ${f.phoneMasked || '—'} | ${f.plz || '—'} | ${f.city || '—'} | ${f.reasons.join(', ')} |`,
),
'',
'## What this audit does NOT do',
'',
'- It does not modify any data.',
'- It does not create, update or delete any rows.',
'- It does not run in any deployment pipeline.',
'',
'## Next steps',
'',
'- Review the rows above. Cleanup is opt-in and requires separate approval.',
'- A cleanup can be limited to fields with high confidence.',
'',
].join('\n');

await fs.writeFile(MD_PATH, md, 'utf8');
console.log(`[audit] Markdown summary written: ${MD_PATH}`);

console.log(`[audit] DONE. ${suspiciousCount} suspect customer(s) found.`);
}

main().catch((err: unknown) => {
console.error('[audit] FATAL:', err);
process.exit(1);
});
