import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { SHELL_ID } from '../lib/nav';

/**
 * A made-up browser for `public/sw.js`: its `caches`, its network and its three
 * events, over maps the tests of `sw.test.ts` read. The worker's file is a
 * plain script with no module and no build, so it is read and run in a context
 * of its own.
 */
export const SOURCE = readFileSync(join(__dirname, '..', '..', 'public', 'sw.js'), 'utf8');
const ORIGIN = 'https://staff.test';
/** The cache of the worker the tests register, as commit `14f7b056`. */
export const CACHE = 'myclash-staff-14f7b056';

type Handler = (event: {
  request: { url: string; mode: string };
  respondWith: (answer: Promise<Response>) => void;
  waitUntil: (work: Promise<unknown>) => void;
}) => void;

export interface Worker {
  /** `''` (the referee site) or `/staff` (the organiser site): the folder the worker was registered in. */
  mount: string;
  /** The cache's entries, by cache name then address. */
  stores: Map<string, Map<string, Response>>;
  /** What the network answers, by path. A path that is not here fails, as with no network. */
  network: Map<string, () => Response>;
  asked: string[];
  install: () => Promise<void>;
  activate: () => Promise<void>;
  /** Asks the worker for an address. Undefined when the worker leaves the request alone. */
  ask: (path: string, mode?: string) => Promise<Response> | undefined;
  /** What the worker did to take over: `skipWaiting` at install, `claim` at activate. */
  took: string[];
  /** What the worker said with `console.warn`, first argument each. */
  warned: string[];
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

/**
 * `stores`: the caches of another worker, for two workers of one origin.
 * `noCache`: the browser refuses to open a cache (storage refused, a private window).
 */
export function worker(
  version?: string,
  opts: { active?: boolean; mount?: string; stores?: Stores; noCache?: boolean } = {},
): Worker {
  const mount = opts.mount ?? '';
  const took: string[] = [];
  const warned: string[] = [];
  const stores: Stores = opts.stores ?? new Map();
  const network = new Map<string, () => Response>();
  const asked: string[] = [];
  const handlers = new Map<string, Handler>();
  const context = {
    URL,
    Response,
    Set,
    Promise,
    console: { warn: (first: unknown) => warned.push(String(first)) },
    self: {
      location: {
        origin: ORIGIN,
        href: `${ORIGIN}${mount}/sw.js${version ? `?v=${version}` : ''}`,
      },
      addEventListener: (type: string, handler: Handler) => handlers.set(type, handler),
      // A worker's reach is the folder of its address. A worker of an earlier
      // version is in charge of the pages, or none is.
      registration: { scope: `${ORIGIN}${mount}/`, active: opts.active ? {} : null },
      skipWaiting: () => Promise.resolve(took.push('skipWaiting')),
      clients: { claim: () => Promise.resolve(took.push('claim')) },
    },
    caches: opts.noCache
      ? {
          ...cachesOver(stores),
          open: () => Promise.reject(new DOMException('refused', 'UnknownError')),
        }
      : cachesOver(stores),
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
  return { mount, stores, network, asked, took, warned, ...exposed, ...eventsOf(handlers) };
}

export const page = (body: string) => () =>
  new Response(body, { status: 200, headers: { 'Content-Type': 'text/html' } });
export const file = () => new Response('/* a chunk */', { status: 200 });

/**
 * A hall with a network: every shell answers under the worker's mount, and
 * names its scripts both ways. The scripts stay at `/_next/static/…`: their
 * prefix is the build's, not the mount's.
 */
export function online(sw: Worker) {
  for (const path of [
    '/',
    '/login',
    '/lices',
    '/offline',
    '/desk',
    '/gear',
    `/lices/${SHELL_ID}`,
  ]) {
    const url = sw.mount + path;
    sw.network.set(url, page(`<script src="/_next/static/chunks/main.js"></script>${url}`));
  }
  sw.network.set(
    `${sw.mount}/matches/${SHELL_ID}`,
    page(
      '<link rel="stylesheet" href="/_next/static/css/pad.css">' +
        '<script src="/_next/static/chunks/bout.js" async></script>' +
        '<script>self.__next_f.push([1,"[\\"static/chunks/lazy-1.js\\",\\"static/media/font.woff2\\"]"])</script>',
    ),
  );
  for (const name of [
    'chunks/main.js',
    'chunks/bout.js',
    'css/pad.css',
    'chunks/lazy-1.js',
    'media/font.woff2',
  ]) {
    sw.network.set(`/_next/static/${name}`, file);
  }
}
