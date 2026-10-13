import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { beforeEach, describe, expect, it } from 'vitest';
import { SHELL_ID } from '../lib/nav';

/**
 * The service worker itself: `public/sw.js`, run as the browser runs it, over a
 * cache and a network made here.
 *
 * It is a plain file the browser loads, with no module and no build, so it is
 * read and run in a context of its own. What a made-up browser cannot show (a
 * page kept as a shell that hydrates under another address) was shown once
 * with the real worker on a production build: see ARCHITECTURE 10.4.
 */
const SOURCE = readFileSync(join(__dirname, '..', '..', 'public', 'sw.js'), 'utf8');
const ORIGIN = 'https://staff.test';
/** The cache of the worker the tests register, as commit `14f7b056`. */
const CACHE = 'myclash-staff-14f7b056';

type Handler = (event: {
  request: { url: string; mode: string };
  respondWith: (answer: Promise<Response>) => void;
  waitUntil: (work: Promise<unknown>) => void;
}) => void;

interface Worker {
  /** The cache's entries, by cache name then address. */
  stores: Map<string, Map<string, Response>>;
  /** What the network answers, by path. A path that is not here fails, as with no network. */
  network: Map<string, () => Response>;
  asked: string[];
  install: () => Promise<void>;
  activate: () => Promise<void>;
  /** Asks the worker for an address. Undefined when the worker leaves the request alone. */
  ask: (path: string, mode?: string) => Promise<Response> | undefined;
  shellFor: (pathname: string) => string;
  staticFilesOf: (html: string) => string[];
}

const pathOf = (target: string | { url: string }) => {
  const url = new URL(typeof target === 'string' ? target : target.url, ORIGIN);
  return url.pathname + url.search;
};

type Stores = Map<string, Map<string, Response>>;

/** The browser's `caches`, over maps the tests read. */
function cachesOver(stores: Stores) {
  const open = (name: string) => {
    const store = stores.get(name) ?? new Map<string, Response>();
    stores.set(name, store);
    return {
      put: (target: string | { url: string }, res: Response) => {
        store.set(pathOf(target), res);
        return Promise.resolve();
      },
      match: (target: string | { url: string }) =>
        Promise.resolve(store.get(pathOf(target))?.clone()),
    };
  };
  return {
    open: (name: string) => Promise.resolve(open(name)),
    keys: () => Promise.resolve([...stores.keys()]),
    delete: (name: string) => Promise.resolve(stores.delete(name)),
    match: (target: string | { url: string }) => {
      const hit = [...stores.values()].map((store) => store.get(pathOf(target))).find(Boolean);
      return Promise.resolve(hit?.clone());
    },
  };
}

/** The three events of a worker, sent to the handlers the script registered. */
function eventsOf(handlers: Map<string, Handler>): Pick<Worker, 'install' | 'activate' | 'ask'> {
  const lifecycle = (type: string) => async () => {
    let work: Promise<unknown> = Promise.resolve();
    const waitUntil = (w: Promise<unknown>) => {
      work = w;
    };
    handlers.get(type)!({ waitUntil } as never);
    await work;
  };
  return {
    install: lifecycle('install'),
    activate: lifecycle('activate'),
    ask: (path, mode = 'navigate') => {
      let answer: Promise<Response> | undefined;
      const respondWith = (a: Promise<Response>) => {
        answer = a;
      };
      const request = { url: ORIGIN + path, mode };
      handlers.get('fetch')!({ request, respondWith, waitUntil: () => undefined });
      return answer;
    },
  };
}

function worker(version?: string): Worker {
  const stores: Stores = new Map();
  const network = new Map<string, () => Response>();
  const asked: string[] = [];
  const handlers = new Map<string, Handler>();
  const context = {
    URL,
    Response,
    Set,
    Promise,
    console: { warn: () => undefined },
    self: {
      location: { origin: ORIGIN, href: `${ORIGIN}/sw.js${version ? `?v=${version}` : ''}` },
      addEventListener: (type: string, handler: Handler) => handlers.set(type, handler),
      skipWaiting: () => Promise.resolve(),
      clients: { claim: () => Promise.resolve() },
    },
    caches: cachesOver(stores),
    fetch: (target: string | { url: string }) => {
      const path = pathOf(target);
      asked.push(path);
      const answer = network.get(path);
      return answer ? Promise.resolve(answer()) : Promise.reject(new TypeError('Failed to fetch'));
    },
  };
  const exposed = runInNewContext(`${SOURCE}\n;({ shellFor, staticFilesOf })`, context) as Pick<
    Worker,
    'shellFor' | 'staticFilesOf'
  >;
  return { stores, network, asked, ...exposed, ...eventsOf(handlers) };
}

const page = (body: string) => () =>
  new Response(body, { status: 200, headers: { 'Content-Type': 'text/html' } });
const file = () => new Response('/* a chunk */', { status: 200 });

/** A hall with a network: every shell answers, and names its scripts both ways. */
function online(sw: Worker) {
  for (const url of ['/', '/login', '/lices', '/offline', `/lices/${SHELL_ID}`]) {
    sw.network.set(url, page(`<script src="/_next/static/chunks/main.js"></script>${url}`));
  }
  sw.network.set(
    `/matches/${SHELL_ID}`,
    page(
      '<link rel="stylesheet" href="/_next/static/css/pad.css">' +
        '<script src="/_next/static/chunks/bout.js" async></script>' +
        '<script>self.__next_f.push([1,"[\\"static/chunks/lazy-1.js\\",\\"static/media/font.woff2\\"]"])</script>',
    ),
  );
  for (const name of ['chunks/main.js', 'chunks/bout.js', 'css/pad.css', 'chunks/lazy-1.js']) {
    sw.network.set(`/_next/static/${name}`, file);
  }
}

let sw: Worker;
beforeEach(() => {
  sw = worker('14f7b056');
});

describe('the shell of an address', () => {
  it('is the bout shell for any bout, and the piste shell for any piste', () => {
    expect(sw.shellFor('/matches/1b4e28ba-2fa1-11d2-883f-0016d3cca427')).toBe('/matches/_');
    expect(sw.shellFor('/lices/lice-7')).toBe('/lices/_');
  });

  it('is the start page for an address with no id, and for a page under a bout', () => {
    for (const path of ['/', '/lices', '/lices/', '/login', '/desk', '/matches', '/whatever/x']) {
      expect(sw.shellFor(path), path).toBe('/');
    }
    expect(sw.shellFor('/matches/bout-1/print')).toBe('/');
  });

  it('is asked with the id the pages read as "no id"', () => {
    expect(SOURCE).toContain(`const SHELL_ID = '${SHELL_ID}';`);
  });
});

describe('the static files a page names', () => {
  it('are its scripts and its styles, and the bare paths of the page data, under one prefix', () => {
    const html =
      '<link href="/staff/_next/static/css/a.css"><script src="/staff/_next/static/chunks/b.js?dpl=1">' +
      '</script><script>x("[\\"static/chunks/c.js\\",\\"static/media/d.woff2\\"]")</script>';

    expect(sw.staticFilesOf(html).sort()).toEqual([
      '/staff/_next/static/chunks/b.js',
      '/staff/_next/static/chunks/c.js',
      '/staff/_next/static/css/a.css',
      '/staff/_next/static/media/d.woff2',
    ]);
  });

  it('are none for a page that names none, and each once', () => {
    expect(sw.staticFilesOf('<p>Offline</p>')).toEqual([]);
    expect(
      sw.staticFilesOf(
        '<script src="/_next/static/chunks/a.js"></script>"/_next/static/chunks/a.js"',
      ),
    ).toEqual(['/_next/static/chunks/a.js']);
  });
});

// The deploy script stamped the cache's name into this file with a `sed` that
// had stopped matching, behind `|| true`: the cache was `v1` for ever, and a
// tablet could serve a page of the old app after a deploy.
describe('the version of the cache', () => {
  it('is the `v` of the worker’s own address: the commit the page registered it with', async () => {
    online(sw);
    await sw.install();

    expect([...sw.stores.keys()]).toEqual(['myclash-staff-14f7b056']);
  });

  it('removes the caches of the older workers at activate, and no other cache', async () => {
    const old = worker('5bc3195f');
    online(old);
    await old.install();
    const next = worker('14f7b056');
    for (const [name, store] of old.stores) next.stores.set(name, store);
    next.stores.set('another-app-v1', new Map());
    online(next);

    await next.install();
    // Both until the new worker is active: the open page still reads the old one.
    expect([...next.stores.keys()].sort()).toEqual([
      'another-app-v1',
      'myclash-staff-14f7b056',
      'myclash-staff-5bc3195f',
    ]);
    await next.activate();

    expect([...next.stores.keys()].sort()).toEqual(['another-app-v1', 'myclash-staff-14f7b056']);
    expect(next.stores.get('myclash-staff-14f7b056')!.has('/matches/_')).toBe(true);
  });

  it('has a name of its own for a worker registered with no version', async () => {
    const bare = worker();
    await bare.install();

    expect([...bare.stores.keys()]).toEqual(['myclash-staff-unversioned']);
  });
});

describe('the install', () => {
  it('keeps the six shells and every static file they name', async () => {
    online(sw);

    await sw.install();

    const kept = [...sw.stores.get(CACHE)!.keys()].sort();
    expect(kept).toEqual([
      '/',
      '/_next/static/chunks/bout.js',
      '/_next/static/chunks/lazy-1.js',
      '/_next/static/chunks/main.js',
      '/_next/static/css/pad.css',
      '/lices',
      '/lices/_',
      '/login',
      '/matches/_',
      '/offline',
    ]);
  });

  // `addAll` dropped the whole list when one address failed.
  it('keeps the rest when one shell and one file do not answer', async () => {
    online(sw);
    sw.network.delete('/offline');
    sw.network.set('/_next/static/chunks/lazy-1.js', () => new Response('gone', { status: 404 }));

    await sw.install();

    const kept = sw.stores.get(CACHE)!;
    expect(kept.has('/matches/_')).toBe(true);
    expect(kept.has('/_next/static/chunks/bout.js')).toBe(true);
    expect(kept.has('/offline')).toBe(false);
    expect(kept.has('/_next/static/chunks/lazy-1.js')).toBe(false);
  });

  it('ends with nothing kept, and no failure, when there is no network at all', async () => {
    await expect(sw.install()).resolves.toBeUndefined();
    expect([...sw.stores.get(CACHE)!.keys()]).toEqual([]);
  });
});

describe('a navigation with no network', () => {
  const text = async (answer: Promise<Response> | undefined) => (await answer)?.text();

  beforeEach(async () => {
    online(sw);
    await sw.install();
    sw.network.clear();
  });

  // Quick-win ruling 4: it got the start page, which could not check who was
  // signed in and offered a Retry that reloaded the same dead address.
  it('gives a bout the tablet never opened the bout shell', async () => {
    expect(await text(sw.ask('/matches/bout-never-opened'))).toContain('chunks/bout.js');
    expect(await text(sw.ask('/matches/bout-2?return=%2Forg%2Fx'))).toContain('chunks/bout.js');
  });

  it('gives a piste the tablet never opened the piste shell', async () => {
    expect(await text(sw.ask('/lices/lice-9'))).toContain('/lices/_');
  });

  it('gives any other address the start page', async () => {
    expect(await text(sw.ask('/desk'))).toMatch(/main\.js"><\/script>\/$/);
  });

  it('gives the start page for a bout when the bout shell was not kept', async () => {
    sw.stores.get(CACHE)!.delete('/matches/_');

    expect(await text(sw.ask('/matches/bout-2'))).toMatch(/main\.js"><\/script>\/$/);
  });

  it('says "Offline" with a 503 when nothing is kept', async () => {
    sw.stores.clear();

    const answer = await sw.ask('/matches/bout-2');

    expect(answer?.status).toBe(503);
  });
});

describe('a navigation with a network', () => {
  it('answers from the network, and the copy of that very address wins over the shell later', async () => {
    online(sw);
    await sw.install();
    sw.network.set('/matches/bout-1', page('the page of bout 1, from the server'));

    expect(await (await sw.ask('/matches/bout-1'))?.text()).toContain('from the server');
    sw.network.clear();

    expect(await (await sw.ask('/matches/bout-1'))?.text()).toContain('from the server');
  });
});

describe('a static file', () => {
  // Production asks for `/staff/_next/static/…` (STAFF_ASSET_PREFIX): the test
  // for the prefix-less form alone sent those through another strategy.
  it('comes from the tablet under either prefix, with no request', async () => {
    for (const path of ['/_next/static/chunks/a.js', '/staff/_next/static/chunks/a.js']) {
      sw.network.set(path, file);
      await sw.ask(path, 'no-cors');
      sw.asked.length = 0;
      sw.network.clear();

      const again = await sw.ask(path, 'no-cors');

      expect(again?.status, path).toBe(200);
      expect(sw.asked, path).toEqual([]);
    }
  });

  it('is a 503 when it is not on the tablet and there is no network', async () => {
    expect((await sw.ask('/_next/static/chunks/never.js', 'no-cors'))?.status).toBe(503);
  });
});

describe('a request of the API', () => {
  it('is never kept, and with no network is the 503 the pad reads as "no network"', async () => {
    sw.network.set('/api/v1/matches/bout-1', () => new Response('{"id":"bout-1"}'));
    await sw.ask('/api/v1/matches/bout-1', 'cors');
    sw.network.clear();

    const answer = await sw.ask('/api/v1/matches/bout-1', 'cors');

    expect(answer?.status).toBe(503);
    expect(await answer?.json()).toMatchObject({ error: 'offline', status: 503 });
  });
});
