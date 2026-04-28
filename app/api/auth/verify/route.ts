export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { logAuditAsync } from '@/lib/audit';
import { normalizeEmail } from '@/lib/email-utils';

function getBaseUrl(request: Request): string {
  const forwardedHost = request.headers.get('x-forwarded-host') || request.headers.get('host') || '';
  const forwardedProto = request.headers.get('x-forwarded-proto') || 'https';
  if (forwardedHost) {
    return `${forwardedProto}://${forwardedHost}`;
  }
  return process.env.NEXTAUTH_URL || 'http://localhost:3000';
}

/**
 * E-Mail verification entry point.
 *
 * Production incident root-cause notes
 * -----------------------------------
 * The previous implementation deleted the VerificationToken on the first
 * successful click, which is correct from a security stand-point but caused
 * a confusing "ungultiger Bestatigungslink" toast on:
 *   (a) any second click (e.g. user clicks once on phone, again on desktop),
 *   (b) email-client safe-link prefetch (web.de / GMX / Outlook safe links
 *       fetch the URL once for malware scanning before the user clicks).
 *
 * Hardening introduced here:
 *  1. The signup route now appends `&email=...` to the verification URL.
 *     If the token row is gone but the email matches an already-verified
 *     user, we redirect to `/login?verified=already` instead of the scary
 *     "invalid token" toast — the click is genuinely idempotent.
 *  2. The user lookup uses case-insensitive matching so legacy rows with
 *     mixed-case e-mails (e.g. `Ralf.seelbach@web.de` vs `ralf.seelbach`)
 *     are still correctly resolved — the previous case-sensitive
 *     `update({where:{email}})` would silently throw P2025 and the user
 *     would see "verification_failed".
 *  3. The whole route remains fail-closed: any unexpected error redirects to
 *     the login page with a code so the front-end can surface a toast.
 */
export async function GET(request: Request) {
  const baseUrl = getBaseUrl(request);
  try {
    const { searchParams } = new URL(request.url);
    const token = searchParams.get('token');
    const emailParam = normalizeEmail(searchParams.get('email'));

    if (!token) {
      return NextResponse.redirect(`${baseUrl}/login?error=invalid_token`);
    }

    const verificationToken = await prisma.verificationToken.findUnique({ where: { token } });

    if (!verificationToken) {
      // Idempotent path: if the user is already verified, treat the click as
      // a no-op success rather than an error. This covers the "second click"
      // and "email-scanner pre-fetch" cases that produced the prod incident.
      if (emailParam) {
        try {
          const existing = await prisma.user.findFirst({
            where: { email: { equals: emailParam, mode: 'insensitive' } },
            select: { id: true, emailVerified: true, email: true },
            orderBy: [{ emailVerified: { sort: 'desc', nulls: 'last' } }],
          });
          if (existing?.emailVerified) {
            return NextResponse.redirect(`${baseUrl}/login?verified=already`);
          }
        } catch (lookupErr) {
          // Fall through to invalid_token if the lookup itself fails.
          console.error('Verify: idempotent lookup failed:', lookupErr);
        }
      }
      return NextResponse.redirect(`${baseUrl}/login?error=invalid_token`);
    }

    if (verificationToken.expires < new Date()) {
      // Clean up expired token
      await prisma.verificationToken.delete({ where: { token } }).catch(() => {});
      return NextResponse.redirect(`${baseUrl}/login?error=expired_token`);
    }

    // Find the user via case-insensitive match — legacy data may have stored
    // the email with different casing than what's in the token's identifier.
    const targetUser = await prisma.user.findFirst({
      where: { email: { equals: verificationToken.identifier, mode: 'insensitive' } },
      select: { id: true, email: true },
    });

    if (!targetUser) {
      console.error('Verify: no user matched token identifier', verificationToken.identifier);
      // Don't leak the token — just clean it up and treat as invalid.
      await prisma.verificationToken.delete({ where: { token } }).catch(() => {});
      return NextResponse.redirect(`${baseUrl}/login?error=invalid_token`);
    }

    // Idempotent update — setting `emailVerified` again on an already-verified
    // user is harmless. Update by `id` so case-mismatches can't break us.
    const verifiedUser = await prisma.user.update({
      where: { id: targetUser.id },
      data: { emailVerified: new Date() },
    });

    logAuditAsync({
      userId: verifiedUser.id,
      userEmail: verifiedUser.email,
      action: 'EMAIL_VERIFIED',
      area: 'AUTH',
      success: true,
      request,
    });

    // Delete the used token (best-effort — a concurrent request may have
    // already cleaned it up).
    await prisma.verificationToken.delete({ where: { token } }).catch(() => {});

    return NextResponse.redirect(`${baseUrl}/login?verified=true`);
  } catch (error: any) {
    console.error('Verify error:', error);
    return NextResponse.redirect(`${baseUrl}/login?error=verification_failed`);
  }
}
