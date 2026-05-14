export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireUserId, handleAuthError, getSessionUser } from '@/lib/get-session';
import { logAuditAsync } from '@/lib/audit';
import { normalizePhoneE164 } from '@/lib/normalize';
import { getEnvLabel } from '@/lib/env';
import { getS3ResolvedConfig } from '@/lib/aws-config';

export async function GET() {
  try {
    let userId: string;
    try { userId = await requireUserId(); } catch (e) { return handleAuthError(e); }

    let settings = await prisma.companySettings.findFirst({
  where: { userId },
  select: {
    id: true,
    userId: true,
    firmenname: true,
    firmaRechtlich: true,
    ansprechpartner: true,
    telefon: true,
    telefon2: true,
    email: true,
    supportEmail: true,
    webseite: true,
    strasse: true,
    hausnummer: true,
    plz: true,
    ort: true,
    iban: true,
    bank: true,
    mwstAktiv: true,
    mwstNummer: true,
    mwstSatz: true,
    mwstHinweis: true,
    testModus: true,
    branche: true,
    hauptsprache: true,
    documentTemplate: true,
    letterheadUrl: true,
    letterheadName: true,
    letterheadVisible: true,
    whatsappIntakeNumber: true,
    createdAt: true,
    updatedAt: true,
currency: true,
  },
});
    if (!settings) {
      settings = await prisma.companySettings.create({ data: { userId } });
    }
    // Append runtime feature flags (non-persisted, derived from env).
    // envLabel: null in production, "STAGING"/"DEVELOPMENT" otherwise.
    // whatsappEnabled: true only when Twilio credentials are configured.
    const envLabel = getEnvLabel();
    const whatsappEnabled = !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN);

    return NextResponse.json({ ...settings, envLabel, whatsappEnabled });
  } catch (error) {
    console.error('GET /api/settings error:', error);
    return NextResponse.json({ error: 'Fehler beim Laden' }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    let userId: string;
    try { userId = await requireUserId(); } catch (e) { return handleAuthError(e); }

    const body = await request.json();
    const {
      firmenname, firmaRechtlich, ansprechpartner, telefon: rawTelefon, telefon2: rawTelefon2, email, supportEmail, webseite,
      strasse, hausnummer, plz, ort,
     iban, bank, mwstAktiv, mwstNummer, mwstSatz, mwstHinweis, testModus, branche, hauptsprache, currency,
      // New fields for document template + letterhead (Settings/Templates/Import paket)
      documentTemplate: rawDocumentTemplate, letterheadUrl: rawLetterheadUrl, letterheadName: rawLetterheadName,
      letterheadVisible: rawLetterheadVisible,
      // Legacy aliases kept for backward compatibility (old clients)
      logoUrl: rawLogoUrl, companyLogo: rawCompanyLogo, companyLogoUrl: rawCompanyLogoUrl,
      logoVisible: rawLogoVisible, showLogo: rawShowLogo,
      // WhatsApp intake number
      whatsappIntakeNumber: rawWhatsappIntakeNumber,
    } = body;

    const letterheadUrlProvided =
      rawLetterheadUrl !== undefined ||
      rawLogoUrl !== undefined ||
      rawCompanyLogo !== undefined ||
      rawCompanyLogoUrl !== undefined;

    const resolvedRawLetterheadUrl =
      rawLetterheadUrl !== undefined
        ? rawLetterheadUrl
        : rawLogoUrl !== undefined
          ? rawLogoUrl
          : rawCompanyLogo !== undefined
            ? rawCompanyLogo
            : rawCompanyLogoUrl;

    const letterheadVisibleProvided =
      rawLetterheadVisible !== undefined ||
      rawLogoVisible !== undefined ||
      rawShowLogo !== undefined;

    const resolvedRawLetterheadVisible =
      rawLetterheadVisible !== undefined
        ? rawLetterheadVisible
        : rawLogoVisible !== undefined
          ? rawLogoVisible
          : rawShowLogo;

    // Whitelist document template values. Fallback to 'classic' (byte-identical to pre-template behaviour).
    const ALLOWED_TEMPLATES = ['classic', 'modern', 'minimal', 'elegant'] as const;
    let documentTemplate: string | undefined = undefined;
    if (rawDocumentTemplate !== undefined) {
      const t = String(rawDocumentTemplate || '').toLowerCase();
      documentTemplate = (ALLOWED_TEMPLATES as readonly string[]).includes(t) ? t : 'classic';
    }

    // ─── Paket A: Phone number foundation — server-side normalization + validation ───
    // 1) Distinguish "field omitted" (undefined) from "field cleared" (null/empty):
    //    - omitted → do not touch; keep existing value
    //    - cleared → set to null
    //    - non-empty → normalize; reject if invalid
    const telefonProvided = rawTelefon !== undefined;
    const telefon2Provided = rawTelefon2 !== undefined;

    let normalizedTelefon: string | null | undefined = undefined;
    let normalizedTelefon2: string | null | undefined = undefined;

    if (telefonProvided) {
      const raw = (rawTelefon ?? '').toString().trim();
      if (!raw) {
        normalizedTelefon = null;
      } else {
        const n = normalizePhoneE164(raw);
        if (!n) {
          return NextResponse.json(
            { error: 'Ungültige Telefonnummer. Bitte im internationalen Format eingeben (z.B. +41 76 123 45 67).', field: 'telefon' },
            { status: 400 }
          );
        }
        normalizedTelefon = n;
      }
    }

    if (telefon2Provided) {
      const raw = (rawTelefon2 ?? '').toString().trim();
      if (!raw) {
        normalizedTelefon2 = null;
      } else {
        const n = normalizePhoneE164(raw);
        if (!n) {
          return NextResponse.json(
            { error: 'Ungültige zweite Nummer. Bitte im internationalen Format eingeben (z.B. +41 76 123 45 67).', field: 'telefon2' },
            { status: 400 }
          );
        }
        normalizedTelefon2 = n;
      }
    }

    // 2) WhatsApp intake number — normalize early so we can cross-check
    let normalizedWhatsapp: string | null | undefined = undefined;
    const whatsappProvided = rawWhatsappIntakeNumber !== undefined;
    if (whatsappProvided) {
      const raw = (rawWhatsappIntakeNumber ?? '').toString().trim();
      if (!raw) {
        normalizedWhatsapp = null;
      } else {
        const n = normalizePhoneE164(raw);
        if (!n) {
          return NextResponse.json(
            { error: 'Ungültige Hauptnummer. Bitte im internationalen Format eingeben (z.B. +41 76 123 45 67).', field: 'whatsappIntakeNumber' },
            { status: 400 }
          );
        }
        normalizedWhatsapp = n;
      }
    }

    // 3) Reject if Hauptnummer and Zweitnummer are the SAME normalized value
    if (normalizedWhatsapp && normalizedTelefon2 && normalizedWhatsapp === normalizedTelefon2) {
      return NextResponse.json(
        { error: 'Hauptnummer und Zweitnummer dürfen nicht identisch sein.', field: 'telefon2' },
        { status: 400 }
      );
    }
    // Also check telefon vs telefon2 for legacy compat
    if (normalizedTelefon && normalizedTelefon2 && normalizedTelefon === normalizedTelefon2) {
      return NextResponse.json(
        { error: 'Hauptnummer und Zweitnummer dürfen nicht identisch sein.', field: 'telefon2' },
        { status: 400 }
      );
    }

    // 4) Uniqueness: only WhatsApp intake numbers must be unique cross-account.
    //    telefon (business phone) is intentionally excluded — it may be shared
    //    across companies (e.g. same office number).
    const numbersToCheck: Array<{ field: string; value: string }> = [];
    if (normalizedWhatsapp) numbersToCheck.push({ field: 'whatsappIntakeNumber', value: normalizedWhatsapp });
    if (normalizedTelefon2) numbersToCheck.push({ field: 'telefon2', value: normalizedTelefon2 });

    for (const { field, value } of numbersToCheck) {
      const conflicts = await prisma.companySettings.findMany({
        where: {
          userId: { not: userId },
          OR: [{ whatsappIntakeNumber: value }, { telefon2: value }],
        },
        select: { id: true, userId: true },
      });
      if (conflicts.length > 0) {
        return NextResponse.json(
          {
            error: `Diese Nummer ist bereits einem anderen Account zugeordnet und kann nicht doppelt vergeben werden.`,
            field,
            conflicting: value,
          },
          { status: 409 }
        );
      }
    }

const settingsData: Record<string, any> = {};

if (firmenname !== undefined) settingsData.firmenname = firmenname || '';
if (firmaRechtlich !== undefined) settingsData.firmaRechtlich = firmaRechtlich || null;
if (ansprechpartner !== undefined) settingsData.ansprechpartner = ansprechpartner || null;
if (email !== undefined) settingsData.email = email || null;
if (supportEmail !== undefined) settingsData.supportEmail = supportEmail || null;
if (webseite !== undefined) settingsData.webseite = webseite || null;
if (strasse !== undefined) settingsData.strasse = strasse || null;
if (hausnummer !== undefined) settingsData.hausnummer = hausnummer || null;
if (plz !== undefined) settingsData.plz = plz || null;
if (ort !== undefined) settingsData.ort = ort || null;
if (iban !== undefined) settingsData.iban = iban || null;
if (bank !== undefined) settingsData.bank = bank || null;
if (mwstAktiv !== undefined) settingsData.mwstAktiv = !!mwstAktiv;
if (mwstNummer !== undefined) settingsData.mwstNummer = mwstNummer || null;
if (mwstSatz !== undefined) settingsData.mwstSatz = mwstSatz != null ? Number(mwstSatz) : null;
if (mwstHinweis !== undefined) settingsData.mwstHinweis = mwstHinweis || null;
if (testModus !== undefined) settingsData.testModus = testModus;
if (branche !== undefined) settingsData.branche = branche;
if (hauptsprache !== undefined) settingsData.hauptsprache = hauptsprache;
if (currency !== undefined) settingsData.currency = currency === 'EUR' ? 'EUR' : 'CHF';


    
    // Only include phone fields when caller provided them (preserves legacy rows on partial updates).
    if (telefonProvided) settingsData.telefon = normalizedTelefon;
    if (telefon2Provided) settingsData.telefon2 = normalizedTelefon2;

    // Only touch template/letterhead fields when the caller provided them — legacy rows
    // must not lose their template selection on partial updates.
    if (documentTemplate !== undefined) settingsData.documentTemplate = documentTemplate;
    if (letterheadUrlProvided) {
      const normalizedLetterhead = resolvedRawLetterheadUrl ? String(resolvedRawLetterheadUrl).trim() : '';
      if (!normalizedLetterhead) {
        settingsData.letterheadUrl = null;
      } else if (/^https?:\/\//i.test(normalizedLetterhead)) {
        settingsData.letterheadUrl = normalizedLetterhead;
      } else {
        // Backward compatibility: some legacy rows stored cloud_storage_path instead of a URL.
        const { bucketName, region } = getS3ResolvedConfig();
        const normalizedKey = normalizedLetterhead.replace(/^\/+/, '');
        settingsData.letterheadUrl = bucketName
          ? 'https://' + bucketName + '.s3.' + region + '.amazonaws.com/' + normalizedKey
          : normalizedLetterhead;
      }
    }
    if (rawLetterheadName !== undefined) settingsData.letterheadName = rawLetterheadName ? String(rawLetterheadName) : null;
    if (letterheadVisibleProvided) settingsData.letterheadVisible = !!resolvedRawLetterheadVisible;

    // WhatsApp intake number — already normalized above in step 2
    if (whatsappProvided) settingsData.whatsappIntakeNumber = normalizedWhatsapp;



// Find existing settings for this user
let existing = await prisma.companySettings.findFirst({
  where: { userId },
  select: { id: true },
});

if (existing) {
  const settings = await prisma.companySettings.update({
    where: { id: existing.id },
    data: settingsData,
    select: {
      id: true,
      userId: true,
      firmenname: true,
      firmaRechtlich: true,
      ansprechpartner: true,
      telefon: true,
      telefon2: true,
      email: true,
      supportEmail: true,
      webseite: true,
      strasse: true,
      hausnummer: true,
      plz: true,
      ort: true,
      iban: true,
      bank: true,
      mwstAktiv: true,
      mwstNummer: true,
      mwstSatz: true,
      mwstHinweis: true,
      testModus: true,
      branche: true,
      hauptsprache: true,
      documentTemplate: true,
      letterheadUrl: true,
      letterheadName: true,
      letterheadVisible: true,
      whatsappIntakeNumber: true,
      createdAt: true,
      updatedAt: true,
currency: true,
    },
  });

  const su = await getSessionUser();
  logAuditAsync({ userId: su?.id, userEmail: su?.email, userRole: su?.role, action: 'SETTINGS_UPDATE', area: 'SETTINGS', request });
  return NextResponse.json(settings);
} else {
  const settings = await prisma.companySettings.create({
    data: { userId, ...settingsData, testModus: testModus ?? true, branche: branche ?? 'Gartenbau', hauptsprache: hauptsprache ?? 'Deutsch' },
    select: {
      id: true,
      userId: true,
      firmenname: true,
      firmaRechtlich: true,
      ansprechpartner: true,
      telefon: true,
      telefon2: true,
      email: true,
      supportEmail: true,
      webseite: true,
      strasse: true,
      hausnummer: true,
      plz: true,
      ort: true,
      iban: true,
      bank: true,
      mwstAktiv: true,
      mwstNummer: true,
      mwstSatz: true,
      mwstHinweis: true,
      testModus: true,
      branche: true,
      hauptsprache: true,
      documentTemplate: true,
      letterheadUrl: true,
      letterheadName: true,
      letterheadVisible: true,
      whatsappIntakeNumber: true,
      createdAt: true,
      updatedAt: true,
currency: true,
    },
  });

  const su = await getSessionUser();
  logAuditAsync({ userId: su?.id, userEmail: su?.email, userRole: su?.role, action: 'SETTINGS_UPDATE', area: 'SETTINGS', request });
  return NextResponse.json(settings);
}



  } catch (error) {
    console.error('PUT /api/settings error:', error);
    return NextResponse.json({ error: 'Fehler beim Speichern' }, { status: 500 });
  }
}
