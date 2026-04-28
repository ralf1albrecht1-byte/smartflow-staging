export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import bcrypt from 'bcryptjs';
import { logAuditAsync } from '@/lib/audit';
import { normalizeEmail } from '@/lib/email-utils';
import { evaluateAccountStatus, germanReason, statusCode, auditLoginBlockedByStatus } from '@/lib/account-status';

/**
 * Pre-check endpoint that gives specific error messages before NextAuth signIn.
 * NextAuth's authorize swallows custom error messages, so we check here first.
 *
 * Case-sensitivity hardening (production incident fix)
 * ----------------------------------------------------
 * Previous implementation used `findUnique({ where: { email } })`, which is
 * case-sensitive in Postgres. A user signing up as `Ralf.seelbach@web.de` and
 * later typing the auto-filled lower-case `ralf.seelbach@web.de` would not be
 * matched, OR worse, would match an unrelated unverified shadow account.
 *
 * We now do a case-insensitive lookup, ordered so the verified row wins if
 * legacy data has multiple rows for the same address (older rows are usually
 * unverified shadow accounts). NextAuth's `authorize` callback uses the same
 * pattern — see lib/auth.ts.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const email = normalizeEmail(body?.email);
    const password: string | undefined = body?.password;

    if (!email || !password) {
      return NextResponse.json({ error: 'E-Mail und Passwort sind erforderlich' }, { status: 400 });
    }

    const user = await prisma.user.findFirst({
      where: { email: { equals: email, mode: 'insensitive' } },
      orderBy: [
        { emailVerified: { sort: 'desc', nulls: 'last' } },
        { createdAt: 'desc' },
      ],
    });
    if (!user || !user.password) {
      logAuditAsync({ userEmail: email, action: 'LOGIN_FAILED', area: 'AUTH', success: false, details: { reason: 'invalid_credentials' }, request });
      return NextResponse.json({ error: 'Ungültige Zugangsdaten' }, { status: 401 });
    }

    const isValid = await bcrypt.compare(password, user.password);
    if (!isValid) {
      logAuditAsync({ userId: user.id, userEmail: email, action: 'LOGIN_FAILED', area: 'AUTH', success: false, details: { reason: 'wrong_password' }, request });
      return NextResponse.json({ error: 'Ungültige Zugangsdaten' }, { status: 401 });
    }

    if (!user.emailVerified) {
      logAuditAsync({ userId: user.id, userEmail: email, action: 'LOGIN_FAILED', area: 'AUTH', success: false, details: { reason: 'email_not_verified' }, request });
      return NextResponse.json({
        error: 'E-Mail nicht bestätigt. Bitte prüfen Sie Ihre E-Mail für den Bestätigungslink.',
        code: 'EMAIL_NOT_VERIFIED',
      }, { status: 403 });
    }

    // Block U — technischer Account-Status. Wir spiegeln hier dieselbe Logik
    // wie in NextAuth `authorize()` und liefern eine konkrete deutsche
    // Fehlermeldung. So sieht der User, WARUM der Login abgelehnt wurde.
    const eff = evaluateAccountStatus(user as any);
    if (!eff.canAccess) {
      auditLoginBlockedByStatus({
        userId: user.id,
        email,
        status: eff.status,
        reason: eff.reason,
        request,
      });
      return NextResponse.json({
        error: germanReason(eff.status, (user as any).accessEndsAt),
        code: statusCode(eff.status),
      }, { status: 403 });
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Login pre-check error:', error);
    return NextResponse.json({ error: 'Ein Fehler ist aufgetreten' }, { status: 500 });
  }
}
