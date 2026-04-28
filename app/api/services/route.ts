export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireUserId, unauthorizedResponse, getSessionUser } from '@/lib/get-session';
import { logAuditAsync } from '@/lib/audit';

export async function GET() {
  try {
    let userId: string;
    try { userId = await requireUserId(); } catch { return unauthorizedResponse(); }

    // Block E: Alphabetical order, case-insensitive & locale-aware (de).
    // Prisma's default orderBy is case-sensitive for PostgreSQL text columns,
    // which would place lowercase names after uppercase ones. We sort in Node
    // using localeCompare so the user always sees strict A→Z regardless of
    // capitalization.
    const raw = await prisma.service.findMany({ where: { userId } });
    const services = [...(raw ?? [])].sort((a, b) =>
      (a?.name ?? '').localeCompare(b?.name ?? '', 'de', { sensitivity: 'base' })
    );
    return NextResponse.json(services);
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
    const service = await prisma.service.create({ data: { name: data?.name ?? '', defaultPrice: Number(data?.defaultPrice ?? 0), unit: data?.unit ?? 'Stunde', userId } });
    const su = await getSessionUser();
    logAuditAsync({ userId: su?.id, userEmail: su?.email, userRole: su?.role, action: 'SERVICE_CREATE', area: 'SERVICES', targetType: 'Service', targetId: service.id, request });
    return NextResponse.json(service);
  } catch (error: any) {
    console.error(error);
    return NextResponse.json({ error: 'Fehler beim Erstellen' }, { status: 500 });
  }
}
