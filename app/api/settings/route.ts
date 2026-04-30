export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireUserId, handleAuthError, getSessionUser } from '@/lib/get-session';
import { logAuditAsync } from '@/lib/audit';
import { normalizePhoneE164 } from '@/lib/normalize';
import { getEnvLabel } from '@/lib/env';

export async function GET() {
  try {
    let userId: string;
    try { userId = await requireUserId(); } catch (e) { return handleAuthError(e); }

    let settings = await prisma.companySettings.findFirst({ where: { userId } });
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
      iban, bank, mwstAktiv, mwstNummer, mwstSatz, mwstHinweis, testModus, branche, hauptsprache,
      // New fields for document template + letterhead (Settings/Templates/Import paket)
      documentTemplate: rawDocumentTemplate, letterheadUrl: rawLetterheadUrl, letterheadName: rawLetterheadName,
      letterheadVisible: rawLetterheadVisible,
      // WhatsApp intake number
      whatsappIntakeNumber: rawWhatsappIntakeNumber,
    } = body;

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

    const settingsData: Record<string, any> = {
      firmenname: firmenname ?? '',
      firmaRechtlich: firmaRechtlich || null,
      ansprechpartner: ansprechpartner || null,
      email: email || null,
      supportEmail: supportEmail || null,
      webseite: webseite || null,
      strasse: strasse || null,
      hausnummer: hausnummer || null,
      plz: plz || null,
      ort: ort || null,
      iban: iban || null,
      bank: bank || null,
      mwstAktiv: mwstAktiv ?? false,
      mwstNummer: mwstNummer || null,
      mwstSatz: mwstSatz != null ? Number(mwstSatz) : null,
      mwstHinweis: mwstHinweis || null,
      testModus: testModus ?? undefined,
      branche: branche ?? undefined,
      hauptsprache: hauptsprache ?? undefined,
    };
    // Only include phone fields when caller provided them (preserves legacy rows on partial updates).
    if (telefonProvided) settingsData.telefon = normalizedTelefon;
    if (telefon2Provided) settingsData.telefon2 = normalizedTelefon2;

    // Only touch template/letterhead fields when the caller provided them — legacy rows
    // must not lose their template selection on partial updates.
    if (documentTemplate !== undefined) settingsData.documentTemplate = documentTemplate;
    if (rawLetterheadUrl !== undefined) settingsData.letterheadUrl = rawLetterheadUrl ? String(rawLetterheadUrl) : null;
    if (rawLetterheadName !== undefined) settingsData.letterheadName = rawLetterheadName ? String(rawLetterheadName) : null;
    if (rawLetterheadVisible !== undefined) settingsData.letterheadVisible = !!rawLetterheadVisible;

    // WhatsApp intake number — already normalized above in step 2
    if (whatsappProvided) settingsData.whatsappIntakeNumber = normalizedWhatsapp;

    // Find existing settings for this user
    let existing = await prisma.companySettings.findFirst({ where: { userId } });

    if (existing) {
      const settings = await prisma.companySettings.update({
        where: { id: existing.id },
        data: settingsData,
      });
      const su = await getSessionUser();
      logAuditAsync({ userId: su?.id, userEmail: su?.email, userRole: su?.role, action: 'SETTINGS_UPDATE', area: 'SETTINGS', request });
      return NextResponse.json(settings);
    } else {
      const settings = await prisma.companySettings.create({
        data: { userId, ...settingsData, testModus: testModus ?? true, branche: branche ?? 'Gartenbau', hauptsprache: hauptsprache ?? 'Deutsch' },
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
