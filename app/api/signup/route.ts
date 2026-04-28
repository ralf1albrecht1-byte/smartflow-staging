export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { logAuditAsync, EVENTS, AREAS } from '@/lib/audit';
import { normalizePhoneE164 } from '@/lib/normalize';
import { shouldSendEmail, getEmailSuppressionReason, getAppEnv } from '@/lib/env';
import { getCurrentVersion, type LegalDocumentType } from '@/lib/legal-versions';
import { normalizeEmail } from '@/lib/email-utils';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const {
      email: rawEmail, password, confirmPassword, name,
      // Block P — three separate compliance acceptances. Each becomes its own
      // ConsentRecord + audit event. `acceptedTerms` is back-compat fallback.
      acceptedAgb, acceptedDatenschutz, acceptedAvv, acceptedTerms,
      // Optional business contact fields captured directly at registration.
      // These map 1:1 onto CompanySettings columns — no parallel storage.
      telefon: rawTelefon,
      strasse: rawStrasse,
      hausnummer: rawHausnummer,
      plz: rawPlz,
      ort: rawOrt,
    } = body || {};

    // Back-compat: legacy clients sending only `acceptedTerms` are treated as
    // having accepted AGB + Datenschutz only — they will still hit the post-
    // login compliance gate to accept AVV before using the app.
    const agbOk = Boolean(acceptedAgb || acceptedTerms);
    const datenschutzOk = Boolean(acceptedDatenschutz || acceptedTerms);
    const avvOk = Boolean(acceptedAvv);

    // Normalize email up-front (lower-case + trim). This is the single source
    // of truth for the address going into the DB and outgoing verification
    // email - it eliminates the case-sensitivity duplicate-account bug that
    // surfaced as "ungueltiger Bestaetigungslink" in production. See lib/email-utils.ts.
    const email = normalizeEmail(rawEmail);

    if (!email || !password) {
      return NextResponse.json({ error: 'E-Mail und Passwort sind erforderlich' }, { status: 400 });
    }
    if (!confirmPassword || password !== confirmPassword) {
      return NextResponse.json({ error: 'Passwörter stimmen nicht überein' }, { status: 400 });
    }
    if (password.length < 8) {
      return NextResponse.json({ error: 'Passwort muss mindestens 8 Zeichen lang sein' }, { status: 400 });
    }
    if (!agbOk) {
      return NextResponse.json({ error: 'Sie müssen die AGB / Nutzungsbedingungen akzeptieren' }, { status: 400 });
    }
    if (!datenschutzOk) {
      return NextResponse.json({ error: 'Sie müssen die Datenschutzerklärung akzeptieren' }, { status: 400 });
    }
    if (!avvOk) {
      return NextResponse.json({ error: 'Sie müssen die AVV / Auftragsverarbeitung akzeptieren' }, { status: 400 });
    }

    // Case-insensitive duplicate check - protects against legacy mixed-case
    // rows like `Ralf.seelbach@web.de` colliding with a new lowercase signup.
    const existing = await prisma.user.findFirst({
      where: { email: { equals: email, mode: 'insensitive' } },
      select: { id: true },
    });
    if (existing) {
      return NextResponse.json({ error: 'Benutzer existiert bereits' }, { status: 400 });
    }

    // ─── Optional business contact: normalize + safe-trim ───
    // Phone: reuse the single source of truth (normalizePhoneE164) so signup and
    // /api/settings share identical validation semantics.
    const telefonRawStr = (rawTelefon ?? '').toString().trim();
    let normalizedTelefon: string | null = null;
    if (telefonRawStr) {
      const n = normalizePhoneE164(telefonRawStr);
      if (!n) {
        return NextResponse.json(
          { error: 'Ungültige Telefonnummer. Bitte im internationalen Format eingeben (z.B. +41 76 123 45 67).', field: 'telefon' },
          { status: 400 }
        );
      }
      normalizedTelefon = n;
    }

    // Phone uniqueness (same rule as PUT /api/settings): a given E.164 number
    // must not already belong to another user's CompanySettings.
    if (normalizedTelefon) {
      const conflicts = await prisma.companySettings.findMany({
        where: {
          OR: [{ telefon: normalizedTelefon }, { telefon2: normalizedTelefon }],
        },
        select: { id: true },
      });
      if (conflicts.length > 0) {
        return NextResponse.json(
          {
            error: 'Diese Telefonnummer ist bereits einem anderen Account zugeordnet und kann nicht doppelt vergeben werden.',
            field: 'telefon',
          },
          { status: 409 }
        );
      }
    }

    const strasseTrim = (rawStrasse ?? '').toString().trim() || null;
    const hausnummerTrim = (rawHausnummer ?? '').toString().trim() || null;
    const plzTrim = (rawPlz ?? '').toString().trim() || null;
    const ortTrim = (rawOrt ?? '').toString().trim() || null;

    const hashed = await bcrypt.hash(password, 10);

    // Block P — capture acceptance metadata for ConsentRecord rows.
    const ipAddress = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
                   || request.headers.get('x-real-ip')
                   || null;
    const ua = request.headers.get('user-agent') || null;
    const userAgent = ua ? (ua.length > 280 ? ua.slice(0, 280) : ua) : null;
    // Phase 4 — Each document is stamped with its CURRENT version constant.
    // When any constant is bumped later, the next deploy will force users
    // through /onboarding/compliance to re-accept (gate in (app)/layout.tsx).
    // New signups always start at the current version, so they never hit the
    // re-acceptance flow immediately after signup.

    // Atomic: create User AND seed CompanySettings (with any provided business
    // fields) AND three ConsentRecord rows (terms / privacy / avv) in a single
    // transaction so registration can never leave orphan or partially-accepted
    // rows. CompanySettings is the single source of truth for business contact
    // data; ConsentRecord is the single source of truth for compliance acceptance.
    const { user, consentRecords } = await prisma.$transaction(async (tx: any) => {
      const createdUser = await tx.user.create({
        data: {
          email,
          password: hashed,
          name: name || email,
          acceptedTermsAt: new Date(),
        },
      });
      const settingsData: Record<string, any> = { userId: createdUser.id };
      if (normalizedTelefon) settingsData.telefon = normalizedTelefon;
      if (strasseTrim) settingsData.strasse = strasseTrim;
      if (hausnummerTrim) settingsData.hausnummer = hausnummerTrim;
      if (plzTrim) settingsData.plz = plzTrim;
      if (ortTrim) settingsData.ort = ortTrim;
      await tx.companySettings.create({ data: settingsData });

      // Block P — three separate compliance acceptances.
      const docTypes: Array<LegalDocumentType> = ['terms', 'privacy', 'avv'];
      const created: Record<string, any> = {};
      for (const documentType of docTypes) {
        const rec = await tx.consentRecord.create({
          data: {
            userId: createdUser.id,
            documentType,
            documentVersion: getCurrentVersion(documentType),
            ipAddress,
            userAgent,
          },
        });
        created[documentType] = rec;
      }
      return { user: createdUser, consentRecords: created };
    });

    // Create verification token
    const token = crypto.randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24h
    await prisma.verificationToken.create({
      data: {
        identifier: email,
        token,
        expires,
      },
    });

    // Send verification email
    try {
      // Derive the public URL from request headers (reverse proxy sets these)
      const forwardedHost = request.headers.get('x-forwarded-host') || request.headers.get('host') || '';
      const forwardedProto = request.headers.get('x-forwarded-proto') || 'https';
      const appUrl = forwardedHost
        ? `${forwardedProto}://${forwardedHost}`
        : (process.env.NEXTAUTH_URL || 'http://localhost:3000');
      // Include the e-mail as a query param so the verify route can still
      // produce a graceful "already verified" response if the token row was
      // already consumed (second click / email-scanner prefetch).
      const verifyUrl = `${appUrl}/api/auth/verify?token=${token}&email=${encodeURIComponent(email)}`;
      const htmlBody = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #333; border-bottom: 2px solid #16a34a; padding-bottom: 10px;">E-Mail Bestätigung</h2>
          <p>Hallo ${name || email},</p>
          <p>Vielen Dank für Ihre Registrierung beim Business Manager.</p>
          <p>Bitte bestätigen Sie Ihre E-Mail-Adresse, indem Sie auf den folgenden Link klicken:</p>
          <div style="text-align: center; margin: 30px 0;">
            <a href="${verifyUrl}" style="background: #16a34a; color: white; padding: 12px 30px; border-radius: 6px; text-decoration: none; font-weight: bold;">E-Mail bestätigen</a>
          </div>
          <p style="color: #666; font-size: 14px;">Oder kopieren Sie diesen Link in Ihren Browser:</p>
          <p style="color: #666; font-size: 12px; word-break: break-all;">${verifyUrl}</p>
          <p style="color: #999; font-size: 12px; margin-top: 30px;">Dieser Link ist 24 Stunden gültig.</p>
        </div>
      `;

      // Phase 2 — env-based email guard.
      // In Production (APP_ENV unset or =production) shouldSendEmail returns true,
      // so behaviour is identical to before. In Staging/Development the guard
      // suppresses delivery and emits an audit event for traceability.
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
        console.log(`[signup] email suppressed by env guard env=${getAppEnv()} reason=${reason}`);
        logAuditAsync({
          userId: user.id,
          userEmail: email,
          action: 'EMAIL_SUPPRESSED_BY_ENV',
          area: 'AUTH',
          success: true,
          details: { kind: 'signup_verification', env: getAppEnv(), reason },
          request,
        });
      }
    } catch (emailError) {
      console.error('Failed to send verification email:', emailError);
      // Continue - user is created, they can request re-send later
    }

    logAuditAsync({ userId: user.id, userEmail: email, action: 'SIGNUP', area: 'AUTH', success: true, request });

    // Block P — three separate compliance audit events for the three accepted documents.
    const docToEvent: Record<string, string> = {
      terms: EVENTS.TERMS_ACCEPTED,
      privacy: EVENTS.PRIVACY_POLICY_ACCEPTED,
      avv: EVENTS.AVV_ACCEPTED,
    };
    for (const documentType of ['terms', 'privacy', 'avv'] as const) {
      const event = docToEvent[documentType];
      const rec = consentRecords?.[documentType];
      if (event && rec) {
        logAuditAsync({
          userId: user.id,
          userEmail: email,
          action: event,
          area: AREAS.COMPLIANCE,
          targetType: 'ConsentRecord',
          targetId: rec.id,
          success: true,
          details: {
            documentType,
            documentVersion: getCurrentVersion(documentType),
            source: 'signup',
          },
          request,
        });
      }
    }

    return NextResponse.json({
      success: true,
      message: 'Registrierung erfolgreich. Bitte prüfen Sie Ihre E-Mail für den Bestätigungslink.',
    });
  } catch (error: any) {
    console.error('Signup error:', error);
    return NextResponse.json({ error: 'Registrierung fehlgeschlagen' }, { status: 500 });
  }
}
