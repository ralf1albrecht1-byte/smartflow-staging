export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import crypto from 'crypto';
import { logAuditAsync } from '@/lib/audit';
import { shouldSendEmail, getEmailSuppressionReason, getAppEnv } from '@/lib/env';
import { normalizeEmail } from '@/lib/email-utils';
import { sendEmail } from '@/lib/mail';

export async function POST(request: Request) {
  try {
    const { email } = await request.json();

    const neutralResponse = NextResponse.json({
      success: true,
      message: 'Wenn ein Konto mit dieser E-Mail existiert, wurde ein Link zum Zurücksetzen gesendet.',
    });

    const normalized = normalizeEmail(email);
    if (!normalized) {
      return neutralResponse;
    }

    const user = await prisma.user.findFirst({
      where: { email: { equals: normalized, mode: 'insensitive' } },
      orderBy: [
        { emailVerified: { sort: 'desc', nulls: 'last' } },
        { createdAt: 'desc' },
      ],
    });

    if (!user) {
      return neutralResponse;
    }

    await prisma.verificationToken.deleteMany({
      where: { identifier: `reset:${user.email}` },
    });

    const rawToken = crypto.randomBytes(32).toString('hex');
    const hashedToken = crypto.createHash('sha256').update(rawToken).digest('hex');
    const expires = new Date(Date.now() + 60 * 60 * 1000);

    await prisma.verificationToken.create({
      data: {
        identifier: `reset:${user.email}`,
        token: hashedToken,
        expires,
      },
    });

    const forwardedHost = request.headers.get('x-forwarded-host') || request.headers.get('host') || '';
    const forwardedProto = request.headers.get('x-forwarded-proto') || 'https';

    const appUrl = forwardedHost
      ? `${forwardedProto}://${forwardedHost}`
      : (process.env.NEXTAUTH_URL || 'http://localhost:3000');

    const resetUrl = `${appUrl}/passwort-zuruecksetzen?token=${rawToken}&email=${encodeURIComponent(user.email)}`;

    try {
      const htmlBody = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #333; border-bottom: 2px solid #16a34a; padding-bottom: 10px;">Passwort zurücksetzen</h2>
          <p>Hallo${user.name ? ` ${user.name}` : ''},</p>
          <p>du hast angefordert, dein Passwort zurückzusetzen.</p>
          <p>Klicke auf den folgenden Link, um ein neues Passwort festzulegen:</p>
          <div style="text-align: center; margin: 30px 0;">
            <a href="${resetUrl}" style="background: #16a34a; color: white; padding: 12px 30px; border-radius: 6px; text-decoration: none; font-weight: bold;">Neues Passwort festlegen</a>
          </div>
          <p style="color: #666; font-size: 14px;">Oder kopiere diesen Link in deinen Browser:</p>
          <p style="color: #666; font-size: 12px; word-break: break-all;">${resetUrl}</p>
          <p style="color: #666; font-size: 14px;">Falls du das nicht warst, kannst du diese E-Mail ignorieren. Dein Passwort bleibt unverändert.</p>
          <p style="color: #999; font-size: 12px; margin-top: 30px;">Dieser Link ist 60 Minuten gültig.</p>
        </div>
      `;

      if (shouldSendEmail(user.email)) {
        await sendEmail({
          to: user.email,
          subject: 'Passwort zurücksetzen - Business Manager',
          html: htmlBody,
        });
      } else {
        const reason = getEmailSuppressionReason(user.email) || 'unknown';

        console.log(`[forgot-password] email suppressed by env guard env=${getAppEnv()} reason=${reason}`);

        logAuditAsync({
          userId: user.id,
          userEmail: user.email,
          action: 'EMAIL_SUPPRESSED_BY_ENV',
          area: 'AUTH',
          success: true,
          details: { kind: 'password_reset', env: getAppEnv(), reason },
          request,
        });
      }
    } catch (emailError) {
      console.error('Failed to send reset email:', emailError);
    }

    logAuditAsync({
      userId: user.id,
      userEmail: user.email,
      action: 'PASSWORD_RESET_REQUEST',
      area: 'AUTH',
      success: true,
      request,
    });

    return neutralResponse;
  } catch (error: any) {
    console.error('Forgot password error:', error);

    return NextResponse.json({
      success: true,
      message: 'Wenn ein Konto mit dieser E-Mail existiert, wurde ein Link zum Zurücksetzen gesendet.',
    });
  }
}