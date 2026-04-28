export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import crypto from 'crypto';
import { logAuditAsync } from '@/lib/audit';
import { normalizeEmail } from '@/lib/email-utils';
import { shouldSendEmail, getEmailSuppressionReason, getAppEnv } from '@/lib/env';

/**
 * POST /api/auth/resend-verification
 * Generates a new verification token and re-sends the verification email.
 * Rate-limited to one email per 2 minutes per address (soft guard).
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const email = normalizeEmail(body?.email);

    if (!email) {
      return NextResponse.json(
        { error: 'E-Mail-Adresse ist erforderlich' },
        { status: 400 },
      );
    }

    // Find user (case-insensitive, prefer verified row like everywhere else)
    const user = await prisma.user.findFirst({
      where: { email: { equals: email, mode: 'insensitive' } },
      orderBy: [
        { emailVerified: { sort: 'desc', nulls: 'last' } },
        { createdAt: 'desc' },
      ],
    });

    // Always return success to avoid email-enumeration attacks
    if (!user || !user.password) {
      return NextResponse.json({ success: true });
    }

    // Already verified — nothing to do
    if (user.emailVerified) {
      return NextResponse.json({ success: true });
    }

    // Rate-limit: check if a token was created in the last 2 min
    const recentToken = await prisma.verificationToken.findFirst({
      where: {
        identifier: { equals: email, mode: 'insensitive' },
        expires: { gt: new Date() },
      },
      orderBy: { expires: 'desc' },
    });

    if (recentToken) {
      // If the token was created less than 2 minutes ago, throttle
      const tokenCreatedAt = new Date(recentToken.expires.getTime() - 24 * 60 * 60 * 1000);
      const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000);
      if (tokenCreatedAt > twoMinutesAgo) {
        return NextResponse.json({ success: true }); // silent throttle
      }
    }

    // Delete any existing tokens for this email
    await prisma.verificationToken.deleteMany({
      where: { identifier: { equals: email, mode: 'insensitive' } },
    });

    // Create new token
    const token = crypto.randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24h
    await prisma.verificationToken.create({
      data: {
        identifier: email,
        token,
        expires,
      },
    });

    // Build verification URL
    const forwardedHost = request.headers.get('x-forwarded-host') || request.headers.get('host') || '';
    const forwardedProto = request.headers.get('x-forwarded-proto') || 'https';
    const appUrl = forwardedHost
      ? `${forwardedProto}://${forwardedHost}`
      : (process.env.NEXTAUTH_URL || 'http://localhost:3000');
    const verifyUrl = `${appUrl}/api/auth/verify?token=${token}&email=${encodeURIComponent(email)}`;

    const htmlBody = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #333; border-bottom: 2px solid #16a34a; padding-bottom: 10px;">E-Mail Bestätigung</h2>
        <p>Hallo ${user.name || email},</p>
        <p>Sie haben einen neuen Bestätigungslink angefordert.</p>
        <p>Bitte bestätigen Sie Ihre E-Mail-Adresse, indem Sie auf den folgenden Link klicken:</p>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${verifyUrl}" style="background: #16a34a; color: white; padding: 12px 30px; border-radius: 6px; text-decoration: none; font-weight: bold;">E-Mail bestätigen</a>
        </div>
        <p style="color: #666; font-size: 14px;">Oder kopieren Sie diesen Link in Ihren Browser:</p>
        <p style="color: #666; font-size: 12px; word-break: break-all;">${verifyUrl}</p>
        <p style="color: #999; font-size: 12px; margin-top: 30px;">Dieser Link ist 24 Stunden gültig.</p>
      </div>
    `;

    if (shouldSendEmail(email)) {
      await fetch('https://apps.abacus.ai/api/sendNotificationEmail', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deployment_token: process.env.ABACUSAI_API_KEY,
          app_id: process.env.WEB_APP_ID,
          notification_id: process.env.NOTIF_ID_EMAIL_VERIFIZIERUNG,
          subject: 'E-Mail Bestätigung - Business Manager',
          body: htmlBody,
          is_html: true,
          recipient_email: email,
          sender_email: `noreply@${(() => { try { return new URL(appUrl).hostname; } catch { return 'business-manager.app'; } })()}`,
          sender_alias: 'Business Manager',
        }),
      });
    } else {
      const reason = getEmailSuppressionReason(email) || 'unknown';
      console.log(`[resend-verification] email suppressed by env guard env=${getAppEnv()} reason=${reason}`);
      logAuditAsync({
        userId: user.id,
        userEmail: email,
        action: 'EMAIL_SUPPRESSED_BY_ENV',
        area: 'AUTH',
        success: true,
        details: { kind: 'resend_verification', env: getAppEnv(), reason },
        request,
      });
    }

    logAuditAsync({
      userId: user.id,
      userEmail: email,
      action: 'RESEND_VERIFICATION',
      area: 'AUTH',
      success: true,
      details: {},
      request,
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Resend verification error:', error);
    return NextResponse.json(
      { error: 'Ein Fehler ist aufgetreten. Bitte versuchen Sie es später erneut.' },
      { status: 500 },
    );
  }
}
