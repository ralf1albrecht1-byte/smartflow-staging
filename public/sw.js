// Service Worker — Business Manager PWA
// v3 (2026-04-24): stronger kill-switch for stale HTML/chunk caches left over
// from v1. v1 cached navigation HTML which orphaned chunk references after a
// deploy and produced white screens on Aufträge/Angebote/Rechnungen/Kunden.
// v2 stopped caching HTML; v3 additionally PURGES every pre-existing cache on
// activate so any user still running v1 recovers on the very next visit
// without a manual cache clear.
const CACHE_NAME = 'bm-cache-v3';
const OFFLINE_URL = '/offline.html';

// Install: cache offline fallback only. Never cache navigation HTML.
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll([OFFLINE_URL]))
  );
  self.skipWaiting();
});

// Activate: delete ALL previous caches (v1/v2/anything else), take control.
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)))
    ).then(() => self.clients.claim())
  );
});

// Fetch: network-only for HTML; cache-first for hashed static assets.
self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Only handle GET requests.
  if (request.method !== 'GET') return;

  // Navigation requests (HTML pages): network-ONLY, NEVER cache.
  // Rationale: Next.js HTML references hashed static chunks. A cached HTML
  // after a deploy would reference chunks that no longer exist on the
  // origin and cause a full white-screen. If the network is truly offline
  // we show the offline page fallback (still never the old HTML).
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.match(OFFLINE_URL))
    );
    return;
  }

  // Static assets (_next/static): cache-first (filenames are content-hashed
  // so a cached response is always correct for its URL).
  if (request.url.includes('/_next/static/')) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          // Only cache successful responses so a 404 never gets stored.
          if (response && response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        });
      })
    );
    return;
  }

  // Everything else: let the network handle it — no SW caching.
});

// Message channel: allow the client to request an immediate cache wipe
// (used by /recover and the ChunkErrorHandler self-heal path).
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
  if (event.data === 'CLEAR_CACHE') {
    caches.keys().then((names) => names.forEach((n) => caches.delete(n)));
  }
});
