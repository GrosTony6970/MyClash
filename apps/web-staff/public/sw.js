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
 * THE VERSION is the `v` of this worker's own address: the page registers
 * `<mount>/sw.js?v=<commit served>` (`src/lib/worker-registration.ts`). A
 * deploy is a new address, so a new worker: it fills a cache of its own at
 * install, and at activate removes every older one of its mount, so a page of
 * the old app never serves.
 *
 * THE MOUNT is the folder of this worker's own address, its reach: nothing on
 * the referee site, `/staff` on the organiser site, where the page registers
 * `/staff/sw.js`. Every page address it builds starts with it: on the organiser
 * site `/login` is the organiser app's. The API (`/api/v1/…`) is at the root on
 * both sites, and static files are matched under either prefix.
 *
 * ONE ORIGIN CAN HOLD TWO MOUNTS: the referee site also answers pages under
 * `/staff/…`, so a tablet may hold a root worker and a `/staff/` one. Each
 * updates only on a page of its own reach, so each owns the caches of its
 * mount (the mount is in the name) and removes no other mount's.
 */

const CACHE_VERSION = new URL(self.location.href).searchParams.get('v') || 'unversioned';

/** `''` or `/staff`: the reach of this worker, with no slash at its end. */
const MOUNT = new URL(self.registration.scope).pathname.replace(/\/$/, '');

/** The caches of this mount: `myclash-staff-<v>` at the root, `myclash-staff~staff-<v>` under `/staff`. */
const CACHE_FAMILY = `myclash-staff${MOUNT.replace('/', '~')}-`;
const CACHE_NAME = CACHE_FAMILY + CACHE_VERSION;

/** The start page. */
const START = `${MOUNT}/`;

/** The id a page is asked with to keep its shell. In step with `SHELL_ID` in `src/lib/nav.ts`. */
const SHELL_ID = '_';

/** The routes whose address holds an id: one shell each. */
const SHELL_ROUTES = ['matches', 'lices'];

/** Shell URLs to precache on install. */
const SHELL_URLS = [
  START,
  ...[
    '/login',
    '/lices',
    '/offline',
    // The two desks. With a cache that follows the deploy, a page that is not
    // kept here is lost at each deploy until its next visit with a network.
    '/desk',
    '/gear',
    ...SHELL_ROUTES.map((route) => `/${route}/${SHELL_ID}`),
  ].map((path) => MOUNT + path),
];

/**
 * The shell that serves `pathname` when the network is gone and the tablet
 * holds no copy of that very address: the shell of its route for an address
 * with an id, the start page for anything else. `pathname` is in this worker's
 * reach, so it starts with the mount.
 */
function shellFor(pathname) {
  const [, route, id, ...more] = pathname.slice(MOUNT.length).split('/');
  // `/matches/x` and `/matches/x/`: the page reads both as bout x (`idFromPath`).
  const noMore = more.length === 0 || (more.length === 1 && more[0] === '');
  if (SHELL_ROUTES.includes(route) && id && noMore) return `${MOUNT}/${route}/${SHELL_ID}`;
  return START;
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
  for (const [, address] of html.matchAll(/["'(]((?:\/[\w-]+)?\/_next\/static\/[^"'\\)\s#]+)/g)) {
    found.add(address);
    prefix = address.slice(0, address.indexOf('static/'));
  }
  for (const [, bare] of html.matchAll(/["'](static\/(?:chunks|css|media)\/[^"'\\)\s?#]+)/g)) {
    found.add(prefix + bare);
  }
  return [...found];
}

/**
 * Keeps one address. Answers the response it kept, or why it kept none:
 *   - `absent`: the server says there is no such file (a 4xx). It will not come.
 *   - `missed`: no answer, or a fault of the server. It may come at the next try.
 */
async function keep(cache, url) {
  try {
    const res = await fetch(url, { credentials: 'same-origin' });
    if (res.ok) {
      await cache.put(url, res.clone());
      return res;
    }
    console.warn('[SW] Not kept:', url, res.status);
    return res.status < 500 ? 'absent' : 'missed';
  } catch (err) {
    console.warn('[SW] Not kept:', url, err);
    return 'missed';
  }
}

/**
 * Keeps each shell and every static file it names. One by one: `addAll` drops
 * the whole list when one address fails. Answers whether the cache is WHOLE:
 * nothing was missed for want of an answer.
 */
async function keepShells(cache) {
  const files = new Set();
  let whole = true;
  for (const url of SHELL_URLS) {
    const res = await keep(cache, url);
    if (res === 'missed') whole = false;
    if (typeof res === 'string') continue;
    for (const file of staticFilesOf(await res.text())) files.add(file);
  }
  const kept = await Promise.all([...files].map((file) => keep(cache, file)));
  return whole && !kept.includes('missed');
}

/**
 * The install of a NEW version must not take over with half a cache.
 *
 * The cache follows the deploy, so activate removes the cache of the worker
 * before. A tablet that reloads just after a deploy, on wifi that drops while
 * the shells are being kept, would lose a whole cache for half of one: "Next
 * match" with no network would be the start page again. So when a worker is
 * already active, an install the network cut short FAILS: the browser drops
 * this worker, the active one and its cache stay, and the next page with a
 * network tries again.
 *
 * A first install has nothing to protect: it takes what it got, and the rest
 * is kept at its first use.
 */
async function install() {
  const whole = await keepShells(await caches.open(CACHE_NAME));
  if (!whole && self.registration.active) {
    throw new Error('[SW] The network cut the install short: the worker before stays');
  }
  await self.skipWaiting();
}

// ── Install: precache the shells ─────────────────────────────────────────────

self.addEventListener('install', (event) => {
  event.waitUntil(install());
});

// ── Activate: purge old caches ────────────────────────────────────────────────

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith(CACHE_FAMILY) && key !== CACHE_NAME)
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
    // `code` beside `error`: the shared request helper keeps a refusal's `code`
    // and drops the rest, and the start page must tell this answer from a
    // server that is up and answers 503. In step with `offlineResponse()`.
    return new Response(JSON.stringify({ error: 'offline', code: 'offline', status: 503 }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * EVERY strategy reads THIS worker's cache only, never `caches.match` across
 * all of them. On the referee site the root worker keeps the first `/staff/…`
 * page it was in charge of, and every `/staff/_next/static/…` file a root page
 * asked for (one build, one asset prefix). Asked across caches, the `/staff/`
 * worker would serve that page of an older app, or a file it never kept and
 * loses when the root worker's next deploy removes its cache.
 */
const ownCache = () => caches.open(CACHE_NAME);

async function networkFirstNavigate(request) {
  try {
    const res = await fetch(request);
    // Cache successful navigation responses for offline use
    if (res.ok) {
      const copy = res.clone();
      ownCache()
        .then((cache) => cache.put(request, copy))
        .catch(() => undefined);
    }
    return res;
  } catch {
    try {
      const cache = await ownCache();
      const cached = await cache.match(request);
      if (cached) return cached;
      // The shell of the address's route; the start page when that is not kept either.
      const shell =
        (await cache.match(shellFor(new URL(request.url).pathname))) ?? (await cache.match(START));
      if (shell) return shell;
    } catch {
      // No cache to read: the same answer as an empty one.
    }
    return new Response('Offline', { status: 503 });
  }
}

async function cacheFirst(request) {
  // A cache that cannot open is an empty one: the network still answers.
  const cache = await ownCache().catch(() => null);
  const cached = await cache?.match(request);
  if (cached) return cached;
  try {
    const res = await fetch(request);
    if (res.ok) cache?.put(request, res.clone());
    return res;
  } catch {
    return new Response('Asset unavailable offline', { status: 503 });
  }
}

async function staleWhileRevalidate(request) {
  const cache = await ownCache();
  const cached = await cache.match(request);
  const fetchPromise = fetch(request)
    .then((res) => {
      if (res.ok) cache.put(request, res.clone());
      return res;
    })
    .catch(() => cached);
  return cached ?? fetchPromise;
}
