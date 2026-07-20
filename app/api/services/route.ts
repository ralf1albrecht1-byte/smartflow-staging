export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireUserId, unauthorizedResponse, getSessionUser } from '@/lib/get-session';
import { logAuditAsync } from '@/lib/audit';
import { normalizePositionType } from '@/lib/position-types';

const compact = (value?: string | null) =>
  String(value || '').replace(/\s+/g, ' ').trim();

const normalizeServiceKey = (value?: string | null) =>
  compact(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss');

const canonicalServiceName = (value?: string | null) => {
  const name = compact(value);
  const key = normalizeServiceKey(name);

  if (
    /\b(anfahrt|anfahrt pauschal|fahrtkosten|fahrkosten|fahrpauschale|wegpauschale|deplacement|deplacement forfait|déplacement|déplacement forfait|travel fee|travel cost|travel costs|trip fee|transport fee|trasferta|transferta|viaje)\b/i.test(
      key,
    )
  ) {
    return 'Anfahrt';
  }

  if (
    /\b(boden reinigen|bodenreinigung|clean floor|floor cleaning|nettoyage du sol|nettoyage sol|pulizia pavimento|pulizia del pavimento|limpieza suelo|limpieza de suelo)\b/i.test(
      key,
    )
  ) {
    return 'Boden reinigen';
  }

  if (
    /\b(fenster reinigen|fensterreinigung|clean windows|window cleaning|windows cleaning|nettoyage des vitres|nettoyage vitres|nettoyage des vitrines|nettoyage vitrines|vitres|vitrines|fenetres|fenêtres|pulizia finestre|pulizia delle finestre|limpieza ventanas|limpieza de ventanas)\b/i.test(
      key,
    )
  ) {
    return 'Fenster reinigen';
  }

  return name;
};

const canonicalKey = (value?: string | null) =>
  normalizeServiceKey(canonicalServiceName(value));

const isInternalReviewServiceName = (value?: string | null) => {
  const key = normalizeServiceKey(value);
  if (!key) return true;
  return new Set([
    'leistung pruefen',
    'leistung prufen',
    'pruefen',
    'prufen',
    'unklare leistung',
    'bitte pruefen',
    'bitte prufen',
    'einheit pruefen',
    'einheit prufen',
    'betrag pruefen',
    'betrag prufen',
  ]).has(key);
};

const isInternalReviewUnit = (value?: string | null) => {
  const key = normalizeServiceKey(value);
  return !key || new Set(['pruefen', 'prufen', 'einheit pruefen', 'einheit prufen']).has(key);
};

const preferCanonicalRecord = (current: any | undefined, candidate: any) => {
  if (!current) return candidate;
  const currentName = compact(current.name);
  const candidateName = compact(candidate.name);
  const currentCanonical = canonicalServiceName(currentName);
  const candidateCanonical = canonicalServiceName(candidateName);

  if (candidateName === candidateCanonical && currentName !== currentCanonical) {
    return candidate;
  }

  return current;
};

const normalizeServiceForResponse = (service: any) => ({
  ...service,
  name: canonicalServiceName(service?.name),
});

const dedupeServicesForResponse = (services: any[]) => {
  const byKey = new Map<string, any>();

  for (const service of services ?? []) {
    const key = canonicalKey(service?.name);
    if (!key) continue;
    byKey.set(key, preferCanonicalRecord(byKey.get(key), service));
  }

  return Array.from(byKey.values())
    .map(normalizeServiceForResponse)
    .sort((a, b) =>
      (a?.name ?? '').localeCompare(b?.name ?? '', 'de', { sensitivity: 'base' }),
    );
};

async function findCanonicalService(userId: string, name: string) {
  const key = canonicalKey(name);
  if (!key) return null;

  const services = await prisma.service.findMany({ where: { userId } });
  return services.find((service) => canonicalKey(service.name) === key) || null;
}

export async function GET() {
  try {
    let userId: string;
    try { userId = await requireUserId(); } catch { return unauthorizedResponse(); }

    const raw = await prisma.service.findMany({ where: { userId } });
    return NextResponse.json(dedupeServicesForResponse(raw ?? []));
  } catch (error: any) {
    console.error(error);
    return NextResponse.json([], { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    let userId: string;
    try { userId = await requireUserId(); } catch { return unauthorizedResponse(); }

    const data = await request.json();
    const { name, defaultPrice, unit } = data;
    const positionType = normalizePositionType(data?.positionType);

    if (!name || typeof name !== 'string') {
      return NextResponse.json({ error: 'Name fehlt' }, { status: 400 });
    }

    if (isInternalReviewServiceName(name)) {
      return NextResponse.json({ error: 'Prüf-Platzhalter dürfen nicht in den Leistungskatalog übernommen werden.' }, { status: 400 });
    }

    if (defaultPrice === undefined || defaultPrice === null || isNaN(defaultPrice) || Number(defaultPrice) <= 0) {
      return NextResponse.json({ error: 'Preis ungültig' }, { status: 400 });
    }

    if (!unit || typeof unit !== 'string' || isInternalReviewUnit(unit)) {
      return NextResponse.json({ error: 'Einheit fehlt oder ist noch auf Prüfen.' }, { status: 400 });
    }

    const canonicalName = canonicalServiceName(name);
    const existing = await findCanonicalService(userId, canonicalName);

    if (existing) {
      return NextResponse.json(
        {
          error: 'Leistung existiert bereits',
          code: 'SERVICE_ALREADY_EXISTS',
          service: normalizeServiceForResponse(existing),
        },
        { status: 409 },
      );
    }

    const service = await prisma.service.create({
      data: {
        name: canonicalName,
        defaultPrice: Number(defaultPrice),
        unit,
        positionType,
        userId,
      },
    });

    const su = await getSessionUser();
    logAuditAsync({
      userId: su?.id,
      userEmail: su?.email,
      userRole: su?.role,
      action: 'SERVICE_CREATE',
      area: 'SERVICES',
      targetType: 'Service',
      targetId: service.id,
      request,
    });
    return NextResponse.json(normalizeServiceForResponse(service));
  } catch (error: any) {
    console.error(error);
    return NextResponse.json({ error: 'Fehler beim Erstellen' }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    let userId: string;
    try { userId = await requireUserId(); } catch { return unauthorizedResponse(); }

    const data = await request.json();
    const { id, name, defaultPrice, unit } = data;
    const positionType = normalizePositionType(data?.positionType);

    if (!id || typeof id !== 'string') {
      return NextResponse.json({ error: 'ID fehlt' }, { status: 400 });
    }

    if (!name || typeof name !== 'string') {
      return NextResponse.json({ error: 'Name fehlt' }, { status: 400 });
    }

    if (isInternalReviewServiceName(name)) {
      return NextResponse.json({ error: 'Prüf-Platzhalter dürfen nicht in den Leistungskatalog übernommen werden.' }, { status: 400 });
    }

    if (defaultPrice === undefined || defaultPrice === null || isNaN(defaultPrice) || Number(defaultPrice) <= 0) {
      return NextResponse.json({ error: 'Preis ungültig' }, { status: 400 });
    }

    if (!unit || typeof unit !== 'string' || isInternalReviewUnit(unit)) {
      return NextResponse.json({ error: 'Einheit fehlt oder ist noch auf Prüfen.' }, { status: 400 });
    }

    const canonicalName = canonicalServiceName(name);
    const requested = await prisma.service.findFirst({ where: { id, userId } });

    if (!requested) {
      return NextResponse.json({ error: 'Leistung nicht gefunden' }, { status: 404 });
    }

    const existingCanonical = await findCanonicalService(userId, canonicalName);
    const targetId = existingCanonical?.id || requested.id;

    const service = await prisma.service.update({
      where: { id: targetId },
      data: {
        name: canonicalName,
        defaultPrice: Number(defaultPrice),
        unit,
        positionType,
      },
    });

    const su = await getSessionUser();
    logAuditAsync({
      userId: su?.id,
      userEmail: su?.email,
      userRole: su?.role,
      action: 'SERVICE_UPDATE',
      area: 'SERVICES',
      targetType: 'Service',
      targetId: service.id,
      request,
    });
    return NextResponse.json(normalizeServiceForResponse(service));
  } catch (error: any) {
    console.error(error);
    return NextResponse.json({ error: 'Fehler beim Aktualisieren' }, { status: 500 });
  }
}
