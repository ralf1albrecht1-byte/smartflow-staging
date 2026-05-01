'use client';

import { useSession } from 'next-auth/react';
import { AlertTriangle, Info, XCircle } from 'lucide-react';

export default function TrialBanner() {
  const { data: session } = useSession() || {};
  const accountStatus = (session?.user as any)?.accountStatus as string | null | undefined;
  const trialStartRaw = (session?.user as any)?.trialStart as string | null | undefined;
  const trialEndDateRaw = (session?.user as any)?.trialEndDate as string | null | undefined;

  if (accountStatus === 'blocked') {
    return (
      <div
        role="alert"
        className="mb-4 flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200"
      >
        <XCircle className="w-5 h-5 mt-0.5 flex-shrink-0" />
        <div>
          <div className="font-medium">Account gesperrt</div>
          <div className="mt-0.5 text-red-800/90 dark:text-red-300/90">Account gesperrt – bitte kontaktieren</div>
        </div>
      </div>
    );
  }

  if (!trialEndDateRaw || accountStatus !== 'trial') return null;

  const trialEnd = new Date(trialEndDateRaw);
  if (Number.isNaN(trialEnd.getTime())) return null;

  const trialStart = trialStartRaw ? new Date(trialStartRaw) : null;
  const now = new Date();
  const msPerDay = 24 * 60 * 60 * 1000;
  const endOfDay = new Date(trialEnd);
  endOfDay.setHours(23, 59, 59, 999);
  const diffDays = Math.ceil((endOfDay.getTime() - now.getTime()) / msPerDay);

  const dateStr = trialEnd.toLocaleDateString('de-CH', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });

  const trialStartStr = trialStart && !Number.isNaN(trialStart.getTime())
    ? trialStart.toLocaleDateString('de-CH', { day: '2-digit', month: '2-digit', year: 'numeric' })
    : null;

  if (diffDays < 0) {
    return (
      <div
        role="alert"
        className="mb-4 flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200"
      >
        <XCircle className="w-5 h-5 mt-0.5 flex-shrink-0" />
        <div>
          <div className="font-medium">Testzugang abgelaufen am {dateStr}</div>
          <div className="mt-0.5 text-red-800/90 dark:text-red-300/90">Account gesperrt – bitte kontaktieren</div>
        </div>
      </div>
    );
  }

  if (diffDays <= 7) {
    return (
      <div
        role="alert"
        className="mb-4 flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-200"
      >
        <AlertTriangle className="w-5 h-5 mt-0.5 flex-shrink-0" />
        <div>
          <div className="font-medium">Testzugang läuft am {dateStr} ab</div>
          <div className="mt-0.5 text-amber-800/90 dark:text-amber-300/90">
            Noch {diffDays === 0 ? 'heute' : diffDays === 1 ? '1 Tag' : `${diffDays} Tage`} verfügbar.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      role="status"
      className="mb-4 flex items-start gap-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900 dark:border-blue-900/50 dark:bg-blue-950/40 dark:text-blue-200"
    >
      <Info className="w-5 h-5 mt-0.5 flex-shrink-0" />
      <div>
        <div className="font-medium">Testzugang aktiv bis {dateStr}</div>
        <div className="mt-0.5 text-blue-800/90 dark:text-blue-300/90">
          {trialStartStr ? `Testzeitraum: ${trialStartStr} bis ${dateStr}` : 'Vielen Dank, dass Sie Smartflow AI testen.'}
        </div>
      </div>
    </div>
  );
}
