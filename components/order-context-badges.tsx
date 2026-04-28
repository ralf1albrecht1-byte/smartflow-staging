'use client';
import { useState, useEffect, useCallback } from 'react';
import { Volume2, ImageIcon, AlertTriangle, Info, AlertCircle, ChevronLeft, ChevronRight } from 'lucide-react';
import { splitSpecialNotes, splitJobHints } from '@/lib/special-notes-utils';

interface OrderContext {
  mediaUrl?: string | null;
  mediaType?: string | null;
  imageUrls?: string[];
  thumbnailUrls?: string[];
  audioTranscript?: string | null;
  specialNotes?: string | null;
  hinweisLevel?: string | null;
  needsReview?: boolean;
}

// Resolve S3 cloud path to signed URL
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

// Hook to resolve S3 paths to signed URLs (with caching)
const urlCache = new Map<string, string>();
function useResolvedUrls(paths: string[]): string[] {
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
  }, [paths.join(',')]);
  return urls;
}

const hintColors: Record<string, string> = {
  info: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
  important: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300',
  warning: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
};

const hintIcons: Record<string, any> = {
  info: Info,
  important: AlertCircle,
  warning: AlertTriangle,
};

/**
 * Resolves order context from either a direct Order or from an array of linked orders.
 */
export function resolveOrderContext(order?: OrderContext | null, linkedOrders?: OrderContext[]): OrderContext {
  if (order) return order;
  if (linkedOrders && linkedOrders.length > 0) {
    // Merge from all linked orders - take the most severe hint level and collect all media
    const levels = ['none', 'info', 'important', 'warning'];
    let maxLevel = 'none';
    let specialNotes = '';
    let mediaUrl: string | null = null;
    let mediaType: string | null = null;
    let imageUrls: string[] = [];
    let thumbnailUrls: string[] = [];
    let audioTranscript: string | null = null;

    for (const o of linkedOrders) {
      const lvl = o.hinweisLevel || (o.needsReview ? 'warning' : (o.specialNotes ? 'info' : 'none'));
      if (levels.indexOf(lvl) > levels.indexOf(maxLevel)) maxLevel = lvl;
      if (o.specialNotes && !specialNotes) specialNotes = o.specialNotes;
      if (o.mediaUrl && o.mediaType === 'audio' && !mediaUrl) { mediaUrl = o.mediaUrl; mediaType = 'audio'; }
      if (o.imageUrls && o.imageUrls.length > 0) imageUrls = [...imageUrls, ...o.imageUrls];
      else if (o.mediaUrl && o.mediaType === 'image') imageUrls = [...imageUrls, o.mediaUrl];
      if (o.thumbnailUrls && o.thumbnailUrls.length > 0) thumbnailUrls = [...thumbnailUrls, ...o.thumbnailUrls];
      if (o.audioTranscript && !audioTranscript) audioTranscript = o.audioTranscript;
    }

    const needsReview = linkedOrders.some(o => o.needsReview);
    return { mediaUrl, mediaType, imageUrls, thumbnailUrls, audioTranscript, specialNotes: specialNotes || null, hinweisLevel: maxLevel, needsReview };
  }
  return {};
}

/**
 * Renders compact inline badges for media and hints on card views.
 * Shows: audio icon, image icon, hint badge with color.
 */
export function OrderContextBadges({
  ctx,
  onAudioClick,
  onImageClick,
}: {
  ctx: OrderContext;
  onAudioClick?: () => void;
  onImageClick?: () => void;
}) {
  const level = ctx.hinweisLevel || (ctx.needsReview ? 'warning' : (ctx.specialNotes ? 'info' : 'none'));
  const hasAudio = ctx.mediaUrl && ctx.mediaType === 'audio';
  const hasImages = (ctx.imageUrls && ctx.imageUrls.length > 0) || (ctx.mediaUrl && ctx.mediaType === 'image');
  const HintIcon = hintIcons[level] || null;
  const hintColor = hintColors[level] || '';

  if (!hasAudio && !hasImages && level === 'none') return null;

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
        const imgCount = ctx.imageUrls?.length || (ctx.mediaUrl && ctx.mediaType === 'image' ? 1 : 0);
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
      {ctx.specialNotes && (() => {
        const { jobHints } = splitSpecialNotes(ctx.specialNotes);
        const { hazards, equipment } = splitJobHints(jobHints);
        return (
          <>
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
          </>
        );
      })()}
    </>
  );
}

/**
 * Image gallery with thumbnail strip and prev/next switching for multi-image orders.
 */
function ImageGallery({ thumbUrls, fullUrls }: { thumbUrls: string[]; fullUrls: string[] }) {
  const [activeIdx, setActiveIdx] = useState(0);
  const count = thumbUrls.length;
  if (count === 0) return null;

  // Single image: just show thumbnail linking to full image
  if (count === 1) {
    return (
      <div>
        <p className="text-xs font-medium text-muted-foreground mb-1 flex items-center gap-1"><ImageIcon className="w-3.5 h-3.5" />Bild</p>
        <a href={fullUrls[0] || thumbUrls[0]} target="_blank" rel="noopener noreferrer" className="block w-24 h-24 rounded border overflow-hidden bg-muted">
          <img src={thumbUrls[0]} alt="Bild" className="w-full h-full object-cover" loading="lazy" />
        </a>
      </div>
    );
  }

  // Multi-image: gallery with switcher
  return (
    <div>
      <p className="text-xs font-medium text-muted-foreground mb-1 flex items-center gap-1">
        <ImageIcon className="w-3.5 h-3.5" />Bild {activeIdx + 1} / {count}
      </p>
      {/* Main preview */}
      <div className="relative bg-muted rounded border overflow-hidden" style={{ maxWidth: 320, aspectRatio: '4/3' }}>
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
      {/* Thumbnail strip */}
      <div className="flex gap-1.5 mt-1.5">
        {thumbUrls.map((url, i) => (
          <button key={i} onClick={(e) => { e.stopPropagation(); setActiveIdx(i); }}
            className={`w-14 h-14 rounded border overflow-hidden bg-muted shrink-0 transition-all ${i === activeIdx ? 'ring-2 ring-primary border-primary' : 'opacity-60 hover:opacity-100'}`}
          >
            <img src={url} alt={`Vorschau ${i + 1}`} className="w-full h-full object-cover" loading="lazy" />
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * Renders the full detail view for order context (audio player, images, transcript, hints).
 */
export function OrderContextDetail({ ctx }: { ctx: OrderContext }) {
  const level = ctx.hinweisLevel || (ctx.needsReview ? 'warning' : (ctx.specialNotes ? 'info' : 'none'));
  const hasAudio = ctx.mediaUrl && ctx.mediaType === 'audio';
  // Use preview images (imageUrls) for detail view, fallback to mediaUrl
  const imagePaths = ctx.imageUrls && ctx.imageUrls.length > 0 ? ctx.imageUrls : (ctx.mediaUrl && ctx.mediaType === 'image' ? [ctx.mediaUrl] : []);
  // Use thumbnails for the small previews (fallback to full images)
  const thumbPaths = ctx.thumbnailUrls && ctx.thumbnailUrls.length > 0 ? ctx.thumbnailUrls : imagePaths;
  const resolvedThumbs = useResolvedUrls(thumbPaths);
  const resolvedImages = useResolvedUrls(imagePaths);
  const HintIcon = hintIcons[level] || null;
  const hintColor = hintColors[level] || '';

  // Resolve audio URL
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  useEffect(() => {
    if (hasAudio && ctx.mediaUrl) {
      resolveUrl(ctx.mediaUrl).then(setAudioUrl);
    }
  }, [ctx.mediaUrl, hasAudio]);

  if (!hasAudio && imagePaths.length === 0 && !ctx.audioTranscript && level === 'none') return null;

  return (
    <div className="space-y-3 mt-3 p-3 bg-muted/50 rounded-lg border" onClick={(e) => e.stopPropagation()}>
      {/* Operational hints (hazards shown as badges on card, system hints hidden) */}
      {ctx.specialNotes && (() => {
        const { jobHints } = splitSpecialNotes(ctx.specialNotes);
        const { operational } = splitJobHints(jobHints);
        if (operational.length === 0) return null;
        return (
          <div className="flex items-start gap-2 p-2 rounded bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <span className="text-sm whitespace-pre-line">{operational.join('\n')}</span>
          </div>
        );
      })()}

      {/* Audio player */}
      {hasAudio && audioUrl && (
        <div>
          <p className="text-xs font-medium text-muted-foreground mb-1 flex items-center gap-1"><Volume2 className="w-3.5 h-3.5" />Sprachnachricht</p>
          <audio controls className="w-full h-8" preload="none">
            <source src={audioUrl} />
          </audio>
        </div>
      )}

      {/* Transcript */}
      {ctx.audioTranscript && (
        <div>
          <p className="text-xs font-medium text-muted-foreground mb-1">Transkript</p>
          <p className="text-sm bg-background p-2 rounded border whitespace-pre-line">{ctx.audioTranscript}</p>
        </div>
      )}

      {/* Images — gallery with prev/next switching */}
      {resolvedThumbs.length > 0 && (
        <ImageGallery thumbUrls={resolvedThumbs} fullUrls={resolvedImages} />
      )}
    </div>
  );
}
