import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import AppSidebar from '@/components/app-sidebar';
import TrialBanner from '@/components/trial-banner';
import AccountStatusGuard from '@/components/account-status-guard';
import Link from 'next/link';
import { computeConsentStatus, needsReAcceptance } from '@/lib/legal-versions';
import { evaluateAccountStatus, statusCode } from '@/lib/account-status';

export const dynamic = 'force-dynamic';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');

  // Block P + Phase 4 (Re-acceptance) — Compliance gate.
  // Authenticated users must have a CURRENT ConsentRecord for all three
  // required documents (terms / privacy / avv). The latest accepted row
  // per documentType is compared against the CURRENT_*_VERSION constants
  // in lib/legal-versions.ts. If any document is MISSING or OUTDATED,
  // the user is redirected to /onboarding/compliance. Login/auth flow is
  // never interrupted; only protected app pages are gated.
  const userId = (session as any)?.user?.id;

  // Block U — technischer Account-Status. Wir lesen den User frisch aus der DB,
  // damit Sperren/Anonymisierung beim NÄCHSTEN Request greifen, auch wenn der
  // Browser noch ein gültiges JWT hat. Wenn der User nicht (mehr) aktiv ist,
  // werfen wir die Session weg via `/api/auth/signout` und leiten zum Login.
  if (userId) {
    try {
      const u = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          accountStatus: true,
          accessEndsAt: true,
          blockedAt: true,
          blockedReason: true,
          anonymizedAt: true,
        },
      });
      const eff = evaluateAccountStatus(u as any);
      if (!eff.canAccess) {
        // Cookies löschen, damit das alte JWT nicht weiter genutzt werden kann.
        // NextAuth speichert den Session-Token unter `next-auth.session-token`
        // (HTTP) bzw. `__Secure-next-auth.session-token` (HTTPS). Beide sicher
        // entfernen.
        try {
          const c = cookies();
          c.delete('next-auth.session-token');
          c.delete('__Secure-next-auth.session-token');
          c.delete('next-auth.csrf-token');
          c.delete('__Host-next-auth.csrf-token');
          c.delete('next-auth.callback-url');
          c.delete('__Secure-next-auth.callback-url');
        } catch { /* ignore */ }
        redirect(`/login?error=account_inactive&code=${statusCode(eff.status)}`);
      }
    } catch (e: any) {
      if (e?.digest && String(e.digest).startsWith('NEXT_REDIRECT')) throw e;
      console.error('[account-status-gate] DB lookup failed:', e);
    }
  }

  if (userId) {
    try {
      const records = await prisma.consentRecord.findMany({
        where: { userId },
        select: { documentType: true, documentVersion: true, acceptedAt: true },
        orderBy: { acceptedAt: 'desc' },
      });
      const status = computeConsentStatus(records as any);
      if (needsReAcceptance(status)) {
        redirect('/onboarding/compliance');
      }
    } catch (e: any) {
      // Re-throw NEXT_REDIRECT so Next.js can perform the redirect.
      if (e?.digest && String(e.digest).startsWith('NEXT_REDIRECT')) throw e;
      // For DB errors here we let the user through rather than locking them out
      // (the gate is defence-in-depth on top of the form-level enforcement).
      console.error('[compliance-gate] consent lookup failed:', e);
    }
  }

  return (
    <div className="flex min-h-screen bg-background">
      <AccountStatusGuard />
      <AppSidebar />
      <main className="flex-1 flex flex-col p-4 lg:p-8 pt-16 lg:pt-8 overflow-x-hidden">
        <div className="max-w-[1200px] mx-auto flex-1 w-full">
          <TrialBanner />
          {children}
        </div>
        <footer className="max-w-[1200px] mx-auto w-full mt-12 pt-4 border-t border-border/40">
          <div className="flex items-center justify-end gap-4 text-xs text-muted-foreground">
            <Link href="/agb" target="_blank" className="hover:text-foreground transition-colors">AGB</Link>
            <Link href="/datenschutz" target="_blank" className="hover:text-foreground transition-colors">Datenschutz</Link>
            <Link href="/avv" target="_blank" className="hover:text-foreground transition-colors">AVV</Link>
            <Link href="/unterauftragnehmer" target="_blank" className="hover:text-foreground transition-colors">Unterauftragnehmer</Link>
          </div>
        </footer>
      </main>
    </div>
  );
}
