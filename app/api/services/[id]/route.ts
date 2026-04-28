export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireUserId, unauthorizedResponse, getSessionUser } from '@/lib/get-session';
import { logAuditAsync } from '@/lib/audit';

export async function PUT(request: Request, { params }: { params: { id: string } }) {
  try {
    let userId: string;
    try { userId = await requireUserId(); } catch { return unauthorizedResponse(); }

    const existing = await prisma.service.findFirst({ where: { id: params?.id, userId } });
    if (!existing) return NextResponse.json({ error: 'Nicht gefunden' }, { status: 404 });

    const data = await request.json();
    const service = await prisma.service.update({ where: { id: params?.id }, data: { name: data?.name, defaultPrice: Number(data?.defaultPrice ?? 0), unit: data?.unit } });
    const su = await getSessionUser();
    logAuditAsync({ userId: su?.id, userEmail: su?.email, userRole: su?.role, action: 'SERVICE_UPDATE', area: 'SERVICES', targetType: 'Service', targetId: params?.id, request });
    return NextResponse.json(service);
  } catch (error: any) {
    console.error(error);
    return NextResponse.json({ error: 'Fehler' }, { status: 500 });
  }
}

export async function DELETE(request: Request, { params }: { params: { id: string } }) {
  try {
    let userId: string;
    try { userId = await requireUserId(); } catch { return unauthorizedResponse(); }

    const existing = await prisma.service.findFirst({ where: { id: params?.id, userId } });
    if (!existing) return NextResponse.json({ error: 'Nicht gefunden' }, { status: 404 });

    await prisma.service.delete({ where: { id: params?.id } });
    const su = await getSessionUser();
    logAuditAsync({ userId: su?.id, userEmail: su?.email, userRole: su?.role, action: 'SERVICE_DELETE', area: 'SERVICES', targetType: 'Service', targetId: params?.id, request });
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error(error);
    return NextResponse.json({ error: 'Fehler' }, { status: 500 });
  }
}
