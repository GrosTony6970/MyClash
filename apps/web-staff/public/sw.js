/**
 * MyClash Scoring — Service Worker (T-502)
 *
 * Strategy:
 *   - The shells and every static file they name: kept at install
 *   - _next/static: cache-first (immutable, content-hashed filenames)
 *   - API calls: network-first, offline → 503 JSON
 *   - Navigation: network-first, offline → the copy of that address, then the
 *     shell of its route
 *
 * THE SHELLS. A page with an id in its address (`/matches/<id>`,
 * `/lices/<id>`) is one page for every id: it reads the id from the address
 * (`src/lib/nav.ts`, `idFromPath`) and its bout or its piste from the tablet.
 * So one kept copy, asked as `/matches/_`, serves every bout with no network.
 * Before, an address the tablet had never opened got the START page, which
 * could not check who was signed in and offered a Retry that reloaded the same
 * dead address (quick-win ruling 4).
 *
 * Cache name is stamped by the deploy script (VERSION env var).
 * On activate, old caches are purged so stale assets never serve.
 */

const CACHE_VERSION = self.__CACHE_VERSION__ || 'v1';
const CACHE_NAME = `myclash-staff-${CACHE_VERSION}`;

/** The id a page is asked with to keep its shell. In step with `SHELL_ID` in `src/lib/nav.ts`. */
const SHELL_ID = '_';

/** The routes whose address holds an id: one shell each. */
const SHELL_ROUTES = ['matches', 'lices'];

/** Shell URLs to precache on install. */
const SHELL_URLS = [
  '/',
  '/login',
  '/lices',
  '/offline',
  ...SHELL_ROUTES.map((route) => `/${route}/${SHELL_ID}`),
];

/**
 * The shell that serves `pathname` when the network is gone and the tablet
 * holds no copy of that very address: the shell of its route for an address
 * with an id, the start page for anything else.
 */
function shellFor(pathname) {
  const [, route, id, more] = pathname.split('/');
  if (SHELL_ROUTES.includes(route) && id && more === undefined) return `/${route}/${SHELL_ID}`;
  return '/';
}

/**
 * The static files a page's HTML names: its scripts, its styles, its fonts.
 *
 * A shell is no use with no network when its scripts are not on the tablet,
 * and until now they were kept only after a page had asked for them. The HTML
 * names them twice: as addresses (`/_next/static/…`, or `/staff/_next/static/…`
 * in production, see `STAFF_ASSET_PREFIX`), and as bare `static/…` paths in the
 * data Next inlines for the page. Both are kept, the bare ones under the
 * prefix the addresses use.
 */
function staticFilesOf(html) {
  const found = new Set();
  let prefix = '/_next/';
  for (const [, address] of html.matchAll(/["'(]((?:\/[\w-]+)?\/_next\/static\/[^"'\\)\s?#]+)/g)) {
    found.add(address);
    prefix = address.slice(0, address.indexOf('static/'));
  }
  for (const [, bare] of html.matchAll(/["'](static\/(?:chunks|css|media)\/[^"'\\)\s?#]+)/g)) {
    found.add(prefix + bare);
  }
  return [...found];
}

/** Keeps one address. A failure costs that file only, and is said. */
async function keep(cache, url) {
  try {
    const res = await fetch(url, { credentials: 'same-origin' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    await cache.put(url, res.clone());
    return res;
  } catch (err) {
    // Non-fatal: an install with no network is fine, the file is kept at its first use.
    console.warn('[SW] Not kept:', url, err);
    return null;
  }
}

/**
 * Keeps each shell and every static file it names. One by one: `addAll` drops
 * the whole list when one address fails.
 */
async function keepShells(cache) {
  const files = new Set();
  for (const url of SHELL_URLS) {
    const res = await keep(cache, url);
    if (res) for (const file of staticFilesOf(await res.text())) files.add(file);
  }
  await Promise.all([...files].map((file) => keep(cache, file)));
}

// ── Install: precache the shells ─────────────────────────────────────────────

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then(keepShells)
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
            .filter((key) => key.startsWith('myclash-staff-') && key !== CACHE_NAME)
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

  // _next/static: cache-first (content-hashed, immutable), under either
  // prefix: production asks for `/staff/_next/static/…`.
  if (url.pathname.includes('/_next/static/')) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // Navigation: network-first, offline → the copy, then the route's shell
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
    // The shell of the address's route; the start page when that is not kept either.
    const shell =
      (await caches.match(shellFor(new URL(request.url).pathname))) ?? (await caches.match('/'));
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
