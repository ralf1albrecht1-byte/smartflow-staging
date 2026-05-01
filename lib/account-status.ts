/**
 * lib/account-status.ts — Block U: zentrale Logik für technischen Kontostatus.
 *
 * Dieses Modul ist DIE einzige Quelle, an der entschieden wird ob ein User
 * Zugang zur Anwendung haben darf. Es wird vom Login-Pre-Check
 * (`/api/auth/login`), von NextAuth `authorize()` (lib/auth.ts) und vom
 * Server-Layout (`app/(app)/layout.tsx`) benutzt. API-Routen, die
 * `requireUserId()` aufrufen, erhalten denselben Schutz über
 * `lib/get-session.ts`.
 *
 * Wichtige Invariante: ComplianceRequest.status (offen/in_progress/completed/
 * rejected) und User.accountStatus (active/cancelled/blocked/anonymized) sind
 * komplett getrennte Felder. Das Setzen eines Compliance-Status ändert NIE
 * automatisch den Account-Status — nur explizite Admin-Aktionen tun das.
 */
import { prisma } from '@/lib/prisma';
import { logAuditAsync, EVENTS, AREAS } from '@/lib/audit';

export type RawAccountStatus = 'active' | 'cancelled' | 'blocked' | 'anonymized';

export type EffectiveAccountStatus =
  | 'active'
  | 'cancelled_active'   // Kündigung mit accessEndsAt in der Zukunft → darf noch login
  | 'cancelled_expired'  // Kündigung mit accessEndsAt in der Vergangenheit → blockiert
  | 'blocked'
  | 'anonymized';

export interface AccountStatusUserShape {
  accountStatus?: string | null;
  accessEndsAt?: Date | string | null;
  blockedAt?: Date | string | null;
  blockedReason?: string | null;
  anonymizedAt?: Date | string | null;
}

/** Synchroner Status-Evaluator. Übergeben wird ein bereits geladener User. */
export function evaluateAccountStatus(
  user: AccountStatusUserShape | null | undefined,
  now: Date = new Date(),
): { status: EffectiveAccountStatus; canAccess: boolean; reason?: string } {
  if (!user) {
    return { status: 'blocked', canAccess: false, reason: 'user_not_found' };
  }
  // Reihenfolge: anonymized > blocked > expired > cancelled_active > active.
  if (user.anonymizedAt) {
    return { status: 'anonymized', canAccess: false, reason: 'anonymized' };
  }
  const raw = (user.accountStatus || 'active') as RawAccountStatus;
  if (raw === 'anonymized') {
    return { status: 'anonymized', canAccess: false, reason: 'anonymized' };
  }
  if (raw === 'blocked') {
    return { status: 'blocked', canAccess: false, reason: user.blockedReason || 'blocked' };
  }
  // accessEndsAt: wenn gesetzt und in der Vergangenheit → abgelaufen.
  if (user.accessEndsAt) {
    const end = user.accessEndsAt instanceof Date ? user.accessEndsAt : new Date(user.accessEndsAt);
    if (!isNaN(end.getTime()) && end.getTime() <= now.getTime()) {
      return { status: 'cancelled_expired', canAccess: false, reason: 'access_expired' };
    }
    // accessEndsAt in der Zukunft → noch erlaubt, aber als gekündigt markiert.
    return { status: 'cancelled_active', canAccess: true };
  }
  if (raw === 'cancelled') {
    // Gekündigt ohne accessEndsAt → sofort blockiert.
    return { status: 'cancelled_expired', canAccess: false, reason: 'cancelled_no_access_date' };
  }
  return { status: 'active', canAccess: true };
}

/** Deutsche User-facing Begründung für abgelehnten Zugang. */
export function germanReason(status: EffectiveAccountStatus, accessEndsAt?: Date | string | null): string {
  switch (status) {
    case 'blocked':
      return 'Ihr Konto wurde gesperrt. Bitte kontaktieren Sie den Support.';
    case 'anonymized':
      return 'Dieses Konto wurde anonymisiert und ist nicht mehr verfügbar.';
    case 'cancelled_expired':
      if (accessEndsAt) {
        try {
          const d = new Date(accessEndsAt as any);
          if (!isNaN(d.getTime())) {
            return `Ihr Zugang ist am ${d.toLocaleDateString('de-CH')} abgelaufen. Bitte kontaktieren Sie den Support.`;
          }
        } catch { /* ignore */ }
      }
      return 'Ihr Zugang wurde beendet. Bitte kontaktieren Sie den Support.';
    case 'cancelled_active':
      return 'Ihr Konto ist gekündigt, der Zugang endet in Kürze.';
    case 'active':
    default:
      return '';
  }
}

/**
 * Kompakter Maschinencode für Login-Pre-Check Antworten und URL-Param.
 */
export function statusCode(status: EffectiveAccountStatus): string {
  switch (status) {
    case 'blocked': return 'ACCOUNT_BLOCKED';
    case 'anonymized': return 'ACCOUNT_ANONYMIZED';
    case 'cancelled_expired': return 'ACCOUNT_EXPIRED';
    case 'cancelled_active': return 'ACCOUNT_CANCELLED_ACTIVE';
    default: return 'ACCOUNT_ACTIVE';
  }
}

/** Zusätzliche User-Felder, die wir für den Status-Check benötigen. */
export const ACCOUNT_STATUS_USER_SELECT = {
  accountStatus: true,
  accessEndsAt: true,
  blockedAt: true,
  blockedReason: true,
  anonymizedAt: true,
} as const;

/**
 * Liest den User aus der DB und wertet den Status aus. Wird vom Layout
 * und von `requireUserId` benutzt. Gibt null zurück wenn der User nicht
 * existiert (→ wie blocked behandeln).
 */
export async function getEffectiveStatusForUserId(userId: string): Promise<{
  status: EffectiveAccountStatus;
  canAccess: boolean;
  reason?: string;
  user: any | null;
}> {
  if (!userId) return { status: 'blocked', canAccess: false, reason: 'no_user_id', user: null };
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        ...ACCOUNT_STATUS_USER_SELECT,
      },
    });
    const eff = evaluateAccountStatus(user as any);
    return { ...eff, user };
  } catch (e) {
    // Im Fehlerfall NICHT aussperren — Layout/API entscheidet selbst.
    console.error('[account-status] DB lookup failed for user', userId, e);
    return { status: 'active', canAccess: true, user: null };
  }
}

/**
 * Audit-Helfer für abgelehnte Logins wegen Account-Status.
 * Wird sowohl vom Pre-Check (`/api/auth/login`) als auch von
 * NextAuth `authorize()` aufgerufen.
 */
export function auditLoginBlockedByStatus(opts: {
  userId?: string | null;
  email: string;
  status: EffectiveAccountStatus;
  reason?: string;
  request?: Request;
}) {
  logAuditAsync({
    userId: opts.userId || undefined,
    userEmail: opts.email,
    action: EVENTS.LOGIN_BLOCKED_BY_STATUS,
    area: AREAS.AUTH,
    success: false,
    details: {
      effectiveStatus: opts.status,
      reason: opts.reason || null,
    },
    request: opts.request,
  });
}

/**
 * Liefert true falls mindestens ein anderer aktiver Admin existiert. Wird
 * vor Block-/Anonymisierungs-Aktionen geprüft, damit nicht der letzte aktive
 * Admin gesperrt wird.
 */
export async function hasOtherActiveAdmin(targetUserId: string): Promise<boolean> {
  try {
    // Case-insensitive Vergleich falls Legacy-Daten 'ADMIN' verwenden.
    const count = await prisma.user.count({
      where: {
        id: { not: targetUserId },
        role: { equals: 'admin', mode: 'insensitive' },
        accountStatus: 'active',
        anonymizedAt: null,
      },
    });
    return count > 0;
  } catch (e) {
    console.error('[account-status] hasOtherActiveAdmin failed:', e);
    return false;
  }
}
