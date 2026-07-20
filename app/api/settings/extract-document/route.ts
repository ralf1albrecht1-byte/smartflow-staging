export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { requireUserId, handleAuthError } from '@/lib/get-session';
import { getFileUrl } from '@/lib/s3';

const SYSTEM_PROMPT = `Du bist ein KI-Parser für Firmenbriefpapier/Rechnungsbriefe (Schweiz, Deutschland, Österreich).

Du bekommst ein Bild — z.B. Briefpapier, Rechnung, Angebot oder Visitenkarte.

Extrahiere daraus die Firmenstammdaten und gib NUR gültiges JSON zurück (keine Markdown, kein Text davor/danach).

AUSGABEFORMAT:

{
  "firmenname": "",
  "firma_rechtlich": "",
  "ansprechpartner": "",
  "telefon": "",
  "telefon2": "",
  "email": "",
  "webseite": "",
  "adresse": {
    "strasse": "",
    "hausnummer": "",
    "plz": "",
    "ort": ""
  },
  "rechnungsdaten": {
    "iban": "",
    "bank": "",
    "mwst_aktiv": false,
    "mwst_nummer": "",
    "mwst_satz": null,
    "mwst_hinweis": ""
  }
}

REGELN:

1) Extrahiere nur Daten, die tatsächlich im Bild stehen. Niemals Werte erfinden.
2) Wenn ein Feld nicht eindeutig erkennbar ist → leerer String oder null.
3) Telefonnummern bitte im internationalen Format (+41..., +49..., +43...) wenn möglich. Falls nicht, im Originalformat lassen.
4) IBAN ohne Leerzeichen.
5) MWST-Logik:
   - Wenn UID/MWST-Nummer/CHE-Nummer/Steuersatz erkennbar → mwst_aktiv=true, mwst_nummer=erkannte Nummer, mwst_satz=erkannter Wert (Zahl).
   - Wenn "nicht MWST-pflichtig" oder keine Infos vorhanden → mwst_aktiv=false, mwst_nummer="", mwst_satz=null, mwst_hinweis="Nicht MWST-pflichtig".
6) firma_rechtlich = rechtlicher Vollname (z.B. "Beispiel GmbH") nur wenn explizit anders als firmenname. Sonst leer.
7) ansprechpartner = nur wenn eine Person als Kontakt genannt ist, sonst leer.`;

function getOpenAiApiKey(): string | null {
  return process.env.OPENAI_API_KEY || null;
}

function mapExtractedCompanyData(parsed: any) {
  return {
    firmenname: parsed?.firmenname || '',
    firmaRechtlich: parsed?.firma_rechtlich || null,
    ansprechpartner: parsed?.ansprechpartner || null,
    telefon: parsed?.telefon || null,
    telefon2: parsed?.telefon2 || null,
    email: parsed?.email || null,
    webseite: parsed?.webseite || null,
    strasse: parsed?.adresse?.strasse || null,
    hausnummer: parsed?.adresse?.hausnummer || null,
    plz: parsed?.adresse?.plz || null,
    ort: parsed?.adresse?.ort || null,
    iban: parsed?.rechnungsdaten?.iban || null,
    bank: parsed?.rechnungsdaten?.bank || null,
    mwstAktiv: parsed?.rechnungsdaten?.mwst_aktiv ?? false,
    mwstNummer: parsed?.rechnungsdaten?.mwst_nummer || null,
    mwstSatz: parsed?.rechnungsdaten?.mwst_satz ?? null,
    mwstHinweis: parsed?.rechnungsdaten?.mwst_hinweis || null,
  };
}

export async function POST(request: Request) {
  try {
    try {
      await requireUserId();
    } catch (e) {
      return handleAuthError(e);
    }

    const body = await request.json();
    const { cloud_storage_path, contentType } = body || {};

    if (!cloud_storage_path || !contentType) {
      return NextResponse.json(
        { error: 'cloud_storage_path und contentType sind erforderlich.' },
        { status: 400 }
      );
    }

    const folderPrefix = process.env.AWS_FOLDER_PREFIX || '';

    if (folderPrefix && !cloud_storage_path.startsWith(folderPrefix)) {
      return NextResponse.json({ error: 'Ungültiger Dateipfad.' }, { status: 403 });
    }

    const isPdf = contentType === 'application/pdf' || contentType.includes('pdf');
    const isImage = contentType.startsWith('image/');

    if (isPdf) {
      return NextResponse.json(
        {
          error:
           'PDF-Analyse ist aktuell deaktiviert. Bitte vorerst ein Bild hochladen.',
        },
        { status: 400 }
      );
    }

    if (!isImage) {
      return NextResponse.json(
        { error: 'Nur Bilddateien werden aktuell unterstützt.' },
        { status: 400 }
      );
    }

    const apiKey = getOpenAiApiKey();

    if (!apiKey) {
      return NextResponse.json(
        { error: 'KI-Analyse ist aktuell nicht konfiguriert.' },
        { status: 503 }
      );
    }

    const signedUrl = await getFileUrl(cloud_storage_path, false);
    const fileRes = await fetch(signedUrl);

    if (!fileRes.ok) {
      return NextResponse.json(
        { error: 'Datei konnte nicht geladen werden.' },
        { status: 500 }
      );
    }

    const fileBuf = Buffer.from(await fileRes.arrayBuffer());
    const MAX_BYTES = 10 * 1024 * 1024;

    if (fileBuf.byteLength > MAX_BYTES) {
      return NextResponse.json(
        { error: 'Datei ist zu gross (max. 10 MB).' },
        { status: 413 }
      );
    }

    const b64 = fileBuf.toString('base64');

    const llmRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: process.env.OPENAI_VISION_MODEL || process.env.OPENAI_TEXT_MODEL || 'gpt-4.1-mini',
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: 'Bitte extrahiere die Firmenstammdaten aus diesem Bild.',
              },
              {
                type: 'image_url',
                image_url: {
                  url: `data:${contentType};base64,${b64}`,
                },
              },
            ],
          },
        ],
        response_format: { type: 'json_object' },
        max_tokens: 1200,
        temperature: 0,
      }),
    });

    if (!llmRes.ok) {
      const errTxt = await llmRes.text().catch(() => '');
      console.error('OpenAI extract-document error:', llmRes.status, errTxt);

      return NextResponse.json(
        { error: 'KI-Analyse fehlgeschlagen. Bitte erneut versuchen.' },
        { status: 502 }
      );
    }

    const llmJson = await llmRes.json();
    const content = llmJson?.choices?.[0]?.message?.content;

    if (!content) {
      return NextResponse.json(
        { error: 'Keine Antwort von der KI.' },
        { status: 502 }
      );
    }

    let parsed: any;

    try {
      parsed = typeof content === 'string' ? JSON.parse(content) : content;
    } catch {
      console.error('Failed to parse OpenAI JSON:', content);

      return NextResponse.json(
        { error: 'KI-Antwort ungültig.' },
        { status: 502 }
      );
    }

    return NextResponse.json({ extracted: mapExtractedCompanyData(parsed) });
  } catch (error) {
    console.error('POST /api/settings/extract-document error:', error);

    return NextResponse.json(
      { error: 'Fehler bei der Dokument-Analyse.' },
      { status: 500 }
    );
  }
}