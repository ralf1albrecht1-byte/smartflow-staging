/* eslint-disable no-console */
/**
 * scripts/audit-phone-normalization.ts
 *
 * Phase 0 — Read-only audit of phone-number normalization drift.
 *
 * CRITICAL: This script is STRICTLY READ-ONLY.
 *  - No writes, no updates, no migrations, no schema changes.
 *  - Never calls any *.update, *.create, *.delete, or $executeRaw mutation.
 *  - Uses prisma.findMany only.
 *
 * Outputs (inside the project `nextjs_space` dir):
 *   reports/phone-audit.csv           — one row per phone value audited
 *   reports/phone-audit-summary.md    — masked human-readable summary
 *
 * Usage:
 *   cd nextjs_space
 *   yarn tsx --require dotenv/config scripts/audit-phone-normalization.ts
 *
 *   Optional env:
 *     AUDIT_DB=dev|prod    Default: dev. When `prod`, uses PROD_DATABASE_URL
 *                          (read-only). Never writes.
 *     AUDIT_LIMIT=<n>      Hard cap on rows processed per table (safety).
 */

import { PrismaClient } from '@prisma/client';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';

import {
  parsePhoneStrict,
  maskPhoneForLog,
  type ParseStatus,
} from '../lib/phone';
import { normalizePhoneE164 as oldNormalize } from '../lib/normalize';

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

type Delta = 'same' | 'diff' | 'newNull' | 'oldNull' | 'bothNull';

interface AuditRow {
  user_id: string | null;
  customer_id: string | null;
  source_table: string;
  source_field: string;
  raw_phone: string;
  old_normalized: string | null;
  new_normalized: string | null;
  delta: Delta;
  parse_status: ParseStatus | '';
  country_inferred: string | null;
  extension: string | null;
  collision_group_id: string | null;
}

// ─────────────────────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────────────────────

function csvEscape(v: string | null | undefined): string {
  if (v == null) return '';
  const s = String(v);
  // Quote if contains comma, quote, or newline.
  if (/[",\n\r]/.test(s)) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

function computeDelta(oldN: string | null, newN: string | null): Delta {
  const hasOld = !!(oldN && oldN.length);
  const hasNew = !!(newN && newN.length);
  if (!hasOld && !hasNew) return 'bothNull';
  if (hasOld && !hasNew) return 'newNull';
  if (!hasOld && hasNew) return 'oldNull';
  return oldN === newN ? 'same' : 'diff';
}

function buildRow(params: {
  userId: string | null;
  customerId: string | null;
  sourceTable: string;
  sourceField: string;
  raw: string;
}): AuditRow {
  const { userId, customerId, sourceTable, sourceField, raw } = params;

  const oldN = oldNormalize(raw);
  const parseResult = parsePhoneStrict(raw);
  const newN = parseResult.normalizedE164;
  const delta = computeDelta(oldN, newN);

  return {
    user_id: userId ?? null,
    customer_id: customerId ?? null,
    source_table: sourceTable,
    source_field: sourceField,
    raw_phone: raw,
    old_normalized: oldN,
    new_normalized: newN,
    delta,
    parse_status: parseResult.parseStatus,
    country_inferred: parseResult.country,
    extension: parseResult.extension,
    collision_group_id: null, // filled later, post-hoc
  };
}

// Assign collision group ids per (user_id, new_normalized) when new_normalized is non-null.
function assignCollisionGroups(rows: AuditRow[]) {
  const groupMap = new Map<string, string>(); // key = userId||newN → groupId
  const countMap = new Map<string, number>(); // key → occurrence count

  // 1st pass: count occurrences per (userId,newN) where newN is truthy
  for (const r of rows) {
    if (!r.new_normalized) continue;
    const uid = r.user_id ?? '__null__';
    const key = uid + '|' + r.new_normalized;
    countMap.set(key, (countMap.get(key) ?? 0) + 1);
  }

  // 2nd pass: assign group id only where count > 1
  let groupSeq = 0;
  for (const r of rows) {
    if (!r.new_normalized) continue;
    const uid = r.user_id ?? '__null__';
    const key = uid + '|' + r.new_normalized;
    const count = countMap.get(key) ?? 0;
    if (count < 2) continue;
    let id = groupMap.get(key);
    if (!id) {
      groupSeq += 1;
      id = `cg_${groupSeq}`;
      groupMap.set(key, id);
    }
    r.collision_group_id = id;
  }
}

// ─────────────────────────────────────────────────────────────
// Data fetch (READ-ONLY)
// ─────────────────────────────────────────────────────────────

async function fetchCompanySettings(prisma: PrismaClient, limit: number | null) {
  return prisma.companySettings.findMany({
    select: {
      userId: true,
      telefon: true,
      telefon2: true,
      whatsappIntakeNumber: true,
      firmenname: true,
    },
    ...(limit ? { take: limit } : {}),
  });
}

async function fetchCustomers(prisma: PrismaClient, limit: number | null) {
  return prisma.customer.findMany({
    select: {
      id: true,
      userId: true,
      phone: true,
      deletedAt: true,
    },
    ...(limit ? { take: limit } : {}),
  });
}

// ─────────────────────────────────────────────────────────────
// Report writers
// ─────────────────────────────────────────────────────────────

async function writeCsv(filePath: string, rows: AuditRow[]) {
  const header = [
    'user_id',
    'customer_id',
    'source_table',
    'source_field',
    'raw_phone',
    'old_normalized',
    'new_normalized',
    'delta',
    'parse_status',
    'country_inferred',
    'extension',
    'collision_group_id',
  ].join(',');

  const body = rows
    .map((r) =>
      [
        csvEscape(r.user_id ?? ''),
        csvEscape(r.customer_id ?? ''),
        csvEscape(r.source_table),
        csvEscape(r.source_field),
        csvEscape(r.raw_phone),
        csvEscape(r.old_normalized ?? ''),
        csvEscape(r.new_normalized ?? ''),
        csvEscape(r.delta),
        csvEscape(r.parse_status),
        csvEscape(r.country_inferred ?? ''),
        csvEscape(r.extension ?? ''),
        csvEscape(r.collision_group_id ?? ''),
      ].join(','),
    )
    .join('\n');

  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, header + '\n' + body + '\n', 'utf8');
}

function summarize(rows: AuditRow[]) {
  const stats = {
    total: rows.length,
    parseable: 0,
    unparseable: 0,
    same: 0,
    diff: 0,
    newNull: 0,
    oldNull: 0,
    bothNull: 0,
    byParseStatus: new Map<string, number>(),
    tenants: new Map<string, { total: number; collisions: number }>(),
  };

  for (const r of rows) {
    if (r.new_normalized) stats.parseable += 1;
    else stats.unparseable += 1;

    switch (r.delta) {
      case 'same': stats.same += 1; break;
      case 'diff': stats.diff += 1; break;
      case 'newNull': stats.newNull += 1; break;
      case 'oldNull': stats.oldNull += 1; break;
      case 'bothNull': stats.bothNull += 1; break;
    }

    const s = r.parse_status || 'EMPTY';
    stats.byParseStatus.set(s, (stats.byParseStatus.get(s) ?? 0) + 1);

    const uid = r.user_id ?? '__null__';
    const tenant = stats.tenants.get(uid) ?? { total: 0, collisions: 0 };
    tenant.total += 1;
    if (r.collision_group_id) tenant.collisions += 1;
    stats.tenants.set(uid, tenant);
  }

  return stats;
}

function buildTopCollisionGroups(rows: AuditRow[], tenant: string, topN: number) {
  // group within tenant
  const groups = new Map<string, AuditRow[]>();
  for (const r of rows) {
    if (!r.collision_group_id) continue;
    const uid = r.user_id ?? '__null__';
    if (uid !== tenant) continue;
    const list = groups.get(r.collision_group_id) ?? [];
    list.push(r);
    groups.set(r.collision_group_id, list);
  }
  const arr = Array.from(groups.entries()).map(([gid, list]) => ({
    groupId: gid,
    size: list.length,
    newE164: list[0].new_normalized,
    rows: list,
  }));
  arr.sort((a, b) => b.size - a.size);
  return arr.slice(0, topN);
}

async function writeMarkdownSummary(filePath: string, rows: AuditRow[], compSettingsDeltas: AuditRow[], customerCollisions: AuditRow[], inventory: { path: string; notes: string }[]) {
  const stats = summarize(rows);

  const lines: string[] = [];
  lines.push('# Phone-Normalization Audit — Phase 0 (read-only)');
  lines.push('');
  lines.push(`_Generated: ${new Date().toISOString()}_`);
  lines.push('');

  lines.push('## Executive Summary');
  lines.push('');
  lines.push('Dieser Report vergleicht die **alte** Normalisierungsfunktion (`lib/normalize.ts::normalizePhoneE164`, regex-basiert)');
  lines.push('mit der **neuen** zentralen Utility (`lib/phone.ts`, libphonenumber-js strict, keine stille Landannahme).');
  lines.push('Er enthält keine Schreiboperationen und hat **keinen** produktiven Datenstand verändert.');
  lines.push('');
  lines.push(`- Gescannte Nummern gesamt: **${stats.total}**`);
  lines.push(`- parseable (neue Logik → E.164): **${stats.parseable}**`);
  lines.push(`- unparseable (neue Logik → NULL): **${stats.unparseable}**`);
  lines.push(`- delta=same: **${stats.same}**`);
  lines.push(`- delta=diff: **${stats.diff}**`);
  lines.push(`- delta=newNull (alt hat Wert, neu NULL): **${stats.newNull}**`);
  lines.push(`- delta=oldNull (alt NULL, neu hat Wert): **${stats.oldNull}**`);
  lines.push(`- delta=bothNull: **${stats.bothNull}**`);
  lines.push('');

  lines.push('## Parse-Status-Verteilung');
  lines.push('');
  lines.push('| parse_status | count |');
  lines.push('|---|---|');
  const byStatus = Array.from(stats.byParseStatus.entries()).sort((a, b) => b[1] - a[1]);
  for (const [s, n] of byStatus) lines.push(`| ${s} | ${n} |`);
  lines.push('');

  lines.push('## Inventar der gescannten Code-Pfade');
  lines.push('');
  lines.push('| Pfad | Heute gefundene Normalisierungs-/Matching-Logik |');
  lines.push('|---|---|');
  for (const i of inventory) {
    lines.push(`| \`${i.path}\` | ${i.notes.replace(/\|/g, '\\|')} |`);
  }
  lines.push('');

  lines.push('## Tenants / Kollisionen');
  lines.push('');
  lines.push('| user_id (masked) | total | collisions |');
  lines.push('|---|---|---|');
  const tenantArr = Array.from(stats.tenants.entries())
    .map(([uid, v]) => ({ uid, ...v }))
    .sort((a, b) => b.collisions - a.collisions);
  for (const t of tenantArr) {
    const short = t.uid === '__null__' ? '(null)' : `${t.uid.slice(0, 6)}…`;
    lines.push(`| ${short} | ${t.total} | ${t.collisions} |`);
  }
  lines.push('');

  lines.push('## Top-20 Kollisionsgruppen (pro Tenant mit Kollisionen)');
  lines.push('');
  lines.push('Gruppierung: dieselbe neue E.164 tritt innerhalb **derselben** `userId` mehrfach auf.');
  lines.push('Telefonnummern sind maskiert.');
  lines.push('');
  const tenantsWithColl = tenantArr.filter((t) => t.collisions > 0);
  if (tenantsWithColl.length === 0) {
    lines.push('_Keine Kollisionen erkannt._');
  } else {
    for (const t of tenantsWithColl) {
      const short = t.uid === '__null__' ? '(null)' : `${t.uid.slice(0, 6)}…`;
      lines.push(`### Tenant ${short}`);
      const top = buildTopCollisionGroups(rows, t.uid, 20);
      lines.push('');
      lines.push('| group | size | new_normalized (masked) | members (source:id) |');
      lines.push('|---|---|---|---|');
      for (const g of top) {
        const members = g.rows.map((r) => `${r.source_table}.${r.source_field}:${r.customer_id ?? r.user_id ?? '?'}`).join(', ');
        lines.push(`| ${g.groupId} | ${g.size} | ${maskPhoneForLog(g.newE164)} | ${members} |`);
      }
      lines.push('');
    }
  }

  lines.push('## Routing-Risiko: CompanySettings Delta');
  lines.push('');
  lines.push('Zeilen, bei denen sich `old_normalized` und `new_normalized` unterscheiden');
  lines.push('oder bei denen eine Seite NULL ist — das heißt, Webhook-Routing könnte unter neuer Logik anders greifen.');
  lines.push('');
  if (compSettingsDeltas.length === 0) {
    lines.push('_Keine Deltas auf CompanySettings gefunden._');
  } else {
    lines.push('| userId (masked) | field | old (masked) | new (masked) | delta | parse_status |');
    lines.push('|---|---|---|---|---|---|');
    for (const r of compSettingsDeltas.slice(0, 500)) {
      const short = r.user_id ? `${r.user_id.slice(0, 6)}…` : '(null)';
      lines.push(`| ${short} | ${r.source_field} | ${maskPhoneForLog(r.old_normalized ?? r.raw_phone)} | ${maskPhoneForLog(r.new_normalized ?? '')} | ${r.delta} | ${r.parse_status} |`);
    }
  }
  lines.push('');

  lines.push('## Matching-Risiko: Customer Collision');
  lines.push('');
  lines.push('Zeilen aus `Customer`, die innerhalb desselben `user_id` auf eine neue E.164 kollidieren.');
  lines.push('');
  if (customerCollisions.length === 0) {
    lines.push('_Keine Customer-Kollisionen gefunden._');
  } else {
    lines.push('| group | userId (masked) | customerId | new (masked) |');
    lines.push('|---|---|---|---|');
    for (const r of customerCollisions.slice(0, 500)) {
      const short = r.user_id ? `${r.user_id.slice(0, 6)}…` : '(null)';
      lines.push(`| ${r.collision_group_id} | ${short} | ${r.customer_id} | ${maskPhoneForLog(r.new_normalized ?? '')} |`);
    }
  }
  lines.push('');

  lines.push('## Unparseable Samples (max 200, maskiert)');
  lines.push('');
  const unparseable = rows.filter((r) => !r.new_normalized && r.raw_phone).slice(0, 200);
  if (unparseable.length === 0) {
    lines.push('_Keine unparseablen Nummern gefunden._');
  } else {
    lines.push('| source | parse_status | masked_raw |');
    lines.push('|---|---|---|');
    for (const r of unparseable) {
      lines.push(`| ${r.source_table}.${r.source_field} | ${r.parse_status} | ${maskPhoneForLog(r.raw_phone)} |`);
    }
  }
  lines.push('');

  lines.push('## Empfehlung zur Umstellungsreihenfolge (Phase 2/3)');
  lines.push('');
  lines.push('1. **lib/phone.ts bleibt in Phase 1 isoliert.** Tests laufen, keine Integration in produktive Pfade.');
  lines.push('2. **Phase 2 Vorbereitung:** zuerst **Lesepfade** (`find-duplicates`, `order-intake` Strong-Signal, Customer-Suche) auf `lib/phone.ts` umstellen, aber nur dort, wo es keinen Routing-Impact hat.');
  lines.push('3. **WhatsApp-Webhook-Resolver (`lib/phone-resolver.ts`)** zuletzt — denn der steuert produktiven Intake. Vor Umstellung: CompanySettings-Delta-Liste manuell durchgehen, nicht-äquivalente Einträge korrigieren (z. B. `+41 Ort `→ `+4179…`).');
  lines.push('4. **Phase 3 (Schema + Backfill + Uniqueness)** erst nach schriftlicher Freigabe der obigen Delta- und Kollisionslisten.');
  lines.push('');

  lines.push('## Akzeptanzbestand dieser Audit-Ausführung');
  lines.push('');
  lines.push('- [x] Keine Schema-Änderung');
  lines.push('- [x] Keine Schreiboperation');
  lines.push('- [x] `lib/phone.ts` nur in Audit + Tests verwendet');
  lines.push('- [x] CSV erzeugt: `reports/phone-audit.csv`');
  lines.push('- [x] Markdown erzeugt: `reports/phone-audit-summary.md`');
  lines.push('- [x] Alle Logs verwenden Reason-Codes und maskierte Nummern');
  lines.push('');

  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, lines.join('\n') + '\n', 'utf8');
}

// ─────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────

async function main() {
  const auditDb = (process.env.AUDIT_DB || 'dev').toLowerCase();
  const limit = process.env.AUDIT_LIMIT ? Number(process.env.AUDIT_LIMIT) : null;

  const url =
    auditDb === 'prod'
      ? process.env.PROD_DATABASE_URL || process.env.DATABASE_URL
      : process.env.DATABASE_URL;

  if (!url) {
    console.error('[AUDIT] No DATABASE_URL (or PROD_DATABASE_URL) in env. Aborting.');
    process.exit(1);
  }

  console.log(`[AUDIT] Starting read-only audit. DB=${auditDb}. limit=${limit ?? 'none'}`);

  // NOTE: Instantiating a dedicated PrismaClient per run avoids sharing the
  // app-server singleton's middleware (not relevant for reads, but cleanest).
  const prisma = new PrismaClient({ datasourceUrl: url });

  try {
    const settings = await fetchCompanySettings(prisma, limit);
    const customers = await fetchCustomers(prisma, limit);

    console.log(`[AUDIT] Fetched ${settings.length} CompanySettings rows, ${customers.length} Customer rows (read-only).`);

    const rows: AuditRow[] = [];

    for (const s of settings) {
      for (const field of ['telefon', 'telefon2', 'whatsappIntakeNumber'] as const) {
        const raw = s[field];
        if (!raw) continue;
        rows.push(
          buildRow({
            userId: s.userId ?? null,
            customerId: null,
            sourceTable: 'CompanySettings',
            sourceField: field,
            raw,
          }),
        );
      }
    }

    for (const c of customers) {
      if (!c.phone) continue;
      rows.push(
        buildRow({
          userId: c.userId ?? null,
          customerId: c.id,
          sourceTable: 'Customer',
          sourceField: 'phone',
          raw: c.phone,
        }),
      );
    }

    // Mark collision groups (only after full set of rows assembled)
    assignCollisionGroups(rows);

    // Special slices
    const compSettingsDeltas = rows.filter(
      (r) => r.source_table === 'CompanySettings' && (r.delta === 'diff' || r.delta === 'newNull' || r.delta === 'oldNull'),
    );
    const customerCollisions = rows.filter((r) => r.source_table === 'Customer' && r.collision_group_id);

    // Inventory notes — static, hand-maintained list of known touch points in this codebase.
    const inventory = [
      { path: 'lib/normalize.ts', notes: 'Alte regex-basierte `normalizePhoneE164`. Swiss default (leading 0 → +41). Wird aktuell von Settings- und Signup-API + UI verwendet.' },
      { path: 'app/api/settings/route.ts', notes: 'Schreibt CompanySettings.telefon/telefon2, ruft `normalizePhoneE164` auf, enforct Cross-Account-Uniqueness.' },
      { path: 'app/api/signup/route.ts', notes: 'Registriert Benutzer + initiales CompanySettings, ruft `normalizePhoneE164`.' },
      { path: 'app/(app)/einstellungen/page.tsx', notes: 'UI onBlur normalize für Instant-Feedback.' },
      { path: 'lib/phone-resolver.ts', notes: 'WhatsApp Webhook → userId Routing. Nutzt `normalizePhoneE164` + Suffix-Fallback (letzte 9 Ziffern).' },
      { path: 'app/api/whatsapp/webhook/route.ts', notes: 'Produktiver Intake-Pfad. Routing hängt an `lib/phone-resolver.ts`.' },
      { path: 'app/api/customers/find-duplicates/route.ts', notes: 'Eigene lokale `normalize()` (nur Ziffern). Suffix-Match auf letzten 4 Stellen, Score-basiert. **Eigene Logik — Drift-Risiko.**' },
      { path: 'lib/order-intake.ts', notes: 'Strong-Signal-Auto-Link nutzt `customer.phone` direkt (display-form), keine zentrale Normalisierung.' },
      { path: 'app/api/customers/merge/**', notes: 'Nicht in Phase 0 geprüft; wird in Phase 2/3 eingeschlossen.' },
      { path: 'components/customer-search-combobox.tsx / Kundenliste', notes: '`phone: { contains: q }` Textsuche, kein normalisierter Vergleich.' },
    ];

    // Paths \u2014 when AUDIT_DB !== 'prod' we suffix the DB tag into the filename
    // so both environments can be audited and committed side-by-side.
    const reportsDir = path.resolve(process.cwd(), 'reports');
    const suffix = auditDb === 'prod' ? '' : `-${auditDb}`;
    const csvPath = path.join(reportsDir, `phone-audit${suffix}.csv`);
    const mdPath = path.join(reportsDir, `phone-audit-summary${suffix}.md`);

    await writeCsv(csvPath, rows);
    await writeMarkdownSummary(mdPath, rows, compSettingsDeltas, customerCollisions, inventory);

    console.log(`[AUDIT] ${rows.length} rows analysed. PARSE_OK rows:`, rows.filter((r) => r.parse_status === 'PARSE_OK' || r.parse_status === 'PARSE_OK_CHANNEL').length);
    console.log(`[AUDIT] Wrote CSV  → ${csvPath}`);
    console.log(`[AUDIT] Wrote MD   → ${mdPath}`);
    console.log(`[AUDIT] CompanySettings deltas: ${compSettingsDeltas.length}`);
    console.log(`[AUDIT] Customer collisions:    ${customerCollisions.length}`);
    console.log(`[AUDIT] Reason counts — PARSE_OK:`, rows.filter(r => r.parse_status === 'PARSE_OK').length,
      '| PARSE_OK_CHANNEL:', rows.filter(r => r.parse_status === 'PARSE_OK_CHANNEL').length,
      '| PHONE_UNPARSEABLE:', rows.filter(r => !r.new_normalized && !!r.raw_phone).length,
    );
    console.log('[AUDIT] Done. Report is READ-ONLY. No data modified.');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('[AUDIT] Fatal error:', err);
  process.exit(1);
});
