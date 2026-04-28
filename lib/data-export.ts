/**
 * Block T — Admin-only data export builder.
 *
 * Builds a self-contained ZIP package with all data scoped to a single
 * user/company, intended to be hand-delivered by an admin to the user as
 * fulfilment of a `data_export` compliance request.
 *
 * Strict scope guarantees:
 *  - All Prisma queries are filtered by `userId` (the requesting user) — never
 *    cross-tenant.
 *  - Auth-internal data (password hash, sessions, verification tokens) is
 *    NEVER exported.
 *  - Media files (images, audio) are NEVER bundled — only references / URLs.
 *  - Audit log is capped (see AUDIT_ROW_LIMIT) to avoid memory blow-ups.
 *
 * The caller is responsible for `requireAdmin()` authorization. This module
 * does no auth — it just builds the package. See
 * `app/api/admin/compliance/requests/[id]/export/route.ts`.
 */

import JSZip from 'jszip';
import { prisma } from '@/lib/prisma';

const AUDIT_ROW_LIMIT = 50_000;

export interface ExportPackage {
  buffer: Buffer;
  filename: string;
  counts: {
    customers: number;
    orders: number;
    orderItems: number;
    offers: number;
    offerItems: number;
    invoices: number;
    invoiceItems: number;
    services: number;
    consents: number;
    complianceRequests: number;
    auditLogs: number;
    auditLogsCapped: boolean;
    mediaReferences: number;
  };
}

// ──────────────────────────────────────────────────────────────────────────
// CSV helpers
// ──────────────────────────────────────────────────────────────────────────

/**
 * Escapes a single CSV cell value.
 * - null/undefined → empty string
 * - Date → ISO string
 * - Arrays → JSON-encoded
 * - Objects → JSON-encoded
 * - CSV-Injection mitigation: prefix `=`, `+`, `-`, `@`, TAB, CR with `'` so
 *   spreadsheet apps don't evaluate them as formulas.
 * - Wraps in double quotes when the value contains comma, quote, CR or LF.
 */
function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  let s: string;
  if (value instanceof Date) {
    s = value.toISOString();
  } else if (Array.isArray(value)) {
    s = JSON.stringify(value);
  } else if (typeof value === 'object') {
    s = JSON.stringify(value);
  } else if (typeof value === 'boolean') {
    s = value ? 'true' : 'false';
  } else {
    s = String(value);
  }
  // CSV-Injection safe: prefix risky leading chars with single-quote.
  if (s.length > 0) {
    const first = s.charCodeAt(0);
    // = + - @ TAB(0x09) CR(0x0D)
    if (first === 0x3d || first === 0x2b || first === 0x2d || first === 0x40 || first === 0x09 || first === 0x0d) {
      s = "'" + s;
    }
  }
  // Quote-wrap if needed.
  if (s.includes('"') || s.includes(',') || s.includes('\n') || s.includes('\r')) {
    s = '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

/** Builds a CSV blob from headers + rows. UTF-8 BOM prefix for Excel-DE compat. */
function toCsv(headers: string[], rows: unknown[][]): string {
  const head = headers.map(csvCell).join(',');
  const body = rows.map((r) => r.map(csvCell).join(',')).join('\n');
  return '\uFEFF' + head + '\n' + body + (rows.length > 0 ? '\n' : '');
}

function safeFilenameSegment(input: string | null | undefined, fallback: string): string {
  const raw = (input ?? '').trim();
  if (!raw) return fallback;
  // Allow letters, digits, dot, hyphen, underscore, @ — replace everything else.
  const cleaned = raw.replace(/[^A-Za-z0-9._@-]+/g, '_').slice(0, 80);
  return cleaned || fallback;
}

function todayIso(d: Date = new Date()): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// ──────────────────────────────────────────────────────────────────────────
// README generator (German)
// ──────────────────────────────────────────────────────────────────────────

function buildReadme(opts: {
  createdAt: Date;
  userEmail: string;
  userId: string;
  companyName: string | null;
  counts: ExportPackage['counts'];
}): string {
  const ts = opts.createdAt.toLocaleString('de-CH', { timeZone: 'Europe/Zurich' });
  const lines: string[] = [];
  lines.push('Smartflow AI — Datenexport');
  lines.push('=================================');
  lines.push('');
  lines.push(`Erstellt am:        ${ts} (Europe/Zurich)`);
  lines.push(`Benutzer:           ${opts.userEmail}`);
  lines.push(`Benutzer-ID:        ${opts.userId}`);
  lines.push(`Firma:              ${opts.companyName ?? '(nicht hinterlegt)'}`);
  lines.push('');
  lines.push('Zweck dieses Pakets');
  lines.push('-------------------');
  lines.push('Dieses ZIP enthält eine Kopie aller in Smartflow AI gespeicherten');
  lines.push('Geschäftsdaten, die diesem Konto zugeordnet sind. Es dient der');
  lines.push('Erfüllung einer Datenexport-Anfrage gemäss Art. 25 nDSG / Art. 15 DSGVO');
  lines.push('(Auskunfts- bzw. Datenauszugsrecht).');
  lines.push('');
  lines.push('Inhalt');
  lines.push('------');
  lines.push('  export.json               Übersicht (Kontodaten, Firmendaten, Anzahl pro Tabelle)');
  lines.push(`  customers.csv             Kunden (${opts.counts.customers} Zeilen)`);
  lines.push(`  orders.csv                Aufträge (${opts.counts.orders} Zeilen)`);
  lines.push(`  order-items.csv           Auftragspositionen (${opts.counts.orderItems} Zeilen)`);
  lines.push(`  offers.csv                Angebote (${opts.counts.offers} Zeilen)`);
  lines.push(`  offer-items.csv           Angebotspositionen (${opts.counts.offerItems} Zeilen)`);
  lines.push(`  invoices.csv              Rechnungen (${opts.counts.invoices} Zeilen)`);
  lines.push(`  invoice-items.csv         Rechnungspositionen (${opts.counts.invoiceItems} Zeilen)`);
  lines.push(`  services.csv              Leistungen / Stammdaten (${opts.counts.services} Zeilen)`);
  lines.push(`  consents.csv              Akzeptanzen AGB / Datenschutz / AVV (${opts.counts.consents} Zeilen)`);
  lines.push(`  compliance-requests.csv   Compliance-Anfragen (${opts.counts.complianceRequests} Zeilen)`);
  lines.push(`  audit-logs.csv            Audit-Log (${opts.counts.auditLogs} Zeilen${opts.counts.auditLogsCapped ? `, gekürzt auf die letzten ${AUDIT_ROW_LIMIT}` : ''})`);
  lines.push(`  media-references.csv      Verweise auf Bild- / Audio-Anhänge (${opts.counts.mediaReferences} Zeilen)`);
  lines.push('  README.txt                Diese Datei');
  lines.push('');
  lines.push('Wichtige Hinweise');
  lines.push('-----------------');
  lines.push('• Medien-Dateien (Bilder, Sprachnachrichten) sind in dieser Version NICHT');
  lines.push('  als physische Dateien enthalten. media-references.csv listet stattdessen');
  lines.push('  die zugehörigen Cloud-Storage-Verweise (URLs, Schlüssel, Zeitstempel,');
  lines.push('  verknüpfte Auftrags-/Kunden-IDs). Die Original-Dateien bleiben in unserer');
  lines.push('  sicheren Cloud-Speicherung verfügbar — auf Anfrage liefern wir diese');
  lines.push('  separat aus.');
  lines.push('• Authentifizierungsdaten (Passwort-Hash, Sessions, Verifikations-Token,');
  lines.push('  Password-Reset-Token) sind aus Sicherheitsgründen NICHT enthalten.');
  lines.push('• Daten anderer Konten oder Firmen sind in keiner Datei enthalten.');
  lines.push('• Alle Zeitstempel sind, sofern nicht anders bezeichnet, in UTC (ISO-8601).');
  lines.push('• CSV-Dateien sind UTF-8 mit BOM kodiert und in Excel direkt importierbar.');
  lines.push('');
  lines.push('Format');
  lines.push('------');
  lines.push('Format-Version: v1');
  lines.push('Trennzeichen:   Komma (,)');
  lines.push('Textbegrenzer:  doppelte Anführungszeichen (")');
  lines.push('Zeichensatz:    UTF-8 mit BOM');
  lines.push('');
  lines.push('Bei Rückfragen: kontakt@smartflowai.ch');
  lines.push('');
  return lines.join('\n');
}

// ──────────────────────────────────────────────────────────────────────────
// Main builder
// ──────────────────────────────────────────────────────────────────────────

/**
 * Builds the data-export ZIP for a single user/company.
 *
 * @param targetUserId  The User.id whose data should be exported.
 * @param opts.requestId  The originating ComplianceRequest.id. Used in the
 *   filename so the ZIP-Dateiname KEINE personenbezogenen Daten enthält
 *   (kein Email, kein Name, keine Firma — nur Datum + Request-ID).
 */
export async function buildUserDataExport(
  targetUserId: string,
  opts?: { requestId?: string },
): Promise<ExportPackage> {
  const createdAt = new Date();

  // ── 1. User & company headers ─────────────────────────────────────────
  const user = await prisma.user.findUnique({
    where: { id: targetUserId },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      acceptedTermsAt: true,
      createdAt: true,
      updatedAt: true,
      // password / accounts / sessions deliberately excluded
    },
  });
  if (!user) {
    throw new Error(`User not found: ${targetUserId}`);
  }

  const settings = await prisma.companySettings.findFirst({
    where: { userId: targetUserId },
  });
  const companyName = settings?.firmenname?.trim() || null;

  // ── 2. Customers ──────────────────────────────────────────────────────
  const customers = await prisma.customer.findMany({
    where: { userId: targetUserId },
    orderBy: { createdAt: 'asc' },
  });

  // ── 3. Orders + items ─────────────────────────────────────────────────
  const orders = await prisma.order.findMany({
    where: { userId: targetUserId },
    include: { items: true, customer: { select: { id: true, name: true, customerNumber: true } } },
    orderBy: { createdAt: 'asc' },
  });

  // ── 4. Offers + items ─────────────────────────────────────────────────
  const offers = await prisma.offer.findMany({
    where: { userId: targetUserId },
    include: { items: true, customer: { select: { id: true, name: true, customerNumber: true } } },
    orderBy: { createdAt: 'asc' },
  });

  // ── 5. Invoices + items ───────────────────────────────────────────────
  const invoices = await prisma.invoice.findMany({
    where: { userId: targetUserId },
    include: { items: true, customer: { select: { id: true, name: true, customerNumber: true } } },
    orderBy: { createdAt: 'asc' },
  });

  // ── 6. Services ───────────────────────────────────────────────────────
  const services = await prisma.service.findMany({
    where: { userId: targetUserId },
    orderBy: { createdAt: 'asc' },
  });

  // ── 7. Consents ───────────────────────────────────────────────────────
  const consents = await prisma.consentRecord.findMany({
    where: { userId: targetUserId },
    orderBy: { acceptedAt: 'asc' },
  });

  // ── 8. Compliance requests ────────────────────────────────────────────
  const complianceRequests = await prisma.complianceRequest.findMany({
    where: { userId: targetUserId },
    orderBy: { requestedAt: 'asc' },
  });

  // ── 9. Audit logs (capped) ────────────────────────────────────────────
  const totalAudit = await prisma.auditLog.count({ where: { userId: targetUserId } });
  const auditCapped = totalAudit > AUDIT_ROW_LIMIT;
  const auditLogs = await prisma.auditLog.findMany({
    where: { userId: targetUserId },
    orderBy: { createdAt: 'desc' },
    take: AUDIT_ROW_LIMIT,
  });

  // ── 10. Build CSVs ────────────────────────────────────────────────────

  const customersCsv = toCsv(
    [
      'id', 'customerNumber', 'name', 'address', 'plz', 'city', 'country',
      'phone', 'email', 'notes', 'deletedAt', 'createdAt', 'updatedAt',
    ],
    customers.map((c) => [
      c.id, c.customerNumber, c.name, c.address, c.plz, c.city, c.country,
      c.phone, c.email, c.notes, c.deletedAt, c.createdAt, c.updatedAt,
    ]),
  );

  const ordersCsv = toCsv(
    [
      'id', 'customerId', 'customerName', 'description', 'serviceName', 'status',
      'priceType', 'unitPrice', 'quantity', 'totalPrice', 'vatRate', 'vatAmount', 'total',
      'date', 'notes', 'specialNotes', 'needsReview', 'reviewReasons', 'hinweisLevel',
      'invoiceId', 'offerId',
      'audioDurationSec', 'audioTranscriptionStatus',
      'deletedAt', 'createdAt', 'updatedAt',
    ],
    orders.map((o) => [
      o.id, o.customerId, o.customer?.name ?? '', o.description, o.serviceName, o.status,
      o.priceType, o.unitPrice, o.quantity, o.totalPrice, o.vatRate, o.vatAmount, o.total,
      o.date, o.notes, o.specialNotes, o.needsReview, o.reviewReasons, o.hinweisLevel,
      o.invoiceId, o.offerId,
      o.audioDurationSec, o.audioTranscriptionStatus,
      o.deletedAt, o.createdAt, o.updatedAt,
    ]),
  );

  const orderItems = orders.flatMap((o) => o.items.map((it) => ({ ...it, orderId: o.id })));
  const orderItemsCsv = toCsv(
    ['id', 'orderId', 'serviceName', 'description', 'quantity', 'unit', 'unitPrice', 'totalPrice'],
    orderItems.map((it) => [it.id, it.orderId, it.serviceName, it.description, it.quantity, it.unit, it.unitPrice, it.totalPrice]),
  );

  const offersCsv = toCsv(
    [
      'id', 'offerNumber', 'customerId', 'customerName',
      'subtotal', 'vatRate', 'vatAmount', 'total', 'status',
      'offerDate', 'validUntil', 'notes',
      'deletedAt', 'createdAt', 'updatedAt',
    ],
    offers.map((o) => [
      o.id, o.offerNumber, o.customerId, o.customer?.name ?? '',
      o.subtotal, o.vatRate, o.vatAmount, o.total, o.status,
      o.offerDate, o.validUntil, o.notes,
      o.deletedAt, o.createdAt, o.updatedAt,
    ]),
  );

  const offerItems = offers.flatMap((o) => o.items.map((it) => ({ ...it, offerId: o.id })));
  const offerItemsCsv = toCsv(
    ['id', 'offerId', 'description', 'quantity', 'unit', 'unitPrice', 'totalPrice'],
    offerItems.map((it) => [it.id, it.offerId, it.description, it.quantity, it.unit, it.unitPrice, it.totalPrice]),
  );

  const invoicesCsv = toCsv(
    [
      'id', 'invoiceNumber', 'customerId', 'customerName',
      'subtotal', 'vatRate', 'vatAmount', 'total', 'status',
      'invoiceDate', 'dueDate', 'notes', 'sourceOfferId',
      'archivedPdfPath',
      'deletedAt', 'createdAt', 'updatedAt',
    ],
    invoices.map((i) => [
      i.id, i.invoiceNumber, i.customerId, i.customer?.name ?? '',
      i.subtotal, i.vatRate, i.vatAmount, i.total, i.status,
      i.invoiceDate, i.dueDate, i.notes, i.sourceOfferId,
      i.archivedPdfPath,
      i.deletedAt, i.createdAt, i.updatedAt,
    ]),
  );

  const invoiceItems = invoices.flatMap((i) => i.items.map((it) => ({ ...it, invoiceId: i.id })));
  const invoiceItemsCsv = toCsv(
    ['id', 'invoiceId', 'description', 'quantity', 'unit', 'unitPrice', 'totalPrice'],
    invoiceItems.map((it) => [it.id, it.invoiceId, it.description, it.quantity, it.unit, it.unitPrice, it.totalPrice]),
  );

  const servicesCsv = toCsv(
    ['id', 'name', 'defaultPrice', 'unit', 'createdAt', 'updatedAt'],
    services.map((s) => [s.id, s.name, s.defaultPrice, s.unit, s.createdAt, s.updatedAt]),
  );

  const consentsCsv = toCsv(
    ['id', 'documentType', 'documentVersion', 'acceptedAt', 'ipAddress', 'userAgent'],
    consents.map((c) => [c.id, c.documentType, c.documentVersion, c.acceptedAt, c.ipAddress, c.userAgent]),
  );

  const complianceCsv = toCsv(
    ['id', 'type', 'status', 'notes', 'adminNotes', 'requestedAt', 'completedAt', 'updatedAt'],
    complianceRequests.map((r) => [r.id, r.type, r.status, r.notes, r.adminNotes, r.requestedAt, r.completedAt, r.updatedAt]),
  );

  const auditLogsCsv = toCsv(
    [
      'id', 'action', 'area', 'targetType', 'targetId', 'success',
      'details', 'ipAddress', 'userAgent', 'source', 'errorMessage', 'createdAt',
    ],
    auditLogs.map((a) => [
      a.id, a.action, a.area, a.targetType, a.targetId, a.success,
      a.details, a.ipAddress, a.userAgent, a.source, a.errorMessage, a.createdAt,
    ]),
  );

  // ── 11. Media references (extracted from orders) ──────────────────────
  type MediaRow = {
    orderId: string;
    customerId: string;
    kind: 'image' | 'thumbnail' | 'media' | 'audioTranscript' | 'archivedPdf';
    index: number | null;
    reference: string;
    mediaType: string | null;
    audioDurationSec: number | null;
    audioTranscriptionStatus: string | null;
    createdAt: Date;
  };
  const mediaRows: MediaRow[] = [];
  for (const o of orders) {
    if (o.mediaUrl) {
      mediaRows.push({
        orderId: o.id, customerId: o.customerId, kind: 'media', index: null,
        reference: o.mediaUrl, mediaType: o.mediaType,
        audioDurationSec: o.audioDurationSec ?? null,
        audioTranscriptionStatus: o.audioTranscriptionStatus ?? null,
        createdAt: o.createdAt,
      });
    }
    (o.imageUrls ?? []).forEach((url, idx) => {
      mediaRows.push({
        orderId: o.id, customerId: o.customerId, kind: 'image', index: idx,
        reference: url, mediaType: null,
        audioDurationSec: null, audioTranscriptionStatus: null,
        createdAt: o.createdAt,
      });
    });
    (o.thumbnailUrls ?? []).forEach((url, idx) => {
      mediaRows.push({
        orderId: o.id, customerId: o.customerId, kind: 'thumbnail', index: idx,
        reference: url, mediaType: null,
        audioDurationSec: null, audioTranscriptionStatus: null,
        createdAt: o.createdAt,
      });
    });
    if (o.audioTranscript) {
      mediaRows.push({
        orderId: o.id, customerId: o.customerId, kind: 'audioTranscript', index: null,
        reference: '(transkribierter Text — siehe orders.csv ist nicht als Datei gespeichert)',
        mediaType: 'text/plain',
        audioDurationSec: o.audioDurationSec ?? null,
        audioTranscriptionStatus: o.audioTranscriptionStatus ?? null,
        createdAt: o.createdAt,
      });
    }
  }
  // Archived invoice PDFs (S3 keys, not bundled).
  for (const i of invoices) {
    if (i.archivedPdfPath) {
      mediaRows.push({
        orderId: '', customerId: i.customerId, kind: 'archivedPdf', index: null,
        reference: i.archivedPdfPath, mediaType: 'application/pdf',
        audioDurationSec: null, audioTranscriptionStatus: null,
        createdAt: i.createdAt,
      });
    }
  }
  const mediaCsv = toCsv(
    ['orderId', 'customerId', 'kind', 'index', 'reference', 'mediaType', 'audioDurationSec', 'audioTranscriptionStatus', 'createdAt'],
    mediaRows.map((m) => [m.orderId, m.customerId, m.kind, m.index, m.reference, m.mediaType, m.audioDurationSec, m.audioTranscriptionStatus, m.createdAt]),
  );

  // ── 12. export.json (header / summary) ────────────────────────────────
  const counts: ExportPackage['counts'] = {
    customers: customers.length,
    orders: orders.length,
    orderItems: orderItems.length,
    offers: offers.length,
    offerItems: offerItems.length,
    invoices: invoices.length,
    invoiceItems: invoiceItems.length,
    services: services.length,
    consents: consents.length,
    complianceRequests: complianceRequests.length,
    auditLogs: auditLogs.length,
    auditLogsCapped: auditCapped,
    mediaReferences: mediaRows.length,
  };

  const exportJson = {
    formatVersion: 'v1',
    createdAt: createdAt.toISOString(),
    timezone: 'Europe/Zurich',
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      acceptedTermsAt: user.acceptedTermsAt,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    },
    company: settings
      ? {
          firmenname: settings.firmenname,
          firmaRechtlich: settings.firmaRechtlich,
          ansprechpartner: settings.ansprechpartner,
          telefon: settings.telefon,
          telefon2: settings.telefon2,
          email: settings.email,
          supportEmail: settings.supportEmail,
          webseite: settings.webseite,
          strasse: settings.strasse,
          hausnummer: settings.hausnummer,
          plz: settings.plz,
          ort: settings.ort,
          iban: settings.iban,
          bank: settings.bank,
          mwstAktiv: settings.mwstAktiv,
          mwstNummer: settings.mwstNummer,
          mwstSatz: settings.mwstSatz,
          mwstHinweis: settings.mwstHinweis,
          branche: settings.branche,
          hauptsprache: settings.hauptsprache,
          documentTemplate: settings.documentTemplate,
          letterheadName: settings.letterheadName,
          letterheadVisible: settings.letterheadVisible,
          whatsappIntakeNumber: settings.whatsappIntakeNumber,
          createdAt: settings.createdAt,
          updatedAt: settings.updatedAt,
        }
      : null,
    counts,
    notes: {
      mediaFilesIncluded: false,
      mediaReferencesIncluded: true,
      authInternalIncluded: false,
      auditRowLimit: AUDIT_ROW_LIMIT,
      auditCapped: auditCapped,
    },
  };

  // ── 13. Build ZIP ─────────────────────────────────────────────────────
  const zip = new JSZip();
  zip.file('export.json', JSON.stringify(exportJson, null, 2));
  zip.file('customers.csv', customersCsv);
  zip.file('orders.csv', ordersCsv);
  zip.file('order-items.csv', orderItemsCsv);
  zip.file('offers.csv', offersCsv);
  zip.file('offer-items.csv', offerItemsCsv);
  zip.file('invoices.csv', invoicesCsv);
  zip.file('invoice-items.csv', invoiceItemsCsv);
  zip.file('services.csv', servicesCsv);
  zip.file('consents.csv', consentsCsv);
  zip.file('compliance-requests.csv', complianceCsv);
  zip.file('audit-logs.csv', auditLogsCsv);
  zip.file('media-references.csv', mediaCsv);
  zip.file(
    'README.txt',
    buildReadme({
      createdAt,
      userEmail: user.email,
      userId: user.id,
      companyName,
      counts,
    }),
  );

  const buffer = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });

  // Block T-fix — Filename darf KEINE personenbezogenen Daten enthalten.
  // Format: smartflow-datenexport-YYYY-MM-DD-REQUESTID.zip
  // Wenn keine requestId mitgegeben wurde (Defensiv-Fallback), nutzen wir
  // einen kurzen, neutralen Hash-Suffix. Email/Name/Firma werden NIE
  // verwendet.
  const idSuffix = safeFilenameSegment(opts?.requestId, user.id.slice(0, 8));
  const filename = `smartflow-datenexport-${todayIso(createdAt)}-${idSuffix}.zip`;

  return { buffer, filename, counts };
}
