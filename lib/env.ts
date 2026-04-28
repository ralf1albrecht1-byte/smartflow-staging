/**
 * lib/env.ts — central environment-awareness helpers.
 *
 * Goal: Allow the same codebase to safely run in Production / Staging /
 * Development without leaking real customer emails, accidentally consuming
 * Twilio credit, or mixing data between environments.
 *
 * SAFETY CONTRACT (Phase 2):
 *   • If APP_ENV is missing or unrecognized → behave EXACTLY as Production.
 *     This guarantees the existing single-deployment Production at
 *     business-manager-ra.abacusai.app is never silently downgraded.
 *   • Email-sending: Production sends; Staging restricts to allowlist;
 *     Development blocks. All non-prod behaviour is OPT-IN via APP_ENV.
 *   • WhatsApp inbound: Production processes; non-prod can be disabled
 *     via WHATSAPP_INBOUND_ENABLED=false. Default keeps current behaviour.
 *
 * No code path imported here should change Production behaviour at runtime
 * unless `APP_ENV` is explicitly set to a non-production value.
 */

export type AppEnv = 'production' | 'staging' | 'development';

/**
 * Resolve the current app environment.
 *
 * Order of precedence:
 *   1. APP_ENV explicitly set to 'production' | 'staging' | 'development'
 *   2. Fallback → 'production' (safe-by-default)
 *
 * Note: We deliberately do NOT auto-derive from NODE_ENV. NODE_ENV is
 * controlled by Next.js / yarn build and would mark every developer build
 * as 'development' — which would disable email entirely. APP_ENV is an
 * explicit, ops-controlled flag.
 */
export function getAppEnv(): AppEnv {
  const raw = (process.env.APP_ENV || '').toLowerCase().trim();
  if (raw === 'staging') return 'staging';
  if (raw === 'development' || raw === 'dev') return 'development';
  // Anything else (including unset, '', 'production', 'prod', or unknown)
  // resolves to production — preserves current single-deployment behaviour.
  return 'production';
}

export function isProduction(): boolean {
  return getAppEnv() === 'production';
}

export function isStaging(): boolean {
  return getAppEnv() === 'staging';
}

export function isDevelopment(): boolean {
  return getAppEnv() === 'development';
}

/**
 * Display label for environment badge / debug headers.
 * Production returns null so no banner is rendered.
 */
export function getEnvLabel(): string | null {
  const env = getAppEnv();
  if (env === 'production') return null;
  if (env === 'staging') return 'STAGING';
  return 'DEVELOPMENT';
}

// ─────────────────────────────────────────────────────────────────────
// Email guard
// ─────────────────────────────────────────────────────────────────────

/**
 * Returns the comma-separated email allowlist for non-prod environments.
 * Only used when APP_ENV=staging. Trims, lowercases, deduplicates.
 */
function getEmailAllowlist(): Set<string> {
  const raw = process.env.EMAIL_ALLOWLIST || '';
  const list = raw
    .split(/[,;\s]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return new Set(list);
}

/**
 * Decide whether an email should actually be sent to `targetEmail`.
 *
 * Behaviour by environment:
 *   • production  → always true (preserves current behaviour)
 *   • staging     → true only if target is in EMAIL_ALLOWLIST
 *   • development → always false (no real emails leak from dev)
 *
 * Additional override: EMAIL_ENABLED=false hard-disables email everywhere
 * (useful for staging bring-up / load tests).
 *
 * IMPORTANT: With APP_ENV unset, this returns true for every recipient,
 * which preserves the current Production behaviour byte-for-byte.
 */
export function shouldSendEmail(targetEmail: string | null | undefined): boolean {
  // Hard kill-switch (opt-in). Default: not set → not active.
  if ((process.env.EMAIL_ENABLED || '').toLowerCase() === 'false') return false;

  const env = getAppEnv();
  if (env === 'production') return true;

  if (env === 'development') return false;

  // staging
  const target = (targetEmail || '').trim().toLowerCase();
  if (!target) return false;
  return getEmailAllowlist().has(target);
}

/**
 * Reason string for audit logs when an email is suppressed by the guard.
 * Returns null when no suppression should occur.
 */
export function getEmailSuppressionReason(targetEmail: string | null | undefined): string | null {
  if (shouldSendEmail(targetEmail)) return null;
  if ((process.env.EMAIL_ENABLED || '').toLowerCase() === 'false') return 'env_email_disabled';
  const env = getAppEnv();
  if (env === 'development') return 'env_development';
  if (env === 'staging') return 'env_staging_not_in_allowlist';
  return 'env_unknown';
}

// ─────────────────────────────────────────────────────────────────────
// WhatsApp inbound guard
// ─────────────────────────────────────────────────────────────────────

/**
 * Whether the WhatsApp/Twilio inbound webhook should process incoming
 * messages.
 *
 * Default behaviour:
 *   • production  → enabled (preserves current behaviour)
 *   • staging/dev → enabled UNLESS WHATSAPP_INBOUND_ENABLED=false is set
 *
 * The env var WHATSAPP_INBOUND_ENABLED takes precedence in all envs:
 *   • 'false' → disabled
 *   • 'true'  → enabled
 *   • unset   → defaults per env (above)
 *
 * IMPORTANT: With both APP_ENV and WHATSAPP_INBOUND_ENABLED unset, this
 * returns true — preserves current Production behaviour byte-for-byte.
 */
export function whatsappInboundEnabled(): boolean {
  const flag = (process.env.WHATSAPP_INBOUND_ENABLED || '').toLowerCase().trim();
  if (flag === 'false') return false;
  if (flag === 'true') return true;
  // No explicit flag — default to true in all envs to preserve current
  // Production behaviour. Operators must opt-out per-env when needed.
  return true;
}
