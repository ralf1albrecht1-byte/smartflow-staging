export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireUserId, handleAuthError } from '@/lib/get-session';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { logAuditAsync } from '@/lib/audit';

export async function POST(request: Request) {
  try {
    let userId: string;
    try { userId = await requireUserId(); } catch (e) { return handleAuthError(e); }

    const session = await getServerSession(authOptions);
    const body = await request.json();
    const { confirmEmail } = body;

    // Safety: confirm email must match
    if (!confirmEmail || confirmEmail.toLowerCase() !== session?.user?.email?.toLowerCase()) {
      return NextResponse.json({ error: 'E-Mail-Bestätigung stimmt nicht überein.' }, { status: 400 });
    }

    // Delete all user data in correct order (respect foreign keys)
    // 1. Delete offers (they reference orders + customers)
    await prisma.offer.deleteMany({ where: { userId } });
    // 2. Delete invoices (they reference customers)
    await prisma.invoice.deleteMany({ where: { userId } });
    // 3. Delete orders (they reference customers + services)
    await prisma.order.deleteMany({ where: { userId } });
    // 4. Delete customers
    await prisma.customer.deleteMany({ where: { userId } });
    // 5. Delete services
    await prisma.service.deleteMany({ where: { userId } });
    // 6. Delete company settings
    await prisma.companySettings.deleteMany({ where: { userId } });
    // 7. Delete counters for this user
    await prisma.counter.deleteMany({ where: { name: { contains: userId } } });
    // 8. Delete sessions + accounts
    await prisma.session.deleteMany({ where: { userId } });
    await prisma.account.deleteMany({ where: { userId } });
    // Log before deleting user (user record about to be removed)
    logAuditAsync({ userId, userEmail: session?.user?.email || undefined, action: 'ACCOUNT_DELETE', area: 'ACCOUNT', request });

    // 9. Delete the user
    await prisma.user.delete({ where: { id: userId } });

    return NextResponse.json({ success: true, message: 'Konto und alle Daten wurden gelöscht.' });
  } catch (error: any) {
    console.error('DELETE /api/account/delete error:', error);
    return NextResponse.json({ error: 'Fehler beim Löschen des Kontos.' }, { status: 500 });
  }
}
