export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';

const SYSTEM_PROMPT = `WICHTIG – ABSOLUT KRITISCH:

Gib NUR gültiges JSON zurück.
KEINE Markdown-Formatierung.
KEINE Erklärungen.
KEIN Text vor oder nach dem JSON.

--------------------------------------------------

ROLLE:

Du bist ein KI-Parser für Firmeneinstellungen eines Business-Management-Tools.

--------------------------------------------------

KONTEXT:

Der Nutzer ist ein Firmenkunde (z. B. Handwerksbetrieb, Dienstleistungsunternehmen).

Die Daten werden verwendet für:
- Angebote
- Rechnungen

--------------------------------------------------

WICHTIG:

- Es geht IMMER um die Daten des Firmenkunden (NICHT Endkunden)
- Keine Werte erfinden
- Wenn etwas nicht eindeutig erkennbar ist → null setzen

--------------------------------------------------

AUSGABEFORMAT (JSON):

{
  "firmenname": "",
  "firma_rechtlich": "",
  "ansprechpartner": "",
  "telefon": "",
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

--------------------------------------------------

REGELN:

1. FIRMENNAME vs. FIRMA_RECHTLICH:

- "firmenname" = sichtbarer Firmenname
- "firma_rechtlich" = offizieller juristischer Name

WICHTIG:
- Wenn nur EIN Name vorhanden → nur "firmenname" setzen
- "firma_rechtlich" = null
- NICHT raten

--------------------------------------------------

2. TELEFON / E-MAIL:

- Nur übernehmen, wenn klar erkennbar
- Keine Formatänderung erzwingen

--------------------------------------------------

3. ADRESSE:

- Straße und Hausnummer trennen
- PLZ und Ort sauber extrahieren

--------------------------------------------------

4. IBAN / BANK:

- Nur übernehmen, wenn eindeutig genannt
- Keine Vermutungen

--------------------------------------------------

5. MWST-LOGIK:

- "mwst_aktiv" = true, wenn:
  - MWST / UID / CHE-Nummer erwähnt
  - Steuersatz genannt wird

- "mwst_aktiv" = false, wenn:
  - "nicht MWST-pflichtig" erwähnt
  - oder keine Infos vorhanden

Wenn true:
- mwst_nummer = erkannte Nummer
- mwst_satz = erkannter Wert
- mwst_hinweis = null

Wenn false:
- mwst_nummer = null
- mwst_satz = null
- mwst_hinweis = "Nicht MWST-pflichtig"`;

function getOpenAiApiKey(): string | null {
  return process.env.OPENAI_API_KEY || null;
}

function mapParsedSettings(parsed: any) {
  return {
    firmenname: parsed?.firmenname || '',
    firmaRechtlich: parsed?.firma_rechtlich || null,
    ansprechpartner: parsed?.ansprechpartner || null,
    telefon: parsed?.telefon || null,
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
    const session = await getServerSession(authOptions);

    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { text } = await request.json();

    if (!text?.trim()) {
      return NextResponse.json({ error: 'Kein Text angegeben' }, { status: 400 });
    }

    const apiKey = getOpenAiApiKey();

    if (!apiKey) {
      return NextResponse.json(
        { error: 'KI-Analyse ist aktuell nicht konfiguriert' },
        { status: 503 }
      );
    }

    const llmResponse = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: process.env.OPENAI_TEXT_MODEL || 'gpt-4.1-mini',
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: text },
        ],
        response_format: { type: 'json_object' },
        max_tokens: 1000,
        temperature: 0,
      }),
    });

    if (!llmResponse.ok) {
      const errorText = await llmResponse.text();
      console.error('OpenAI API error:', errorText);

      return NextResponse.json(
        { error: 'KI-Analyse fehlgeschlagen' },
        { status: 500 }
      );
    }

    const llmResult = await llmResponse.json();
    const content = llmResult?.choices?.[0]?.message?.content;

    if (!content) {
      return NextResponse.json({ error: 'Keine Antwort von KI' }, { status: 500 });
    }

    let parsed: any;

    try {
      parsed = JSON.parse(content);
    } catch {
      console.error('Failed to parse OpenAI response:', content);

      return NextResponse.json(
        { error: 'KI-Antwort ungültig' },
        { status: 500 }
      );
    }

    return NextResponse.json(mapParsedSettings(parsed));
  } catch (error) {
    console.error('POST /api/settings/parse error:', error);

    return NextResponse.json(
      { error: 'Fehler beim Parsen' },
      { status: 500 }
    );
  }
}