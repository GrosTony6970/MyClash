/**
 * MyClash Scoring — Service Worker (T-502)
 *
 * Strategy:
 *   - App shell + static assets: cache-first (precached on install)
 *   - _next/static: cache-first (immutable, content-hashed filenames)
 *   - API calls: network-first, offline → 503 JSON
 *   - Navigation: network-first, offline → cached shell
 *
 * Cache name is stamped by the deploy script (VERSION env var).
 * On activate, old caches are purged so stale assets never serve.
 */

const CACHE_VERSION = self.__CACHE_VERSION__ || 'v1';
const CACHE_NAME = `myclash-scoring-${CACHE_VERSION}`;

/** Shell URLs to precache on install. */
const SHELL_URLS = ['/', '/login', '/lices', '/offline'];

// ── Install: precache shell ───────────────────────────────────────────────────

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) =>
        cache.addAll(SHELL_URLS).catch((err) => {
          // Non-fatal: offline install is fine, shell cached on first online visit
          console.warn('[SW] Precache partial failure:', err);
        }),
      )
      .then(() => self.skipWaiting()),
  );
});

// ── Activate: purge old caches ────────────────────────────────────────────────

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith('myclash-scoring-') && key !== CACHE_NAME)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

// ── Fetch ─────────────────────────────────────────────────────────────────────

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Only handle same-origin + known CDN patterns
  if (url.origin !== self.location.origin && !url.pathname.startsWith('/_next/')) {
    return;
  }

  // API calls: network-first, offline → structured error
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(networkFirstApi(request));
    return;
  }

  // _next/static: cache-first (content-hashed, immutable)
  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // Navigation: network-first, offline → shell
  if (request.mode === 'navigate') {
    event.respondWith(networkFirstNavigate(request));
    return;
  }

  // Everything else: stale-while-revalidate
  event.respondWith(staleWhileRevalidate(request));
});

// ── Strategies ────────────────────────────────────────────────────────────────

async function networkFirstApi(request) {
  try {
    return await fetch(request);
  } catch {
    return new Response(JSON.stringify({ error: 'offline', status: 503 }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

async function networkFirstNavigate(request) {
  try {
    const res = await fetch(request);
    // Cache successful navigation responses for offline use
    if (res.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, res.clone());
    }
    return res;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    // Fall back to root shell
    const shell = await caches.match('/');
    return shell ?? new Response('Offline', { status: 503 });
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const res = await fetch(request);
    if (res.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, res.clone());
    }
    return res;
  } catch {
    return new Response('Asset unavailable offline', { status: 503 });
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  const fetchPromise = fetch(request)
    .then((res) => {
      if (res.ok) cache.put(request, res.clone());
      return res;
    })
    .catch(() => cached);
  return cached ?? fetchPromise;
}
