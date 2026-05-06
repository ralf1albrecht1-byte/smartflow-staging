export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import Stripe from 'stripe';
import { prisma } from '@/lib/prisma';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { logAuditAsync, EVENTS, AREAS } from '@/lib/audit';
import { normalizePhoneE164 } from '@/lib/normalize';
import { shouldSendEmail, getEmailSuppressionReason, getAppEnv } from '@/lib/env';
import { getCurrentVersion, type LegalDocumentType } from '@/lib/legal-versions';
import { normalizeEmail } from '@/lib/email-utils';
import { sendEmail } from '@/lib/mail';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', {
apiVersion: '2025-02-24.acacia',
});

export async function POST(request: Request) {
try {
const body = await request.json();
const {
email: rawEmail,
password,
confirmPassword,
name,
acceptedAgb,
acceptedDatenschutz,
acceptedAvv,
acceptedTerms,
whatsappIntakeNumber: rawWhatsappIntakeNumber,
telefon: rawTelefon,
strasse: rawStrasse,
hausnummer: rawHausnummer,
plz: rawPlz,
ort: rawOrt,
} = body || {};


const agbOk = Boolean(acceptedAgb || acceptedTerms);
const datenschutzOk = Boolean(acceptedDatenschutz || acceptedTerms);
const avvOk = Boolean(acceptedAvv);

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

const whatsappRawStr = (rawWhatsappIntakeNumber ?? '').toString().trim();

if (!whatsappRawStr) {
  return NextResponse.json(
    { error: 'WhatsApp Nummer ist erforderlich.', field: 'whatsappIntakeNumber' },
    { status: 400 }
  );
}

const normalizedWhatsapp = normalizePhoneE164(whatsappRawStr);

if (!normalizedWhatsapp) {
  return NextResponse.json(
    {
      error: 'Ungültige WhatsApp Nummer. Bitte im internationalen Format eingeben (z.B. +41 76 123 45 67).',
      field: 'whatsappIntakeNumber',
    },
    { status: 400 }
  );
}

const whatsappConflict = await prisma.companySettings.findFirst({
  where: { whatsappIntakeNumber: normalizedWhatsapp },
  select: { id: true },
});

if (whatsappConflict) {
  return NextResponse.json(
    {
      error: 'Diese WhatsApp Nummer ist bereits einem anderen Account zugeordnet.',
      field: 'whatsappIntakeNumber',
    },
    { status: 409 }
  );
}

const existing = await prisma.user.findFirst({
  where: { email: { equals: email, mode: 'insensitive' } },
  select: { id: true },
});

if (existing) {
  return NextResponse.json({ error: 'Benutzer existiert bereits' }, { status: 400 });
}

const telefonRawStr = (rawTelefon ?? '').toString().trim();
let normalizedTelefon: string | null = null;

if (telefonRawStr) {
  const n = normalizePhoneE164(telefonRawStr);

  if (!n) {
    return NextResponse.json(
      {
        error: 'Ungültige Telefonnummer. Bitte im internationalen Format eingeben (z.B. +41 76 123 45 67).',
        field: 'telefon',
      },
      { status: 400 }
    );
  }

  normalizedTelefon = n;
}

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

const ipAddress =
  request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
  request.headers.get('x-real-ip') ||
  null;

const ua = request.headers.get('user-agent') || null;
const userAgent = ua ? (ua.length > 280 ? ua.slice(0, 280) : ua) : null;

const { user, consentRecords } = await prisma.$transaction(async (tx: any) => {
  const createdUser = await tx.user.create({
    data: {
      email,
      password: hashed,
      name: name || email,
      acceptedTermsAt: new Date(),
    },
  });

  const settingsData: Record<string, any> = {
    userId: createdUser.id,
    whatsappIntakeNumber: normalizedWhatsapp,
  };

  if (normalizedTelefon) settingsData.telefon = normalizedTelefon;
  if (strasseTrim) settingsData.strasse = strasseTrim;
  if (hausnummerTrim) settingsData.hausnummer = hausnummerTrim;
  if (plzTrim) settingsData.plz = plzTrim;
  if (ortTrim) settingsData.ort = ortTrim;

  await tx.companySettings.create({ data: settingsData });

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

const token = crypto.randomBytes(32).toString('hex');
const expires = new Date(Date.now() + 24 * 60 * 60 * 1000);

await prisma.verificationToken.create({
  data: {
    identifier: email,
    token,
    expires,
  },
});

try {
  const forwardedHost = request.headers.get('x-forwarded-host') || request.headers.get('host') || '';
  const forwardedProto = request.headers.get('x-forwarded-proto') || 'https';

  const appUrl = forwardedHost
    ? `${forwardedProto}://${forwardedHost}`
    : process.env.NEXTAUTH_URL || 'http://localhost:3000';

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

  if (shouldSendEmail(email)) {
await sendEmail({
  to: email,
  subject: 'E-Mail Bestätigung - Business Manager',
  html: htmlBody,
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
}

logAuditAsync({
  userId: user.id,
  userEmail: email,
  action: 'SIGNUP',
  area: 'AUTH',
  success: true,
  request,
});

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

let checkoutUrl: string | null = null;

try {
  if (process.env.STRIPE_SECRET_KEY && process.env.STRIPE_PRICE_ID_MONTHLY) {
    const forwardedHost = request.headers.get('x-forwarded-host') || request.headers.get('host') || '';
    const forwardedProto = request.headers.get('x-forwarded-proto') || 'https';

    const appUrl = forwardedHost
      ? `${forwardedProto}://${forwardedHost}`
      : process.env.NEXTAUTH_URL || 'http://localhost:3000';

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer_email: email,
      payment_method_types: ['card'],
      line_items: [
        {
          price: process.env.STRIPE_PRICE_ID_MONTHLY,
          quantity: 1,
        },
      ],
      subscription_data: {
        trial_period_days: 7,
        metadata: {
          userId: user.id,
          plan: 'standard',
        },
      },
      client_reference_id: user.id,
      metadata: {
        userId: user.id,
        plan: 'standard',
        source: 'signup',
      },
      success_url: `${appUrl}/dashboard?stripe=success`,
      cancel_url: `${appUrl}/login?stripe=cancelled`,
    });

    checkoutUrl = session.url || null;
  }
} catch (stripeError) {
  console.error('Stripe signup checkout error:', stripeError);
}

return NextResponse.json({
  success: true,
  message: 'Registrierung erfolgreich.',
  checkoutUrl,
});


} catch (error: any) {
console.error('Signup error:', error);
return NextResponse.json({ error: 'Registrierung fehlgeschlagen' }, { status: 500 });
}
}
