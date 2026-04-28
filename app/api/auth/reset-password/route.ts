export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { logAuditAsync } from '@/lib/audit';
import { normalizeEmail } from '@/lib/email-utils';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { token, password, confirmPassword } = body || {};
    // Normalize the URL-supplied email so the comparison below is case-insensitive
    // and matches whether the token was created with a legacy mixed-case email or
    // a freshly normalized lower-case one.
    const emailNormalized = normalizeEmail(body?.email);

    if (!token || !emailNormalized || !password || !confirmPassword) {
      return NextResponse.json({ error: 'Alle Felder sind erforderlich' }, { status: 400 });
    }

    if (password !== confirmPassword) {
      return NextResponse.json({ error: 'Passwörter stimmen nicht überein' }, { status: 400 });
    }

    if (password.length < 8) {
      return NextResponse.json({ error: 'Passwort muss mindestens 8 Zeichen lang sein' }, { status: 400 });
    }

    // Hash the incoming token to compare with stored hash. Token is unique by
    // construction (32 random bytes → sha256), so we can look it up by hash
    // alone and then verify the identifier matches the URL-supplied email
    // case-insensitively. This stays robust against legacy mixed-case rows.
    const hashedToken = crypto.createHash('sha256').update(token).digest('hex');

    const verificationToken = await prisma.verificationToken.findUnique({
      where: { token: hashedToken },
    });

    if (!verificationToken || !verificationToken.identifier.startsWith('reset:')) {
      return NextResponse.json({ error: 'Ungültiger oder abgelaufener Reset-Link' }, { status: 400 });
    }

    const tokenEmailRaw = verificationToken.identifier.slice('reset:'.length);
    if (normalizeEmail(tokenEmailRaw) !== emailNormalized) {
      return NextResponse.json({ error: 'Ungültiger oder abgelaufener Reset-Link' }, { status: 400 });
    }

    if (verificationToken.expires < new Date()) {
      // Clean up expired token
      await prisma.verificationToken.delete({
        where: { identifier_token: { identifier: verificationToken.identifier, token: hashedToken } },
      }).catch(() => {});
      return NextResponse.json({ error: 'Der Reset-Link ist abgelaufen. Bitte fordere einen neuen an.' }, { status: 400 });
    }

    // Find user case-insensitively so legacy mixed-case rows are still resolved.
    const user = await prisma.user.findFirst({
      where: { email: { equals: tokenEmailRaw, mode: 'insensitive' } },
      orderBy: [{ emailVerified: { sort: 'desc', nulls: 'last' } }],
    });
    if (!user) {
      return NextResponse.json({ error: 'Benutzer nicht gefunden' }, { status: 400 });
    }

    // Hash new password and update
    const hashedPassword = await bcrypt.hash(password, 10);
    await prisma.user.update({
      where: { id: user.id },
      data: { password: hashedPassword },
    });

    // Delete the used token
    await prisma.verificationToken.delete({
      where: { identifier_token: { identifier: verificationToken.identifier, token: hashedToken } },
    }).catch(() => {});

    logAuditAsync({ userId: user.id, userEmail: user.email, action: 'PASSWORD_RESET', area: 'AUTH', success: true, request });

    return NextResponse.json({
      success: true,
      message: 'Dein Passwort wurde erfolgreich geändert.',
    });
  } catch (error: any) {
    console.error('Reset password error:', error);
    return NextResponse.json({ error: 'Ein Fehler ist aufgetreten' }, { status: 500 });
  }
}
