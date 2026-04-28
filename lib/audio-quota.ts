/**
 * Stage K — Server-side audio transcription quota enforcement.
 *
 * Reads the user's current monthly usage and active plan, and decides whether
 * a new audio of `audioDurationSec` should be transcribed or blocked.
 *
 * FAIL-SAFE rules (cost protection):
 *   - missing userId          → block (`reason: 'no_user'`)
 *   - missing/invalid duration → block (`reason: 'quota_unknown'`)
 *   - usage/plan lookup throws → block (`reason: 'quota_unknown'`)
 *   - used + new > included    → block (`reason: 'quota_exceeded'`)
 *   - otherwise                → allow  (`reason: 'within_quota'`)
 *
 * The caller is responsible for handling a `false` decision by creating a
 * manual-review order without transcribing the audio (and without calling
 * the LLM intake pipeline). See lib/order-intake.ts → createVoiceTooLongReviewOrder.
 *
 * Scope mirrors lib/audio-usage.ts: only audio orders attached to the same
 * user are considered. We never aggregate across users / globally.
 */
import { getMonthlyAudioUsage } from '@/lib/audio-usage';
import { getCurrentPlan } from '@/lib/plan';
import { logAuditAsync } from '@/lib/audit';

export type QuotaCheckReason =
  | 'within_quota'
  | 'quota_exceeded'
  | 'quota_unknown'
  | 'no_user';

export interface AudioQuotaCheck {
  /** True iff transcription is allowed within the current monthly cap. */
  allowTranscription: boolean;
  /** Why the decision was made (machine-readable). */
  reason: QuotaCheckReason;
  /** Already-used audio minutes this month (rounded to 1 decimal). */
  usedMinutes: number;
  /** Plan-included audio minutes this month. */
  includedMinutes: number;
  /** Remaining minutes before this audio is added (>=0). */
  remainingMinutes: number;
  /** This audio's duration in minutes (0 when unknown). */
  audioDurationMinutes: number;
}

/**
 * Server-side gate for audio transcription. NEVER throws — always returns a
 * decision object. On unexpected failures, defaults to a fail-safe block.
 */
export async function checkAudioTranscriptionQuota(
  userId: string | null | undefined,
  audioDurationSec: number | null | undefined,
): Promise<AudioQuotaCheck> {
  if (!userId) {
    return {
      allowTranscription: false,
      reason: 'no_user',
      usedMinutes: 0,
      includedMinutes: 0,
      remainingMinutes: 0,
      audioDurationMinutes: 0,
    };
  }

  if (
    typeof audioDurationSec !== 'number' ||
    !isFinite(audioDurationSec) ||
    audioDurationSec <= 0
  ) {
    // Duration unknown → fail-safe: do NOT transcribe.
    logAuditAsync({
      userId,
      action: 'AUDIO_QUOTA_CHECK_UNKNOWN_DURATION',
      area: 'WEBHOOK',
      success: false,
      details: { audioDurationSec: audioDurationSec ?? null },
    });
    return {
      allowTranscription: false,
      reason: 'quota_unknown',
      usedMinutes: 0,
      includedMinutes: 0,
      remainingMinutes: 0,
      audioDurationMinutes: 0,
    };
  }

  try {
    const [usage, plan] = await Promise.all([
      getMonthlyAudioUsage(userId),
      getCurrentPlan(userId),
    ]);

    const audioMinutes = audioDurationSec / 60;
    const usedMinutes = usage.receivedMinutes;
    const includedMinutes = plan.includedMinutes;
    const remainingMinutes = Math.max(0, includedMinutes - usedMinutes);

    if (usedMinutes + audioMinutes > includedMinutes) {
      logAuditAsync({
        userId,
        action: 'AUDIO_QUOTA_BLOCKED',
        area: 'WEBHOOK',
        success: false,
        details: {
          reason: 'quota_exceeded',
          usedMinutes,
          includedMinutes,
          audioMinutes: Math.round(audioMinutes * 10) / 10,
          plan: plan.name,
        },
      });
      return {
        allowTranscription: false,
        reason: 'quota_exceeded',
        usedMinutes,
        includedMinutes,
        remainingMinutes,
        audioDurationMinutes: audioMinutes,
      };
    }

    return {
      allowTranscription: true,
      reason: 'within_quota',
      usedMinutes,
      includedMinutes,
      remainingMinutes,
      audioDurationMinutes: audioMinutes,
    };
  } catch (err: any) {
    // Lookup failed → fail-safe block (cost protection demands it).
    console.error('[AudioQuota] Failed to fetch usage/plan — fail-safe block:', err?.message || err);
    logAuditAsync({
      userId,
      action: 'AUDIO_QUOTA_CHECK_FAILED',
      area: 'WEBHOOK',
      success: false,
      details: {
        error: err?.message || String(err),
        audioDurationSec,
      },
    });
    return {
      allowTranscription: false,
      reason: 'quota_unknown',
      usedMinutes: 0,
      includedMinutes: 0,
      remainingMinutes: 0,
      audioDurationMinutes: 0,
    };
  }
}
