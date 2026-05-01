import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { NextResponse } from 'next/server';
import { getEffectiveStatusForUserId } from '@/lib/account-status';

export async function getUserId(): Promise<string | null> {
  const session = await getServerSession(authOptions);
  return (session?.user as any)?.id || null;
}

export async function getUserRole(): Promise<string | null> {
  const session = await getServerSession(authOptions);
  return (session?.user as any)?.role || null;
}

export async function requireUserId(): Promise<string> {
  const userId = await getUserId();
  if (!userId) throw new Error('UNAUTHORIZED');
  // Block U — auch eine vorhandene Session muss bei jedem geschützten Request
  // gegen den DB-Status geprüft werden. So greift Sperrung sofort, auch bei
  // noch gültigem JWT. Wirft 'ACCOUNT_INACTIVE' damit Aufrufer gezielt einen
  // 403 zurückgeben können (siehe `accountInactiveResponse()`).
  const eff = await getEffectiveStatusForUserId(userId);
  if (!eff.canAccess) {
    const err: any = new Error('ACCOUNT_INACTIVE');
    err.code = 'ACCOUNT_INACTIVE';
    err.effectiveStatus = eff.status;
    err.reason = eff.reason;
    throw err;
  }
  return userId;
}

/**
 * Wie requireUserId, gibt aber zusätzlich keine Statusinfo aus. Praktisch für
 * Routes, die nur den Status checken wollen (z.B. Admin-Endpoints, die ihre
 * eigene Logik haben). Selten gebraucht.
 */
export async function requireUserIdAllowInactive(): Promise<string> {
  const userId = await getUserId();
  if (!userId) throw new Error('UNAUTHORIZED');
  return userId;
}

/** Standardisierte 403-Antwort für blockierte Accounts. */
export function accountInactiveResponse(message?: string) {
  return NextResponse.json(
    { error: message || 'Ihr Konto ist nicht mehr aktiv. Bitte kontaktieren Sie den Support.', code: 'ACCOUNT_INACTIVE' },
    { status: 403 },
  );
}

/** Hilfs-Wrapper für Catch-Blocks: behandelt UNAUTHORIZED + ACCOUNT_INACTIVE. */
export function handleAuthError(err: any) {
  if (err?.code === 'ACCOUNT_INACTIVE' || err?.message === 'ACCOUNT_INACTIVE') {
    return accountInactiveResponse();
  }
  return unauthorizedResponse();
}

export async function requireAdmin(): Promise<string> {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as any)?.id;
  const role = (session?.user as any)?.role;
  if (!userId) throw new Error('UNAUTHORIZED');
  if (role !== 'admin') throw new Error('FORBIDDEN');
  // Block U — auch ein Admin muss aktiv sein. Falls jemand einen Admin
  // anonymisiert/gesperrt hat, darf das alte JWT keine weiteren Admin-Aktionen
  // mehr durchführen.
  const eff = await getEffectiveStatusForUserId(userId);
  if (!eff.canAccess) {
    const err: any = new Error('ACCOUNT_INACTIVE');
    err.code = 'ACCOUNT_INACTIVE';
    err.effectiveStatus = eff.status;
    throw err;
  }
  return userId;
}

export function unauthorizedResponse() {
  return NextResponse.json({ error: 'Nicht autorisiert' }, { status: 401 });
}

export function forbiddenResponse() {
  return NextResponse.json({ error: 'Keine Berechtigung' }, { status: 403 });
}

/** Returns { id, email, role } from session or null if not logged in. Useful for audit logging. */
export async function getSessionUser(): Promise<{ id: string; email: string; role: string } | null> {
  const session = await getServerSession(authOptions);
  const id = (session?.user as any)?.id;
  if (!id) return null;
  return {
    id,
    email: session?.user?.email || '',
    role: (session?.user as any)?.role || 'user',
  };
}
