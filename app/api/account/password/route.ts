export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import bcrypt from 'bcryptjs';
import { logAuditAsync } from '@/lib/audit';
import { requireUserId, handleAuthError, getSessionUser } from '@/lib/get-session';

export async function PUT(request: Request) {
  try {
    let userId: string;
    try { userId = await requireUserId(); } catch (e) { return handleAuthError(e); }

    const { currentPassword, newPassword } = await request.json();

    if (!currentPassword || !newPassword) {
      return NextResponse.json({ error: 'Alle Felder sind erforderlich' }, { status: 400 });
    }
    if (newPassword.length < 8) {
      return NextResponse.json({ error: 'Neues Passwort muss mindestens 8 Zeichen lang sein' }, { status: 400 });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, password: true, email: true },
    });

    if (!user || !user.password) {
      return NextResponse.json({ error: 'Benutzer nicht gefunden' }, { status: 404 });
    }

    const isValid = await bcrypt.compare(currentPassword, user.password);
    if (!isValid) {
      return NextResponse.json({ error: 'Aktuelles Passwort ist falsch' }, { status: 400 });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await prisma.user.update({
      where: { id: user.id },
      data: { password: hashedPassword },
    });

    logAuditAsync({ userId: user.id, userEmail: user.email || undefined, action: 'PASSWORD_CHANGE', area: 'ACCOUNT', request });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Password change error:', error);
    return NextResponse.json({ error: 'Interner Fehler' }, { status: 500 });
  }
}
