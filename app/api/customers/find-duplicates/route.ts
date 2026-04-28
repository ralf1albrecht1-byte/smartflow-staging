export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireUserId, unauthorizedResponse } from '@/lib/get-session';
import { classifyMatch, type MatchClass } from '@/lib/duplicate-scoring';

// Phase 2a: classifyMatch + normalize are now in `@/lib/duplicate-scoring`.
// Phone-match inside classifyMatch uses strict libphonenumber-based E.164
// equality via `toE164Strict` from `@/lib/phone`. The 4-/8-digit suffix match
// has been removed -- phones without a parseable international prefix no
// longer contribute to scoring.

export async function POST(request: Request) {
  try {
    let userId: string;
    try { userId = await requireUserId(); } catch { return unauthorizedResponse(); }

    const { name, address, plz, city, phone, email, excludeId, manualQuery } = await request.json();

    // Manual search mode: search by user-typed query across customer fields
    if (manualQuery?.trim()) {
      const q = manualQuery.trim();
      if (q.length < 1) return NextResponse.json([]);

      // For very short queries (1 char), use startsWith on name for relevance;
      // for longer queries, use contains across all fields.
      const isShort = q.length === 1;
      const limit = isShort ? 8 : 20;

      const matches = await prisma.customer.findMany({
        where: {
          userId,
          deletedAt: null,
          ...(excludeId ? { id: { not: excludeId } } : {}),
          OR: isShort
            ? [{ name: { startsWith: q, mode: 'insensitive' } }]
            : [
                { name: { contains: q, mode: 'insensitive' } },
                { phone: { contains: q, mode: 'insensitive' } },
                { email: { contains: q, mode: 'insensitive' } },
                { address: { contains: q, mode: 'insensitive' } },
                { city: { contains: q, mode: 'insensitive' } },
                { plz: { contains: q, mode: 'insensitive' } },
                { customerNumber: { contains: q, mode: 'insensitive' } },
              ],
        },
        select: {
          id: true, customerNumber: true, name: true,
          address: true, plz: true, city: true,
          phone: true, email: true, createdAt: true,
          _count: {
            select: {
              orders: { where: { deletedAt: null } },
              invoices: { where: { deletedAt: null } },
              offers: { where: { deletedAt: null } },
            },
          },
        },
        orderBy: { name: 'asc' },
        take: limit,
      });

      // Score against the current customer data for classification
      const source = { name: name || '', address, plz, city, phone, email };
      const scored = matches.map((m: any) => {
        const { classification, score } = name?.trim()
          ? classifyMatch(source, m)
          : { classification: 'UNSICHER' as MatchClass, score: 10 };
        return { ...m, classification, score, isManualResult: true };
      });
      scored.sort((a: any, b: any) => b.score - a.score);
      return NextResponse.json(scored.slice(0, isShort ? 8 : 15));
    }

    // Auto-search mode: search by last name of current customer
    if (!name?.trim()) return NextResponse.json([]);

    const nameParts = name.trim().split(/\s+/);
    const lastName = nameParts[nameParts.length - 1];
    if (lastName.length < 2) return NextResponse.json([]);

    const matches = await prisma.customer.findMany({
      where: {
        name: { contains: lastName, mode: 'insensitive' },
        userId,
        deletedAt: null,
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
      select: {
        id: true, customerNumber: true, name: true,
        address: true, plz: true, city: true,
        phone: true, email: true, createdAt: true,
        _count: {
          select: {
            orders: { where: { deletedAt: null } },
            invoices: { where: { deletedAt: null } },
            offers: { where: { deletedAt: null } },
          },
        },
      },
      take: 30,
    });

    const source = { name, address, plz, city, phone, email };
    const scored = matches.map((m: any) => {
      const { classification, score } = classifyMatch(source, m);
      return { ...m, classification, score };
    });

    // Sort: EXAKT first, then WAHRSCHEINLICH, then UNSICHER; within each class by score desc
    const classOrder: Record<MatchClass, number> = { EXAKT: 0, WAHRSCHEINLICH: 1, UNSICHER: 2 };
    scored.sort((a: any, b: any) => {
      const classDiff = classOrder[a.classification as MatchClass] - classOrder[b.classification as MatchClass];
      if (classDiff !== 0) return classDiff;
      return b.score - a.score;
    });

    // Return top 10
    return NextResponse.json(scored.slice(0, 10));
  } catch (error: any) {
    console.error('[find-duplicates]', error);
    return NextResponse.json([], { status: 500 });
  }
}