export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSessionUser } from '@/lib/get-session';
import { logAuditAsync, EVENTS, AREAS } from '@/lib/audit';
import {
  getCurrentVersion,
  REQUIRED_DOC_TYPES,
  type LegalDocumentType,
} from '@/lib/legal-versions';

/**
 * Block N — Datenschutz-Akzeptanzen.
 *
 * Phase 4 (Re-acceptance):
 *   - The server validates that the submitted documentVersion matches the
 *     CURRENT_*_VERSION constant from lib/legal-versions.ts. Older versions
 *     are rejected with HTTP 400 so a stale client tab cannot accidentally
 *     re-stamp an already-outdated row.
 *   - On a successful POST, in addition to the existing per-document audit
 *     events (TERMS_ACCEPTED / PRIVACY_POLICY_ACCEPTED / AVV_ACCEPTED) we
 *     also emit a single USER_REACCEPTED_LEGAL event when the previous
 *     latest accepted version was different from the new one (i.e. an
 *     actual version bump happened).
 */
const ALLOWED_TYPES = new Set<LegalDocumentType>(['privacy', 'terms', 'avv']);

function docEvent(type: string): string | null {
  if (type === 'privacy') return EVENTS.PRIVACY_POLICY_ACCEPTED;
  if (type === 'terms') return EVENTS.TERMS_ACCEPTED;
  if (type === 'avv') return EVENTS.AVV_ACCEPTED;
  return null;
}

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Nicht autorisiert' }, { status: 401 });

  try {
    const records = await prisma.consentRecord.findMany({
      where: { userId: user.id },
      orderBy: { acceptedAt: 'desc' },
    });
    return NextResponse.json({ records });
  } catch (error) {
    console.error('GET consent error:', error);
    return NextResponse.json({ error: 'Fehler beim Laden' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Nicht autorisiert' }, { status: 401 });

  try {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Ungültige Anfrage' }, { status: 400 });
    }
    const documentType = String(body.documentType || '').toLowerCase() as LegalDocumentType;
    const documentVersion = String(body.documentVersion || '').trim();
    if (!ALLOWED_TYPES.has(documentType)) {
      return NextResponse.json({ error: 'Dokumenttyp nicht erlaubt' }, { status: 400 });
    }

    // Phase 4 — server-side version pinning: only accept the version that
    // matches the current global constant. This makes the constants the
    // single source of truth and prevents a stale client from "refreshing"
    // an outdated row to look current.
    const expectedVersion = getCurrentVersion(documentType);
    if (documentVersion !== expectedVersion) {
      return NextResponse.json(
        {
          error:
            'Dokumentversion ist nicht mehr aktuell. Bitte laden Sie die Seite neu und akzeptieren Sie die aktualisierte Version.',
          field: 'documentVersion',
          expected: expectedVersion,
        },
        { status: 400 }
      );
    }

    const ipAddress = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
                   || request.headers.get('x-real-ip')
                   || null;
    const ua = request.headers.get('user-agent') || null;
    const userAgent = ua ? (ua.length > 280 ? ua.slice(0, 280) : ua) : null;

    // Phase 4 — capture the previous latest version BEFORE inserting the new
    // row, so we can detect actual version bumps and audit them as a
    // re-acceptance (not a first-time acceptance).
    const previousLatest = await prisma.consentRecord.findFirst({
      where: { userId: user.id, documentType },
      orderBy: { acceptedAt: 'desc' },
      select: { documentVersion: true },
    });
    const previousVersion = previousLatest?.documentVersion || null;
    const isReAcceptance = !!previousVersion && previousVersion !== documentVersion;

    const created = await prisma.consentRecord.create({
      data: {
        userId: user.id,
        documentType,
        documentVersion,
        ipAddress,
        userAgent,
      },
    });

    const event = docEvent(documentType);
    if (event) {
      logAuditAsync({
        userId: user.id,
        userEmail: user.email,
        userRole: user.role,
        action: event,
        area: AREAS.COMPLIANCE,
        targetType: 'ConsentRecord',
        targetId: created.id,
        success: true,
        details: {
          documentType,
          documentVersion,
          previousVersion,
          source: isReAcceptance ? 're_acceptance' : 'onboarding',
        },
        request,
      });
    }

    // Phase 4 — emit a single high-level event whenever a version actually
    // changed for this user. Helps admins quickly find users who re-accepted
    // after a legal bump without scanning per-document events.
    if (isReAcceptance) {
      logAuditAsync({
        userId: user.id,
        userEmail: user.email,
        userRole: user.role,
        action: EVENTS.USER_REACCEPTED_LEGAL,
        area: AREAS.COMPLIANCE,
        targetType: 'ConsentRecord',
        targetId: created.id,
        success: true,
        details: {
          documentType,
          previousVersion,
          newVersion: documentVersion,
        },
        request,
      });
    }

    return NextResponse.json({ ok: true, record: created, isReAcceptance });
  } catch (error) {
    console.error('POST consent error:', error);
    return NextResponse.json({ error: 'Fehler' }, { status: 500 });
  }
}

// Suppress unused-import warning while keeping REQUIRED_DOC_TYPES exported
// from lib for callers and admin tooling.
void REQUIRED_DOC_TYPES;
