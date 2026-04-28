export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin, unauthorizedResponse, forbiddenResponse } from '@/lib/get-session';

/**
 * Block T-fix — Admin compliance request listing.
 *
 * Sortierung: requestedAt DESC, neueste oben (zuvor `status asc, requestedAt
 * desc` was alphabetisch completed vor open ranked).
 *
 * Filter (alle optional, server-seitig kombinierbar):
 *   - status:  open | in_progress | completed | rejected
 *   - type:    data_export | data_deletion | account_cancellation
 *   - q:       Volltext über Email, Name, Firma, requestId
 *   - from:    YYYY-MM-DD inklusive (auf requestedAt)
 *   - to:      YYYY-MM-DD inklusive (auf requestedAt; bis Tagesende)
 *
 * Response enthält je Eintrag den Firmennamen (aus CompanySettings) und
 * `updatedAt`, damit das Admin-UI „angefordert am" und „zuletzt geändert am"
 * anzeigen kann.
 */
export async function GET(request: Request) {
  try {
    await requireAdmin();
  } catch (e: any) {
    if (e.message === 'FORBIDDEN') return forbiddenResponse();
    return unauthorizedResponse();
  }

  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status') || undefined;
    const type = searchParams.get('type') || undefined;
    const q = (searchParams.get('q') || '').trim();
    const fromRaw = (searchParams.get('from') || '').trim();
    const toRaw = (searchParams.get('to') || '').trim();

    const where: any = {};
    if (status) where.status = status;
    if (type) where.type = type;

    // Datumsfilter — robust parsing; ungültige Werte werden einfach ignoriert.
    const isoDate = /^\d{4}-\d{2}-\d{2}$/;
    if (fromRaw && isoDate.test(fromRaw)) {
      const fromDate = new Date(`${fromRaw}T00:00:00.000Z`);
      if (!isNaN(fromDate.getTime())) {
        where.requestedAt = { ...(where.requestedAt || {}), gte: fromDate };
      }
    }
    if (toRaw && isoDate.test(toRaw)) {
      const toDate = new Date(`${toRaw}T23:59:59.999Z`);
      if (!isNaN(toDate.getTime())) {
        where.requestedAt = { ...(where.requestedAt || {}), lte: toDate };
      }
    }

    // Volltextsuche — Email, Name, Request-ID via Prisma.
    // Firma wird in einem zweiten Schritt über CompanySettings ergänzt
    // (Prisma kennt im ComplianceRequest-Scope nur die direkte User-Relation).
    if (q) {
      const qLower = q.toLowerCase();
      // 1) Direkte Match-Kandidaten auf Request/User.
      const orFilters: any[] = [
        { id: { contains: q, mode: 'insensitive' } },
        { user: { is: { email: { contains: q, mode: 'insensitive' } } } },
        { user: { is: { name: { contains: q, mode: 'insensitive' } } } },
      ];
      // 2) Firmensuche: User-IDs vorab via CompanySettings ermitteln.
      try {
        const companyMatches = await prisma.companySettings.findMany({
          where: { firmenname: { contains: q, mode: 'insensitive' } },
          select: { userId: true },
          take: 200,
        });
        const userIds = Array.from(new Set(companyMatches.map((m: any) => m.userId).filter(Boolean)));
        if (userIds.length > 0) {
          orFilters.push({ userId: { in: userIds } });
        }
      } catch {
        // ignore — q wirkt dann nur auf email/name/id
      }
      // Wenn AND mit anderen Filtern bestehen, kombinieren.
      where.OR = orFilters;
      // qLower bewusst nicht verwendet — Prisma kann case-insensitive über `mode` selbst.
      void qLower;
    }

    const items = await prisma.complianceRequest.findMany({
      where,
      orderBy: { requestedAt: 'desc' },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            name: true,
            // Block U — technischer Account-Status für UI-Chip + Action-Bar
            accountStatus: true,
            accessEndsAt: true,
            blockedAt: true,
            blockedReason: true,
            cancellationAcceptedAt: true,
            anonymizedAt: true,
            deletionCompletedAt: true,
            role: true,
          },
        },
      },
      take: 500,
    });

    // Firmenname je User pro Eintrag ergänzen (für UI-Anzeige + Audit-Kontext).
    const userIds = Array.from(new Set(items.map((i: any) => i.userId).filter(Boolean))) as string[];
    let companyByUserId: Record<string, string | null> = {};
    if (userIds.length > 0) {
      try {
        const settings = await prisma.companySettings.findMany({
          where: { userId: { in: userIds } },
          select: { userId: true, firmenname: true },
        });
        for (const s of settings as any[]) {
          companyByUserId[s.userId] = s.firmenname?.trim() || null;
        }
      } catch {
        // ignore — companyName bleibt null für betroffene Einträge
      }
    }
    const itemsWithCompany = items.map((it: any) => ({
      ...it,
      companyName: companyByUserId[it.userId] ?? null,
    }));

    return NextResponse.json({ items: itemsWithCompany });
  } catch (error) {
    console.error('Admin GET compliance requests error:', error);
    return NextResponse.json({ error: 'Fehler' }, { status: 500 });
  }
}
