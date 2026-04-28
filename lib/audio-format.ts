/**
 * Stage I — Client-safe audio formatting helpers.
 *
 * This file contains NO server-only imports (no Prisma, no `next/server`),
 * so it can be imported from both client and server components without
 * pulling Prisma into the browser bundle.
 */

/**
 * Formats a duration in seconds as `m:ss` (e.g. 38 -> "0:38", 84 -> "1:24").
 * Used by the per-order audio info display.
 */
export function formatAudioDuration(durationSec: number | null | undefined): string {
  if (typeof durationSec !== 'number' || !isFinite(durationSec) || durationSec < 0) return '–';
  const total = Math.round(durationSec);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}
