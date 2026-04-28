export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import crypto from 'crypto';
import { logAuditAsync } from '@/lib/audit';
import { shouldSendEmail, getEmailSuppressionReason, getAppEnv } from '@/lib/env';
import { normalizeEmail } from '@/lib/email-utils';

export async function POST(request: Request) {
  try {
    const { email } = await request.json();

    // Always return neutral message - never reveal if email exists
    const neutralResponse = NextResponse.json({
      success: true,
      message: 'Wenn ein Konto mit dieser E-Mail existiert, wurde ein Link zum Zurücksetzen gesendet.',
    });

    const normalized = normalizeEmail(email);
    if (!normalized) {
      return neutralResponse;
    }

    // Case-insensitive lookup so legacy mixed-case rows can also trigger the
    // reset flow. Prefer the verified row when several legacy duplicates exist.
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

    // Delete any existing reset tokens for this user
    await prisma.verificationToken.deleteMany({
      where: { identifier: `reset:${user.email}` },
    });

    // Generate secure token
    const rawToken = crypto.randomBytes(32).toString('hex');
    // Store hashed token in DB for security
    const hashedToken = crypto.createHash('sha256').update(rawToken).digest('hex');
    const expires = new Date(Date.now() + 60 * 60 * 1000); // 60 minutes

    await prisma.verificationToken.create({
      data: {
        identifier: `reset:${user.email}`,
        token: hashedToken,
        expires,
      },
    });

    // Build reset URL from request headers (same pattern as signup)
    const forwardedHost = request.headers.get('x-forwarded-host') || request.headers.get('host') || '';
    const forwardedProto = request.headers.get('x-forwarded-proto') || 'https';
    const appUrl = forwardedHost
      ? `${forwardedProto}://${forwardedHost}`
      : (process.env.NEXTAUTH_URL || 'http://localhost:3000');
    // Send raw token in URL, hash it server-side for verification
    const resetUrl = `${appUrl}/passwort-zuruecksetzen?token=${rawToken}&email=${encodeURIComponent(user.email)}`;

    // Send reset email
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

      // Phase 2 — env-based email guard. Production = no behaviour change.
      if (shouldSendEmail(user.email)) {
        await fetch('https://apps.abacus.ai/api/sendNotificationEmail', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            deployment_token: process.env.ABACUSAI_API_KEY,
            app_id: process.env.WEB_APP_ID,
            notification_id: process.env.NOTIF_ID_PASSWORT_ZURCKSETZEN,
            subject: 'Passwort zurücksetzen - Business Manager',
            body: htmlBody,
            is_html: true,
            recipient_email: user.email,
            sender_email: `noreply@${(() => { try { return new URL(appUrl).hostname; } catch { return 'business-manager.app'; } })()}`,
            sender_alias: 'Business Manager',
          }),
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
      // Still return neutral response
    }

    logAuditAsync({ userId: user.id, userEmail: user.email, action: 'PASSWORD_RESET_REQUEST', area: 'AUTH', success: true, request });

    return neutralResponse;
  } catch (error: any) {
    console.error('Forgot password error:', error);
    return NextResponse.json({
      success: true,
      message: 'Wenn ein Konto mit dieser E-Mail existiert, wurde ein Link zum Zurücksetzen gesendet.',
    });
  }
}
