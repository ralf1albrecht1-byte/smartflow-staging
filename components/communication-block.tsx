'use client';
import { useState, useEffect, useMemo } from 'react';
import { Volume2, ImageIcon, AlertTriangle, ChevronLeft, ChevronRight, Globe, Mic, Camera, FileImage, Mail, Info, Phone } from 'lucide-react';
import { splitSpecialNotes, splitJobHints, detectCallbackRequest } from '@/lib/special-notes-utils';
import { formatAudioDuration } from '@/lib/audio-format';
import { TouchImageViewer } from '@/components/touch-image-viewer';


function WhatsAppIcon({ className = 'w-3 h-3' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M20.5 11.8a8.5 8.5 0 0 1-12.7 7.4L3.5 20.5l1.3-4.1A8.5 8.5 0 1 1 20.5 11.8Z" />
      <path d="M9.4 7.8c.2-.4.4-.4.7-.4h.5c.2 0 .4.1.5.4l.7 1.6c.1.3.1.5-.1.7l-.4.5c-.1.1-.1.3 0 .5.4.8 1.1 1.5 2 1.9.2.1.4.1.5 0l.6-.5c.2-.2.4-.2.7-.1l1.5.7c.3.1.4.3.4.6v.5c0 .4-.2.7-.5.9-.5.3-1.2.5-1.9.4-2.2-.2-5.1-2.3-6.2-4.3-.4-.7-.6-1.4-.5-2 .1-.5.3-.9.6-1.2l.4-.4Z" />
    </svg>
  );
}

function SmsIcon({ className = 'w-3 h-3' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M4.5 5.5h15a2 2 0 0 1 2 2v7.5a2 2 0 0 1-2 2H10l-4.5 3v-3h-1a2 2 0 0 1-2-2V7.5a2 2 0 0 1 2-2Z" />
      <path d="M7.5 10.2h.01" />
      <path d="M12 10.2h.01" />
      <path d="M16.5 10.2h.01" />
      <path d="M7.5 13.2h9" />
    </svg>
  );
}

function stripInternalCommunicationMetadata(value: string | null | undefined): string {
  return String(value || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .filter((line) => {
      const trimmed = line.trim();
      if (!trimmed) return true;
      if (/^\s*\[META\]/i.test(trimmed)) return false;
      // Smartflow-internal marker lines are metadata, never customer work text.
      // This is intentionally marker-based, not service-word-based.
      if (/^\s*\[\s*(?:titel|title|titre|titolo|título|titulo|priorität|prioritaet|priority|priorité|priorita|prioridad)\s*:/i.test(trimmed)) return false;
      return true;
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}



function LadderChipIcon({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <span
      className={`${className} inline-flex items-center justify-center leading-none`}
      aria-hidden="true"
      title="Leiter"
    >
      🪜
    </span>
  );
}

function DoorOpenChipIcon({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.3"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M4 21h16" />
      <path d="M6 21V4.8A1.8 1.8 0 0 1 7.8 3H15" />
      <path d="M15 21V5.2c0-.9.9-1.5 1.7-1.2l2.1.8A1.8 1.8 0 0 1 20 6.5V21" />
      <path d="M16.5 12h.01" />
    </svg>
  );
}

type SemanticChipVisual = {
  icon: any;
  iconOnly: boolean;
  title: string;
};

function normalizeSemanticChipText(value: string | null | undefined): string {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9\s/-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isNegatedAnimalHint(value: string | null | undefined): boolean {
  const text = normalizeSemanticChipText(value);
  if (!text || !/\b(?:hund|hunde|dog|dogs|chien|chiens|cane|cani|perro|perros|cao|caes)\b/.test(text)) return false;

  return (
    /\b(?:kein|keine|keinen|keinem|keiner|ohne|nicht|no|not|without|pas|sans|aucun|aucune|nessun|nessuna|sin)\b.{0,36}\b(?:hund|hunde|dog|dogs|chien|chiens|cane|cani|perro|perros|cao|caes)\b/.test(text) ||
    /\b(?:hund|hunde|dog|dogs|chien|chiens|cane|cani|perro|perros|cao|caes)\b.{0,36}\b(?:nicht|nein|none|absent|abwesend|nicht vorhanden|kein thema|no issue)\b/.test(text)
  );
}

function getHazardChipVisual(value: string): SemanticChipVisual {
  const text = normalizeSemanticChipText(value);

  if (!isNegatedAnimalHint(value) && /\b(hund|hunde|dog|dogs|chien|chiens|cane|cani|perro|perros|cao|caes)\b/.test(text)) {
    return { icon: '🐶', iconOnly: true, title: value };
  }

  return { icon: '⚠️', iconOnly: false, title: value };
}

function getEquipmentChipVisual(value: string): SemanticChipVisual {
  const text = normalizeSemanticChipText(value);

  if (/\b(leiter|ladder|echelle|scala|escalera|escada)\b/.test(text)) {
    return { icon: <LadderChipIcon />, iconOnly: true, title: value };
  }

  if (/\b(schluessel|schlussel|schlüssel|key|cle|clé|chiave|llave)\b/.test(text)) {
    return { icon: '🔑', iconOnly: true, title: value };
  }

  if (/\b(zugang|eingang|hintereingang|seiteneingang|tor|door|access|entree|entrée|porta|puerta)\b/.test(text)) {
    return { icon: <DoorOpenChipIcon />, iconOnly: true, title: value };
  }

  return { icon: '🔧', iconOnly: false, title: value };
}



type EquipmentChipCategory = 'ladder' | 'key' | 'access' | 'badge' | 'equipment';

function getEquipmentChipCategory(value: string | null | undefined): EquipmentChipCategory {
  const text = normalizeSemanticChipText(value);

  if (/\b(leiter|ladder|echelle|scala|escalera|escada)\b/.test(text)) return 'ladder';
  if (/\b(badge|keycard|key\s*card|schluesselkarte|schlusselkarte|schlüsselkarte)\b/.test(text)) return 'badge';
  if (/\b(schluessel|schlussel|schlüssel|key|cle|clé|chiave|llave|cassetta|box|code)\b/.test(text)) return 'key';
  if (/\b(zugang|eingang|hintereingang|seiteneingang|tor|door|access|entree|entrée|porta|puerta)\b/.test(text)) return 'access';
  return 'equipment';
}

function isEquipmentHintLine(value: string | null | undefined): boolean {
  const text = normalizeSemanticChipText(value);
  return /\b(leiter|ladder|echelle|scala|escalera|escada|schluessel|schlussel|schlüssel|key|cle|clé|chiave|llave|badge|keycard|schluesselkarte|schlusselkarte|schlüsselkarte|zugang|access|tor|door|cassetta|box|code)\b/.test(text);
}

function equipmentHintScore(value: string | null | undefined): number {
  const raw = String(value || '').trim();
  const text = normalizeSemanticChipText(raw);
  let score = raw.length;

  if (/\b(?:in|im|bei|beim|an|am|at|dans|alla|nella|en)\b/.test(text)) score += 20;
  if (/\b\d{2,}\b/.test(text)) score += 20;
  if (/\b(?:halle|empfang|rezeption|reception|hauswart|buero|büro|box|cassetta|kasten)\b/.test(text)) score += 20;
  if (/^(?:leiter|schlüssel|schlussel|key|badge)$/i.test(raw)) score -= 40;

  return score;
}

function buildEquipmentChipHints(
  equipment: string[],
  specialNotes: string | null | undefined,
): string[] {
  const candidates = [
    ...equipment,
    ...String(specialNotes || '')
      .split(/\n+/g)
      .map((line) => line.trim())
      .filter(Boolean)
      .filter(isEquipmentHintLine),
  ];

  const selectedByCategory = new Map<EquipmentChipCategory, string>();

  for (const candidate of candidates) {
    const cleaned = String(candidate || '').replace(/\s+/g, ' ').trim();
    if (!cleaned || !isEquipmentHintLine(cleaned)) continue;

    const category = getEquipmentChipCategory(cleaned);
    const previous = selectedByCategory.get(category);
    if (!previous || equipmentHintScore(cleaned) > equipmentHintScore(previous)) {
      selectedByCategory.set(category, cleaned);
    }
  }

  const orderedCategories: EquipmentChipCategory[] = ['ladder', 'key', 'badge', 'access', 'equipment'];
  return orderedCategories
    .map((category) => selectedByCategory.get(category))
    .filter((value): value is string => Boolean(value));
}

// ─── Types ───
export interface CommunicationData {
  // Work summary (the clean normalized description)
  description?: string | null;
  // Special notes (warning/access/condition)
  specialNotes?: string | null;
  // Raw customer message (notes field from order)
  notes?: string | null;
  // Media
  mediaUrl?: string | null;
  mediaType?: string | null;
  imageUrls?: string[];
  thumbnailUrls?: string[];
  audioTranscript?: string | null;
  // Audio metadata (Stage I)
  audioDurationSec?: number | null;
  audioTranscriptionStatus?: string | null; // 'transcribed' | 'failed' | 'skipped_too_long' | 'skipped_uncheckable' | 'skipped_quota_exceeded' | null
  customer?: {
    name?: string | null;
    email?: string | null;
    phone?: string | null;
  } | null;
  email?: string | null;
  phone?: string | null;
  customerPhone?: string | null;
  contactPhone?: string | null;
  /** Canonical structured contact/communication context for list chips. */
  communicationContext?: string | null;
  id?: string | null;
  siteName?: string | null;
  siteAddress?: string | null;
  sitePlz?: string | null;
  siteCity?: string | null;
  originOrderIds?: string[] | null;
  reviewReasons?: string[] | null;
  workSites?: Array<{
    id?: string | null;
    siteName?: string | null;
    siteAddress?: string | null;
    sitePlz?: string | null;
    siteCity?: string | null;
    sourceOrderId?: string | null;
    isPrimary?: boolean | null;
    sortOrder?: number | null;
  }> | null;
  // Hint level
  hinweisLevel?: string | null;
  needsReview?: boolean;
}

/**
 * Resolves communication data from an Order directly, or from linked orders (Offer/Invoice).
 */
export function resolveCommunicationData(
  order?: CommunicationData | null,
  linkedOrders?: CommunicationData[]
): CommunicationData {
  if (order) return order;
  if (linkedOrders && linkedOrders.length > 0) {
    const levels = ['none', 'info', 'important', 'warning'];
    let maxLevel = 'none';
    let result: CommunicationData = {};

    for (const o of linkedOrders) {
      const lvl = o.hinweisLevel || (o.needsReview ? 'warning' : (o.specialNotes ? 'info' : 'none'));
      if (levels.indexOf(lvl) > levels.indexOf(maxLevel)) maxLevel = lvl;
      if (o.description && !result.description) result.description = o.description;
      if (o.specialNotes && !result.specialNotes) result.specialNotes = o.specialNotes;
      if (o.notes && !result.notes) result.notes = o.notes;
      if (o.communicationContext && !result.communicationContext)
        result.communicationContext = o.communicationContext;
      if (o.contactPhone && !result.contactPhone) result.contactPhone = o.contactPhone;
      if (o.customerPhone && !result.customerPhone) result.customerPhone = o.customerPhone;
      if (o.phone && !result.phone) result.phone = o.phone;
      if (o.email && !result.email) result.email = o.email;
      if (o.customer && !result.customer) result.customer = o.customer;
      else if (o.customer) {
        result.customer = {
          ...(result.customer || {}),
          name: result.customer?.name || o.customer.name || null,
          phone: result.customer?.phone || o.customer.phone || null,
          email: result.customer?.email || o.customer.email || null,
        };
      }
      if (o.mediaUrl && o.mediaType === 'audio' && !result.mediaUrl) {
        result.mediaUrl = o.mediaUrl;
        result.mediaType = 'audio';
        if (o.audioDurationSec != null && result.audioDurationSec == null) result.audioDurationSec = o.audioDurationSec;
        if (o.audioTranscriptionStatus && !result.audioTranscriptionStatus) result.audioTranscriptionStatus = o.audioTranscriptionStatus;
      }
      if (o.imageUrls && o.imageUrls.length > 0) result.imageUrls = [...(result.imageUrls || []), ...o.imageUrls];
      else if (o.mediaUrl && o.mediaType === 'image') result.imageUrls = [...(result.imageUrls || []), o.mediaUrl];
      if (o.thumbnailUrls && o.thumbnailUrls.length > 0) result.thumbnailUrls = [...(result.thumbnailUrls || []), ...o.thumbnailUrls];
      if (o.audioTranscript && !result.audioTranscript) result.audioTranscript = o.audioTranscript;
      result.needsReview = result.needsReview || o.needsReview;
    }
    result.hinweisLevel = maxLevel;
    return result;
  }
  return {};
}

// ─── Parse notes field ───
interface ParsedNotes {
  source: string | null;       // 'WhatsApp' | 'Telegram' | null
  originalMessage: string;     // the raw customer text
  translation: string | null;  // auto-translated text or null
}

function parseNotesField(notes: string | null | undefined): ParsedNotes {
  if (!notes || !notes.trim()) return { source: null, originalMessage: '', translation: null };

  let source: string | null = null;
  let body = notes;

  // Extract source prefix (e.g. "WhatsApp:" or "Telegram:")
  const sourceMatch = body.match(/^(WhatsApp|Telegram):\s*\n?/i);
  if (sourceMatch) {
    source = sourceMatch[1];
    body = body.slice(sourceMatch[0].length);
  }

  // Extract translation block
  let translation: string | null = null;
  const transIdx = body.indexOf('--- Übersetzung (automatisch) ---');
  if (transIdx !== -1) {
    translation = body.slice(transIdx + '--- Übersetzung (automatisch) ---'.length).trim();
    body = body.slice(0, transIdx).trim();
  }

  // Remove Smartflow-internal metadata lines like [Titel: ...], [Priorität: ...], and [META] ...
  body = stripInternalCommunicationMetadata(body);

  return { source, originalMessage: body, translation };
}

// ─── Detect media type for chip (only operational types) ───
function getMediaTypeLabel(data: CommunicationData): { label: string; icon: any } | null {
  const hasAudio = data.mediaUrl && data.mediaType === 'audio';
  const hasImages = (data.imageUrls && data.imageUrls.length > 0) || (data.mediaUrl && data.mediaType === 'image');
  const hasText = data.notes && data.notes.trim();

  if (hasAudio) return { label: 'Sprachnachricht', icon: Mic };
  if (hasImages && hasText) return { label: 'Bild + Text', icon: FileImage };
  if (hasImages) return { label: 'Bild', icon: Camera };
  // "Text" chip removed — adds no operational value
  return null;
}

// ─── Fuzzy dedup: check if two strings are substantially the same ───
function isSameContent(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;

  const normalize = (s: string) =>
    s
      .replace(/^(whatsapp|telegram):\s*/i, '')
      .replace(/\[\s*transkription\s*\]/gi, '')
      .replace(/\[\s*transcription\s*\]/gi, '')
      .replace(/\[\s*transkript\s*\]/gi, '')
      .replace(/\n?\[\s*(?:titel|title|titre|titolo|título|titulo):.*?\]/gi, '')
      .replace(/\n?\[\s*(?:priorität|prioritaet|priority|priorité|priorita|prioridad):.*?\]/gi, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();

  const na = normalize(a);
  const nb = normalize(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  // One contains the other (handles extra metadata/whitespace)
  if (na.length > 10 && nb.length > 10) {
    if (na.includes(nb) || nb.includes(na)) return true;
  }
  return false;
}

function isTranscriptOnlyCustomerMessage(
  message: string | null | undefined,
  transcript: string | null | undefined,
  hasAudio: boolean,
): boolean {
  if (!message || !hasAudio) return false;

  const trimmed = message.trim();
  if (!trimmed) return false;

  if (isSameContent(trimmed, transcript)) return true;

  // Voice-only orders often store the same transcript in notes as:
  // "WhatsApp:\n[Transkription] ...". Do not show that a second time.
  return /^\[\s*(?:transkription|transcription|transkript)\s*\]/i.test(trimmed);
}

/**
 * Strips forwarded customer message content from a notes/remarks field.
 * Used for Offers/Invoices where order.notes was wrongly copied into the document notes.
 * Returns only the user's own remarks (empty string if everything was forwarded).
 */
export function stripForwardedMessage(
  formNotes: string | null | undefined,
  linkedOrderNotes: string | null | undefined
): string {
  if (!formNotes || !formNotes.trim()) return '';
  if (!linkedOrderNotes || !linkedOrderNotes.trim()) return formNotes;

  // If the form notes look like a forwarded WhatsApp/Telegram message, strip it
  const normalizedForm = formNotes.replace(/\s+/g, ' ').trim().toLowerCase();
  const normalizedOrder = linkedOrderNotes.replace(/\s+/g, ' ').trim().toLowerCase();

  // Exact or near-exact match
  if (normalizedForm === normalizedOrder) return '';
  // Form contains the entire order message (or vice versa)
  if (normalizedForm.length > 10 && normalizedOrder.length > 10) {
    if (normalizedOrder.includes(normalizedForm) || normalizedForm.includes(normalizedOrder)) return '';
  }
  // Starts with WhatsApp:/Telegram: prefix and matches the order's raw content
  if (/^(whatsapp|telegram):/i.test(formNotes.trim())) {
    return '';  // This is a forwarded message — clear it
  }
  return formNotes;
}

// ─── Resolve S3 URL ───
async function resolveUrl(cloudPath: string): Promise<string> {
  try {
    const res = await fetch('/api/upload/media-url', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cloud_storage_path: cloudPath, isPublic: false }),
    });
    const data = await res.json();
    return data.url || cloudPath;
  } catch { return cloudPath; }
}

const urlCache = new Map<string, string>();
function useResolvedUrls(paths: string[]): string[] {
  const key = paths.join(',');
  const [urls, setUrls] = useState<string[]>([]);
  useEffect(() => {
    if (paths.length === 0) { setUrls([]); return; }
    let cancelled = false;
    Promise.all(paths.map(async (p) => {
      if (urlCache.has(p)) return urlCache.get(p)!;
      const url = await resolveUrl(p);
      urlCache.set(p, url);
      return url;
    })).then(resolved => { if (!cancelled) setUrls(resolved); });
    return () => { cancelled = true; };
  }, [key]);
  return urls;
}
type CommunicationPreferenceChip = {
  key: string;
  label: string;
  color: 'default' | 'green' | 'blue' | 'purple' | 'teal' | 'red' | 'amber' | 'orange';
  href?: string;
  title?: string;
  contactHeading?: string;
  contactName?: string;
  contactValue?: string;
  contactHint?: string;
  contactTimeHint?: string;
};

function normalizeCommunicationPreferenceText(value: string | null | undefined): string {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9@\s.+-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function firstEmailFromText(value: string): string | null {
  return value.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] || null;
}

function normalizePhoneForHref(value?: string | null): string {
  const cleaned = String(value || '').replace(/[^+0-9]/g, '');
  return cleaned.length >= 6 ? cleaned : '';
}

function getContactEmail(data: CommunicationData, sourceText: string): string {
  const operational = extractOperationalContactV17_90L85(sourceText);
  return (
    operational.email ||
    firstEmailFromText(sourceText) ||
    data.customer?.email ||
    data.email ||
    ''
  ).trim();
}

type OperationalContactV17_90L85 = {
  phone: string;
  email: string;
  name: string;
  channel: "sms" | "whatsapp" | "mail" | "call" | null;
  noCall: boolean;
};

function extractOperationalContactV17_90L85(
  sourceText: string,
): OperationalContactV17_90L85 {
  const source = String(sourceText || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ")
    .trim();
  const empty: OperationalContactV17_90L85 = {
    phone: "",
    email: "",
    name: "",
    channel: null,
    noCall: false,
  };
  if (!source) return empty;

  const markerRe =
    /\b(?:kontakt\s+vor\s+ort|kontaktperson\s+vor\s+ort|ansprechperson\s+vor\s+ort|ansprechpartner(?:in)?\s+vor\s+ort|vor\s+ort\s+ansprechpartner(?:in)?|person\s+vor\s+ort|vor\s+ort|on[-\s]?site(?:\s+contact)?|contact\s+sur\s+place|contatto\s+sul\s+posto|contacto\s+en\s+sitio|persona\s+sul\s+posto|person\s+on\s+site|persona\s+en\s+sitio)\b/i;
  const genericMarkerRe =
    /^(?:vor\s+ort|on[-\s]?site|sur\s+place|sul\s+posto|en\s+sitio)$/i;
  const markerMatch = source.match(markerRe);
  const isGenericMarker = Boolean(
    markerMatch && genericMarkerRe.test(markerMatch[0]),
  );

  const validPhoneMatches = (value: string) =>
    Array.from(value.matchAll(/\+?\d[\d\s()./-]{6,}\d/g))
      .map((match) => ({
        phone: String(match[0] || "").replace(/\s+/g, " ").trim(),
        index: match.index || 0,
        end: (match.index || 0) + String(match[0] || "").length,
      }))
      .filter(({ phone }) => {
        const digits = phone.replace(/\D/g, "");
        return digits.length >= 7 && digits.length <= 15;
      });

  const validEmailMatches = (value: string) =>
    Array.from(value.matchAll(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)).map(
      (match) => ({
        email: String(match[0] || "").trim(),
        index: match.index || 0,
        end: (match.index || 0) + String(match[0] || "").length,
      }),
    );

  let scoped = source;
  let markerLength = 0;
  if (markerMatch && markerMatch.index != null) {
    scoped = source.slice(markerMatch.index);
    markerLength = markerMatch[0].length;
  }

  let phoneCandidate: ReturnType<typeof validPhoneMatches>[number] | undefined =
    validPhoneMatches(scoped)[0];
  let emailCandidate: ReturnType<typeof validEmailMatches>[number] | undefined =
    validEmailMatches(scoped)[0];
  if (isGenericMarker && phoneCandidate && phoneCandidate.index > 240) {
    phoneCandidate = undefined;
  }
  if (isGenericMarker && emailCandidate && emailCandidate.index > 240) {
    emailCandidate = undefined;
  }
  if (!phoneCandidate && !emailCandidate) {
    const channelMatch = source.match(
      /\b(?:whats\s*app|whatsapp|sms|text\s+message|kurznachricht|e\s*mail|email|mail|anrufen|telefonieren|call)\b/i,
    );
    const identities = [
      ...validPhoneMatches(source).map((item) => ({ ...item, kind: "phone" as const })),
      ...validEmailMatches(source).map((item) => ({ ...item, kind: "email" as const })),
    ];
    if (channelMatch && channelMatch.index != null && identities.length > 0) {
      const closest = identities.sort(
        (left, right) =>
          Math.abs(left.index - (channelMatch.index || 0)) -
          Math.abs(right.index - (channelMatch.index || 0)),
      )[0];
      if (closest.kind === "phone") phoneCandidate = closest;
      else emailCandidate = closest;
      scoped = source;
      markerLength = 0;
    }
  }

  const phone = normalizePhoneForHref(phoneCandidate?.phone || "");
  const email = String(emailCandidate?.email || "").trim();
  const identityCandidate = phoneCandidate || emailCandidate;
  const beforeIdentity = identityCandidate
    ? scoped.slice(markerLength, identityCandidate.index)
    : "";
  let name = beforeIdentity
    .replace(/^\s*(?:[:.,-]|ist\b|diesmal\b|heute\b)+/i, "")
    .replace(
      /\b(?:erreichbar|zu\s+erreichen|available|reachable)\s*(?:unter|at|via)?\s*$/i,
      "",
    )
    .replace(/\b(?:tel\.?|telefon|phone|mobile|handy|natel|unter)\s*[:.]?\s*$/i, "")
    .replace(/^[\s:.,-]+|[\s:.,-]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const nameParts = name.split(/\s+/g);
  const properNameIndex = nameParts.findIndex((part) =>
    /^[A-ZÀ-ÖØ-ÞÄÖÜ][\p{L}'’.-]*$/u.test(part),
  );
  if (properNameIndex > 0) name = nameParts.slice(properNameIndex).join(" ");
  const properNameTokenCount = name
    .split(/\s+/g)
    .filter((part) => /^[A-ZÀ-ÖØ-ÞÄÖÜ][\p{L}'’.-]*$/u.test(part))
    .length;
  // A bare "vor Ort" can describe only a location. Without at least a
  // two-token person structure, do not bind a later phone to that marker.
  if (
    isGenericMarker &&
    !phone &&
    !email &&
    (properNameTokenCount < 2 || /\d/.test(name))
  ) {
    return empty;
  }

  const contextEnd = identityCandidate
    ? Math.min(scoped.length, identityCandidate.end + 220)
    : Math.min(scoped.length, 300);
  const context = scoped.slice(0, contextEnd);
  const contextLines = splitCommunicationSourceLines(context);
  const noCall =
    /\b(?:nicht\s+(?:telefonisch\s+)?anrufen|nicht\s+telefonisch|keine(?:n)?\s+anrufe?|do\s+not\s+call|don['’]?t\s+call|no\s+calls?|ne\s+pas\s+appeler|non\s+chiamare)\b/i.test(
      context,
    );
  const hasCall = /\b(?:anrufen|telefonieren|call|phone\s+call)\b/i.test(
    context,
  );
  const explicitChannel = detectExplicitPreferredChannel(context);
  const preferredChannel =
    explicitChannel ||
    (["mail", "sms", "whatsapp"] as CommunicationChannel[]).find((channel) =>
      contextLines.some((line) => linePrefersChannel(line, channel)),
    ) ||
    (["mail", "sms", "whatsapp"] as CommunicationChannel[]).find(
      (channel) =>
        contextLines.some((line) => lineMentionsChannel(line, channel)) &&
        !contextLines.some((line) => lineForbidsChannel(line, channel)),
    ) ||
    null;

  return {
    phone,
    email,
    name,
    channel: preferredChannel || (hasCall && !noCall ? "call" : null),
    noCall,
  };
}

function getContactPhone(data: CommunicationData, sourceText: string): string {
  const operational = extractOperationalContactV17_90L85(sourceText);
  const explicitPhone =
    sourceText.match(/(?:tel\.?|telefon|phone|mobile|handy|natel|whats\s*app(?:\s+nummer)?|sms|text\s+message|kontakt(?:\s+vor\s+ort)?|anrufen|al[uü]te)\s*[:.]?\s*(\+?\d[\d\s()./-]{6,}\d)/i)?.[1] ||
    sourceText.match(/(?:use\s+whats\s*app|whats\s*app\s+if\s+possible|per\s+whats\s*app|via\s+whats\s*app).*?(\+?\d[\d\s()./-]{6,}\d)/i)?.[1] ||
    sourceText.match(/(?:bitte\s+)?(?:kurz\s+)?(?:anrufen|telefonieren|zur[uü]ckrufen|rueckrufen|ruckrufen).*?(\+?\d[\d\s()./-]{6,}\d)/i)?.[1] ||
    sourceText.match(/(\+\d[\d\s()./-]{7,}\d)/)?.[1] ||
    "";

  return normalizePhoneForHref(
    operational.phone ||
      data.contactPhone ||
      explicitPhone ||
      data.customer?.phone ||
      data.customerPhone ||
      data.phone ||
      "",
  );
}

function splitCommunicationSourceLines(value: string): string[] {
  return String(value || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split(/\n+|(?<=[.!?])\s+/g)
    .map((line) => line.trim())
    .filter(Boolean);
}

type CommunicationChannel = 'mail' | 'whatsapp' | 'sms';

const COMMUNICATION_CHANNEL_PATTERNS: Record<CommunicationChannel, RegExp> = {
  mail: /\b(?:mail|e\s*mail|e-mail|email|courriel)\b/i,
  whatsapp: /\b(?:whats\s*app|whatsapp)\b/i,
  sms: /\b(?:sms|text\s+message|kurznachricht)\b/i,
};

const channelPatternSource = (channel: CommunicationChannel) => {
  if (channel === 'whatsapp') return '(?:whats\\s*app|whatsapp)';
  if (channel === 'sms') return '(?:sms|text\\s+message|kurznachricht)';
  return '(?:mail|e\\s*mail|e-mail|email|courriel)';
};

const COMMUNICATION_NEGATION_TOKEN =
  '(?:nicht|kein|keine|keinen|ohne|no|not|never|pas|ne\\s+pas|sans|non|nod|noed|ned|nid|nit|nuet|nued)';

function lineMentionsChannel(line: string, channel: CommunicationChannel): boolean {
  return COMMUNICATION_CHANNEL_PATTERNS[channel].test(line);
}

function lineForbidsChannel(line: string, channel: CommunicationChannel): boolean {
  const text = normalizeCommunicationPreferenceText(line);
  if (!text || !lineMentionsChannel(text, channel)) return false;

  const channelSource = channelPatternSource(channel);

  // Only treat negation as a channel ban when it is attached to the channel.
  // "WhatsApp an 079..., nicht einfach kommen" is not a WhatsApp ban.
  const directBeforeChannel = new RegExp(
    `\\b${COMMUNICATION_NEGATION_TOKEN}\\b(?:\\s+(?:bitte|mehr|mehrmals|nur|mehrfach|per|via|ueber|uber|over|mit|auf|durch|kontakt|kontaktieren|schreiben|senden|schicken|message|nachricht)){0,5}\\s+(?:${channelSource})\\b`,
    'i',
  );
  const channelBeforeDirectNo = new RegExp(
    `\\b(?:${channelSource})\\b(?:\\s+(?:bitte|mehr|mehrmals|verwenden|benutzen|nutzen|use|kontaktieren|schreiben|senden|schicken|message|nachricht)){0,6}\\s+\\b${COMMUNICATION_NEGATION_TOKEN}\\b`,
    'i',
  );
  const explicitNoChannel = new RegExp(
    `\\b(?:${channelSource})\\b\\s*(?:nein|verboten|unerwuenscht|unerwünscht|nicht\\s+(?:verwenden|benutzen|nutzen|kontaktieren|schreiben|senden|schicken)|no|not|never)\\b`,
    'i',
  );

  return directBeforeChannel.test(text) || channelBeforeDirectNo.test(text) || explicitNoChannel.test(text);
}

function linePrefersChannel(line: string, channel: CommunicationChannel): boolean {
  const text = normalizeCommunicationPreferenceText(line);
  if (!text || !lineMentionsChannel(text, channel) || lineForbidsChannel(text, channel)) return false;

  const channelSource = channelPatternSource(channel);
  const positiveIntent = '(?:reicht|genuegt|genuget|bevorzugt|preferred|preferiert|am\\s+besten|best|only|nur|schreiben|senden|schicken|kontakt|kontaktieren|melden)';
  const hasPhone = /(?:\+?\d[\d\s()./-]{6,}\d)/.test(line);

  return (
    new RegExp(`\\b(?:${channelSource})\\b(?:[-/\\s]+[a-z0-9]+){0,10}[-/\\s]+${positiveIntent}\\b`, 'i').test(text) ||
    new RegExp(`\\b(?:per|via|mit|nur|only)\\s+(?:${channelSource})\\b`, 'i').test(text) ||
    new RegExp(`\\b${positiveIntent}\\s+(?:per|via|mit)?\\s*(?:${channelSource})\\b`, 'i').test(text) ||
    new RegExp(`\\b(?:${channelSource})[-/\\s]*(?:kontakt|nummer|nr|an)\\b`, 'i').test(text) ||
    (hasPhone && new RegExp(`\\b(?:${channelSource})\\b`, 'i').test(text))
  );
}

function extractContactTimeHintFromLine(line: string): string {
  const raw = String(line || '').replace(/\s+/g, ' ').trim();
  if (!raw) return '';

  const range =
    raw.match(/\b(?:zwischen|von)\s+(\d{1,2})(?:[:.]|\s+)(\d{2})\s*(?:uhr|h)?\s+(?:und|bis)\s+(\d{1,2})(?:[:.]|\s+)(\d{2})\s*(?:uhr|h)?\b/i);
  if (range?.[1] && range?.[3]) {
    return `${range[1].padStart(2, '0')}:${range[2]}–${range[3].padStart(2, '0')}:${range[4]} Uhr`;
  }

  const explicit = raw.match(/\b(erst\s+)?(ab|nach)\s*(\d{1,2})(?:[:.]|\s+)?(\d{2})?\s*(?:uhr|h)?\b/i);
  if (explicit?.[3]) {
    const prefix = explicit[1] ? `erst ${explicit[2].toLowerCase()}` : explicit[2].toLowerCase();
    return `${prefix} ${explicit[3].padStart(2, '0')}:${explicit[4] || '00'} Uhr`;
  }

  return '';
}

function getChannelContactTimeHint(channel: CommunicationChannel, rawSource: string): string {
  const lines = splitCommunicationSourceLines(rawSource);

  for (const line of lines) {
    if (!lineMentionsChannel(line, channel)) continue;
    const hint = extractContactTimeHintFromLine(line);
    if (hint) return hint;
  }

  return '';
}

function appendContactTime(title: string, contactTimeHint: string): string {
  return [title, contactTimeHint].filter(Boolean).join(' · ');
}

function sanitizeContactDisplayName(value: string | null | undefined): string {
  const text = String(value || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split(/\n|\[\s*(?:HINWEIS|INFO|NOTIZ|WARNUNG|GEFAHR)\s*\]/i)[0]
    .replace(/^\s*(?:kontakt(?:person)?|ansprechperson|vor\s*ort)\s*[:.-]?\s*/i, '')
    .replace(/[;|].*$/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!text || text.length > 80 || /\d|@|\[|\]/.test(text)) return '';
  const parts = text.split(/\s+/g).filter(Boolean);
  if (parts.length < 1 || parts.length > 6) return '';
  const lowercaseParticles = new Set([
    'von',
    'van',
    'de',
    'del',
    'della',
    'di',
    'da',
    'du',
    'der',
    'zu',
    'zum',
  ]);
  const isNameToken = (part: string) =>
    lowercaseParticles.has(part.toLowerCase()) ||
    /^[\p{Lu}][\p{L}'’.-]*$/u.test(part);
  if (!parts.every(isNameToken)) return '';
  return text;
}

function cleanCommunicationInfoLine(value: string): string {
  return String(value || '')
    .replace(/\s*\[(?:HINWEIS|INFO|NOTIZ|WARNUNG|GEFAHR|WARNHINWEIS)\]\s*/gi, ' ')
    .replace(/^\s*(?:WhatsApp|Telegram)\s*:\s*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildCommunicationInfoLines(
  jobHints: unknown,
  specialNotes: string | null | undefined,
): string[] {
  const sources = [
    ...(Array.isArray(jobHints) ? jobHints.map(String) : [String(jobHints || '')]),
    String(specialNotes || ''),
  ];
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const source of sources) {
    for (const raw of source.split(
      /\n+|\s*\[(?:HINWEIS|INFO|NOTIZ|WARNUNG|GEFAHR|WARNHINWEIS)\]\s*/gi,
    )) {
      const cleaned = cleanCommunicationInfoLine(raw);
      if (
        !cleaned ||
        /^\[(?:META|Titel|Title|Priorität|Prioritaet|Priority)\b/i.test(cleaned)
      )
        continue;
      const key = normalizeSemanticChipText(cleaned);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      lines.push(cleaned);
    }
  }
  return lines;
}

function uniqueCommunicationInfoLines(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const cleaned = cleanCommunicationInfoLine(String(value || ''));
    const key = normalizeSemanticChipText(cleaned);
    if (!cleaned || !key || seen.has(key)) continue;
    seen.add(key);
    result.push(cleaned);
  }
  return result;
}

function isPrimaryCommunicationInfoLine(value: string): boolean {
  const text = normalizeSemanticChipText(value);
  if (!text) return false;
  return (
    /\b(?:termin|datum|uhr|ankunft|arbeitsbeginn|kontakt|kontaktperson|ansprechperson|telefon|tel|anrufen|rueckruf|ruckruf|sms|whatsapp|mail|email|e mail|melden|vorher|zuerst)\b/.test(text) ||
    /\b\d{1,2}[:.]\d{2}\b/.test(text) ||
    /\b(?:0|41)\d[\d\s()./-]{6,}\b/.test(text)
  );
}


type ExplicitPreferredChannel = CommunicationChannel | null;

function detectExplicitPreferredChannel(value: string | null | undefined): ExplicitPreferredChannel {
  const lines = splitCommunicationSourceLines(String(value || ''));
  const exclusiveToken = '(?:ausschliesslich|ausschließlich|ausschliesslich|exklusiv|nur|only|exclusively)';
  const contactToken = '(?:kontakt|kontaktieren|melden|schreiben|senden|schicken|erreichbar|kommunikation|rueckmeldung|rückmeldung)?';

  for (const rawLine of lines) {
    const line = normalizeCommunicationPreferenceText(rawLine);
    if (!line) continue;
    const candidates: Array<[CommunicationChannel, string]> = [
      ['mail', channelPatternSource('mail')],
      ['whatsapp', channelPatternSource('whatsapp')],
      ['sms', channelPatternSource('sms')],
    ];
    for (const [channel, source] of candidates) {
      const patterns = [
        new RegExp(`\\b${exclusiveToken}\\s+(?:${contactToken}\\s+)?(?:per|via|ueber|uber|mit)?\\s*(?:${source})\\b`, 'i'),
        new RegExp(`\\b(?:${source})\\b(?:[-/\\s]+[a-z0-9]+){0,8}[-/\\s]+${exclusiveToken}\\b`, 'i'),
        new RegExp(`\\b${exclusiveToken}\\s+(?:${source})[-/\\s]*(?:kontakt|nachricht|kommunikation)?\\b`, 'i'),
      ];
      if (patterns.some((pattern) => pattern.test(line)) && !lineForbidsChannel(line, channel)) {
        return channel;
      }
    }
  }
  return null;
}

function splitMergedCommunicationChunks(value: string): string[] {
  const source = String(value || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
  if (!source) return [];
  const chunks = source
    .split(/\n\s*(?:-{3,}|={3,}|Zusammengef(?:ü|ue)hrt|Ursprungsauftrag|Quellauftrag|Nachricht\s+\d+)\s*\n/gi)
    .map((chunk) => chunk.trim())
    .filter(Boolean);
  return chunks.length > 1 ? chunks : [source];
}

export type MergedContactReviewEntry = {
  siteLabel: string;
  contactName: string;
  contactValue: string;
  channelLabel: string;
  detail: string;
  href?: string;
};

export type CustomerMessageReviewBlock = {
  title: string;
  message: string;
  transcript: string;
};

function splitMessageByExecutionSites(
  source: string,
  sites: NonNullable<CommunicationData["workSites"]>,
): Array<{ title: string; message: string }> {
  const raw = String(source || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
  if (!raw) return [];
  const sortedSites = [...sites].sort(
    (a, b) =>
      Number(Boolean(b?.isPrimary)) - Number(Boolean(a?.isPrimary)) ||
      Number(a?.sortOrder || 0) - Number(b?.sortOrder || 0),
  );
  if (sortedSites.length <= 1) {
    return [{
      title: String(sortedSites[0]?.siteName || sortedSites[0]?.siteAddress || "Kundennachricht").trim(),
      message: raw,
    }];
  }

  const explicitChunks = splitMergedCommunicationChunks(raw);
  if (explicitChunks.length > 1) {
    return explicitChunks.map((chunk, index) => ({
      title: String(
        sortedSites[index]?.siteName ||
          sortedSites[index]?.siteAddress ||
          `Quellauftrag ${index + 1}`,
      ).trim(),
      message: chunk,
    }));
  }

  const lines = raw.split("\n");
  const starts: Array<{ index: number; siteIndex: number }> = [];
  sortedSites.forEach((site, siteIndex) => {
    const labels = [site?.siteName, site?.siteAddress]
      .map((value) => normalizeCommunicationPreferenceText(value))
      .filter((value) => value.length >= 4);
    if (labels.length === 0) return;
    const lineIndex = lines.findIndex((line) => {
      const key = normalizeCommunicationPreferenceText(line);
      return labels.some((label) => key.includes(label));
    });
    if (lineIndex >= 0) starts.push({ index: lineIndex, siteIndex });
  });

  const uniqueStarts = starts
    .sort((a, b) => a.index - b.index)
    .filter((entry, index, list) => index === 0 || entry.index !== list[index - 1].index);
  if (uniqueStarts.length >= 2) {
    const prefix = lines.slice(0, uniqueStarts[0].index).join("\n").trim();
    return uniqueStarts.map((entry, index) => {
      const end = uniqueStarts[index + 1]?.index ?? lines.length;
      let message = lines.slice(entry.index, end).join("\n").trim();
      if (index === 0 && prefix) message = `${prefix}\n\n${message}`;
      const site = sortedSites[entry.siteIndex];
      return {
        title: String(site?.siteName || site?.siteAddress || `Quellauftrag ${index + 1}`).trim(),
        message,
      };
    });
  }

  return [{
    title: String(sortedSites[0]?.siteName || sortedSites[0]?.siteAddress || "Kundennachrichten").trim(),
    message: raw,
  }];
}

export function buildCustomerMessageReviewBlocks(
  records: CommunicationData[] | null | undefined,
): CustomerMessageReviewBlock[] {
  const blocks: CustomerMessageReviewBlock[] = [];
  (records || []).filter(Boolean).forEach((record, recordIndex) => {
    const message = String(record.notes || "").trim();
    const transcript = String(record.audioTranscript || "").trim();
    const source = message || transcript;
    if (!source) return;
    const sites = Array.isArray(record.workSites) ? record.workSites : [];
    const pieces = splitMessageByExecutionSites(source, sites);
    pieces.forEach((piece, pieceIndex) => {
      blocks.push({
        title:
          piece.title ||
          String(record.siteName || record.siteAddress || `Quellauftrag ${recordIndex + 1}`).trim(),
        message: piece.message,
        transcript:
          pieces.length === 1 && transcript && message && !message.includes(transcript)
            ? transcript
            : "",
      });
    });
  });

  const seen = new Set<string>();
  return blocks.filter((block) => {
    const key = `${normalizeCommunicationPreferenceText(block.title)}|${normalizeCommunicationPreferenceText(block.message)}`;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}


function communicationSiteLabel(record: CommunicationData, index: number): string {
  const sortedSites = Array.isArray(record.workSites)
    ? [...record.workSites].sort(
        (a, b) => Number(Boolean(b?.isPrimary)) - Number(Boolean(a?.isPrimary)) || Number(a?.sortOrder || 0) - Number(b?.sortOrder || 0),
      )
    : [];
  const primary = sortedSites[0];
  return String(primary?.siteName || record.siteName || record.siteAddress || `Auftrag ${index + 1}`).trim();
}

function communicationSourceForRecord(record: CommunicationData): string {
  return [
    record.notes,
    record.audioTranscript,
    record.communicationContext,
    record.specialNotes,
  ]
    .filter(Boolean)
    .join('\n');
}

function contactReviewEntryFromSource(
  source: string,
  siteLabel: string,
  fallback?: CommunicationData,
): MergedContactReviewEntry | null {
  const parsed = parseNotesField(source);
  const customerSource = [parsed.originalMessage, parsed.translation, source].filter(Boolean).join('\n');
  const exclusive = detectExplicitPreferredChannel(customerSource);
  const operational = extractOperationalContactV17_90L85(customerSource);
  const email = operational.email || firstEmailFromText(customerSource) || fallback?.email || fallback?.customer?.email || '';
  const phone = operational.phone || getContactPhone(fallback || {}, customerSource);
  const name = sanitizeContactDisplayName(operational.name) || sanitizeContactDisplayName(fallback?.customer?.name) || 'Kontakt';
  const lines = splitCommunicationSourceLines(customerSource);
  const preferred = exclusive || operational.channel ||
    (lines.some((line) => linePrefersChannel(line, 'mail')) ? 'mail' :
      lines.some((line) => linePrefersChannel(line, 'sms')) ? 'sms' :
        lines.some((line) => linePrefersChannel(line, 'whatsapp')) ? 'whatsapp' : null);
  const channelLabel = preferred === 'mail' ? 'E-Mail' : preferred === 'sms' ? 'SMS' : preferred === 'whatsapp' ? 'WhatsApp' : operational.noCall ? 'Keine Anrufe' : 'Kontakt';
  const value = preferred === 'mail' ? email : phone || email;
  if (!value && !preferred) return null;
  const noCall = lines.some((line) => /\b(?:nicht|keine|kein)\s+(?:telefonisch\s+)?(?:anrufen|anrufe|telefon|telefonieren)|\bno\s+calls?\b/i.test(line));
  const timeHint = preferred && preferred !== 'call' ? getChannelContactTimeHint(preferred, customerSource) : '';
  const detail = [channelLabel, timeHint, noCall && preferred !== 'mail' ? 'keine Anrufe' : ''].filter(Boolean).join(' · ');
  const href = value
    ? preferred === 'mail' || value.includes('@')
      ? `mailto:${value}`
      : `tel:${String(value).replace(/[^+\d]/g, '')}`
    : undefined;
  return {
    siteLabel,
    contactName: name,
    contactValue: value || 'Kontaktdaten prüfen',
    channelLabel,
    detail,
    href,
  };
}

export function buildMergedContactReviewEntries(records: CommunicationData[] | null | undefined): MergedContactReviewEntry[] {
  const sourceRecords = (records || []).filter(Boolean);
  if (sourceRecords.length === 0) return [];
  const entries: MergedContactReviewEntry[] = [];

  sourceRecords.forEach((record, recordIndex) => {
    const source = communicationSourceForRecord(record);
    const sites = Array.isArray(record.workSites) && record.workSites.length > 0
      ? [...record.workSites].sort(
          (a, b) => Number(Boolean(b?.isPrimary)) - Number(Boolean(a?.isPrimary)) || Number(a?.sortOrder || 0) - Number(b?.sortOrder || 0),
        )
      : [];

    if (sites.length > 1) {
      const messageParts = splitMessageByExecutionSites(source, sites);
      messageParts.forEach((part, siteIndex) => {
        const site = sites[siteIndex];
        const label = String(
          part.title ||
            site?.siteName ||
            site?.siteAddress ||
            `Arbeitsort ${siteIndex + 1}`,
        ).trim();
        const entry = contactReviewEntryFromSource(part.message, label, record);
        if (entry) entries.push(entry);
      });
      return;
    }

    const entry = contactReviewEntryFromSource(source, communicationSiteLabel(record, recordIndex), record);
    if (entry) entries.push(entry);
  });

  const seen = new Set<string>();
  return entries.filter((entry) => {
    const key = [entry.siteLabel, entry.contactValue, entry.channelLabel].map(normalizeCommunicationPreferenceText).join('|');
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function formatMergedContactReviewTooltip(records: CommunicationData[] | null | undefined): string {
  const entries = buildMergedContactReviewEntries(records);
  if (entries.length === 0) return 'Mehrere Telefonnummern, Termine oder Kontaktwege erkannt. Bitte kontrollieren.';
  return [
    'Kontakte prüfen',
    ...entries.flatMap((entry, index) => [
      ...(index > 0 ? ['---'] : []),
      entry.siteLabel,
      `${entry.contactName} · ${entry.contactValue}`,
      entry.detail || entry.channelLabel,
    ]),
  ].join('\n');
}


/**
 * Interaktiver Sammelchip für zusammengeführte Kontakte.
 * Telefonnummern und E-Mail-Adressen bleiben dem jeweiligen Arbeitsort
 * zugeordnet und können direkt geöffnet werden.
 */
export function MergedContactReviewChip({
  records,
  compact = true,
  className = '',
}: {
  records: CommunicationData[] | null | undefined;
  compact?: boolean;
  className?: string;
}) {
  const entries = useMemo(
    () => buildMergedContactReviewEntries(records),
    [records],
  );
  if (entries.length <= 1) return null;

  return (
    <span
      className={`group relative inline-flex shrink-0 ${className}`}
      onClick={(event) => event.stopPropagation()}
      onTouchStart={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        aria-label="Kontakte prüfen"
        className={
          compact
            ? 'inline-flex h-7 w-7 items-center justify-center rounded-lg border border-emerald-300 bg-emerald-50 text-emerald-700 outline-none hover:bg-emerald-100 focus:ring-2 focus:ring-emerald-300'
            : 'inline-flex items-center gap-1 rounded-full border border-emerald-300 bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-700 outline-none hover:bg-emerald-100 focus:ring-2 focus:ring-emerald-300'
        }
      >
        <AlertTriangle className="h-4 w-4" />
        {!compact && <span>Kontakte prüfen</span>}
      </button>
      <span className="pointer-events-auto absolute bottom-full left-0 z-[9999] hidden w-[min(28rem,calc(100vw-2rem))] pb-2 group-hover:block group-focus-within:block">
        <span className="block max-h-[65vh] overflow-y-auto rounded-xl border border-emerald-300 bg-white p-3 text-left text-xs font-normal leading-relaxed text-slate-800 shadow-2xl dark:bg-slate-950 dark:text-slate-100">
          <span className="mb-2 block font-bold text-emerald-800 dark:text-emerald-200">
            Kontakte prüfen
          </span>
          <span className="block space-y-2">
            {entries.map((entry, index) => (
              <span
                key={`${entry.siteLabel}-${entry.contactValue}-${index}`}
                className="block rounded-lg border border-slate-200 bg-slate-50 p-2 dark:border-slate-700 dark:bg-slate-900"
              >
                <span className="block font-semibold text-slate-900 dark:text-slate-100">
                  {entry.siteLabel}
                </span>
                <span className="mt-0.5 block text-slate-700 dark:text-slate-200">
                  {entry.contactName}
                </span>
                {entry.href ? (
                  <a
                    href={entry.href}
                    onClick={(event) => event.stopPropagation()}
                    className="mt-0.5 block break-all font-semibold text-blue-700 underline-offset-2 hover:underline dark:text-blue-300"
                  >
                    {entry.contactValue}
                  </a>
                ) : (
                  <span className="mt-0.5 block break-all font-semibold">
                    {entry.contactValue}
                  </span>
                )}
                <span className="mt-0.5 block text-muted-foreground">
                  {entry.detail || entry.channelLabel}
                </span>
              </span>
            ))}
          </span>
        </span>
      </span>
    </span>
  );
}

function detectCommunicationPreferenceChips(
  data: CommunicationData,
  parsed: ParsedNotes,
): CommunicationPreferenceChip[] {
  const customerSource = [
    data.notes,
    parsed.translation,
    parsed.originalMessage,
    data.audioTranscript,
    data.communicationContext,
  ]
    .filter(Boolean)
    .join('\n');
  const rawSource = [
    customerSource,
    data.specialNotes,
    data.customer?.email,
    data.contactPhone,
    data.customer?.phone,
    data.customerPhone,
    data.email,
    data.phone,
  ]
    .filter(Boolean)
    .join('\n');
  const source = normalizeCommunicationPreferenceText(rawSource);

  if (!source) return [];

  // A clear instruction in the original customer message always wins over
  // derived/legacy specialNotes. This prevents "keine SMS und kein WhatsApp"
  // from being inverted into a WhatsApp chip when the request is "nur E-Mail".
  const exclusiveChannel = detectExplicitPreferredChannel(customerSource);
  const operational = extractOperationalContactV17_90L85(customerSource || rawSource);
  const email = operational.email || getContactEmail(data, customerSource || rawSource);
  const phone = operational.phone || getContactPhone(data, customerSource || rawSource);
  const contactName =
    sanitizeContactDisplayName(operational.name) ||
    sanitizeContactDisplayName(data.customer?.name) ||
    'Kunde';

  const preferenceLines = splitCommunicationSourceLines(customerSource || rawSource);
  const allLines = splitCommunicationSourceLines(rawSource);
  const channelIsForbidden = (channel: CommunicationChannel) =>
    preferenceLines.some((line) => lineForbidsChannel(line, channel)) ||
    (!exclusiveChannel && allLines.some((line) => lineForbidsChannel(line, channel)));
  const channelIsPreferred = (channel: CommunicationChannel) =>
    preferenceLines.some((line) => linePrefersChannel(line, channel));

  const mailTime = getChannelContactTimeHint('mail', customerSource || rawSource);
  const whatsappTime = getChannelContactTimeHint('whatsapp', customerSource || rawSource);
  const smsTime = getChannelContactTimeHint('sms', customerSource || rawSource);

  const mail = exclusiveChannel
    ? exclusiveChannel === 'mail'
    : !channelIsForbidden('mail') &&
      (operational.channel === 'mail' || channelIsPreferred('mail') || Boolean(mailTime));
  const whatsapp = exclusiveChannel
    ? exclusiveChannel === 'whatsapp'
    : !channelIsForbidden('whatsapp') &&
      (operational.channel === 'whatsapp' || channelIsPreferred('whatsapp') || Boolean(whatsappTime));
  const sms = exclusiveChannel
    ? exclusiveChannel === 'sms'
    : !channelIsForbidden('sms') &&
      (operational.channel === 'sms' || channelIsPreferred('sms') || Boolean(smsTime));

  const chips: CommunicationPreferenceChip[] = [];

  const addChip = (chip: CommunicationPreferenceChip) => {
    if (chips.some((existing) => existing.key === chip.key)) return;
    chips.push(chip);
  };

  if (mail) {
    addChip({
      key: 'mail',
      label: 'Mail',
      color: 'teal',
      href: email ? `mailto:${email}` : undefined,
      title: appendContactTime(email ? `${operational.name ? `${operational.name} · ` : ''}E-Mail: ${email}` : 'E-Mail bevorzugt · keine E-Mail hinterlegt', mailTime),
      contactHeading: 'E-Mail-Kontakt',
      contactName,
      contactValue: email || 'Keine E-Mail hinterlegt',
      contactHint: email
        ? 'Antippen oder anklicken, um eine E-Mail zu schreiben.'
        : 'Keine E-Mail-Adresse hinterlegt.',
      contactTimeHint: mailTime,
    });
  }

  if (whatsapp) {
    addChip({
      key: 'whatsapp',
      label: 'WhatsApp',
      color: 'green',
      href: phone ? `https://wa.me/${phone.replace(/^\+/, '')}` : undefined,
      title: appendContactTime(phone ? `${operational.name ? `${operational.name} · ` : ''}WhatsApp: ${phone}` : 'WhatsApp bevorzugt · keine Telefonnummer vorhanden', whatsappTime),
      contactHeading: 'WhatsApp-Kontakt',
      contactName,
      contactValue: phone || 'Keine Telefonnummer vorhanden',
      contactHint: phone
        ? 'Antippen oder anklicken, um WhatsApp zu öffnen.'
        : 'Keine Telefonnummer hinterlegt.',
      contactTimeHint: whatsappTime,
    });
  }

  if (sms) {
    addChip({
      key: 'sms',
      label: 'SMS',
      color: 'blue',
      href: phone ? `sms:${phone}` : undefined,
      title: appendContactTime(phone ? `${operational.name ? `${operational.name} · ` : ''}SMS: ${phone}` : 'SMS bevorzugt · keine Telefonnummer vorhanden', smsTime),
      contactHeading: 'SMS-Kontakt',
      contactName,
      contactValue: phone || 'Keine Telefonnummer vorhanden',
      contactHint: phone
        ? 'Antippen oder anklicken, um eine SMS zu schreiben.'
        : 'Keine Telefonnummer hinterlegt.',
      contactTimeHint: smsTime,
    });
  }

  return chips;
}

// ─── Sub-components ───

/** Chip component */
function Chip({
  icon: Icon,
  label,
  color = 'default',
  href,
  title,
  compact = false,
  contactHeading,
  contactName,
  contactValue,
  contactHint,
  contactTimeHint,
}: {
  icon?: any;
  label: string;
  color?: 'default' | 'green' | 'blue' | 'purple' | 'teal' | 'red' | 'amber' | 'orange';
  href?: string;
  title?: string;
  compact?: boolean;
  contactHeading?: string;
  contactName?: string;
  contactValue?: string;
  contactHint?: string;
  contactTimeHint?: string;
}) {
  const colors: Record<string, string> = {
    default: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
    green: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
    blue: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
    purple: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300',
    teal: 'bg-teal-100 text-teal-800 border border-teal-200 dark:bg-teal-900/30 dark:text-teal-200 dark:border-teal-800',
    red: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
    amber: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
    orange: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300',
  };
  const fallbackIcon = label === 'Mail' ? Mail : label === 'WhatsApp' ? WhatsAppIcon : label === 'SMS' ? SmsIcon : undefined;
  const compactTextLabel = compact && label === 'SMS';
  const DisplayIcon = compactTextLabel ? undefined : Icon || fallbackIcon;
  const className = compact
    ? compactTextLabel
      ? `group relative inline-flex h-7 shrink-0 items-center justify-center rounded-lg px-2 text-[11px] font-bold tracking-wide ${colors[color] || colors.default} ${href ? 'hover:underline cursor-pointer' : ''}`
      : `group relative inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[11px] font-semibold ${colors[color] || colors.default} ${href ? 'hover:underline cursor-pointer' : ''}`
    : `group relative inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full ${colors[color] || colors.default} ${href ? 'hover:underline cursor-pointer' : ''}`;
  const isStructuredContactTooltip = Boolean(
    contactHeading && contactValue,
  );
  const safeContactName =
    sanitizeContactDisplayName(contactName) || 'Kunde';
  const tooltip = title || isStructuredContactTooltip ? (
    <span className="pointer-events-none absolute bottom-full left-0 z-[9999] mb-2 hidden w-[min(20rem,calc(100vw-2rem))] rounded-xl border border-blue-200 bg-white p-3 text-left font-normal shadow-xl group-hover:block group-focus:block dark:border-slate-700 dark:bg-slate-950">
      {isStructuredContactTooltip ? (
        <>
          <span className="block text-xs font-semibold text-blue-800 dark:text-blue-200">
            {contactHeading}
          </span>
          <span className="mt-1 block break-words font-medium text-foreground">
            {safeContactName}
          </span>
          <span className={`mt-1 block break-words text-sm text-blue-700 dark:text-blue-300 ${label === 'Mail' ? 'break-all' : 'font-mono'}`}>
            {contactValue}
          </span>
          <span className="mt-2 block text-xs text-muted-foreground">
            {contactHint || title}
          </span>
        </>
      ) : (
        <span className="whitespace-pre-wrap break-words text-[11px] font-medium leading-snug text-slate-800 dark:text-slate-100">
          {title}
        </span>
      )}
    </span>
  ) : null;
  const content = (
    <>
      {DisplayIcon && <DisplayIcon className={compact ? "w-3.5 h-3.5" : "w-3 h-3"} />}
      {(!compact || compactTextLabel) && label}
      {compact && !compactTextLabel && !DisplayIcon && label.slice(0, 1)}
      {tooltip}
    </>
  );

  if (href) {
    return (
      <a
        href={href}
        className={className}
        onClick={(event) => event.stopPropagation()}
        aria-label={title || label}
      >
        {content}
      </a>
    );
  }

  return (
    <button
      type="button"
      className={`${className} border-0`}
      onClick={(event) => event.stopPropagation()}
      aria-label={title || label}
    >
      {content}
    </button>
  );
}

/** Image gallery with thumbnails — click opens TouchImageViewer lightbox */
function ImageGallery({ thumbUrls, fullUrls }: { thumbUrls: string[]; fullUrls: string[] }) {
  const [activeIdx, setActiveIdx] = useState(0);
  const [viewerOpen, setViewerOpen] = useState(false);
  const count = thumbUrls.length;
  if (count === 0) return null;

  if (count === 1) {
    return (
      <>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); setActiveIdx(0); setViewerOpen(true); }}
          className="block w-24 h-24 rounded-lg border overflow-hidden bg-muted cursor-pointer hover:ring-2 hover:ring-primary transition-all"
        >
          <img src={thumbUrls[0]} alt="Kundenbild" className="w-full h-full object-cover" loading="lazy" />
        </button>
        <TouchImageViewer open={viewerOpen} onOpenChange={setViewerOpen} urls={fullUrls.length > 0 ? fullUrls : thumbUrls} initialIndex={0} />
      </>
    );
  }

  return (
    <div>
      <div
        className="relative bg-muted rounded-lg border overflow-hidden cursor-pointer hover:ring-2 hover:ring-primary transition-all"
        style={{ maxWidth: 300, aspectRatio: '4/3' }}
        onClick={(e) => { e.stopPropagation(); setViewerOpen(true); }}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setViewerOpen(true); } }}
      >
        <img src={fullUrls[activeIdx] || thumbUrls[activeIdx]} alt={`Bild ${activeIdx + 1}`} className="w-full h-full object-contain" loading="lazy" />
        {activeIdx > 0 && (
          <button type="button" onClick={(e) => { e.stopPropagation(); setActiveIdx(i => i - 1); }} className="absolute left-1 top-1/2 -translate-y-1/2 bg-black/50 text-white rounded-full p-1 hover:bg-black/70">
            <ChevronLeft className="w-4 h-4" />
          </button>
        )}
        {activeIdx < count - 1 && (
          <button type="button" onClick={(e) => { e.stopPropagation(); setActiveIdx(i => i + 1); }} className="absolute right-1 top-1/2 -translate-y-1/2 bg-black/50 text-white rounded-full p-1 hover:bg-black/70">
            <ChevronRight className="w-4 h-4" />
          </button>
        )}
      </div>
      <div className="flex gap-1.5 mt-1.5">
        {thumbUrls.map((url, i) => (
          <button key={i} type="button" onClick={(e) => { e.stopPropagation(); setActiveIdx(i); }}
            className={`w-12 h-12 rounded border overflow-hidden bg-muted shrink-0 transition-all ${i === activeIdx ? 'ring-2 ring-primary border-primary' : 'opacity-60 hover:opacity-100'}`}
          >
            <img src={url} alt={`Vorschau ${i + 1}`} className="w-full h-full object-cover" loading="lazy" />
          </button>
        ))}
      </div>
      <p className="text-[10px] text-muted-foreground mt-1">Bild {activeIdx + 1} / {count}</p>
      <TouchImageViewer open={viewerOpen} onOpenChange={setViewerOpen} urls={fullUrls.length > 0 ? fullUrls : thumbUrls} initialIndex={activeIdx} />
    </div>
  );
}

// ─── Main Component ───

/**
 * Unified communication display block.
 * Used in Orders, Offers, and Invoices edit dialogs.
 * 
 * Layout:
 * 1. Chips row (source, media type, language, warnings)
 * 2. Special notes (editable, warning/access/condition only)
 * 3. Customer message / media block (read-only)
 */
export function CommunicationBlock({
  data,
  showDescription = false,
  descriptionValue,
  onDescriptionChange,
  specialNotesValue,
  onSpecialNotesChange,
  showChips = true,
  showSpecialNotes = true,
  showCustomerMessage = true,
}: {
  data: CommunicationData;
  /** Show editable description field (for Orders only) */
  showDescription?: boolean;
  descriptionValue?: string;
  onDescriptionChange?: (val: string) => void;
  /** Editable special notes value */
  specialNotesValue?: string;
  onSpecialNotesChange?: (val: string) => void;
  /** Optional display controls. Defaults preserve all existing callers. */
  showChips?: boolean;
  showSpecialNotes?: boolean;
  showCustomerMessage?: boolean;
}) {
  const parsed = useMemo(() => parseNotesField(data.notes), [data.notes]);
  const mediaInfo = useMemo(() => getMediaTypeLabel(data), [data.notes, data.mediaUrl, data.mediaType, data.imageUrls]);
  const hasAudio = data.mediaUrl && data.mediaType === 'audio';
  const imagePaths = data.imageUrls && data.imageUrls.length > 0 ? data.imageUrls : (data.mediaUrl && data.mediaType === 'image' ? [data.mediaUrl] : []);
  const thumbPaths = data.thumbnailUrls && data.thumbnailUrls.length > 0 ? data.thumbnailUrls : imagePaths;
  const resolvedThumbs = useResolvedUrls(thumbPaths);
  const resolvedImages = useResolvedUrls(imagePaths);

  // Audio URL resolution
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  useEffect(() => {
    if (hasAudio && data.mediaUrl) {
      resolveUrl(data.mediaUrl).then(setAudioUrl);
    }
  }, [data.mediaUrl, hasAudio]);

  // Extract chips from specialNotes
  const { jobHints } = splitSpecialNotes(data.specialNotes);
  const { hazards, equipment } = splitJobHints(jobHints);
  const equipmentWithFallback = useMemo(
    () => buildEquipmentChipHints(equipment, data.specialNotes),
    [data.specialNotes, equipment],
  );

  // Callback is semantic and marker-based: only parsed specialNotes may create it.
  // Raw customer messages are not scanned, so "nicht anrufen" / "klingeln und warten"
  // cannot create a false callback chip.
  const callbackNote = useMemo(() => {
    return detectCallbackRequest(data.specialNotes);
  }, [data.specialNotes]);
  const callbackPhone = useMemo(
    () => getContactPhone(
      data,
      [
        data.communicationContext,
        parsed.originalMessage,
        parsed.translation,
        data.specialNotes,
        data.audioTranscript,
        data.customer?.phone,
        data.phone,
      ]
        .filter(Boolean)
        .join('\n'),
    ),
    [data, parsed.originalMessage, parsed.translation],
  );

  const communicationPreferences = useMemo(
    () => detectCommunicationPreferenceChips(data, parsed),
    [data.communicationContext, data.specialNotes, data.notes, data.audioTranscript, data.customer?.email, data.customer?.phone, data.email, data.phone, parsed],
  );

  // Detect customer language from parsed notes
  const hasTranslation = !!parsed.translation;

  const showOriginalCustomerMessage = Boolean(
    parsed.originalMessage &&
      !isTranscriptOnlyCustomerMessage(parsed.originalMessage, data.audioTranscript, Boolean(hasAudio)),
  );

  // Check if there's any content to show
  const hasContent = showOriginalCustomerMessage || hasAudio || imagePaths.length > 0 || data.audioTranscript || data.specialNotes;
  if (!hasContent && !showDescription) return null;

  return (
    <div className="space-y-3" onClick={(e) => e.stopPropagation()}>

      {/* ─── 1. CHIPS ROW ─── */}
      {showChips && (mediaInfo || hasTranslation || communicationPreferences.length > 0 || hazards.length > 0 || equipmentWithFallback.length > 0 || callbackNote) && (
        <div className="flex flex-wrap items-center gap-1.5">
          {/* Media type (Sprachnachricht / Bild / Bild+Text only) */}
          {mediaInfo && (
            <Chip icon={mediaInfo.icon} label={mediaInfo.label} color="blue" />
          )}
          {/* Language indicator */}
          {hasTranslation && (
            <Chip icon={Globe} label="Übersetzt" color="purple" />
          )}
          {/* Communication preference chips */}
          {communicationPreferences.map((chip) => (
            <span key={chip.key} className="inline-flex">
              <Chip
                label={chip.label}
                color={chip.color}
                href={chip.href}
                title={chip.title}
                contactHeading={chip.contactHeading}
                contactName={chip.contactName}
                contactValue={chip.contactValue}
                contactHint={chip.contactHint}
                contactTimeHint={chip.contactTimeHint}
              />
            </span>
          ))}
          {/* Callback request chip */}
          {callbackNote && callbackPhone ? (
            <a
              href={`tel:${callbackPhone}`}
              onClick={(event) => event.stopPropagation()}
              title={`Anrufen: ${callbackPhone}`}
              className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-blue-200 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200 border border-blue-300 dark:border-blue-700 hover:underline"
            >
              📞 {callbackNote}
            </a>
          ) : callbackNote ? (
            <span
              title="Rückruf gewünscht · Nummer fehlt"
              className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-blue-200 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200 border border-blue-300 dark:border-blue-700"
            >
              📞 {callbackNote}
            </span>
          ) : null}
          {/* Hazard chips */}
          {hazards.filter((h) => !isNegatedAnimalHint(h)).map((h, i) => {
            const visual = getHazardChipVisual(h);
            return (
              <span
                key={`hz-${i}`}
                title={visual.title}
                aria-label={visual.title}
                className={visual.iconOnly
                  ? "inline-flex h-7 w-7 items-center justify-center rounded-lg text-[17px] font-semibold bg-red-200 text-red-800 dark:bg-red-900/40 dark:text-red-200 border border-red-300 dark:border-red-700"
                  : "inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-red-200 text-red-800 dark:bg-red-900/40 dark:text-red-200 border border-red-300 dark:border-red-700"}
              >
                {visual.icon}{!visual.iconOnly && <> {h}</>}
              </span>
            );
          })}
          {/* Equipment chips */}
          {equipmentWithFallback.map((h, i) => {
            const visual = getEquipmentChipVisual(h);
            return (
              <span
                key={`eq-${i}`}
                title={visual.title}
                aria-label={visual.title}
                className={visual.iconOnly
                  ? "inline-flex h-7 w-7 items-center justify-center rounded-lg text-[17px] font-semibold bg-amber-200 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200 border border-amber-300 dark:border-amber-700"
                  : "inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-amber-200 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200 border border-amber-300 dark:border-amber-700"}
              >
                {visual.icon}{!visual.iconOnly && <> {h}</>}
              </span>
            );
          })}
        </div>
      )}

      {/* ─── 2. WORK SUMMARY (editable or read-only) ─── */}
      {showDescription && onDescriptionChange ? (
        <div>
          <label className="text-xs font-medium text-muted-foreground">Arbeitszusammenfassung</label>
          <textarea
            className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm min-h-[60px] resize-y mt-1"
            rows={2}
            placeholder="Wird automatisch aus Leistungen generiert"
            value={descriptionValue ?? ''}
            onChange={(e) => onDescriptionChange(e.target.value)}
          />
        </div>
      ) : showDescription && descriptionValue ? (
        <div>
          <label className="text-xs font-medium text-muted-foreground">Arbeitszusammenfassung</label>
          <div className="mt-1 bg-muted/50 rounded-lg p-3">
            <p className="text-sm whitespace-pre-line">{descriptionValue}</p>
          </div>
        </div>
      ) : null}

      {/* ─── 3. SPECIAL NOTES (editable or read-only) ─── */}
      {showSpecialNotes && (onSpecialNotesChange !== undefined ? (
        <div>
          <label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5 text-orange-500" />
            Besonderheiten
          </label>
          <textarea
            className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm min-h-[50px] resize-y mt-1"
            rows={2}
            placeholder="z.B. Hanglage, Hund, Leiter nötig..."
            value={specialNotesValue ?? ''}
            onChange={(e) => onSpecialNotesChange(e.target.value)}
          />
          {/* Show auto-detected callback note if not already in the special notes */}
          {callbackNote && !(specialNotesValue || '').toLowerCase().includes('rückruf') && (
            <p className="text-[11px] text-blue-600 mt-1 flex items-center gap-1">📞 Erkannt: {callbackNote} — <button type="button" className="underline hover:no-underline" onClick={() => { const current = (specialNotesValue || '').trim(); onSpecialNotesChange(current ? `${current}\n${callbackNote}` : callbackNote); }}>Hinzufügen</button></p>
          )}
        </div>
      ) : (specialNotesValue || callbackNote) ? (
        <div>
          <label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5 text-orange-500" />
            Besonderheiten
          </label>
          <div className="mt-1 bg-orange-50 dark:bg-orange-900/20 rounded-lg p-3 border border-orange-200 dark:border-orange-800">
            {specialNotesValue && <p className="text-sm whitespace-pre-line">{specialNotesValue}</p>}
            {callbackNote && !(specialNotesValue || '').toLowerCase().includes('rückruf') && (
              <p className="text-sm text-blue-700 dark:text-blue-300 flex items-center gap-1 mt-1">📞 {callbackNote}</p>
            )}
          </div>
        </div>
      ) : null)}

      {/* ─── 4. CUSTOMER MESSAGE / MEDIA BLOCK ─── */}
      {showCustomerMessage && (parsed.originalMessage || hasAudio || imagePaths.length > 0 || data.audioTranscript) && (
        <div className="border-t pt-3 mt-1 space-y-3">
          <p className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
            📨 Kundennachricht
          </p>

          {/* Voice message: audio player + transcript + translation */}
          {hasAudio && audioUrl && (
            <div className="space-y-2">
              <audio controls className="w-full h-8" preload="none">
                <source src={audioUrl} />
              </audio>
              {/* Audio metadata: duration + transcription status (Stage I) */}
              {(data.audioDurationSec != null || data.audioTranscriptionStatus) && (
                <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                  {data.audioDurationSec != null && (
                    <span className="inline-flex items-center gap-1">
                      <Mic className="w-3 h-3" />
                      Dauer: <strong className="font-semibold">{formatAudioDuration(data.audioDurationSec)}</strong>
                    </span>
                  )}
                  {data.audioTranscriptionStatus === 'transcribed' && (
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300">
                      ✓ automatisch transkribiert
                    </span>
                  )}
                  {data.audioTranscriptionStatus === 'skipped_too_long' && (
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-50 text-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
                      ⚠️ nicht transkribiert (länger als 60 Sek.)
                    </span>
                  )}
                  {data.audioTranscriptionStatus === 'skipped_uncheckable' && (
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-50 text-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
                      ⚠️ zeitlich nicht prüfbar – manuell prüfen
                    </span>
                  )}
                  {data.audioTranscriptionStatus === 'skipped_quota_exceeded' && (
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-50 text-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
                      ⚠️ Monatslimit erreicht – manuell prüfen
                    </span>
                  )}
                  {data.audioTranscriptionStatus === 'failed' && (
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-300">
                      ✗ Transkription fehlgeschlagen
                    </span>
                  )}
                </div>
              )}
              <p className="text-[10px] text-muted-foreground italic">
                Bei Unklarheiten die Sprachnachricht anhören — Transkriptionen können Fehler enthalten.
              </p>
            </div>
          )}

          {/* Transcript (from audio) — shown ONCE */}
          {data.audioTranscript && (
            <div className="bg-muted/50 rounded-lg p-3">
              <p className="text-[10px] font-medium text-muted-foreground mb-1">Transkript</p>
              <p className="text-sm whitespace-pre-line">{data.audioTranscript}</p>
            </div>
          )}

          {/* Images — gallery */}
          {resolvedThumbs.length > 0 && (
            <ImageGallery thumbUrls={resolvedThumbs} fullUrls={resolvedImages} />
          )}

          {/* Original text message — shown ONCE (only if substantially different from transcript) */}
          {showOriginalCustomerMessage && (
            <div className="bg-muted/50 rounded-lg p-3">
              <p className="text-sm whitespace-pre-line">{parsed.originalMessage}</p>
            </div>
          )}

          {/* Translation (if customer language ≠ German) */}
          {parsed.translation && (
            <div className="bg-purple-50 dark:bg-purple-900/20 rounded-lg p-3 border border-purple-200 dark:border-purple-800">
              <p className="text-[10px] font-medium text-purple-600 dark:text-purple-400 mb-1 flex items-center gap-1">
                <Globe className="w-3 h-3" />Deutsche Übersetzung
              </p>
              <p className="text-sm whitespace-pre-line">{parsed.translation}</p>
            </div>
          )}

        </div>
      )}
    </div>
  );
}

/**
 * Compact inline badges for card list views.
 * Shows: source chip, audio icon, image icon, hazard/equipment chips.
 * This replaces the old OrderContextBadges for card rows.
 */
export function CommunicationChips({
  data,
  onAudioClick,
  onImageClick,
  compact = false,
  contactsOnly = false,
  showMediaChips = false,
  showInfoChip = false,
}: {
  data: CommunicationData;
  onAudioClick?: () => void;
  onImageClick?: () => void;
  compact?: boolean;
  /** For invoices: only direct contact actions, no separate hazard/equipment chips. */
  contactsOnly?: boolean;
  /** Media chips may still be shown while contactsOnly suppresses operational chips. */
  showMediaChips?: boolean;
  /** Collect remaining internal hints in one blue info chip. */
  showInfoChip?: boolean;
}) {
  const hasAudio = data.mediaUrl && data.mediaType === 'audio';
  const hasImages = (data.imageUrls && data.imageUrls.length > 0) || (data.mediaUrl && data.mediaType === 'image');
  const parsed = useMemo(() => parseNotesField(data.notes), [data.notes]);
  const { jobHints } = splitSpecialNotes(data.specialNotes);
  const { hazards, equipment } = splitJobHints(jobHints);
  const equipmentWithFallback = useMemo(
    () => buildEquipmentChipHints(equipment, data.specialNotes),
    [data.specialNotes, equipment],
  );
  const rawCallbackNote = detectCallbackRequest(data.specialNotes);
  const communicationPreferences = useMemo(
    () => detectCommunicationPreferenceChips(data, parsed),
    [data.communicationContext, data.specialNotes, data.notes, data.audioTranscript, data.customer?.email, data.customer?.phone, data.customerPhone, data.contactPhone, data.email, data.phone, parsed],
  );
  const callbackSourceLines = splitCommunicationSourceLines(
    [
      data.communicationContext,
      data.specialNotes,
      data.notes,
      parsed.translation,
      parsed.originalMessage,
    ]
      .filter(Boolean)
      .join("\n"),
  );
  const hasExplicitPositivePhoneCall = callbackSourceLines.some((line) => {
    const normalized = normalizeCommunicationPreferenceText(line);
    if (!normalized) return false;
    const negative =
      /\b(?:nicht|kein|keine|ohne|no|not|without)\b.{0,35}\b(?:anrufen|telefonieren|rueckruf|ruckruf|call)\b/.test(
        normalized,
      );
    if (negative) return false;
    return /\b(?:bitte|vorher|zuerst|vor\s+ankunft|vor\s+arbeitsbeginn)\b.{0,45}\b(?:anrufen|telefonieren|rueckruf|ruckruf|call)\b/.test(
      normalized,
    );
  });
  const hasExplicitNoPhoneCall = callbackSourceLines.some((line) => {
    const normalized = normalizeCommunicationPreferenceText(line);
    return /\b(?:nicht\s+(?:direkt\s+|telefonisch\s+)?anrufen|nicht\s+telefonisch|keine(?:n)?\s+anrufe?|do\s+not\s+call|don['’]?t\s+call|no\s+calls?|ne\s+pas\s+appeler|non\s+chiamare)\b/.test(
      normalized,
    );
  });
  const hasExclusiveMessageChannel = communicationPreferences.some(
    (chip) =>
      chip.key === "sms" || chip.key === "whatsapp" || chip.key === "mail",
  );
  const callbackNote =
    rawCallbackNote &&
    !hasExplicitNoPhoneCall &&
    (!hasExclusiveMessageChannel || hasExplicitPositivePhoneCall)
      ? rawCallbackNote
      : null;
  const callbackPhone = getContactPhone(
    data,
    [
      data.communicationContext,
      data.specialNotes,
      data.notes,
      parsed.translation,
      parsed.originalMessage,
      data.audioTranscript,
      data.contactPhone,
      data.customer?.phone,
      data.customerPhone,
      data.phone,
    ]
      .filter(Boolean)
      .join('\n'),
  );
  const callbackContact = extractOperationalContactV17_90L85(
    [
      data.communicationContext,
      data.specialNotes,
      data.notes,
      parsed.translation,
      parsed.originalMessage,
      data.audioTranscript,
    ]
      .filter(Boolean)
      .join('\n'),
  );
  const callbackContactName =
    sanitizeContactDisplayName(callbackContact.name) ||
    sanitizeContactDisplayName(data.customer?.name) ||
    'Kunde';
  const infoLines = useMemo(
    () => buildCommunicationInfoLines(jobHints, data.specialNotes),
    [jobHints, data.specialNotes],
  );
  const structuredInfo = useMemo(() => {
    const safety = uniqueCommunicationInfoLines(hazards);
    const safetyKeys = new Set(
      safety.map((line) => normalizeSemanticChipText(line)),
    );
    const remaining = uniqueCommunicationInfoLines(infoLines).filter(
      (line) => !safetyKeys.has(normalizeSemanticChipText(line)),
    );
    const primary = remaining.filter(isPrimaryCommunicationInfoLine);
    const primaryKeys = new Set(
      primary.map((line) => normalizeSemanticChipText(line)),
    );
    const additional = remaining.filter(
      (line) => !primaryKeys.has(normalizeSemanticChipText(line)),
    );
    return { safety, primary, additional };
  }, [hazards, infoLines]);

  const hasVisibleContent =
    (((!contactsOnly || showMediaChips) && (hasAudio || hasImages)) ||
      (!contactsOnly &&
        (hazards.length > 0 || equipmentWithFallback.length > 0))) ||
    Boolean(callbackNote) ||
    communicationPreferences.length > 0 ||
    (showInfoChip && infoLines.length > 0);

  if (!hasVisibleContent) return null;

  return (
    <>
      {(!contactsOnly || showMediaChips) && hasAudio && (
        <button
          onClick={(e) => { e.stopPropagation(); onAudioClick?.(); }}
          className="p-1 text-primary bg-primary/10 rounded hover:bg-primary/20"
          title="Audio abspielen"
        >
          <Volume2 className="w-4 h-4" />
        </button>
      )}
      {(!contactsOnly || showMediaChips) && hasImages && (() => {
        const imgCount = data.imageUrls?.length || (data.mediaUrl && data.mediaType === 'image' ? 1 : 0);
        return (
          <button
            onClick={(e) => { e.stopPropagation(); onImageClick?.(); }}
            className={compact ? "inline-flex h-7 w-7 items-center justify-center text-blue-600 bg-blue-50 dark:bg-blue-900/20 rounded-lg hover:bg-blue-100" : "inline-flex items-center gap-0.5 px-1.5 py-0.5 text-blue-600 bg-blue-50 dark:bg-blue-900/20 rounded hover:bg-blue-100 text-[11px]"}
            title="Bilder ansehen"
          >
            <ImageIcon className="w-3.5 h-3.5" />{!compact && (imgCount > 1 ? ` (${imgCount})` : '')}
          </button>
        );
      })()}
      {communicationPreferences.map((chip) => (
        <span key={chip.key} className="inline-flex">
          <Chip
            label={chip.label}
            color={chip.color}
            href={chip.href}
            title={chip.title}
            compact={compact}
            contactHeading={chip.contactHeading}
            contactName={chip.contactName}
            contactValue={chip.contactValue}
            contactHint={chip.contactHint}
            contactTimeHint={chip.contactTimeHint}
          />
        </span>
      ))}
      {!contactsOnly && hazards.filter((h) => !isNegatedAnimalHint(h)).map((h, i) => {
        const visual = getHazardChipVisual(h);
        const iconOnly = compact || visual.iconOnly;
        return (
          <span
            key={`h-${i}`}
            title={visual.title}
            aria-label={visual.title}
            className={iconOnly
              ? "inline-flex h-7 w-7 items-center justify-center rounded-lg text-[17px] font-semibold bg-red-200 text-red-800 dark:bg-red-900/40 dark:text-red-200 border border-red-300 dark:border-red-700"
              : "inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full font-semibold bg-red-200 text-red-800 dark:bg-red-900/40 dark:text-red-200 border border-red-300 dark:border-red-700"}
          >
            {visual.icon}{!iconOnly && <> {h}</>}
          </span>
        );
      })}
      {!contactsOnly && equipmentWithFallback.map((h, i) => {
        const visual = getEquipmentChipVisual(h);
        const iconOnly = compact || visual.iconOnly;
        return (
          <span
            key={`e-${i}`}
            title={visual.title}
            aria-label={visual.title}
            className={iconOnly
              ? "inline-flex h-7 w-7 items-center justify-center rounded-lg text-[17px] font-semibold bg-amber-200 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200 border border-amber-300 dark:border-amber-700"
              : "inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full font-semibold bg-amber-200 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200 border border-amber-300 dark:border-amber-700"}
          >
            {visual.icon}{!iconOnly && <> {h}</>}
          </span>
        );
      })}
      {callbackNote && (
        <span className="inline-flex">
          <Chip
            icon={Phone}
            label="Telefon"
            color="blue"
            href={callbackPhone ? `tel:${callbackPhone}` : undefined}
            title={
              callbackPhone
                ? `Anrufen: ${callbackPhone}`
                : "Rückruf gewünscht · Nummer fehlt"
            }
            compact={compact}
            contactHeading="Telefonkontakt"
            contactName={callbackContactName}
            contactValue={callbackPhone || "Keine Telefonnummer vorhanden"}
            contactHint={
              callbackPhone
                ? "Antippen oder anklicken, um anzurufen."
                : "Keine Telefonnummer hinterlegt."
            }
          />
        </span>
      )}
      {showInfoChip && infoLines.length > 0 && (
        <button
          type="button"
          onClick={(event) => event.stopPropagation()}
          aria-label="Informationen anzeigen"
          className={
            compact
              ? "group relative inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-blue-300 bg-blue-50 text-blue-700 hover:bg-blue-100"
              : "group relative inline-flex items-center gap-1 rounded-full border border-blue-300 bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-blue-700 hover:bg-blue-100"
          }
        >
          <Info className="h-4 w-4" />
          {!compact && "Info"}
          <span className="pointer-events-none absolute bottom-full left-0 z-[9999] mb-2 hidden max-h-[65vh] w-[min(25rem,calc(100vw-2rem))] overflow-y-auto rounded-xl border border-slate-200 bg-white p-3 text-left font-normal shadow-2xl group-hover:block group-focus:block dark:border-slate-700 dark:bg-slate-950">
            <span className="block space-y-2">
              {structuredInfo.safety.length > 0 && (
                <span className="block rounded-lg border border-red-300 bg-red-50 p-2 text-red-800 dark:border-red-800/70 dark:bg-red-950/40 dark:text-red-100">
                  <span className="mb-1 flex items-center gap-1 font-bold">
                    <AlertTriangle className="h-3.5 w-3.5" /> Gefahr / Achtung
                  </span>
                  {structuredInfo.safety.map((line, index) => (
                    <span key={`invoice-info-safety-${index}`} className="block break-words text-xs">
                      • {line}
                    </span>
                  ))}
                </span>
              )}
              {structuredInfo.primary.length > 0 && (
                <span className="block rounded-lg border border-blue-300 bg-blue-50 p-2 text-blue-900 dark:border-blue-800/70 dark:bg-blue-950/30 dark:text-blue-100">
                  <span className="mb-1 flex items-center gap-1 font-bold">
                    <Info className="h-3.5 w-3.5" /> Wichtige Informationen
                  </span>
                  {structuredInfo.primary.map((line, index) => (
                    <span key={`invoice-info-primary-${index}`} className="block break-words text-xs">
                      {line}
                    </span>
                  ))}
                </span>
              )}
              {structuredInfo.additional.length > 0 && (
                <span className="block rounded-lg border border-amber-300 bg-amber-50 p-2 text-amber-900 dark:border-amber-800/70 dark:bg-amber-950/30 dark:text-amber-100">
                  <span className="mb-1 block font-bold">Weitere Besonderheiten</span>
                  {structuredInfo.additional.map((line, index) => (
                    <span key={`invoice-info-additional-${index}`} className="block break-words text-xs">
                      {line}
                    </span>
                  ))}
                </span>
              )}
            </span>
          </span>
        </button>
      )}
    </>
  );
}
