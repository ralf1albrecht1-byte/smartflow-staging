export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getActiveDataScope } from '@/lib/data-scope';
import { requireUserId, unauthorizedResponse } from '@/lib/get-session';

const compactExecutionAddressValue = (value: unknown) =>
  String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();

const normalizeExecutionAddressKeyPart = (value: unknown) =>
  compactExecutionAddressValue(value)
    .toLocaleLowerCase('de-CH')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '');

const fullExecutionAddressIdentityKey = (value: any) =>
  [
    value?.siteName,
    value?.siteAddress,
    value?.sitePlz,
    value?.siteCity,
    value?.siteNote,
  ]
    .map(normalizeExecutionAddressKeyPart)
    .join('|');

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  let userId: string;
  try { userId = await requireUserId(); } catch { return unauthorizedResponse(); }
  const dataScope = await getActiveDataScope(userId);

  try {
    const customer = await prisma.customer.findFirst({
      where: { id: params.id, userId, dataScope, deletedAt: null },
      select: { id: true },
    });

    if (!customer) {
      return NextResponse.json({ error: 'Kunde nicht gefunden' }, { status: 404 });
    }

    const executionAddresses = await prisma.customerExecutionAddress.findMany({
      where: { customerId: params.id, deletedAt: null },
      orderBy: [{ lastUsedAt: 'desc' }, { updatedAt: 'desc' }],
      select: {
        id: true,
        siteName: true,
        siteAddress: true,
        sitePlz: true,
        siteCity: true,
        siteNote: true,
        country: true,
        usageCount: true,
        lastUsedAt: true,
      },
    });

    return NextResponse.json(executionAddresses);
  } catch (error) {
    console.error('GET /api/customers/[id]/execution-addresses error:', error);
    return NextResponse.json({ error: 'Fehler beim Laden der Ausführungsorte' }, { status: 500 });
  }
}

export async function POST(request: Request, { params }: { params: { id: string } }) {
  let userId: string;
  try { userId = await requireUserId(); } catch { return unauthorizedResponse(); }
  const dataScope = await getActiveDataScope(userId);

  try {
    const customerId = compactExecutionAddressValue(params.id);
    const customer = await prisma.customer.findFirst({
      where: { id: customerId, userId, dataScope, deletedAt: null },
      select: { id: true },
    });

    if (!customer) {
      return NextResponse.json({ error: 'Kunde nicht gefunden' }, { status: 404 });
    }

    const body = await request.json().catch(() => ({} as any));
    const siteName = compactExecutionAddressValue(body?.siteName) || null;
    const siteAddress = compactExecutionAddressValue(body?.siteAddress);
    const sitePlz = compactExecutionAddressValue(body?.sitePlz);
    const siteCity = compactExecutionAddressValue(body?.siteCity);
    const siteNote = compactExecutionAddressValue(body?.siteNote) || null;
    const country = compactExecutionAddressValue(body?.country) || 'CH';

    if (!siteAddress || !sitePlz || !siteCity) {
      return NextResponse.json(
        { error: 'Strasse, PLZ und Ort sind erforderlich.' },
        { status: 400 },
      );
    }

    const table = (prisma as any).customerExecutionAddress;
    if (!table) {
      return NextResponse.json(
        { error: 'Ausführungsorte sind nicht verfügbar.' },
        { status: 500 },
      );
    }

    const incoming = {
      siteName,
      siteAddress,
      sitePlz,
      siteCity,
      siteNote,
    };

    const existingRows = await table.findMany({
      where: { customerId, deletedAt: null },
      orderBy: [{ lastUsedAt: 'desc' }, { updatedAt: 'desc' }],
    });

    // Wichtig: Nur ein vollständig identischer gespeicherter Ausführungsort wird wiederverwendet.
    // Gleiche Adresse mit anderer Bezeichnung bleibt ein eigener Kundenprofil-Ort.
    const existing = existingRows.find(
      (row: any) => fullExecutionAddressIdentityKey(row) === fullExecutionAddressIdentityKey(incoming),
    );

    const now = new Date();
    const data = {
      siteName,
      siteAddress,
      sitePlz,
      siteCity,
      siteNote,
      country,
      userId,
      deletedAt: null,
      lastUsedAt: now,
    };

    const saved = existing
      ? await table.update({
          where: { id: existing.id },
          data,
        })
      : await table.create({
          data: {
            customerId,
            ...data,
            usageCount: 0,
          },
        });

    return NextResponse.json(saved);
  } catch (error) {
    console.error('POST /api/customers/[id]/execution-addresses error:', error);
    return NextResponse.json({ error: 'Ausführungsort konnte nicht gespeichert werden.' }, { status: 500 });
  }
}
