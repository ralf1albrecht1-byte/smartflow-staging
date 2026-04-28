'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';

/**
 * Catches ChunkLoadError / CSS loading failures during client-side navigation
 * and triggers a full self-healing recovery: unregisters any stale service
 * worker, purges ALL HTTP caches, then reloads the page so the browser pulls
 * fresh HTML referencing the current chunk hashes.
 *
 * Background: a legacy service worker (v1) cached navigation HTML which, after
 * a deploy, referenced chunk hashes that no longer exist on the origin. The
 * result was a white-screen on exactly the routes whose chunks had changed.
 * This handler acts as an in-app kill-switch so affected users recover
 * automatically on the very next navigation — no manual cache clear required.
 *
 * A sessionStorage guard prevents infinite reload loops: if recovery runs once
 * and the error happens again in the same tab session, we fall back to a plain
 * reload only.
 */
const RECOVERY_FLAG = 'bm_chunk_recovered_v3';

async function nukeCachesAndSW() {
  try {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister().catch(() => false)));
    }
  } catch {
    /* ignore — best-effort */
  }
  try {
    if (typeof caches !== 'undefined') {
      const names = await caches.keys();
      await Promise.all(names.map((n) => caches.delete(n).catch(() => false)));
    }
  } catch {
    /* ignore — best-effort */
  }
}

export function ChunkErrorHandler() {
  const pathname = usePathname();

  useEffect(() => {
    const isChunkError = (msg: string) =>
      /loading chunk|chunkloaderror|loading css chunk|failed to fetch dynamically/i.test(msg);

    const recover = async (reason: string) => {
      console.warn('[ChunkErrorHandler] Recovering after:', reason);
      let alreadyRecovered = false;
      try {
        alreadyRecovered = sessionStorage.getItem(RECOVERY_FLAG) === '1';
      } catch {
        /* sessionStorage unavailable (e.g. privacy mode) — treat as first run */
      }

      if (!alreadyRecovered) {
        try {
          sessionStorage.setItem(RECOVERY_FLAG, '1');
        } catch {
          /* ignore */
        }
        await nukeCachesAndSW();
      }
      window.location.reload();
    };

    const handleError = (event: ErrorEvent) => {
      if (isChunkError(event.message || '')) {
        event.preventDefault();
        void recover(event.message || 'chunk-error');
      }
    };

    const handleRejection = (event: PromiseRejectionEvent) => {
      const msg = event.reason?.message || String(event.reason || '');
      if (isChunkError(msg)) {
        event.preventDefault();
        void recover(msg);
      }
    };

    window.addEventListener('error', handleError);
    window.addEventListener('unhandledrejection', handleRejection);
    return () => {
      window.removeEventListener('error', handleError);
      window.removeEventListener('unhandledrejection', handleRejection);
    };
  }, [pathname]);

  return null;
}
