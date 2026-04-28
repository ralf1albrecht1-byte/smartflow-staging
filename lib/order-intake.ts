/**
 * Intelligente Auftragserfassung mit KI-gestütztem Kundenabgleich
 * Wird von Telegram- und WhatsApp-Webhooks verwendet.
 */
import { prisma } from '@/lib/prisma';
import { ensureAddressSplit } from '@/lib/address-parser';
import { logAuditAsync } from '@/lib/audit';
import { verifyCustomerMatch, type MatchVerdict } from '@/lib/customer-matching';
import { sanitizeNewCustomerFields } from '@/lib/intake-sanitize';
import { findExactDeterministicMatch, findNearExactDeterministicMatch } from '@/lib/exact-customer-match';
import { maskPhoneForLog } from '@/lib/phone';

// ─────────────────────────────────────────────────────────────────────────
// Block R — Self-introduction safety-net for voice/text intake.
//
// When the LLM returns kunde.name = null/empty AND the raw incoming text
// contains a clear self-introduction pattern ("mein Name ist X" /
// "Ich heisse X" / "Ich bin X"), extract the name from the text as a
// post-LLM fallback.
//
// Greift NUR wenn:
//   - kunde.name leer/null ist (überschreibt NIE eine LLM-Extraktion)
//   - eine eindeutige Selbstvorstellung im Text steht (Regex)
//
// Dies löst den Fall, in dem der WhatsApp-ProfileName mit dem im Audio
// genannten Endkunden-Namen identisch ist und der Prompt deshalb die
// Name-Extraktion unterdrückt.
// ─────────────────────────────────────────────────────────────────────────
function extractSelfIntroductionName(rawText: string | null | undefined): string | null {
  if (!rawText || typeof rawText !== 'string') return null;
  const text = rawText.trim();
  if (!text) return null;

  // Tolerant gegen Transkript-Quirks: "Mein Name ist", "Ich heisse/heiße", "Ich bin",
  // "Hier spricht", "Hier ist", "Mein Vorname ist", "Mein Nachname ist".
  // Erlaubt 1-2 Namensteile (Vor- und/oder Nachname), 2-30 Zeichen pro Teil.
  // Buchstaben/Umlaute/Bindestriche, optional Apostroph für O'Brien etc.
  const pattern = /(?:mein\s+(?:name|vorname|nachname)\s+(?:ist|lautet)|ich\s+hei[sß]+e|ich\s+bin|hier\s+spricht|hier\s+ist)\s+([A-Za-zÄÖÜäöüß][A-Za-zÄÖÜäöüß'\-]{1,30}(?:\s+[A-Za-zÄÖÜäöüß][A-Za-zÄÖÜäöüß'\-]{1,30})?)/iu;
  const m = text.match(pattern);
  if (!m || !m[1]) return null;

  const candidate = m[1].trim();
  // Ausschliessen: triviale Wörter die häufig nach "Ich bin" stehen aber kein Name sind
  const blocklist = new Set([
    'der', 'die', 'das', 'ein', 'eine', 'einer', 'sehr', 'gut', 'schon',
    'noch', 'auch', 'hier', 'dort', 'jetzt', 'heute', 'morgen', 'gestern',
    'froh', 'gerade', 'nicht', 'kein', 'keine', 'okay', 'super',
  ]);
  const firstToken = candidate.split(/\s+/)[0]?.toLowerCase() || '';
  if (blocklist.has(firstToken)) return null;
  // Mindestens 2 Zeichen, max 60 Zeichen Gesamtname
  if (candidate.length < 2 || candidate.length > 60) return null;
  return candidate;
}

/**
 * Strukturiertes Audit-Log für jede Intake-Verarbeitung.
 * Wird in stdout als kompakter JSON-Block ausgegeben:
 *   [INTAKE-AUDIT] {"source":"WhatsApp", ...}
 *
 * Telefonnummern sind maskiert (maskPhoneForLog).
 * Audio-Buffer / Bildinhalte werden NIE geloggt.
 */
function logIntakeAudit(payload: {
  source: string;
  userId: string | null;
  phoneMasked: string;
  senderName: string;
  mediaType: string | null;
  hasTranscript: boolean;
  transcriptLen: number;
  llmExtractedName: string | null;
  llmAbgleichStatus: string;
  selfIntroFallbackUsed: boolean;
  resolvedCustomerName: string | null;
  customerId: string | null;
  customerWasNewlyCreated: boolean;
  customerNameInDb: string | null;
  customerFallbackUsed: boolean;
  notes?: string;
}): void {
  try {
    console.log('[INTAKE-AUDIT]', JSON.stringify(payload));
  } catch {
    // never let logging break the intake
  }
}

// ---------- Types ----------
export interface IntakeResult {
  orderId: string;
  description: string;
  customerName: string;
  serviceName: string;
  kundeStatus: string;
  kundenabgleichStatus: string;
}

export interface IntakeInput {
  source: 'Telegram' | 'WhatsApp';
  senderName: string;
  /**
   * Block R — sender phone (E.164) for masked audit logging only.
   * NEVER used for customer matching. Optional: existing call sites may
   * omit this field; logIntakeAudit will then output phoneMasked='[redacted]'.
   */
  phoneNumber?: string | null;
  messageText: string;
  imageBase64?: string | null;
  imageMimeType?: string;
  savedMediaPath?: string | null;
  savedMediaType?: 'audio' | 'image' | null;
  optimizedPreviewPath?: string | null;
  optimizedThumbnailPath?: string | null;
  userId?: string | null;
  // Multi-image support
  allImageBase64s?: string[];
  allImageMimeTypes?: string[];
  allSavedMediaPaths?: string[];
  allOptimizedPreviewPaths?: string[];
  allOptimizedThumbnailPaths?: string[];
  // ─── Stage I: audio usage tracking (additive, optional) ───
  // Detected duration in seconds (may be fractional; will be rounded by the
  // intake before writing). NULL when duration parsing failed (Stage H
  // fail-open path) or when the order has no audio at all.
  audioDurationSec?: number | null;
  // Lifecycle marker — see Order.audioTranscriptionStatus comment in schema.prisma.
  // 'transcribed' | 'failed' | 'skipped_too_long' | 'skipped_uncheckable' | 'skipped_quota_exceeded' | null
  audioTranscriptionStatus?: 'transcribed' | 'failed' | 'skipped_too_long' | 'skipped_uncheckable' | 'skipped_quota_exceeded' | null;
}

// ---------- Build system prompt ----------
function buildSystemPrompt(
  serviceListJson: string,
  customerListJson: string,
  senderName: string,
  branche: string = 'Gartenbau',
  hauptsprache: string = 'Deutsch',
): string {
  return `WICHTIG – ABSOLUT KRITISCH:

Gib NUR gültiges JSON zurück.
KEINE Markdown-Formatierung.
KEIN Text vor oder nach dem JSON.
KEINE Erklärungen.

--------------------------------------------------
ROLLE
--------------------------------------------------

Du bist eine KI für ein ${branche}-Unternehmen.

Deine Aufgaben:

1. Endkunden-Daten extrahieren
2. Kundenabgleich durchführen
3. Auftrag verstehen
4. Passende Leistung erkennen (Service-Matching)
5. Unsicherheiten markieren

--------------------------------------------------
WICHTIGER KONTEXT
--------------------------------------------------

- Nachrichten werden typischerweise vom Firmenkunden (A) weitergeleitet
- Der Absender ("${senderName}") ist STANDARDMÄSSIG Kunde A – NICHT der Endkunde
- Telefonnummer und E-Mail NICHT für Kundenabgleich verwenden
- Es geht in der Regel um Endkunde (B) – alle Daten aus dem Nachrichtentext extrahieren
- KEINE Daten erfinden
- AUSNAHME (Selbstvorstellung): Wenn der Nachrichtentext eine eindeutige
  Selbstvorstellung enthält ("mein Name ist X", "Ich heisse X", "Ich bin X",
  "Hier spricht X", "Hier ist X"), EXTRAHIERE diesen Namen als kunde.name —
  auch wenn er ähnlich oder identisch zum Absender ist. In diesem Fall ist
  der Absender selbst der Endkunde (Solo-Selbständige, Test-Anfragen, direkte
  Kundenanfragen via WhatsApp).

--------------------------------------------------
EINGABE
--------------------------------------------------

bestehende_kunden:
${customerListJson}

leistungen:
${serviceListJson}

--------------------------------------------------
ZIELE
--------------------------------------------------

1. Kunde extrahieren:
- name
- strasse
- hausnummer
- plz
- ort

2. Auftrag:
- titel (max 3 Wörter, IMMER auf ${hauptsprache})
- beschreibung (IMMER auf ${hauptsprache}, auch wenn die Nachricht in einer anderen Sprache ist)
- besonderheiten: JSON-Array mit einzelnen Hinweisen, z.B. ["Hund auf Grundstück", "Leiter nötig", "Hanglage"]
  (Nur echte Auftragshinweise wie: Hund, Hanglage, Leiter nötig, Tor geschlossen, Vorsicht – KEINE Systemhinweise)
  (IMMER auf ${hauptsprache} übersetzen, auch wenn die Nachricht in einer anderen Sprache ist)

3. Service erkennen:
- passende Leistung aus "leistungen"
- KEIN Service erfinden
- wenn nichts passt → null

4. einfache Kalkulation:
- estimated_quantity (nur wenn klar erkennbar)
- unit (aus Leistung übernehmen)
- unit_price (aus Leistung übernehmen)

--------------------------------------------------
MATCHING-REGELN (STRENG – SICHERHEIT VOR FALSCHEM ABGLEICH)
--------------------------------------------------

ABSOLUT VERBOTEN:
- NIEMALS "gleicher_kunde" NUR aufgrund von Name setzen!
- NIEMALS bei Teilnamen (z.B. nur Vorname oder Nachname) als gleicher_kunde werten!
- NIEMALS bei ähnlichem/gleichem Namen OHNE mindestens ein starkes Signal!

STARKE SIGNALE (mindestens eines MUSS für "gleicher_kunde" vorhanden sein):
- Gleiche Telefonnummer
- Gleiche E-Mail-Adresse
- Gleiche Straße + Hausnummer + (PLZ oder Ort)
- Gleiche vollständige Adresse

SCHWACHE SIGNALE (reichen ALLEIN NICHT für "gleicher_kunde"):
- Gleicher/ähnlicher Name → NUR "moeglicher_treffer"
- Nur Nachname gleich → NUR "moeglicher_treffer"
- Nur Vorname gleich → NUR "moeglicher_treffer"
- Nur Ort gleich → NUR "moeglicher_treffer"
- Nur PLZ gleich → NUR "moeglicher_treffer"
- Teilname enthalten → NUR "moeglicher_treffer"

NAME-VARIANTEN:
- Schreibvarianten erkennen (ss=ß, Str.=Strasse=Straße, Reihenfolge egal)
- ABER Name allein = schwaches Signal!

ADRESSE:
- Straße + Hausnummer + PLZ/Ort → stark (zusammen mit Name = gleicher_kunde erlaubt)
- Straße ohne Nummer → mittel
- nur Ort → schwach

ENTSCHEIDUNGSLOGIK:
- Name + starkes Signal → "gleicher_kunde"
- Name allein (auch exakt) → "moeglicher_treffer" (NIEMALS gleicher_kunde!)
- Teilname/ähnlicher Name → "moeglicher_treffer"
- Kein relevanter Treffer → "kein_treffer"
- Widersprüchliche Daten → "konflikt"

--------------------------------------------------
STATUS
--------------------------------------------------

"gleicher_kunde" → NUR bei Name + mindestens einem starken Signal!
"moeglicher_treffer" → Bei Name-Ähnlichkeit OHNE starkes Signal
"konflikt" → Bei widersprüchlichen Daten
"kein_treffer" → Kein relevanter Treffer

--------------------------------------------------
AUSGABEFORMAT
--------------------------------------------------

{
  "kunde": {
    "name": null,
    "strasse": null,
    "hausnummer": null,
    "plz": null,
    "ort": null
  },
  "auftrag": {
    "titel": null,
    "beschreibung": null,
    "besonderheiten": []
  },
  "service": {
    "service_id": null,
    "service_name": null,
    "estimated_quantity": null,
    "unit": null,
    "unit_price": null
  },
  "kundenabgleich": {
    "status": null,
    "bestehende_kunden_id": null,
    "confidence": 0,
    "unterschiede": [],
    "warnung": ""
  },
  "system": {
    "needs_review": false,
    "prioritaet": "normal"
  }
}

--------------------------------------------------
REGELN
--------------------------------------------------

1. KEINE DATEN ERFINDEN / KEIN ABSCHREIBEN VON BESTEHENDEN KUNDEN
- Felder unter "kunde" (name, strasse, hausnummer, plz, ort) dürfen AUSSCHLIESSLICH
  aus dem Nachrichtentext / Audio-Transkript / Bildinhalt stammen.
- NIEMALS Felder aus der Liste "bestehende_kunden" nach "kunde" kopieren.
- Wenn ein Feld nicht in der eingehenden Nachricht vorkommt → null setzen, nicht raten.
- PLZ nur setzen wenn im Text vorhanden; keine Rückschlüsse aus Ort.

2. E-Mail komplett ignorieren (KEINE Warnung, KEIN needs_review)

3. Telefonnummer:
- NICHT für Matching verwenden
- ABER wenn Telefon im Text vorhanden UND bestehender Kunde hat andere Telefonnummer:
  → status = "moeglicher_treffer"
  → needs_review = true
  → warnung = "Telefonnummer weicht ab – bitte prüfen"
- Wenn Telefon fehlt: komplett ignorieren

4. Service-Matching:
- nur beste Übereinstimmung wählen
- wenn unsicher → service = null

5. estimated_quantity:
- nur wenn klar (z. B. "2 Bäume", "50m²")
- sonst null

6. needs_review = true bei:
- moeglicher_treffer
- konflikt
- fehlende Adresse
- kein Service erkannt
- Telefonnummer weicht ab (siehe Regel 3)

7. WARNLOGIK:
moeglicher_treffer → "Möglicher Kundentreffer – bitte prüfen"
konflikt → "Konflikt bei Kundenzuordnung – manuelle Prüfung erforderlich"
Telefon abweichend → "Telefonnummer weicht ab – bitte prüfen"
sonst → ""

8. confidence:
- gleicher_kunde → 0.9–1.0
- moeglicher_treffer → 0.5–0.8
- konflikt → 0.2–0.5
- kein_treffer → 0–0.3

9. PRIORITÄT:
- "hoch" bei Wörtern wie: "dringend", "sofort", "heute"
- sonst "normal"

10. NUR-BILD-NACHRICHTEN (WICHTIG):
Wenn KEIN Text und KEINE Sprachnachricht vorhanden ist (nur Bild(er)):
- beschreibung: NUR beschreiben, was auf dem Bild SICHTBAR ist
- NICHT den gewünschten Auftrag erraten oder erfinden
- NICHT schreiben: "soll geschnitten werden", "muss gepflegt werden", "gewünscht"
- STATTDESSEN vorsichtig formulieren:
  - "Das Bild zeigt eine Hecke entlang der Straße und eine Rasenfläche davor."
  - "Genauer Auftrag ist ohne zusätzlichen Text nicht eindeutig erkennbar."
  - "Sichtbar: Hecke, Rasen, Baumbestand."
- titel: beschreibend, NICHT handlungsorientiert (z.B. "Hecke / Garten" statt "Hecke schneiden")
- needs_review = true (immer bei Nur-Bild ohne Text)`;
}

// ---------- Main intake function ----------
export async function processIncomingMessage(input: IntakeInput): Promise<IntakeResult | null> {
  const { source, senderName, messageText, imageBase64, imageMimeType, savedMediaPath, savedMediaType, optimizedPreviewPath, optimizedThumbnailPath, userId: inputUserId, allImageBase64s, allImageMimeTypes, allSavedMediaPaths, allOptimizedPreviewPaths, allOptimizedThumbnailPaths, audioDurationSec: inputAudioDurationSec, audioTranscriptionStatus: inputAudioTranscriptionStatus } = input;

  // Resolve userId: use provided userId ONLY. No fallbacks!
  // Webhooks must resolve userId via phone number BEFORE calling this function.
  const userId = inputUserId || null;
  if (!userId) {
    console.error(`[${source}] ❌ No userId provided — cannot process message. Webhook must resolve userId by phone number.`);
    logAuditAsync({ action: `ORDER_CREATE_FROM_${source.toUpperCase()}_FAILED`, area: 'WEBHOOK', success: false, details: { reason: 'no_userId', sender: senderName } });
    return null;
  }
  const _intakeStartTime = Date.now();
  console.log(`[${source}] Processing message for userId: ${userId} (textLength=${messageText.length}chars, hasImage=${!!imageBase64}, hasMedia=${!!savedMediaPath})`);

  const userFilter = userId ? { userId } : {};

  // Load services
  const services = await prisma.service.findMany({ where: userFilter });
  const serviceListJson = JSON.stringify(
    services.map((s: any) => ({
      id: s.id,
      name: s.name,
      einheit: s.unit,
      standard_preis: Number(s.defaultPrice),
    }))
  );

  // Load customers for matching (max 200).
  // Phase 2b: ONLY expose {id, name} to the LLM — never address/phone/email.
  // Rationale: the LLM previously copied address fields from a candidate's
  // master record into its own `kunde.*` output on name-only hits, which the
  // create-path then persisted into a *new* customer (silent partial-inheritance bug).
  // The authoritative customer match runs server-side in verifyCustomerMatch
  // (reads address/phone/email straight from the DB), so the LLM does not need
  // that information to decide "gleicher_kunde" / "moeglicher_treffer".
  const allCustomers = await prisma.customer.findMany({
    where: { deletedAt: null, ...userFilter },
    select: { id: true, name: true },
    orderBy: { updatedAt: 'desc' },
    take: 200,
  });
  const customerListJson = JSON.stringify(
    allCustomers.map((c: any) => ({ id: c.id, name: c.name }))
  );

  // Fetch branche + hauptsprache from company settings
  const companySettings = userId ? await prisma.companySettings.findFirst({ where: { userId } }) : await prisma.companySettings.findFirst();
  const branche = companySettings?.branche || 'Gartenbau';
  const hauptsprache = (companySettings as any)?.hauptsprache || 'Deutsch';

  // Resolve default VAT rate from CompanySettings.
  // If MwSt is active and a rate is configured → use that rate.
  // If MwSt is explicitly disabled → 0.
  // Otherwise fall back to schema default (8.1) for backwards compatibility.
  const intakeVatRate: number = companySettings?.mwstAktiv === true && companySettings?.mwstSatz != null
    ? Number(companySettings.mwstSatz)
    : companySettings?.mwstAktiv === false
      ? 0
      : 8.1;

  // Build prompt
  const systemPrompt = buildSystemPrompt(serviceListJson, customerListJson, senderName, branche, hauptsprache);

  // Build user content (supports multi-image)
  const hasMultipleImages = allImageBase64s && allImageBase64s.length > 0;
  const hasAnyImage = hasMultipleImages || !!imageBase64;
  const userContent: any[] = [];
  const isImageOnly = !messageText.trim() && (hasMultipleImages || !!imageBase64);
  if (messageText.trim()) {
    userContent.push({ type: 'text', text: `Nachricht:\n"${messageText}"` });
  }
  if (hasMultipleImages) {
    if (isImageOnly) {
      userContent.push({ type: 'text', text: `Der Kunde hat ${allImageBase64s.length} Bilder geschickt, aber KEINEN Text dazu. Beschreibe NUR was sichtbar ist. Erfinde KEINEN Auftrag. Setze needs_review=true.` });
    } else {
      userContent.push({ type: 'text', text: `Der Kunde hat ${allImageBase64s.length} Bilder zusammen mit der Nachricht geschickt. Es handelt sich um EINEN Auftrag:` });
    }
    for (let imgIdx = 0; imgIdx < allImageBase64s.length; imgIdx++) {
      userContent.push({ type: 'image_url', image_url: { url: `data:${allImageMimeTypes?.[imgIdx] || 'image/jpeg'};base64,${allImageBase64s[imgIdx]}` } });
    }
  } else if (imageBase64) {
    if (isImageOnly) {
      userContent.push({ type: 'text', text: 'Der Kunde hat NUR dieses Bild geschickt, OHNE Text. Beschreibe NUR was sichtbar ist. Erfinde KEINEN konkreten Auftrag. Setze needs_review=true.' });
    } else {
      userContent.push({ type: 'text', text: 'Der Kunde hat auch dieses Bild geschickt:' });
    }
    userContent.push({ type: 'image_url', image_url: { url: `data:${imageMimeType || 'image/jpeg'};base64,${imageBase64}` } });
  }
  if (userContent.length === 0) {
    console.log(`[${source}] No content to analyze, skipping`);
    return null;
  }

  // Call LLM
  // If the LLM fails (credits exhausted, HTTP error, network/timeout, empty or
  // unparseable response), we fall back to creating a manual-review order so
  // no WhatsApp message gets silently dropped. See createFallbackOrderFromRawPayload.
  const _llmStartTime = Date.now();
  console.log(`[${source}] 🤖 Starting LLM analysis (model=${hasAnyImage ? 'gpt-4.1' : 'gpt-4.1-mini'}, systemPrompt=${systemPrompt.length}chars, userContent=${JSON.stringify(userContent).length}chars)`);
  let llmResponse: Response;
  try {
    llmResponse = await fetch('https://apps.abacus.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.ABACUSAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: hasAnyImage ? 'gpt-4.1' : 'gpt-4.1-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userContent.length === 1 && !hasAnyImage ? userContent[0].text : userContent },
        ],
        response_format: { type: 'json_object' },
        max_tokens: 1500,
      }),
    });
  } catch (netErr: any) {
    console.error(`[${source}] LLM network/timeout error:`, netErr?.message || netErr);
    logAuditAsync({ userId, action: `ORDER_CREATE_FROM_${source.toUpperCase()}_FAILED`, area: 'WEBHOOK', success: false, details: { reason: 'llm_network_error', sender: senderName, error: netErr?.message || String(netErr) } });
    return await createFallbackOrderFromRawPayload(input, 'llm_network_error');
  }

  if (!llmResponse.ok) {
    const errText = await llmResponse.text().catch(() => '');
    console.error(`[${source}] LLM API error:`, errText);
    logAuditAsync({ userId, action: `ORDER_CREATE_FROM_${source.toUpperCase()}_FAILED`, area: 'WEBHOOK', success: false, details: { reason: 'llm_api_error', sender: senderName, httpStatus: llmResponse.status } });
    return await createFallbackOrderFromRawPayload(input, 'llm_api_error');
  }

  let llmResult: any;
  try {
    llmResult = await llmResponse.json();
  } catch (jsonErr: any) {
    console.error(`[${source}] LLM response JSON parse error:`, jsonErr?.message || jsonErr);
    logAuditAsync({ userId, action: `ORDER_CREATE_FROM_${source.toUpperCase()}_FAILED`, area: 'WEBHOOK', success: false, details: { reason: 'llm_response_parse_error', sender: senderName } });
    return await createFallbackOrderFromRawPayload(input, 'llm_response_parse_error');
  }
  console.log(`[${source}] 🤖 LLM analysis completed in ${Date.now() - _llmStartTime}ms`);
  const content = llmResult?.choices?.[0]?.message?.content;
  if (!content) {
    console.error(`[${source}] LLM returned empty content`);
    logAuditAsync({ userId, action: `ORDER_CREATE_FROM_${source.toUpperCase()}_FAILED`, area: 'WEBHOOK', success: false, details: { reason: 'llm_empty_response', sender: senderName } });
    return await createFallbackOrderFromRawPayload(input, 'llm_empty_response');
  }

  let parsed: any;
  try {
    parsed = JSON.parse(content);
  } catch {
    console.error(`[${source}] Failed to parse LLM response:`, content?.slice(0, 500));
    logAuditAsync({ userId, action: `ORDER_CREATE_FROM_${source.toUpperCase()}_FAILED`, area: 'WEBHOOK', success: false, details: { reason: 'llm_parse_error', sender: senderName } });
    return await createFallbackOrderFromRawPayload(input, 'llm_parse_error');
  }

  console.log(`[${source}] KI-Analyse:`, JSON.stringify({
    kunde: parsed.kunde?.name,
    titel: parsed.auftrag?.titel,
    service: parsed.service?.service_name,
    abgleich_status: parsed.kundenabgleich?.status,
    confidence: parsed.kundenabgleich?.confidence,
    treffer_id: parsed.kundenabgleich?.bestehende_kunden_id,
    prioritaet: parsed.system?.prioritaet,
    needs_review: parsed.system?.needs_review,
  }));

  // --- Customer resolution based on kundenabgleich.status ---
  const abgleich = parsed.kundenabgleich || {};
  let abgleichStatus = abgleich.status || 'kein_treffer';
  const matchId = abgleich.bestehende_kunden_id || '';

  // Ensure address is split properly
  const kundeData = parsed.kunde || {};

  // Block R — Safety-Net: Wenn die LLM keinen Namen extrahiert hat, aber der
  // Text eine eindeutige Selbstvorstellung enthält ("mein Name ist Aida",
  // "Ich heisse X", "Ich bin X" etc.), den Namen aus dem Text übernehmen.
  // Greift NUR bei leerem LLM-Namen — überschreibt NIE eine LLM-Extraktion.
  // Bug-Hintergrund: Wenn der WhatsApp-ProfileName mit dem Endkunden-Namen
  // identisch ist (z.B. Solo-Selbständige testen mit eigener Nummer), unterdrückt
  // die Prompt-Regel "Absender = Kunde A, NICHT Endkunde" die Namens-Extraktion.
  const llmExtractedName = (kundeData.name || '').trim();
  let selfIntroFallbackUsed = false;
  if (!llmExtractedName) {
    const selfIntroName = extractSelfIntroductionName(messageText);
    if (selfIntroName) {
      kundeData.name = selfIntroName;
      selfIntroFallbackUsed = true;
      console.log(`[${source}] 🪪 Selbstvorstellungs-Safety-Net griff: kunde.name='${selfIntroName}' (LLM hatte leer/null geliefert)`);
    }
  }
  const addr = ensureAddressSplit({
    customerStreet: kundeData.strasse ? `${kundeData.strasse}${kundeData.hausnummer ? ' ' + kundeData.hausnummer : ''}` : null,
    customerPlz: kundeData.plz,
    customerCity: kundeData.ort,
  });

  let customerId: string | null = null;
  let duplicateWarning = '';
  let customerWasNewlyCreated = false;

  // ═══ SERVER-SIDE CUSTOMER MATCHING (v2 — hardened) ═══
  // Uses centralized verifyCustomerMatch from lib/customer-matching.ts.
  // The LLM output is NEVER trusted for auto-assignment decisions.
  // Only phone or email matches allow auto-assignment.
  // Name + address requires confirmation (not auto-assign).
  // All other signals are review/suggestion only.

  if (abgleichStatus === 'gleicher_kunde' && matchId) {
    const matchResult = await verifyCustomerMatch(matchId, {
      phone: kundeData.telefon || null,
      email: kundeData.email || null,
      street: addr.street,
      plz: addr.plz,
      city: addr.city,
      name: kundeData.name,
    });

    if (matchResult.verdict === 'auto_assign') {
      // ✅ Strong unique signal verified (phone or email) → safe to auto-assign
      customerId = matchId;
      const matchedCust = await prisma.customer.findUnique({ where: { id: matchId }, select: { address: true, plz: true, city: true } });
      if (!matchedCust?.address?.trim() || !matchedCust?.plz?.trim() || !matchedCust?.city?.trim()) {
        parsed.system = parsed.system || {};
        parsed.system.needs_review = true;
        console.log(`[${source}] ✅ AUTO-ASSIGN VERIFIED (${matchResult.reason}, conf ${abgleich.confidence}) but address incomplete → needsReview=true`);
      } else {
        console.log(`[${source}] ✅ AUTO-ASSIGN VERIFIED (${matchResult.reason}, conf ${abgleich.confidence}) → auto-assign to ${matchId}`);
      }
    } else if (matchResult.verdict === 'bestaetigungs_treffer') {
      // 🟡 Name + address match but no unique identifier → needs manual confirmation
      abgleichStatus = 'bestaetigungs_treffer';
      duplicateWarning = `⚠️ Name und Adresse stimmen überein, aber kein eindeutiges Signal (Telefon/E-Mail). Manuelle Bestätigung erforderlich.`;
      parsed.system = parsed.system || {};
      parsed.system.needs_review = true;
      console.log(`[${source}] 🟡 CONFIRMATION REQUIRED (${matchResult.reason}) → bestaetigungs_treffer for ${matchId}`);
    } else {
      // 🛡️ No strong signal → downgrade to moeglicher_treffer, NEVER auto-assign
      abgleichStatus = 'moeglicher_treffer';
      const unterschiede = (abgleich.unterschiede || []).join(', ');
      duplicateWarning = `⚠️ KI-Treffer herabgestuft: Kein starkes Signal (${matchResult.reason}). Manuelle Prüfung erforderlich.${unterschiede ? ` (${unterschiede})` : ''}`;
      parsed.system = parsed.system || {};
      parsed.system.needs_review = true;
      console.log(`[${source}] 🛡️ DOWNGRADED → moeglicher_treffer (reason: ${matchResult.reason}, no strong signal for ${matchId})`);
    }
  } else if (abgleichStatus === 'gleicher_kunde' && !matchId) {
    console.log(`[${source}] ⚠ gleicher_kunde but no matchId, creating new`);
  } else if (abgleichStatus === 'moeglicher_treffer') {
    const unterschiede = (abgleich.unterschiede || []).join(', ');
    duplicateWarning = `⚠️ ${abgleich.warnung || 'Möglicher Kundentreffer – bitte prüfen'}${unterschiede ? ` (${unterschiede})` : ''}. Confidence: ${abgleich.confidence}`;
    parsed.system = parsed.system || {};
    parsed.system.needs_review = true;
    console.log(`[${source}] ⚠ moeglicher_treffer (confidence ${abgleich.confidence}) → new customer + warning`);
  } else if (abgleichStatus === 'konflikt') {
    duplicateWarning = `🚨 ${abgleich.warnung || 'Konflikt bei Kundenzuordnung – manuelle Prüfung erforderlich'}. Confidence: ${abgleich.confidence}`;
    parsed.system = parsed.system || {};
    parsed.system.needs_review = true;
    console.log(`[${source}] 🚨 konflikt → new customer + strong warning`);
  } else {
    console.log(`[${source}] ➕ kein_treffer → creating new customer`);
  }

  // ═══ PHASE 2c: EXACT DETERMINISTIC REUSE (before creating a new customer) ═══
  // Only if no customerId was assigned by strong-signal matching (phone/email),
  // AND the incoming record is fully addressed (name + street + plz + city),
  // AND exactly one active candidate under this user matches strictly, AND
  // there is no phone/email conflict — reuse that candidate.
  //
  // This is NOT a merge: no second record exists yet. We simply skip the
  // would-be duplicate create. For every other case (0 hits, >1 hits, any
  // conflict, archived candidate, incomplete incoming) fall through to the
  // existing create-new-customer path unchanged.
  // Phase 2d: accumulate tags for reviewReasons to surface in the UI banner.
  const autoReuseTags: string[] = [];
  if (!customerId) {
    const exact = await findExactDeterministicMatch(prisma, userId ?? null, {
      name: kundeData.name || null,
      street: addr.street,
      plz: addr.plz,
      city: addr.city,
      phone: kundeData.telefon || null,
      email: kundeData.email || null,
    });
    if (exact.match) {
      customerId = exact.match.id;
      autoReuseTags.push(`AUTO_REUSED:${exact.match.customerNumber}`);
      console.log(`[${source}] 🎯 EXACT REUSE → binding to existing ${exact.match.customerNumber} (${exact.match.id})`);
      logAuditAsync({
        userId, action: 'CUSTOMER_REUSE_EXACT', area: 'CUSTOMERS',
        targetType: 'Customer', targetId: exact.match.id,
        success: true,
        details: {
          source,
          matchedOn: ['name', 'street', 'plz', 'city'],
          candidateCustomerNumber: exact.match.customerNumber,
        },
      });
      // Improve-only update: the existing `else` branch below
      // (`// Update existing customer with new data - only if it IMPROVES...`)
      // already runs protectCustomerData(existing, incoming) for any non-null
      // customerId — so we do nothing extra here and let that canonical path
      // handle address/plz/city fill-in.
    } else if (exact.reason !== 'incomplete_incoming' && exact.reason !== 'no_candidate') {
      // Useful trace for the other guarded cases (multi-match / conflict):
      console.log(`[${source}] exact-reuse skipped (${exact.reason}, count=${exact.candidateCount}) → normal create/duplicate path`);
    }
  }

  // ═══ PHASE 2d: NEAR-EXACT DETERMINISTIC REUSE (strict) ═══
  // Triggers ONLY when: name+street exact, EXACTLY ONE of {plz, city} missing
  // on incoming, candidate has that field filled, exactly 1 active candidate,
  // no phone/email conflict. Completion is implicit (order binds to candidate
  // which already has the field). Never weakens exact-match. See spec in
  // lib/exact-customer-match.ts for full rules.
  if (!customerId) {
    const nearExact = await findNearExactDeterministicMatch(prisma, userId ?? null, {
      name: kundeData.name || null,
      street: addr.street,
      plz: addr.plz,
      city: addr.city,
      phone: kundeData.telefon || null,
      email: kundeData.email || null,
    });
    if (nearExact.match && nearExact.completedField) {
      customerId = nearExact.match.id;
      autoReuseTags.push(`AUTO_REUSED_NEAR_EXACT:${nearExact.match.customerNumber}:${nearExact.completedField}_completed`);
      console.log(`[${source}] 🎯 NEAR-EXACT REUSE → binding to existing ${nearExact.match.customerNumber} (${nearExact.match.id}), completed=${nearExact.completedField}`);
      logAuditAsync({
        userId, action: 'CUSTOMER_REUSE_NEAR_EXACT', area: 'CUSTOMERS',
        targetType: 'Customer', targetId: nearExact.match.id,
        success: true,
        details: {
          source,
          matchedOn: ['name', 'street', nearExact.completedField === 'plz' ? 'city' : 'plz'],
          completedField: nearExact.completedField,
          completedValue: nearExact.completedValue,
          candidateCustomerNumber: nearExact.match.customerNumber,
        },
      });
    } else if (nearExact.reason !== 'not_applicable' && nearExact.reason !== 'incomplete_incoming' && nearExact.reason !== 'no_candidate') {
      console.log(`[${source}] near-exact-reuse skipped (${nearExact.reason}, count=${nearExact.candidateCount}) → normal create/duplicate path`);
    }
  }

  // Create new customer if not auto-assigned
  if (!customerId) {
    // ═══ DEFENSE-IN-DEPTH: only persist master data fields that are
    // demonstrably present in the raw incoming message (text + audio transcript).
    // This blocks silent partial inheritance of city/ZIP/street/phone/email from
    // any existing customer record, even if a future LLM/model regression tries
    // to copy fields from the `bestehende_kunden` prompt list into `kunde.*`.
    // Applies to the CREATE path only — improve-existing (auto_assign) goes
    // through protectCustomerData and is unchanged.
    // messageText already contains the audio transcript (transcription happens
    // in the webhook before processIncomingMessage is called). For image-only
    // messages messageText is empty → sanitize drops every auto-derived field.
    // Note: phone/email are NOT auto-persisted from webhook intake today
    // (historical conservative default). We still run them through the sanitizer
    // to keep the audit trail accurate about what the LLM tried to set.
    const sanitized = sanitizeNewCustomerFields({
      rawText: messageText,
      street: addr.street,
      plz: addr.plz,
      city: addr.city,
      phone: kundeData.telefon || null,
      email: kundeData.email || null,
    });
    if (sanitized.dropped.length > 0) {
      console.log(`[${source}] 🛡️ intake-sanitize dropped unverified fields on new-customer create: ${sanitized.dropped.join(', ')}`);
    }

    const { generateCustomerNumber } = await import('@/lib/customer-number');
    const customerNumber = await generateCustomerNumber();
    const customer = await prisma.customer.create({
      data: {
        customerNumber,
        name: kundeData.name || '',
        // phone/email stay conservatively null on webhook-created customers
        // (preserves pre-Phase-2b behavior; unchanged).
        phone: null,
        email: null,
        address: sanitized.street,
        plz: sanitized.plz,
        city: sanitized.city,
        notes: `${source}-Kunde`,
        ...(userId ? { userId } : {}),
      },
    });
    customerId = customer.id;
    customerWasNewlyCreated = true;
  } else {
    // Update existing customer with new data - only if it IMPROVES existing data
    const cust = await prisma.customer.findUnique({ where: { id: customerId } });
    if (cust) {
      const { protectCustomerData } = await import('@/lib/data-protection');
      const updates = protectCustomerData(cust, { address: addr.street, plz: addr.plz, city: addr.city });
      if (Object.keys(updates).length > 0) {
        await prisma.customer.update({ where: { id: customerId }, data: updates });
        console.log(`[${source}] Updated customer ${customerId} with improved fields:`, Object.keys(updates));
      }
    }
  }

  // --- Build specialNotes (only real job-related hints, NO system hints) ---
  // System hints (needsReview, duplicateWarning, confidence) are tracked via
  // needsReview boolean and shown dynamically in the UI — not stored in specialNotes.
  // besonderheiten is now a JSON array from the LLM. Store as newline-separated items.
  const rawBesonderheiten = parsed.auftrag?.besonderheiten;
  const besonderheitenItems: string[] = Array.isArray(rawBesonderheiten)
    ? rawBesonderheiten.filter((b: any) => typeof b === 'string' && b.trim())
    : (typeof rawBesonderheiten === 'string' && rawBesonderheiten.trim())
      ? rawBesonderheiten.split(/[,\n]+/).map((s: string) => s.trim()).filter(Boolean)
      : [];
  const finalSpecialNotes = besonderheitenItems.length > 0 ? besonderheitenItems.join('\n') : null;

  // --- Map service ---
  const svc = parsed.service || {};
  const matchedService = svc.service_id
    ? services.find((s: any) => s.id === svc.service_id)
    : null;
  const matchedByName = !matchedService && svc.service_name
    ? services.find((s: any) => s.name.toLowerCase() === (svc.service_name || '').toLowerCase())
      || services.find((s: any) => (svc.service_name || '').toLowerCase().includes(s.name.toLowerCase()))
    : null;
  const finalService = matchedService || matchedByName;

  const unitPrice = finalService ? Number(finalService.defaultPrice) : (Number(svc.unit_price) || 50);
  const unit = svc.unit || finalService?.unit || 'Stunde';
  const quantity = Number(svc.estimated_quantity) || 1;
  const totalPrice = unitPrice * quantity;
  const serviceName = finalService?.name || svc.service_name || parsed.auftrag?.titel || 'Sonstiges';

  // --- Description ---
  const description = parsed.auftrag?.beschreibung || parsed.auftrag?.titel || `${source}-Auftrag`;

  // --- Auto-translation if message is not in hauptsprache ---
  let translationText = '';
  if (messageText.trim() && hauptsprache) {
    try {
      const transRes = await fetch('https://apps.abacus.ai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.ABACUSAI_API_KEY}` },
        body: JSON.stringify({
          model: 'gpt-4.1-mini',
          messages: [
            { role: 'system', content: `Du bist ein Spracherkennungs- und Übersetzungsassistent. Analysiere den folgenden Text und bestimme die Sprache. Wenn der Text NICHT auf ${hauptsprache} ist, übersetze ihn auf ${hauptsprache}. Antworte NUR mit gültigem JSON:\n{"detected_language": "...", "is_target_language": true/false, "translation": "..." oder null falls keine Übersetzung nötig}\nKEINE Erklärungen, NUR JSON.` },
            { role: 'user', content: messageText },
          ],
          response_format: { type: 'json_object' },
          max_tokens: 1500,
        }),
      });
      if (transRes.ok) {
        const transResult = await transRes.json();
        const transContent = transResult?.choices?.[0]?.message?.content;
        if (transContent) {
          const transData = JSON.parse(transContent);
          if (transData && !transData.is_target_language && transData.translation) {
            translationText = transData.translation;
            console.log(`[${source}] Auto-translated from ${transData.detected_language} to ${hauptsprache}`);
          }
        }
      }
    } catch (e) {
      console.error(`[${source}] Translation failed:`, e);
    }
  }

  // --- Build notes ---
  const notesParts: string[] = [`${source}:\n${messageText}`];
  if (parsed.auftrag?.titel) notesParts.push(`\n[Titel: ${parsed.auftrag.titel}]`);
  if (parsed.system?.prioritaet === 'hoch') notesParts.push(`[Priorität: hoch]`);
  if (translationText) notesParts.push(`\n--- Übersetzung (automatisch) ---\n${translationText}`);

  // --- Build reviewReasons from abgleich status ---
  const reviewReasons: string[] = [];
  if (abgleichStatus === 'moeglicher_treffer' || abgleichStatus === 'konflikt' || abgleichStatus === 'bestaetigungs_treffer') {
    reviewReasons.push('uncertain_assignment');
  }
  // Image-only messages (no text, no audio) always need review — intent is unclear
  if (isImageOnly) {
    reviewReasons.push('image_only_no_text');
  }
  const hasRealReviewReason = reviewReasons.length > 0;
  // Phase 2d: append auto-reuse tags AFTER hasRealReviewReason is determined,
  // so auto-reuse by itself never sets needsReview=true. The banner-only UI
  // uses these tags to inform the user without blocking the order.
  if (autoReuseTags.length > 0) {
    reviewReasons.push(...autoReuseTags);
  }

  // --- Create order ---
  const order = await prisma.order.create({
    data: {
      customerId,
      ...(userId ? { userId } : {}),
      description,
      serviceName,
      status: 'Offen',
      priceType: unit,
      unitPrice,
      quantity,
      totalPrice,
      vatRate: intakeVatRate,
      date: new Date(),
      notes: notesParts.join('\n'),
      specialNotes: finalSpecialNotes,
      needsReview: hasRealReviewReason,
      reviewReasons,
      hinweisLevel: hasRealReviewReason ? 'warning' : (parsed.system?.prioritaet === 'hoch' ? 'important' : (finalSpecialNotes ? 'info' : 'none')),
      mediaUrl: savedMediaPath || (allSavedMediaPaths?.[0]) || null,
      mediaType: savedMediaType || (allSavedMediaPaths && allSavedMediaPaths.length > 0 ? 'image' : null),
      imageUrls: allOptimizedPreviewPaths && allOptimizedPreviewPaths.length > 0
        ? allOptimizedPreviewPaths
        : allSavedMediaPaths && allSavedMediaPaths.length > 0
        ? allSavedMediaPaths
        : (savedMediaType === 'image') ? [optimizedPreviewPath || savedMediaPath].filter(Boolean) as string[] : [],
      thumbnailUrls: allOptimizedThumbnailPaths && allOptimizedThumbnailPaths.length > 0
        ? allOptimizedThumbnailPaths
        : allSavedMediaPaths && allSavedMediaPaths.length > 0
        ? allSavedMediaPaths
        : (savedMediaType === 'image') ? [optimizedThumbnailPath || savedMediaPath].filter(Boolean) as string[] : [],
      audioTranscript: (savedMediaType === 'audio' && messageText) ? messageText : null,
      // Stage I — audio usage tracking (only set when this order carries an audio file)
      audioDurationSec: savedMediaType === 'audio'
        ? (typeof inputAudioDurationSec === 'number' && isFinite(inputAudioDurationSec)
            ? Math.max(0, Math.round(inputAudioDurationSec))
            : null)
        : null,
      audioTranscriptionStatus: savedMediaType === 'audio'
        ? (inputAudioTranscriptionStatus || null)
        : null,
      items: {
        create: [{
          serviceName,
          description,
          quantity,
          unit,
          unitPrice,
          totalPrice,
        }],
      },
    },
    include: { customer: true, items: true },
  });

  console.log(`[${source}] Order created: ${order.id} | Customer: ${order.customer?.name} (${order.customer?.customerNumber}) | Service: ${serviceName} | Abgleich: ${abgleichStatus} (confidence: ${abgleich.confidence || 0}) | Priorität: ${parsed.system?.prioritaet || 'normal'}${duplicateWarning ? ' | ⚠️ WARNING' : ''}`);

  // Audit log: order created from webhook (technical webhook trail)
  logAuditAsync({
    userId,
    action: `ORDER_CREATED_FROM_${source.toUpperCase()}`,
    area: 'WEBHOOK',
    targetType: 'Order',
    targetId: order.id,
    success: true,
    details: {
      sender: senderName,
      customer: order.customer?.name || 'Unbekannt',
      customerId,
      service: serviceName,
      abgleichStatus,
      confidence: abgleich.confidence || 0,
      needsReview: !!parsed.system?.needs_review,
      hasMedia: !!savedMediaPath,
      mediaType: savedMediaType || null,
    },
  });

  // Audit log: fachlicher Auftragseintrag unter ORDERS (damit Bereich-Filter ORDERS auch Webhook-Aufträge zeigt)
  logAuditAsync({
    userId,
    action: 'ORDER_CREATE',
    area: 'ORDERS',
    targetType: 'Order',
    targetId: order.id,
    success: true,
    details: {
      source: source.toLowerCase(),
      sender: senderName,
      customer: order.customer?.name || 'Unbekannt',
      customerId,
      service: serviceName,
    },
  });

  console.log(`[${source}] ✅ Order created in ${Date.now() - _intakeStartTime}ms total (orderId=${order.id}, desc="${description.slice(0, 60)}")`);

  // Block R — strukturiertes Audit-Log für jede erfolgreiche Intake-Verarbeitung.
  // Macht es trivial zu finden, wo bei zukünftigen Issue-Reports der Name verloren geht.
  logIntakeAudit({
    source,
    userId,
    phoneMasked: maskPhoneForLog(input.phoneNumber || null),
    senderName: senderName || '',
    mediaType: savedMediaType || null,
    hasTranscript: !!(messageText && messageText.trim().length > 0),
    transcriptLen: (messageText || '').length,
    llmExtractedName: llmExtractedName || null,
    llmAbgleichStatus: abgleichStatus || 'unknown',
    selfIntroFallbackUsed,
    resolvedCustomerName: kundeData.name || null,
    customerId,
    customerWasNewlyCreated,
    customerNameInDb: order.customer?.name || null,
    customerFallbackUsed: false,
  });

  return {
    orderId: order.id,
    description,
    customerName: order.customer?.name || 'Unbekannt',
    serviceName,
    kundeStatus: parsed.system?.needs_review ? 'unbestaetigt' : 'bestaetigt',
    kundenabgleichStatus: abgleichStatus,
  };
}


// ---------- Fallback order creation (LLM failure) ----------
/**
 * Creates a manual-review fallback order from the raw incoming payload
 * when the LLM/AI analysis fails (credits exhausted, API error, network,
 * parse error, empty response, etc.).
 *
 * Rules:
 *   - Never invents customer data. Binds to a per-user placeholder customer.
 *   - Stores only the raw payload (text, images/thumbs, audio ref) + metadata.
 *   - Flags needsReview=true + hinweisLevel=warning so the UI shows the
 *     orange "Kundendaten unvollständig" badge on the order card.
 *   - Status stays 'Offen' so it appears in the default active orders view.
 *
 * @param input  The original IntakeInput that was being processed.
 * @param reason Machine-readable failure reason (e.g. 'llm_api_error',
 *               'llm_parse_error', 'llm_empty_response', 'llm_network_error').
 */
async function createFallbackOrderFromRawPayload(
  input: IntakeInput,
  reason: string,
): Promise<IntakeResult | null> {
  const { source, senderName, messageText, savedMediaPath, savedMediaType, optimizedPreviewPath, optimizedThumbnailPath, userId: inputUserId, allOptimizedPreviewPaths, allOptimizedThumbnailPaths, audioDurationSec: inputAudioDurationSec, audioTranscriptionStatus: inputAudioTranscriptionStatus } = input;
  const userId = inputUserId || null;
  if (!userId) {
    // No user → cannot create; already logged upstream. Do not invent anything.
    return null;
  }

  const FALLBACK_CUSTOMER_NAME = '⚠️ Unbekannt (WhatsApp)';

  // Resolve default VAT rate from CompanySettings (same logic as main intake path)
  const fbSettings = await prisma.companySettings.findFirst({ where: { userId } });
  const fbIntakeVatRate: number = fbSettings?.mwstAktiv === true && fbSettings?.mwstSatz != null
    ? Number(fbSettings.mwstSatz)
    : fbSettings?.mwstAktiv === false
      ? 0
      : 8.1;

  try {
    // Upsert per-user fallback customer (name-only; no guessed fields).
    let fallbackCustomer = await prisma.customer.findFirst({
      where: { userId, name: FALLBACK_CUSTOMER_NAME, deletedAt: null },
      select: { id: true, name: true },
    });
    if (!fallbackCustomer) {
      fallbackCustomer = await prisma.customer.create({
        data: { name: FALLBACK_CUSTOMER_NAME, userId },
        select: { id: true, name: true },
      });
      console.log(`[${source}] 🆕 Fallback customer created: ${fallbackCustomer.id} for userId=${userId}`);
    }

    // Assemble image arrays from whatever preprocessing already saved to S3.
    const imageUrls: string[] = (allOptimizedPreviewPaths && allOptimizedPreviewPaths.length > 0)
      ? allOptimizedPreviewPaths.filter(Boolean) as string[]
      : (optimizedPreviewPath ? [optimizedPreviewPath] : []);
    const thumbnailUrls: string[] = (allOptimizedThumbnailPaths && allOptimizedThumbnailPaths.length > 0)
      ? allOptimizedThumbnailPaths.filter(Boolean) as string[]
      : (optimizedThumbnailPath ? [optimizedThumbnailPath] : []);

    const rawText = (messageText || '').trim();
    // Description: raw text if present, otherwise neutral placeholder.
    const description = rawText.length > 0
      ? rawText
      : (imageUrls.length > 0
          ? `(Nur Bild${imageUrls.length > 1 ? 'er' : ''} erhalten – kein Text)`
          : '(Leere Nachricht)');

    // ─── Layer 1 of three-layer customer-data-pollution defense ───
    // Same rationale as createVoiceTooLongReviewOrder: every system-derived
    // metadata line gets a [META] prefix so the extract-from-notes heuristic
    // ignores it. Originaltext (the raw user message) is NOT prefixed —
    // that is genuine user content and may legitimately contain an address.
    const timestampIso = new Date().toISOString();
    const notesParts = [
      '⚠️ KI-Analyse fehlgeschlagen – bitte manuell prüfen.',
      `[META] Quelle: ${source}`,
      `[META] Absender (WhatsApp/Telegram-Profilname): ${senderName || 'Unbekannt'}`,
      `[META] Empfangen: ${timestampIso}`,
      `[META] Grund: ${reason}`,
    ];
    if (rawText.length > 0) {
      notesParts.push(`Originaltext: ${rawText}`);
    }
    const notes = notesParts.join('\n');

    const order = await prisma.order.create({
      data: {
        customerId: fallbackCustomer.id,
        description,
        serviceName: null,
        status: 'Offen',
        priceType: 'Stundensatz',
        unitPrice: 0,
        quantity: 0,
        totalPrice: 0,
        vatRate: fbIntakeVatRate,
        vatAmount: 0,
        total: 0,
        needsReview: true,
        reviewReasons: [reason],
        hinweisLevel: 'warning',
        mediaUrl: savedMediaPath || null,
        mediaType: savedMediaType || null,
        imageUrls,
        thumbnailUrls,
        notes,
        userId,
        // Stage I — even on LLM-fallback we still track audio usage if duration was detected
        audioDurationSec: savedMediaType === 'audio'
          ? (typeof inputAudioDurationSec === 'number' && isFinite(inputAudioDurationSec)
              ? Math.max(0, Math.round(inputAudioDurationSec))
              : null)
          : null,
        // On LLM-fallback for audio messages, status defaults to 'failed' unless caller provided one
        audioTranscriptionStatus: savedMediaType === 'audio'
          ? (inputAudioTranscriptionStatus || 'failed')
          : null,
      },
    });

    console.log(`[${source}] 🛟 Fallback order created: ${order.id} (reason=${reason}, sender=${senderName})`);

    logAuditAsync({
      userId,
      action: `ORDER_CREATED_FROM_${source.toUpperCase()}_FALLBACK`,
      area: 'WEBHOOK',
      targetType: 'Order',
      targetId: order.id,
      success: true,
      details: {
        reason,
        sender: senderName,
        customerId: fallbackCustomer.id,
        customer: FALLBACK_CUSTOMER_NAME,
        rawTextLength: rawText.length,
        imageCount: imageUrls.length,
        hasAudio: savedMediaType === 'audio',
      },
    });

    logIntakeAudit({
      source,
      userId,
      phoneMasked: maskPhoneForLog(input.phoneNumber || null),
      senderName: senderName || '',
      mediaType: savedMediaType || null,
      hasTranscript: !!(rawText && rawText.trim().length > 0),
      transcriptLen: (rawText || '').length,
      llmExtractedName: null,
      llmAbgleichStatus: 'ki_fehler',
      selfIntroFallbackUsed: false,
      resolvedCustomerName: FALLBACK_CUSTOMER_NAME,
      customerId: fallbackCustomer.id,
      customerWasNewlyCreated: false,
      customerNameInDb: FALLBACK_CUSTOMER_NAME,
      customerFallbackUsed: true,
      notes: `fallback: ${reason}`,
    });

    return {
      orderId: order.id,
      description,
      customerName: FALLBACK_CUSTOMER_NAME,
      serviceName: '',
      kundeStatus: 'fallback_unknown',
      kundenabgleichStatus: 'ki_fehler',
    };
  } catch (err: any) {
    console.error(`[${source}] ❌ Fallback order creation failed:`, err?.message || err);
    logAuditAsync({
      userId,
      action: `ORDER_CREATE_FROM_${source.toUpperCase()}_FALLBACK_FAILED`,
      area: 'WEBHOOK',
      success: false,
      details: { reason: `fallback_exception:${err?.message || 'unknown'}`, originalReason: reason, sender: senderName },
    });
    return null;
  }
}


// ────────────────────────────────────────────────────────────────────────
// Stage H — Cost optimization: long voice messages (>60 s)
// ────────────────────────────────────────────────────────────────────────

export interface VoiceTooLongInput {
  /** 'WhatsApp' or 'Telegram'. */
  source: 'Telegram' | 'WhatsApp';
  /** WhatsApp ProfileName / Telegram first_name etc. */
  senderName: string;
  /** Sender phone (E.164) — only used for logging, not customer match. */
  phoneNumber?: string | null;
  /** S3 path of the original audio file (still archived/playable). */
  audioPath: string | null;
  /** Detected duration in seconds (rounded). null if duration parsing failed. */
  durationSec: number | null;
  /** Resolved owner of the message intake. */
  userId: string | null;
  /** Optional preview paths of images that came with the same message. */
  imagePreviewPaths?: string[];
  /** Optional thumbnail paths of images that came with the same message. */
  imageThumbnailPaths?: string[];
  /**
   * Why this review order is being created.
   *  - `'too_long'` (default): duration was reliably detected and exceeds the 60 s cap.
   *    Warning: "⚠️ Sprachnachricht länger als 60 Sekunden – bitte manuell prüfen".
   *  - `'uncheckable'`: duration could not be determined safely (parse failure,
   *    no metadata, FFmpeg probe failure). Audio was NOT transcribed in order to
   *    protect the cost cap — manual review is required.
   *    Warning: "⚠️ Sprachnachricht konnte zeitlich nicht geprüft werden – bitte manuell prüfen".
   *  - `'quota_exceeded'`: monthly audio-minute plan limit (e.g. 20 min on Standard)
   *    would be exceeded by transcribing this audio. Audio is saved + linked, but
   *    NOT transcribed — manual review required. Warning:
   *    "⚠️ Monatliches Audio-Limit erreicht – bitte manuell prüfen".
   */
  reason?: 'too_long' | 'uncheckable' | 'quota_exceeded';
  /**
   * Optional usage snapshot for the audit log when reason='quota_exceeded'.
   * Omitted in other paths.
   */
  quotaUsedMinutes?: number;
  /** Optional plan limit snapshot for the audit log when reason='quota_exceeded'. */
  quotaIncludedMinutes?: number;
}

/**
 * Creates a visible review order for a voice message that exceeds the 60s
 * cost-control cap, WITHOUT calling the LLM (cost-saving short-circuit).
 *
 * Mirrors the customer-fallback pattern of {@link createFallbackOrderFromRawPayload}:
 * - Per-user "⚠️ Unbekannt (WhatsApp)" customer (created on first use).
 * - `needsReview = true`, `hinweisLevel = 'warning'`, `reviewReasons = ['voice_too_long']`.
 * - Original audio is still linked (`mediaUrl`) so it remains playable in the order detail view.
 * - No transcription, no AI vision, no service detection.
 *
 * Description is the exact German warning text required by the spec.
 */
export async function createVoiceTooLongReviewOrder(
  input: VoiceTooLongInput,
): Promise<IntakeResult | null> {
  const {
    source,
    senderName,
    phoneNumber,
    audioPath,
    durationSec,
    userId,
    imagePreviewPaths,
    imageThumbnailPaths,
  } = input;
  const reason: 'too_long' | 'uncheckable' | 'quota_exceeded' = input.reason ?? 'too_long';
  const quotaUsedMinutes = input.quotaUsedMinutes;
  const quotaIncludedMinutes = input.quotaIncludedMinutes;

  if (!userId) {
    console.warn(`[${source}] ❌ createVoiceTooLongReviewOrder: missing userId — cannot create order.`);
    return null;
  }

  // Resolve default VAT rate from CompanySettings (same logic as main intake path)
  const voiceSettings = await prisma.companySettings.findFirst({ where: { userId } });
  const voiceIntakeVatRate: number = voiceSettings?.mwstAktiv === true && voiceSettings?.mwstSatz != null
    ? Number(voiceSettings.mwstSatz)
    : voiceSettings?.mwstAktiv === false
      ? 0
      : 8.1;

  const FALLBACK_CUSTOMER_NAME = source === 'WhatsApp'
    ? '⚠️ Unbekannt (WhatsApp)'
    : '⚠️ Unbekannt (Telegram)';

  // Exact required German warning text — DO NOT change wording.
  const WARNING_DESCRIPTION =
    reason === 'quota_exceeded'
      ? '⚠️ Monatliches Audio-Limit erreicht – bitte manuell prüfen'
      : reason === 'uncheckable'
        ? '⚠️ Sprachnachricht konnte zeitlich nicht geprüft werden – bitte manuell prüfen'
        : '⚠️ Sprachnachricht länger als 60 Sekunden – bitte manuell prüfen';

  // Lifecycle marker written to Order.audioTranscriptionStatus so usage and
  // CommunicationBlock chips can distinguish the cost-protection paths.
  const STATUS_VALUE: 'skipped_too_long' | 'skipped_uncheckable' | 'skipped_quota_exceeded' =
    reason === 'quota_exceeded'
      ? 'skipped_quota_exceeded'
      : reason === 'uncheckable'
        ? 'skipped_uncheckable'
        : 'skipped_too_long';

  // Tag in Order.reviewReasons array so dashboard filters can pick this up.
  const REVIEW_REASON_TAG: 'voice_too_long' | 'voice_uncheckable' | 'voice_quota_exceeded' =
    reason === 'quota_exceeded'
      ? 'voice_quota_exceeded'
      : reason === 'uncheckable'
        ? 'voice_uncheckable'
        : 'voice_too_long';

  // Audit suffix mirrors the existing `voice_too_long` events for traceability.
  const AUDIT_SUFFIX =
    reason === 'quota_exceeded'
      ? 'VOICE_QUOTA_EXCEEDED'
      : reason === 'uncheckable'
        ? 'VOICE_UNCHECKABLE'
        : 'VOICE_TOO_LONG';

  try {
    // Upsert per-user fallback customer (same pattern as createFallbackOrderFromRawPayload)
    let fallbackCustomer = await prisma.customer.findFirst({
      where: { userId, name: FALLBACK_CUSTOMER_NAME, deletedAt: null },
      select: { id: true, name: true },
    });
    if (!fallbackCustomer) {
      fallbackCustomer = await prisma.customer.create({
        data: { name: FALLBACK_CUSTOMER_NAME, userId },
        select: { id: true, name: true },
      });
      console.log(`[${source}] 🆕 Fallback customer created (${REVIEW_REASON_TAG}): ${fallbackCustomer.id} for userId=${userId}`);
    }

    const timestampIso = new Date().toISOString();
    const durationLabel = (typeof durationSec === 'number' && isFinite(durationSec))
      ? `${Math.round(durationSec)}s`
      : 'unbekannt';

    // ─── Layer 1 of three-layer customer-data-pollution defense ───
    // Every metadata line (sender phone, timestamp, audio duration, ...) is
    // prefixed with the [META] tag so that the auto-fill heuristic in
    // lib/extract-from-notes.ts can deterministically skip these lines and
    // never mistake e.g. a Twilio sandbox number for the customer's phone or
    // a year out of an ISO timestamp for a PLZ.
    //
    // The warning description and the user-facing "Hinweis:" lines stay
    // unprefixed because they contain no extractable address-like patterns.
    const notes = [
      WARNING_DESCRIPTION,
      `[META] Quelle: ${source}`,
      `[META] Absender (WhatsApp/Telegram-Profilname): ${senderName || 'Unbekannt'}`,
      phoneNumber ? `[META] Telefon (Absender, NICHT Kunde): ${phoneNumber}` : null,
      `[META] Empfangen: ${timestampIso}`,
      `[META] Audiodauer: ${durationLabel}`,
      reason === 'quota_exceeded' && typeof quotaUsedMinutes === 'number' && typeof quotaIncludedMinutes === 'number'
        ? `[META] Audio-Verbrauch diesen Monat: ${Number.isInteger(quotaUsedMinutes) ? quotaUsedMinutes : quotaUsedMinutes.toFixed(1)} / ${quotaIncludedMinutes} Min`
        : null,
      reason === 'quota_exceeded'
        ? 'Audio ist im Auftrag abrufbar – bitte manuell anhören.'
        : 'Audio ist im Auftrag abrufbar – bitte manuell anhören.',
    ].filter(Boolean).join('\n');

    const imageUrls: string[] = (imagePreviewPaths || []).filter(Boolean) as string[];
    const thumbnailUrls: string[] = (imageThumbnailPaths || []).filter(Boolean) as string[];

    const order = await prisma.order.create({
      data: {
        customerId: fallbackCustomer.id,
        description: '',
        serviceName: null,
        status: 'Offen',
        priceType: 'Stundensatz',
        unitPrice: 0,
        quantity: 0,
        totalPrice: 0,
        vatRate: voiceIntakeVatRate,
        vatAmount: 0,
        total: 0,
        needsReview: true,
        reviewReasons: [REVIEW_REASON_TAG],
        hinweisLevel: 'warning',
        mediaUrl: audioPath || null,
        mediaType: audioPath ? 'audio' : null,
        imageUrls,
        thumbnailUrls,
        notes,
        userId,
        // Stage I — audio usage tracking for the cost-cap path.
        // For 'uncheckable' we typically don't have a duration, so this stays null
        // (the order is intentionally excluded from the monthly minutes total).
        audioDurationSec: typeof durationSec === 'number' && isFinite(durationSec)
          ? Math.max(0, Math.round(durationSec))
          : null,
        audioTranscriptionStatus: STATUS_VALUE,
      },
    });

    console.log(`[${source}] ⏱️ Voice review order created (reason=${reason}): orderId=${order.id} duration=${durationLabel} sender=${senderName} phone=${phoneNumber ?? '?'}`);

    logAuditAsync({
      userId,
      action: `ORDER_CREATED_FROM_${source.toUpperCase()}_${AUDIT_SUFFIX}`,
      area: 'WEBHOOK',
      targetType: 'Order',
      targetId: order.id,
      success: true,
      details: {
        reason: REVIEW_REASON_TAG,
        sender: senderName,
        phone: phoneNumber ?? null,
        durationSec: typeof durationSec === 'number' ? Math.round(durationSec) : null,
        customerId: fallbackCustomer.id,
        customer: FALLBACK_CUSTOMER_NAME,
        transcriptionSkipped: true,
        hasAudio: !!audioPath,
        imageCount: imageUrls.length,
      },
    });

    logIntakeAudit({
      source,
      userId: userId ?? null,
      phoneMasked: maskPhoneForLog(phoneNumber || null),
      senderName: senderName || '',
      mediaType: 'audio',
      hasTranscript: false,
      transcriptLen: 0,
      llmExtractedName: null,
      llmAbgleichStatus: REVIEW_REASON_TAG,
      selfIntroFallbackUsed: false,
      resolvedCustomerName: FALLBACK_CUSTOMER_NAME,
      customerId: fallbackCustomer.id,
      customerWasNewlyCreated: false,
      customerNameInDb: FALLBACK_CUSTOMER_NAME,
      customerFallbackUsed: true,
      notes: `voice_review: ${REVIEW_REASON_TAG} dur=${typeof durationSec === 'number' ? Math.round(durationSec) : 'null'}`,
    });

    return {
      orderId: order.id,
      description: WARNING_DESCRIPTION,
      customerName: FALLBACK_CUSTOMER_NAME,
      serviceName: '',
      kundeStatus: 'fallback_unknown',
      kundenabgleichStatus: REVIEW_REASON_TAG,
    };
  } catch (err: any) {
    console.error(`[${source}] ❌ createVoiceTooLongReviewOrder failed (reason=${reason}):`, err?.message || err);
    logAuditAsync({
      userId,
      action: `ORDER_CREATE_FROM_${source.toUpperCase()}_${AUDIT_SUFFIX}_FAILED`,
      area: 'WEBHOOK',
      success: false,
      details: {
        reason: `${REVIEW_REASON_TAG}_exception:${err?.message || 'unknown'}`,
        sender: senderName,
        phone: phoneNumber ?? null,
        durationSec: typeof durationSec === 'number' ? Math.round(durationSec) : null,
      },
    });
    return null;
  }
}