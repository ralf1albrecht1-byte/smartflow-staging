'use client';

import { useEffect } from 'react';

/**
 * Registers the service worker for PWA functionality.
 * Handles updates by signalling the new SW to skip waiting.
 */
export function PWARegister() {
  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;

    navigator.serviceWorker
      .register('/sw.js')
      .then((reg) => {
        // Check for updates periodically (every 60 min)
        const interval = setInterval(() => reg.update(), 60 * 60 * 1000);

        reg.addEventListener('updatefound', () => {
          const newSW = reg.installing;
          if (!newSW) return;
          newSW.addEventListener('statechange', () => {
            if (newSW.state === 'installed' && navigator.serviceWorker.controller) {
              // New SW ready — activate immediately
              newSW.postMessage('SKIP_WAITING');
            }
          });
        });

        // When new SW takes over, reload to get fresh assets
        let refreshing = false;
        navigator.serviceWorker.addEventListener('controllerchange', () => {
          if (refreshing) return;
          refreshing = true;
          window.location.reload();
        });

        return () => clearInterval(interval);
      })
      .catch((err) => {
        console.warn('[PWA] SW registration failed:', err);
      });
  }, []);

  return null;
}
