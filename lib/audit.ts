import { prisma } from '@/lib/prisma';

/**
 * lib/audit.ts — central audit logging.
 *
 * Block N adds:
 *   - explicit `userAgent`, `source`, `errorMessage` columns
 *   - exhaustive `EVENTS` constant so callers don't typo event names
 *   - safe `diffFields` helper for redacted previous/new value capture
 *   - exhaustive `AREAS` constant
 *   - automatic source detection from request headers
 *
 * Forbidden in any audit entry (per privacy block):
 *   - passwords, tokens, API keys, verification codes
 *   - full file contents, full audio/image binaries
 *   - any sensitive payload Prisma might leak via error messages
 */

export interface AuditEntry {
  userId?: string | null;
  userEmail?: string | null;
  userRole?: string | null;
  action: string;
  area: string;
  targetType?: string;
  targetId?: string;
  success?: boolean;
  details?: Record<string, any>;
  errorMessage?: string | null;
  source?: AuditSource | null;
  request?: Request;
}

export type AuditSource = 'web' | 'pwa' | 'api' | 'whatsapp' | 'telegram' | 'system';

/** Areas — used by the admin filter dropdown. Extend deliberately. */
export const AREAS = {
  AUTH: 'AUTH',
  CUSTOMERS: 'CUSTOMERS',
  ORDERS: 'ORDERS',
  OFFERS: 'OFFERS',
  INVOICES: 'INVOICES',
  SERVICES: 'SERVICES',
  SETTINGS: 'SETTINGS',
  UPLOAD: 'UPLOAD',
  ACCOUNT: 'ACCOUNT',
  PAPIERKORB: 'PAPIERKORB',
  WEBHOOK: 'WEBHOOK',
  PDF: 'PDF',
  COMPLIANCE: 'COMPLIANCE',
  ADMIN: 'ADMIN',
  SECURITY: 'SECURITY',
} as const;
export type AuditArea = typeof AREAS[keyof typeof AREAS];

/**
 * Canonical event names. Use `EVENTS.X` instead of magic strings so the
 * compiler catches typos.
 *
 * NOTE: legacy short names (e.g. 'LOGIN', 'CUSTOMER_CREATE') are kept as
 * aliases so existing rows in production keep matching the filter.
 */
export const EVENTS = {
  // ── Authentication ──
  LOGIN: 'LOGIN',
  LOGIN_SUCCESS: 'LOGIN_SUCCESS',
  LOGIN_FAILED: 'LOGIN_FAILED',
  LOGOUT: 'LOGOUT',
  SIGNUP: 'SIGNUP',
  EMAIL_VERIFIED: 'EMAIL_VERIFIED',
  PASSWORD_RESET_REQUESTED: 'PASSWORD_RESET_REQUEST',
  PASSWORD_RESET_COMPLETED: 'PASSWORD_RESET',
  PASSWORD_CHANGE: 'PASSWORD_CHANGE',
  SESSION_EXPIRED: 'SESSION_EXPIRED',

  // ── Customers ──
  CUSTOMER_CREATED: 'CUSTOMER_CREATE',
  CUSTOMER_UPDATED: 'CUSTOMER_UPDATE',
  CUSTOMER_DELETED: 'CUSTOMER_DELETE',
  CUSTOMER_ARCHIVED: 'CUSTOMER_ARCHIVED',
  CUSTOMER_RESTORED: 'CUSTOMER_RESTORED',
  CUSTOMER_FIELDS_CLEARED: 'CUSTOMER_FIELDS_CLEARED',
  CUSTOMER_UPDATE_REJECTED: 'CUSTOMER_UPDATE_REJECTED',
  DUPLICATE_MERGED: 'DUPLICATE_MERGED',
  MERGE_UNDONE: 'MERGE_UNDONE',

  // ── Orders ──
  ORDER_CREATED: 'ORDER_CREATE',
  ORDER_UPDATED: 'ORDER_UPDATE',
  ORDER_DELETED: 'ORDER_DELETE',
  ORDER_REVIEW_CLEARED: 'ORDER_REVIEW_CLEARED',

  // ── Offers / Angebote ──
  OFFER_CREATED: 'OFFER_CREATE',
  OFFER_UPDATED: 'OFFER_UPDATE',
  OFFER_DELETED: 'OFFER_DELETE',
  OFFER_CONVERTED_TO_INVOICE: 'OFFER_CONVERTED_TO_INVOICE',
  OFFER_PDF_GENERATED: 'OFFER_PDF_GENERATED',
  OFFER_PDF_DOWNLOADED: 'OFFER_PDF_DOWNLOADED',
  OFFER_PDF_SENT_TO_BUSINESS_WHATSAPP: 'OFFER_PDF_SENT_TO_BUSINESS_WHATSAPP',
  OFFER_PDF_TWILIO_SENT: 'OFFER_PDF_TWILIO_SENT',
  OFFER_PDF_TWILIO_FAILED: 'OFFER_PDF_TWILIO_FAILED',

  // ── Invoices / Rechnungen ──
  INVOICE_CREATED: 'INVOICE_CREATE',
  INVOICE_UPDATED: 'INVOICE_UPDATE',
  INVOICE_ARCHIVED: 'INVOICE_ARCHIVED',
  INVOICE_DELETED: 'INVOICE_DELETE',
  ARCHIVED_INVOICE_DELETED: 'ARCHIVED_INVOICE_DELETED',
  INVOICE_PDF_GENERATED: 'INVOICE_PDF_GENERATED',
  INVOICE_PDF_DOWNLOADED: 'INVOICE_PDF_DOWNLOADED',
  INVOICE_PDF_SENT_TO_BUSINESS_WHATSAPP: 'INVOICE_PDF_SENT_TO_BUSINESS_WHATSAPP',
  INVOICE_PDF_TWILIO_SENT: 'INVOICE_PDF_TWILIO_SENT',
  INVOICE_PDF_TWILIO_FAILED: 'INVOICE_PDF_TWILIO_FAILED',

  // ── Services / Leistungen ──
  SERVICE_CREATED: 'SERVICE_CREATE',
  SERVICE_UPDATED: 'SERVICE_UPDATE',
  SERVICE_DELETED: 'SERVICE_DELETE',

  // ── WhatsApp / Communication / Intake ──
  WHATSAPP_MESSAGE_RECEIVED: 'WHATSAPP_MESSAGE_RECEIVED',
  WHATSAPP_IMAGE_RECEIVED: 'WHATSAPP_IMAGE_RECEIVED',
  WHATSAPP_AUDIO_RECEIVED: 'WHATSAPP_AUDIO_RECEIVED',
  AUDIO_TRANSCRIBED: 'AUDIO_TRANSCRIBED',
  AUDIO_SKIPPED_TOO_LONG: 'AUDIO_SKIPPED_TOO_LONG',
  AUDIO_SKIPPED_QUOTA_EXCEEDED: 'AUDIO_SKIPPED_QUOTA_EXCEEDED',
  AUDIO_QUOTA_CHECK_FAILED: 'AUDIO_QUOTA_CHECK_FAILED',
  IMAGE_PROCESSED: 'IMAGE_PROCESSED',
  IMAGE_SKIPPED_OR_FAILED: 'IMAGE_SKIPPED_OR_FAILED',
  LLM_EXTRACTION_STARTED: 'LLM_EXTRACTION_STARTED',
  LLM_EXTRACTION_COMPLETED: 'LLM_EXTRACTION_COMPLETED',
  LLM_EXTRACTION_FAILED: 'LLM_EXTRACTION_FAILED',
  PHONE_MAPPING_SUCCESS: 'PHONE_MAPPING_SUCCESS',
  PHONE_MAPPING_FAILED: 'PHONE_MAPPING_FAILED',

  // ── Settings / Company ──
  SETTINGS_UPDATED: 'SETTINGS_UPDATE',
  COMPANY_PROFILE_UPDATED: 'COMPANY_PROFILE_UPDATED',
  WHATSAPP_INTAKE_NUMBER_UPDATED: 'WHATSAPP_INTAKE_NUMBER_UPDATED',
  VAT_SETTINGS_UPDATED: 'VAT_SETTINGS_UPDATED',
  LETTERHEAD_SETTINGS_UPDATED: 'LETTERHEAD_SETTINGS_UPDATED',

  // ── Privacy / Account / Compliance ──
  ACCOUNT_DELETE: 'ACCOUNT_DELETE',
  DATA_EXPORT_REQUESTED: 'DATA_EXPORT_REQUESTED',
  // Block T — admin-initiated export package events (data_export requests).
  // PREPARED: ZIP successfully built and downloaded by an admin.
  // PREPARE_FAILED: ZIP build raised an error (logged with errorMessage).
  // The request itself is NOT auto-completed; admin manually marks it
  // completed once the export has been delivered to the customer.
  DATA_EXPORT_PREPARED: 'DATA_EXPORT_PREPARED',
  DATA_EXPORT_PREPARE_FAILED: 'DATA_EXPORT_PREPARE_FAILED',
  DATA_EXPORT_COMPLETED: 'DATA_EXPORT_COMPLETED',
  DATA_DELETION_REQUESTED: 'DATA_DELETION_REQUESTED',
  DATA_DELETION_COMPLETED: 'DATA_DELETION_COMPLETED',
  ACCOUNT_CANCELLATION_REQUESTED: 'ACCOUNT_CANCELLATION_REQUESTED',
  ACCOUNT_CANCELLED: 'ACCOUNT_CANCELLED',
  // ── Block U: Technical account access control (separate from compliance request status) ──
  ACCOUNT_ACCESS_END_SET: 'ACCOUNT_ACCESS_END_SET',
  ACCOUNT_ACCESS_END_CLEARED: 'ACCOUNT_ACCESS_END_CLEARED',
  ACCOUNT_BLOCKED: 'ACCOUNT_BLOCKED',
  ACCOUNT_REACTIVATED: 'ACCOUNT_REACTIVATED',
  ACCOUNT_ANONYMIZATION_STARTED: 'ACCOUNT_ANONYMIZATION_STARTED',
  ACCOUNT_ANONYMIZATION_COMPLETED: 'ACCOUNT_ANONYMIZATION_COMPLETED',
  ACCOUNT_ANONYMIZATION_FAILED: 'ACCOUNT_ANONYMIZATION_FAILED',
  LOGIN_BLOCKED_BY_STATUS: 'LOGIN_BLOCKED_BY_STATUS',
  COMPLIANCE_DELETION_COMPLETION_BLOCKED: 'COMPLIANCE_DELETION_COMPLETION_BLOCKED',
  AVV_ACCEPTED: 'AVV_ACCEPTED',
  PRIVACY_POLICY_ACCEPTED: 'PRIVACY_POLICY_ACCEPTED',
  TERMS_ACCEPTED: 'TERMS_ACCEPTED',
  // Phase 4 — Legal re-acceptance (versioned). Logged once per re-acceptance
  // submission whenever the user re-accepts at least one outdated/missing
  // document via /onboarding/compliance. The per-document events above
  // (TERMS_ACCEPTED / PRIVACY_POLICY_ACCEPTED / AVV_ACCEPTED) are still
  // logged in addition for backward-compatible filters.
  USER_REACCEPTED_LEGAL: 'USER_REACCEPTED_LEGAL',
  COMPLIANCE_REQUEST_CREATED: 'COMPLIANCE_REQUEST_CREATED',
  COMPLIANCE_REQUEST_UPDATED: 'COMPLIANCE_REQUEST_UPDATED',
  COMPLIANCE_REQUEST_STATUS_UPDATED: 'COMPLIANCE_REQUEST_STATUS_UPDATED',
  COMPLIANCE_REQUEST_NOTE_UPDATED: 'COMPLIANCE_REQUEST_NOTE_UPDATED',
  COMPLIANCE_REQUEST_DUPLICATE_BLOCKED: 'COMPLIANCE_REQUEST_DUPLICATE_BLOCKED',
  COMPLIANCE_REQUEST_EMAIL_SENT: 'COMPLIANCE_REQUEST_EMAIL_SENT',
  COMPLIANCE_REQUEST_EMAIL_FAILED: 'COMPLIANCE_REQUEST_EMAIL_FAILED',
  // Block T-fix — Bestätigungsmail an den anfragenden Nutzer (zusätzlich zur Admin-Mail).
  COMPLIANCE_REQUEST_USER_CONFIRMATION_SENT: 'COMPLIANCE_REQUEST_USER_CONFIRMATION_SENT',
  COMPLIANCE_REQUEST_USER_CONFIRMATION_FAILED: 'COMPLIANCE_REQUEST_USER_CONFIRMATION_FAILED',
  // Block T-auto — Automatische Datenexport-Pipeline.
  // GENERATION_STARTED:    ZIP-Build im POST-Handler hat begonnen.
  // GENERATION_FAILED:     ZIP-Build oder S3-Upload sind fehlgeschlagen.
  // READY_EMAIL_SENT:      "Dein Export ist bereit"-Mail wurde an den User versandt.
  // DOWNLOADED:            Owner (oder Admin) hat den Export erfolgreich heruntergeladen.
  // DOWNLOAD_DENIED:       Anderer User versuchte den Download (401/403/404 Pfad).
  // EXPIRED:               Download-Versuch nach Ablauf der 72h-Frist (410 Gone).
  DATA_EXPORT_GENERATION_STARTED: 'DATA_EXPORT_GENERATION_STARTED',
  DATA_EXPORT_GENERATION_FAILED: 'DATA_EXPORT_GENERATION_FAILED',
  DATA_EXPORT_READY_EMAIL_SENT: 'DATA_EXPORT_READY_EMAIL_SENT',
  DATA_EXPORT_READY_EMAIL_FAILED: 'DATA_EXPORT_READY_EMAIL_FAILED',
  DATA_EXPORT_DOWNLOADED: 'DATA_EXPORT_DOWNLOADED',
  DATA_EXPORT_DOWNLOAD_DENIED: 'DATA_EXPORT_DOWNLOAD_DENIED',
  DATA_EXPORT_EXPIRED: 'DATA_EXPORT_EXPIRED',

  // ── Tester / Trial management (Phase 3 — soft-only, no blocking) ──
  USER_TRIAL_SET: 'USER_TRIAL_SET',
  USER_TRIAL_CLEARED: 'USER_TRIAL_CLEARED',

  // ── Environment guards (Phase 2 prep) ──
  EMAIL_SUPPRESSED_BY_ENV: 'EMAIL_SUPPRESSED_BY_ENV',
  WHATSAPP_INBOUND_SKIPPED_BY_ENV: 'WHATSAPP_INBOUND_SKIPPED_BY_ENV',

  // ── Security / File access ──
  FILE_ACCESS_DENIED: 'FILE_ACCESS_DENIED',
} as const;
export type AuditEvent = typeof EVENTS[keyof typeof EVENTS];

function headerOrNull(req: Request | undefined, name: string): string | null {
  if (!req) return null;
  const v = req.headers.get(name);
  return v ? v.trim() : null;
}

function getIp(request?: Request): string | null {
  if (!request) return null;
  const xff = request.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0]?.trim() || null;
  return request.headers.get('x-real-ip') || null;
}

function getUserAgent(request?: Request): string | null {
  const ua = headerOrNull(request, 'user-agent');
  if (!ua) return null;
  // Truncate to keep audit rows lean.
  return ua.length > 280 ? ua.slice(0, 280) : ua;
}

/**
 * Best-effort source detection from request headers. Falls back to 'api'
 * for server-to-server calls without a UA, and 'system' if no request.
 */
function detectSource(request: Request | undefined, override: AuditSource | null | undefined): AuditSource {
  if (override) return override;
  if (!request) return 'system';
  const ua = headerOrNull(request, 'user-agent') || '';
  // Twilio webhook UA contains 'TwilioProxy'.
  if (/Twilio/i.test(ua)) return 'whatsapp';
  // Telegram bot calls don't carry a browser UA — fall back to 'telegram'
  // only when explicitly tagged via a custom header.
  if (headerOrNull(request, 'x-telegram-bot-api-secret-token')) return 'telegram';
  // Standalone PWA installs send a hint header from our service worker
  // (`x-pwa: 1`). Keep optional — never required.
  if (headerOrNull(request, 'x-pwa') === '1') return 'pwa';
  if (ua) return 'web';
  return 'api';
}

/** A handful of keys we never want to store, even if a caller passes them. */
const FORBIDDEN_DETAIL_KEYS = new Set([
  'password', 'newPassword', 'oldPassword', 'currentPassword',
  'token', 'accessToken', 'refreshToken', 'apiKey', 'secret',
  'verificationCode', 'otp',
  // sensitive media payloads
  'audioBuffer', 'imageBuffer', 'fileBuffer', 'rawBody',
]);

function sanitizeDetails(details?: Record<string, any>): Record<string, any> | undefined {
  if (!details) return undefined;
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(details)) {
    if (FORBIDDEN_DETAIL_KEYS.has(k)) continue;
    // Drop very large strings (>2 KB) — likely a body / file content.
    if (typeof v === 'string' && v.length > 2048) {
      out[k] = `${v.slice(0, 2048)}…[truncated ${v.length - 2048} chars]`;
      continue;
    }
    out[k] = v;
  }
  return out;
}

/**
 * Compute a redacted before/after diff for change tracking. Only fields
 * that actually changed are kept; sensitive-looking keys are stripped.
 * Long strings are truncated.
 */
export function diffFields(
  prev: Record<string, any> | null | undefined,
  next: Record<string, any> | null | undefined,
  watchedKeys: string[],
): { changed: string[]; before: Record<string, any>; after: Record<string, any> } {
  const changed: string[] = [];
  const before: Record<string, any> = {};
  const after: Record<string, any> = {};
  for (const k of watchedKeys) {
    if (FORBIDDEN_DETAIL_KEYS.has(k)) continue;
    const a = prev?.[k];
    const b = next?.[k];
    if (a === b) continue;
    if (a == null && b == null) continue;
    if (typeof a === 'object' && typeof b === 'object' && JSON.stringify(a) === JSON.stringify(b)) continue;
    changed.push(k);
    before[k] = typeof a === 'string' && a.length > 200 ? a.slice(0, 200) + '…' : a ?? null;
    after[k]  = typeof b === 'string' && b.length > 200 ? b.slice(0, 200) + '…' : b ?? null;
  }
  return { changed, before, after };
}

/**
 * Fire-and-forget audit log. Never throws — errors are caught and logged to console.
 * This ensures audit logging never breaks the main application flow.
 */
export async function logAudit(entry: AuditEntry): Promise<void> {
  try {
    const sanitizedDetails = sanitizeDetails(entry.details);
    await prisma.auditLog.create({
      data: {
        userId: entry.userId || null,
        userEmail: entry.userEmail || null,
        userRole: entry.userRole || null,
        action: entry.action,
        area: entry.area,
        targetType: entry.targetType || null,
        targetId: entry.targetId || null,
        success: entry.success ?? true,
        details: sanitizedDetails ? JSON.stringify(sanitizedDetails) : null,
        ipAddress: getIp(entry.request),
        userAgent: getUserAgent(entry.request),
        source: detectSource(entry.request, entry.source),
        errorMessage: entry.errorMessage ? entry.errorMessage.slice(0, 500) : null,
      },
    });
  } catch (error) {
    console.error('Audit log error (non-blocking):', error);
  }
}

// Convenience: log without awaiting (truly fire-and-forget)
export function logAuditAsync(entry: AuditEntry): void {
  logAudit(entry).catch(() => {});
}
