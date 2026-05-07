/**
 * lib/env.ts — central environment-awareness helpers.
 *
 * Goal: Allow the same codebase to safely run in Production / Staging /
 * Development without accidentally consuming Twilio credit or mixing data
 * between environments.
 *
 * Current rule:
 *   • If APP_ENV is missing or unrecognized → behave as Production.
 *   • Email sending is controlled by EMAIL_ENABLED.
 *   • EMAIL_ALLOWLIST is optional. If it is empty/missing, emails are allowed.
 *   • If EMAIL_ALLOWLIST is set, only listed recipients are allowed.
 *
 * This keeps TEST and STAGING behaviour aligned.
 */

export type AppEnv = 'production' | 'staging' | 'development';

export function getAppEnv(): AppEnv {
  const raw = (process.env.APP_ENV || '').toLowerCase().trim();

  if (raw === 'staging') return 'staging';
  if (raw === 'development' || raw === 'dev') return 'development';

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

export function getEnvLabel(): string | null {
  const env = getAppEnv();

  if (env === 'production') return null;
  if (env === 'staging') return 'STAGING';

  return 'DEVELOPMENT';
}

// ─────────────────────────────────────────────────────────────────────
// Email guard
// ─────────────────────────────────────────────────────────────────────

function emailEnabled(): boolean {
  const raw = (process.env.EMAIL_ENABLED || '').toLowerCase().trim();

  return raw === 'true';
}

function getEmailAllowlist(): Set<string> {
  const raw = process.env.EMAIL_ALLOWLIST || '';

  const list = raw
    .split(/[,;\s]+/)
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);

  return new Set(list);
}

/**
 * Decide whether an email should actually be sent to `targetEmail`.
 *
 * Behaviour:
 *   • EMAIL_ENABLED=false/missing → no emails
 *   • EMAIL_ENABLED=true + EMAIL_ALLOWLIST empty/missing → all recipients allowed
 *   • EMAIL_ENABLED=true + EMAIL_ALLOWLIST set → only listed recipients allowed
 *
 * This avoids different TEST/STAGING behaviour and removes the old hardcoded
 * "staging must be allowlisted" rule.
 */
export function shouldSendEmail(targetEmail: string | null | undefined): boolean {
  if (!emailEnabled()) return false;

  const target = (targetEmail || '').trim().toLowerCase();

  if (!target) return false;

  const allowlist = getEmailAllowlist();

  if (allowlist.size === 0) return true;

  return allowlist.has(target);
}

/**
 * Reason string for audit/logs when an email is suppressed by the guard.
 * Returns null when no suppression should occur.
 */
export function getEmailSuppressionReason(targetEmail: string | null | undefined): string | null {
  if (shouldSendEmail(targetEmail)) return null;

  if (!emailEnabled()) return 'env_email_disabled';

  const target = (targetEmail || '').trim().toLowerCase();

  if (!target) return 'missing_target_email';

  const allowlist = getEmailAllowlist();

  if (allowlist.size > 0 && !allowlist.has(target)) {
    return 'email_not_in_allowlist';
  }

  return 'email_suppressed';
}

// ─────────────────────────────────────────────────────────────────────
// WhatsApp inbound guard
// ─────────────────────────────────────────────────────────────────────

export function whatsappInboundEnabled(): boolean {
  const flag = (process.env.WHATSAPP_INBOUND_ENABLED || '').toLowerCase().trim();

  if (flag === 'false') return false;
  if (flag === 'true') return true;

  return true;
}