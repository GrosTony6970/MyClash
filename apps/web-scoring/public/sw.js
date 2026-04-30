/**
 * MyClash Scoring — Service Worker
 * Provides offline capability for the scoring PWA.
 * Cache name is stamped by the deploy script.
 */
const CACHE_NAME = 'myclash-scoring-v1';

const PRECACHE_URLS = [
  '/',
  '/login',
  '/offline',
];

// ── Install: precache shell ───────────────────────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS)),
  );
  self.skipWaiting();
});

// ── Activate: clean old caches ────────────────────────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key)),
      ),
    ),
  );
  self.clients.claim();
});

// ── Fetch: network-first for API, cache-first for assets ─────────────────────
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // API calls: network-first (fall back to offline page if network fails)
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(event.request).catch(() =>
        new Response(JSON.stringify({ error: 'offline' }), {
          headers: { 'Content-Type': 'application/json' },
          status: 503,
        }),
      ),
    );
    return;
  }

  // Navigation: network-first, fall back to cached shell
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(() =>
        caches.match('/').then((r) => r ?? fetch('/offline')),
      ),
    );
    return;
  }

  // Static assets: cache-first
  event.respondWith(
    caches.match(event.request).then(
      (cached) => cached ?? fetch(event.request),
    ),
  );
});
