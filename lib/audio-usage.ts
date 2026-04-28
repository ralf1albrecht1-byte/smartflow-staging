/**
 * Stage I — Audio usage aggregation per user / calendar month.
 *
 * Reads `Order.audioDurationSec` + `Order.audioTranscriptionStatus` (both
 * additive nullable fields, see schema.prisma) and produces a small summary
 * for the dashboard card and per-order display.
 *
 * Scope: WhatsApp audio only. Telegram audio is intentionally NOT tracked
 * (see Stage I project notes). Orders without audio are ignored automatically
 * via the `audioDurationSec` filter — NULL / 0 rows do not contribute.
 *
 * Month boundaries:
 *   We use **server UTC** month boundaries. The user explicitly asked us not
 *   to maintain fragile manual DST logic for now — exact billing-grade month
 *   alignment will come with the Stripe integration. Drift across a CET/CEST
 *   month boundary is at most ~1–2 hours per row, which is acceptable for the
 *   pre-billing display.
 */
import { prisma } from '@/lib/prisma';

export interface AudioUsageRow {
  durationSec: number;
  // 'transcribed' | 'failed' | 'skipped_too_long' | 'skipped_uncheckable' | 'skipped_quota_exceeded' | null
  status: string | null;
}

export interface AudioUsageSummary {
  /** Total received audio minutes this month (rounded to 1 decimal). */
  receivedMinutes: number;
  /** Subset of receivedMinutes that was actually transcribed. */
  transcribedMinutes: number;
  /** Subset that hit the 60s cost cap and was NOT transcribed. */
  skippedMinutes: number;
  /** Subset where transcription pipeline failed despite ≤60s. */
  failedMinutes: number;
  /** Number of audio orders that contributed to this aggregation. */
  audioOrderCount: number;
  /** Window start (inclusive), UTC. */
  windowStartIso: string;
  /** Window end (exclusive), UTC. */
  windowEndIso: string;
  /** Timezone label for transparency in API responses. */
  windowTimezone: 'UTC';
}

function getCurrentUtcMonthWindow(now: Date = new Date()): { start: Date; end: Date } {
  // First day of the current UTC month at 00:00:00.000 UTC.
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
  // First day of the next UTC month at 00:00:00.000 UTC (exclusive end).
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0, 0));
  return { start, end };
}

/**
 * Aggregates this month's audio usage for the given user.
 *
 * Returns zeros for unknown users / no audio orders this month.
 * Always returns a fully-populated object — never null.
 */
export async function getMonthlyAudioUsage(userId: string | null | undefined): Promise<AudioUsageSummary> {
  const { start, end } = getCurrentUtcMonthWindow();
  const empty: AudioUsageSummary = {
    receivedMinutes: 0,
    transcribedMinutes: 0,
    skippedMinutes: 0,
    failedMinutes: 0,
    audioOrderCount: 0,
    windowStartIso: start.toISOString(),
    windowEndIso: end.toISOString(),
    windowTimezone: 'UTC',
  };

  if (!userId) return empty;

  // Pull only the two columns we aggregate over. We deliberately don't filter
  // by mediaType='audio' — the audioDurationSec NOT NULL filter is already
  // strong enough and avoids string-equality mistakes if mediaType ever shifts.
  // Including soft-deleted orders (deletedAt != null) is intentional: usage
  // counts "received" minutes for billing, regardless of whether the user
  // later moved the order to the trash.
  const rows = await prisma.order.findMany({
    where: {
      userId,
      audioDurationSec: { not: null },
      createdAt: { gte: start, lt: end },
    },
    select: {
      audioDurationSec: true,
      audioTranscriptionStatus: true,
    },
  });

  if (rows.length === 0) return empty;

  let receivedSec = 0;
  let transcribedSec = 0;
  let skippedSec = 0;
  let failedSec = 0;

  for (const r of rows) {
    const dur = typeof r.audioDurationSec === 'number' ? r.audioDurationSec : 0;
    if (dur <= 0) continue;
    receivedSec += dur;
    switch (r.audioTranscriptionStatus) {
      case 'transcribed':
        transcribedSec += dur;
        break;
      case 'skipped_too_long':
      case 'skipped_uncheckable':
      case 'skipped_quota_exceeded':
        skippedSec += dur;
        break;
      case 'failed':
        failedSec += dur;
        break;
      default:
        // Unknown / null status — still count as received but leave per-bucket alone.
        break;
    }
  }

  return {
    receivedMinutes: Math.round((receivedSec / 60) * 10) / 10,
    transcribedMinutes: Math.round((transcribedSec / 60) * 10) / 10,
    skippedMinutes: Math.round((skippedSec / 60) * 10) / 10,
    failedMinutes: Math.round((failedSec / 60) * 10) / 10,
    audioOrderCount: rows.length,
    windowStartIso: start.toISOString(),
    windowEndIso: end.toISOString(),
    windowTimezone: 'UTC',
  };
}

// Re-export client-safe formatter so existing server-side imports keep working.
export { formatAudioDuration } from '@/lib/audio-format';
