'use client';
import { useState, useEffect, useMemo } from 'react';
import { Volume2, ImageIcon, AlertTriangle, ChevronLeft, ChevronRight, Globe, Mic, Camera, FileImage } from 'lucide-react';
import { splitSpecialNotes, splitJobHints, detectCallbackRequest } from '@/lib/special-notes-utils';
import { formatAudioDuration } from '@/lib/audio-format';

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

  // Remove system metadata lines like [Titel: ...], [Priorität: ...], and [META] ...
  body = body.replace(/\n?\[Titel:.*?\]/g, '').replace(/\n?\[Priorität:.*?\]/g, '').trim();
  // Strip [META] lines added by webhook intake (Layer 1 of data-pollution defense).
  body = body.split('\n').filter(l => !/^\s*\[META\]/i.test(l)).join('\n').trim();

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
  const normalize = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();
  const na = normalize(a);
  const nb = normalize(b);
  if (na === nb) return true;
  // One contains the other (handles extra metadata/whitespace)
  if (na.length > 10 && nb.length > 10) {
    if (na.includes(nb) || nb.includes(na)) return true;
  }
  return false;
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

// ─── Sub-components ───

/** Chip component */
function Chip({ icon: Icon, label, color = 'default' }: { icon?: any; label: string; color?: 'default' | 'green' | 'blue' | 'purple' | 'red' | 'amber' | 'orange' }) {
  const colors: Record<string, string> = {
    default: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
    green: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
    blue: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
    purple: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300',
    red: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
    amber: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
    orange: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300',
  };
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full ${colors[color] || colors.default}`}>
      {Icon && <Icon className="w-3 h-3" />}
      {label}
    </span>
  );
}

/** Image gallery with thumbnails */
function ImageGallery({ thumbUrls, fullUrls }: { thumbUrls: string[]; fullUrls: string[] }) {
  const [activeIdx, setActiveIdx] = useState(0);
  const count = thumbUrls.length;
  if (count === 0) return null;

  if (count === 1) {
    return (
      <a href={fullUrls[0] || thumbUrls[0]} target="_blank" rel="noopener noreferrer" className="block w-24 h-24 rounded-lg border overflow-hidden bg-muted">
        <img src={thumbUrls[0]} alt="Kundenbild" className="w-full h-full object-cover" loading="lazy" />
      </a>
    );
  }

  return (
    <div>
      <div className="relative bg-muted rounded-lg border overflow-hidden" style={{ maxWidth: 300, aspectRatio: '4/3' }}>
        <a href={fullUrls[activeIdx] || thumbUrls[activeIdx]} target="_blank" rel="noopener noreferrer">
          <img src={fullUrls[activeIdx] || thumbUrls[activeIdx]} alt={`Bild ${activeIdx + 1}`} className="w-full h-full object-contain" loading="lazy" />
        </a>
        {activeIdx > 0 && (
          <button onClick={(e) => { e.stopPropagation(); setActiveIdx(i => i - 1); }} className="absolute left-1 top-1/2 -translate-y-1/2 bg-black/50 text-white rounded-full p-1 hover:bg-black/70">
            <ChevronLeft className="w-4 h-4" />
          </button>
        )}
        {activeIdx < count - 1 && (
          <button onClick={(e) => { e.stopPropagation(); setActiveIdx(i => i + 1); }} className="absolute right-1 top-1/2 -translate-y-1/2 bg-black/50 text-white rounded-full p-1 hover:bg-black/70">
            <ChevronRight className="w-4 h-4" />
          </button>
        )}
      </div>
      <div className="flex gap-1.5 mt-1.5">
        {thumbUrls.map((url, i) => (
          <button key={i} onClick={(e) => { e.stopPropagation(); setActiveIdx(i); }}
            className={`w-12 h-12 rounded border overflow-hidden bg-muted shrink-0 transition-all ${i === activeIdx ? 'ring-2 ring-primary border-primary' : 'opacity-60 hover:opacity-100'}`}
          >
            <img src={url} alt={`Vorschau ${i + 1}`} className="w-full h-full object-cover" loading="lazy" />
          </button>
        ))}
      </div>
      <p className="text-[10px] text-muted-foreground mt-1">Bild {activeIdx + 1} / {count}</p>
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
}: {
  data: CommunicationData;
  /** Show editable description field (for Orders only) */
  showDescription?: boolean;
  descriptionValue?: string;
  onDescriptionChange?: (val: string) => void;
  /** Editable special notes value */
  specialNotesValue?: string;
  onSpecialNotesChange?: (val: string) => void;
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

  // Detect callback request from customer message (notes + audioTranscript)
  const callbackNote = useMemo(() => {
    return detectCallbackRequest(data.notes) || detectCallbackRequest(data.audioTranscript);
  }, [data.notes, data.audioTranscript]);

  // Detect customer language from parsed notes
  const hasTranslation = !!parsed.translation;

  // Check if there's any content to show
  const hasContent = parsed.originalMessage || hasAudio || imagePaths.length > 0 || data.audioTranscript || data.specialNotes;
  if (!hasContent && !showDescription) return null;

  return (
    <div className="space-y-3" onClick={(e) => e.stopPropagation()}>

      {/* ─── 1. CHIPS ROW ─── */}
      {(mediaInfo || hasTranslation || hazards.length > 0 || equipment.length > 0 || callbackNote) && (
        <div className="flex flex-wrap items-center gap-1.5">
          {/* Media type (Sprachnachricht / Bild / Bild+Text only) */}
          {mediaInfo && (
            <Chip icon={mediaInfo.icon} label={mediaInfo.label} color="blue" />
          )}
          {/* Language indicator */}
          {hasTranslation && (
            <Chip icon={Globe} label="Übersetzt" color="purple" />
          )}
          {/* Callback request chip */}
          {callbackNote && (
            <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-blue-200 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200 border border-blue-300 dark:border-blue-700">
              📞 {callbackNote}
            </span>
          )}
          {/* Hazard chips */}
          {hazards.map((h, i) => (
            <span key={`hz-${i}`} className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-red-200 text-red-800 dark:bg-red-900/40 dark:text-red-200 border border-red-300 dark:border-red-700">
              {/hund/i.test(h) ? '🐕' : '⚠️'} {h}
            </span>
          ))}
          {/* Equipment chips */}
          {equipment.map((h, i) => (
            <span key={`eq-${i}`} className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-amber-200 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200 border border-amber-300 dark:border-amber-700">
              🔧 {h}
            </span>
          ))}
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
      {onSpecialNotesChange !== undefined ? (
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
      ) : null}

      {/* ─── 4. CUSTOMER MESSAGE / MEDIA BLOCK ─── */}
      {(parsed.originalMessage || hasAudio || imagePaths.length > 0 || data.audioTranscript) && (
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

          {/* Original text message — shown ONCE (only if substantially different from transcript) */}
          {parsed.originalMessage && !isSameContent(parsed.originalMessage, data.audioTranscript) && (
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

          {/* Images — gallery */}
          {resolvedThumbs.length > 0 && (
            <ImageGallery thumbUrls={resolvedThumbs} fullUrls={resolvedImages} />
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
}: {
  data: CommunicationData;
  onAudioClick?: () => void;
  onImageClick?: () => void;
}) {
  const hasAudio = data.mediaUrl && data.mediaType === 'audio';
  const hasImages = (data.imageUrls && data.imageUrls.length > 0) || (data.mediaUrl && data.mediaType === 'image');
  const { jobHints } = splitSpecialNotes(data.specialNotes);
  const { hazards, equipment } = splitJobHints(jobHints);
  const callbackNote = detectCallbackRequest(data.notes) || detectCallbackRequest(data.audioTranscript);

  if (!hasAudio && !hasImages && hazards.length === 0 && equipment.length === 0 && !callbackNote) return null;

  return (
    <>
      {hasAudio && (
        <button
          onClick={(e) => { e.stopPropagation(); onAudioClick?.(); }}
          className="p-1 text-primary bg-primary/10 rounded hover:bg-primary/20"
          title="Audio abspielen"
        >
          <Volume2 className="w-4 h-4" />
        </button>
      )}
      {hasImages && (() => {
        const imgCount = data.imageUrls?.length || (data.mediaUrl && data.mediaType === 'image' ? 1 : 0);
        return (
          <button
            onClick={(e) => { e.stopPropagation(); onImageClick?.(); }}
            className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-blue-600 bg-blue-50 dark:bg-blue-900/20 rounded hover:bg-blue-100 text-[11px]"
            title="Bilder ansehen"
          >
            <ImageIcon className="w-3.5 h-3.5" />{imgCount > 1 ? ` (${imgCount})` : ''}
          </button>
        );
      })()}
      {hazards.map((h, i) => (
        <span key={`h-${i}`} className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full font-semibold bg-red-200 text-red-800 dark:bg-red-900/40 dark:text-red-200 border border-red-300 dark:border-red-700">
          {/hund/i.test(h) ? '🐕' : '⚠️'} {h}
        </span>
      ))}
      {equipment.map((h, i) => (
        <span key={`e-${i}`} className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full font-semibold bg-amber-200 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200 border border-amber-300 dark:border-amber-700">
          🔧 {h}
        </span>
      ))}
      {callbackNote && (
        <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full font-semibold bg-blue-200 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200 border border-blue-300 dark:border-blue-700">
          📞 Rückruf
        </span>
      )}
    </>
  );
}
