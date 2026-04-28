
/**
 * Block T — Admin-only data export builder.
 *
 * Builds a self-contained ZIP package with all data scoped to a single
 * user/company, intended to be hand-delivered by an admin to the user as
 * fulfilment of a `data_export` compliance request.
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

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';

  let s: string;

  if (value instanceof Date) {
    s = value.toISOString();
  } else if (Array.isArray(value) || typeof value === 'object') {
    s = JSON.stringify(value);
  } else if (typeof value === 'boolean') {
    s = value ? 'true' : 'false';
  } else {
    s = String(value);
  }

  if (s.length > 0) {
    const first = s.charCodeAt(0);
    if (
      first === 0x3d ||
      first === 0x2b ||
      first === 0x2d ||
      first === 0x40 ||
      first === 0x09 ||
      first === 0x0d
    ) {
      s = "'" + s;
    }
  }

  if (s.includes('"') || s.includes(',') || s.includes('\n') || s.includes('\r')) {
    s = '"' + s.replace(/"/g, '""') + '"';
  }

  return s;
}

function toCsv(headers: string[], rows: unknown[][]): string {
  const head = headers.map(csvCell).join(',');
  const body = rows.map((r: unknown[]) => r.map(csvCell).join(',')).join('\n');
  return '\uFEFF' + head + '\n' + body + (rows.length > 0 ? '\n' : '');
}

function safeFilenameSegment(input: string | null | undefined, fallback: string): string {
  const raw = (input ?? '').trim();
  if (!raw) return fallback;
  const cleaned = raw.replace(/[^A-Za-z0-9._@-]+/g, '_').slice(0, 80);
  return cleaned || fallback;
}

function todayIso(d: Date = new Date()): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function buildReadme(opts: {
  createdAt: Date;
  userEmail: string;
  userId: string;
  companyName: string | null;
  counts: ExportPackage['counts'];
}): string {
  const ts = opts.createdAt.toLocaleString('de-CH', { timeZone: 'Europe/Zurich' });

  return [
    'Smartflow AI — Datenexport',
    '=================================',
    '',
    `Erstellt am:        ${ts} (Europe/Zurich)`,
    `Benutzer:           ${opts.userEmail}`,
    `Benutzer-ID:        ${opts.userId}`,
    `Firma:              ${opts.companyName ?? '(nicht hinterlegt)'}`,
    '',
    'Zweck dieses Pakets',
    '-------------------',
    'Dieses ZIP enthält eine Kopie aller in Smartflow AI gespeicherten Geschäftsdaten.',
    '',
    'Inhalt',
    '------',
    `customers.csv             Kunden (${opts.counts.customers} Zeilen)`,
    `orders.csv                Aufträge (${opts.counts.orders} Zeilen)`,
    `order-items.csv           Auftragspositionen (${opts.counts.orderItems} Zeilen)`,
    `offers.csv                Angebote (${opts.counts.offers} Zeilen)`,
    `offer-items.csv           Angebotspositionen (${opts.counts.offerItems} Zeilen)`,
    `invoices.csv              Rechnungen (${opts.counts.invoices} Zeilen)`,
    `invoice-items.csv         Rechnungspositionen (${opts.counts.invoiceItems} Zeilen)`,
    `services.csv              Leistungen (${opts.counts.services} Zeilen)`,
    `consents.csv              Akzeptanzen (${opts.counts.consents} Zeilen)`,
    `compliance-requests.csv   Compliance-Anfragen (${opts.counts.complianceRequests} Zeilen)`,
    `audit-logs.csv            Audit-Log (${opts.counts.auditLogs} Zeilen)`,
    `media-references.csv      Medien-Verweise (${opts.counts.mediaReferences} Zeilen)`,
    '',
    'Wichtige Hinweise',
    '-----------------',
    'Medien-Dateien sind nicht physisch enthalten, nur Referenzen.',
    'Authentifizierungsdaten sind nicht enthalten.',
    'Daten anderer Konten sind nicht enthalten.',
    '',
    'Bei Rückfragen: kontakt@smartflowai.ch',
    '',
  ].join('\n');
}

export async function buildUserDataExport(
  targetUserId: string,
  opts?: { requestId?: string },
): Promise<ExportPackage> {
  const createdAt = new Date();

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
    },
  });

  if (!user) {
    throw new Error(`User not found: ${targetUserId}`);
  }

  const settings = await prisma.companySettings.findFirst({
    where: { userId: targetUserId },
  });

  const companyName = settings?.firmenname?.trim() || null;

  const customers = await prisma.customer.findMany({
    where: { userId: targetUserId },
    orderBy: { createdAt: 'asc' },
  });

  const orders = await prisma.order.findMany({
    where: { userId: targetUserId },
    include: { items: true, customer: { select: { id: true, name: true, customerNumber: true } } },
    orderBy: { createdAt: 'asc' },
  });

  const offers = await prisma.offer.findMany({
    where: { userId: targetUserId },
    include: { items: true, customer: { select: { id: true, name: true, customerNumber: true } } },
    orderBy: { createdAt: 'asc' },
  });

  const invoices = await prisma.invoice.findMany({
    where: { userId: targetUserId },
    include: { items: true, customer: { select: { id: true, name: true, customerNumber: true } } },
    orderBy: { createdAt: 'asc' },
  });

  const services = await prisma.service.findMany({
    where: { userId: targetUserId },
    orderBy: { createdAt: 'asc' },
  });

  const consents = await prisma.consentRecord.findMany({
    where: { userId: targetUserId },
    orderBy: { acceptedAt: 'asc' },
  });

  const complianceRequests = await prisma.complianceRequest.findMany({
    where: { userId: targetUserId },
    orderBy: { requestedAt: 'asc' },
  });

  const totalAudit = await prisma.auditLog.count({ where: { userId: targetUserId } });
  const auditCapped = totalAudit > AUDIT_ROW_LIMIT;

  const auditLogs = await prisma.auditLog.findMany({
    where: { userId: targetUserId },
    orderBy: { createdAt: 'desc' },
    take: AUDIT_ROW_LIMIT,
  });

  const customersCsv = toCsv(
    ['id', 'customerNumber', 'name', 'address', 'plz', 'city', 'country', 'phone', 'email', 'notes', 'deletedAt', 'createdAt', 'updatedAt'],
    customers.map((c: any) => [c.id, c.customerNumber, c.name, c.address, c.plz, c.city, c.country, c.phone, c.email, c.notes, c.deletedAt, c.createdAt, c.updatedAt]),
  );

  const ordersCsv = toCsv(
    ['id', 'customerId', 'customerName', 'description', 'serviceName', 'status', 'priceType', 'unitPrice', 'quantity', 'totalPrice', 'vatRate', 'vatAmount', 'total', 'date', 'notes', 'specialNotes', 'needsReview', 'reviewReasons', 'hinweisLevel', 'invoiceId', 'offerId', 'audioDurationSec', 'audioTranscriptionStatus', 'deletedAt', 'createdAt', 'updatedAt'],
    orders.map((o: any) => [o.id, o.customerId, o.customer?.name ?? '', o.description, o.serviceName, o.status, o.priceType, o.unitPrice, o.quantity, o.totalPrice, o.vatRate, o.vatAmount, o.total, o.date, o.notes, o.specialNotes, o.needsReview, o.reviewReasons, o.hinweisLevel, o.invoiceId, o.offerId, o.audioDurationSec, o.audioTranscriptionStatus, o.deletedAt, o.createdAt, o.updatedAt]),
  );

  const orderItems = orders.flatMap((o: any) => o.items.map((it: any) => ({ ...it, orderId: o.id })));
  const orderItemsCsv = toCsv(
    ['id', 'orderId', 'serviceName', 'description', 'quantity', 'unit', 'unitPrice', 'totalPrice'],
    orderItems.map((it: any) => [it.id, it.orderId, it.serviceName, it.description, it.quantity, it.unit, it.unitPrice, it.totalPrice]),
  );

  const offersCsv = toCsv(
    ['id', 'offerNumber', 'customerId', 'customerName', 'subtotal', 'vatRate', 'vatAmount', 'total', 'status', 'offerDate', 'validUntil', 'notes', 'deletedAt', 'createdAt', 'updatedAt'],
    offers.map((o: any) => [o.id, o.offerNumber, o.customerId, o.customer?.name ?? '', o.subtotal, o.vatRate, o.vatAmount, o.total, o.status, o.offerDate, o.validUntil, o.notes, o.deletedAt, o.createdAt, o.updatedAt]),
  );

  const offerItems = offers.flatMap((o: any) => o.items.map((it: any) => ({ ...it, offerId: o.id })));
  const offerItemsCsv = toCsv(
    ['id', 'offerId', 'description', 'quantity', 'unit', 'unitPrice', 'totalPrice'],
    offerItems.map((it: any) => [it.id, it.offerId, it.description, it.quantity, it.unit, it.unitPrice, it.totalPrice]),
  );

  const invoicesCsv = toCsv(
    ['id', 'invoiceNumber', 'customerId', 'customerName', 'subtotal', 'vatRate', 'vatAmount', 'total', 'status', 'invoiceDate', 'dueDate', 'notes', 'sourceOfferId', 'archivedPdfPath', 'deletedAt', 'createdAt', 'updatedAt'],
    invoices.map((i: any) => [i.id, i.invoiceNumber, i.customerId, i.customer?.name ?? '', i.subtotal, i.vatRate, i.vatAmount, i.total, i.status, i.invoiceDate, i.dueDate, i.notes, i.sourceOfferId, i.archivedPdfPath, i.deletedAt, i.createdAt, i.updatedAt]),
  );

  const invoiceItems = invoices.flatMap((i: any) => i.items.map((it: any) => ({ ...it, invoiceId: i.id })));
  const invoiceItemsCsv = toCsv(
    ['id', 'invoiceId', 'description', 'quantity', 'unit', 'unitPrice', 'totalPrice'],
    invoiceItems.map((it: any) => [it.id, it.invoiceId, it.description, it.quantity, it.unit, it.unitPrice, it.totalPrice]),
  );

  const servicesCsv = toCsv(
    ['id', 'name', 'defaultPrice', 'unit', 'createdAt', 'updatedAt'],
    services.map((s: any) => [s.id, s.name, s.defaultPrice, s.unit, s.createdAt, s.updatedAt]),
  );

  const consentsCsv = toCsv(
    ['id', 'documentType', 'documentVersion', 'acceptedAt', 'ipAddress', 'userAgent'],
    consents.map((c: any) => [c.id, c.documentType, c.documentVersion, c.acceptedAt, c.ipAddress, c.userAgent]),
  );

  const complianceCsv = toCsv(
    ['id', 'type', 'status', 'notes', 'adminNotes', 'requestedAt', 'completedAt', 'updatedAt'],
    complianceRequests.map((r: any) => [r.id, r.type, r.status, r.notes, r.adminNotes, r.requestedAt, r.completedAt, r.updatedAt]),
  );

  const auditLogsCsv = toCsv(
    ['id', 'action', 'area', 'targetType', 'targetId', 'success', 'details', 'ipAddress', 'userAgent', 'source', 'errorMessage', 'createdAt'],
    auditLogs.map((a: any) => [a.id, a.action, a.area, a.targetType, a.targetId, a.success, a.details, a.ipAddress, a.userAgent, a.source, a.errorMessage, a.createdAt]),
  );

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

  for (const o of orders as any[]) {
    if (o.mediaUrl) {
      mediaRows.push({
        orderId: o.id,
        customerId: o.customerId,
        kind: 'media',
        index: null,
        reference: o.mediaUrl,
        mediaType: o.mediaType,
        audioDurationSec: o.audioDurationSec ?? null,
        audioTranscriptionStatus: o.audioTranscriptionStatus ?? null,
        createdAt: o.createdAt,
      });
    }

    (o.imageUrls ?? []).forEach((url: string, idx: number) => {
      mediaRows.push({
        orderId: o.id,
        customerId: o.customerId,
        kind: 'image',
        index: idx,
        reference: url,
        mediaType: null,
        audioDurationSec: null,
        audioTranscriptionStatus: null,
        createdAt: o.createdAt,
      });
    });

    (o.thumbnailUrls ?? []).forEach((url: string, idx: number) => {
      mediaRows.push({
        orderId: o.id,
        customerId: o.customerId,
        kind: 'thumbnail',
        index: idx,
        reference: url,
        mediaType: null,
        audioDurationSec: null,
        audioTranscriptionStatus: null,
        createdAt: o.createdAt,
      });
    });

    if (o.audioTranscript) {
      mediaRows.push({
        orderId: o.id,
        customerId: o.customerId,
        kind: 'audioTranscript',
        index: null,
        reference: '(transkribierter Text — siehe orders.csv)',
        mediaType: 'text/plain',
        audioDurationSec: o.audioDurationSec ?? null,
        audioTranscriptionStatus: o.audioTranscriptionStatus ?? null,
        createdAt: o.createdAt,
      });
    }
  }

  for (const i of invoices as any[]) {
    if (i.archivedPdfPath) {
      mediaRows.push({
        orderId: '',
        customerId: i.customerId,
        kind: 'archivedPdf',
        index: null,
        reference: i.archivedPdfPath,
        mediaType: 'application/pdf',
        audioDurationSec: null,
        audioTranscriptionStatus: null,
        createdAt: i.createdAt,
      });
    }
  }

  const mediaCsv = toCsv(
    ['orderId', 'customerId', 'kind', 'index', 'reference', 'mediaType', 'audioDurationSec', 'audioTranscriptionStatus', 'createdAt'],
    mediaRows.map((m: MediaRow) => [m.orderId, m.customerId, m.kind, m.index, m.reference, m.mediaType, m.audioDurationSec, m.audioTranscriptionStatus, m.createdAt]),
  );

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
    company: settings,
    counts,
    notes: {
      mediaFilesIncluded: false,
      mediaReferencesIncluded: true,
      authInternalIncluded: false,
      auditRowLimit: AUDIT_ROW_LIMIT,
      auditCapped,
    },
  };

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

  const idSuffix = safeFilenameSegment(opts?.requestId, user.id.slice(0, 8));
  const filename = `smartflow-datenexport-${todayIso(createdAt)}-${idSuffix}.zip`;

  return { buffer, filename, counts };
}