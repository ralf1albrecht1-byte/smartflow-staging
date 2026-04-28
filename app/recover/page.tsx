'use client';

import { useEffect, useState } from 'react';

/**
 * Manual recovery/kill-switch page.
 *
 * Visiting `/recover` forcibly:
 *   1. Unregisters every service worker (purges stale v1/v2 workers).
 *   2. Deletes every Cache Storage entry.
 *   3. Reloads into `/dashboard` with a cache-busting query string.
 *
 * This is the safety net for anyone who hits a white-screen that the
 * auto-recovery (ChunkErrorHandler) somehow missed. The page itself is pure
 * client-side, imports no shared app chunks, so it loads even if the rest of
 * the bundle is broken.
 */
export default function RecoverPage() {
  const [step, setStep] = useState('Wiederherstellung wird gestartet …');

  useEffect(() => {
    (async () => {
      try {
        setStep('Service Worker werden entfernt …');
        if ('serviceWorker' in navigator) {
          const regs = await navigator.serviceWorker.getRegistrations();
          await Promise.all(regs.map((r) => r.unregister().catch(() => false)));
        }
      } catch {
        /* best-effort */
      }
      try {
        setStep('Alte Caches werden gelöscht …');
        if (typeof caches !== 'undefined') {
          const names = await caches.keys();
          await Promise.all(names.map((n) => caches.delete(n).catch(() => false)));
        }
      } catch {
        /* best-effort */
      }
      try {
        sessionStorage.removeItem('bm_chunk_recovered_v3');
      } catch {
        /* best-effort */
      }
      setStep('Weiterleitung …');
      // Cache-busting reload to the dashboard.
      window.location.replace(`/dashboard?r=${Date.now()}`);
    })();
  }, []);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background p-6 text-center">
      <div className="h-10 w-10 animate-spin rounded-full border-4 border-primary/20 border-t-primary" />
      <h1 className="text-xl font-semibold">Anwendung wird wiederhergestellt</h1>
      <p className="max-w-md text-sm text-muted-foreground">{step}</p>
      <p className="max-w-md text-xs text-muted-foreground">
        Dieser Vorgang dauert nur einen Moment. Bitte schließen Sie das Fenster nicht.
      </p>
    </div>
  );
}
