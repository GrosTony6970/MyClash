import { beforeEach, describe, expect, it } from 'vitest';
import { SHELL_ID } from '../lib/nav';
import { offlineResponse } from './failure-kind';
import { CACHE, SOURCE, file, online, page, worker, type Worker } from './sw.fixtures';

/**
 * The service worker itself: `public/sw.js`, run as the browser runs it, over a
 * cache and a network made here.
 *
 * It is a plain file the browser loads, with no module and no build, so it is
 * read and run in a context of its own. What a made-up browser cannot show (a
 * page kept as a shell that hydrates under another address) was shown once
 * with the real worker on a production build: see ARCHITECTURE 10.4.
 */
let sw: Worker;
beforeEach(() => {
  sw = worker('14f7b056');
});

describe('the shell of an address', () => {
  it('is the bout shell for any bout, and the piste shell for any piste', () => {
    expect(sw.shellFor('/matches/1b4e28ba-2fa1-11d2-883f-0016d3cca427')).toBe('/matches/_');
    expect(sw.shellFor('/lices/lice-7')).toBe('/lices/_');
    // With a slash at its end too: the page reads both as that bout.
    expect(sw.shellFor('/matches/bout-1/')).toBe('/matches/_');
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
      // With its query: the page asks for it so, and the cache answers the same address.
      '/staff/_next/static/chunks/b.js?dpl=1',
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
    expect(next.took).toEqual(['skipWaiting', 'claim']);
    expect(next.stores.get('myclash-staff-14f7b056')!.has('/matches/_')).toBe(true);
  });

  it('has a name of its own for a worker registered with no version', async () => {
    const bare = worker();
    await bare.install();

    expect([...bare.stores.keys()]).toEqual(['myclash-staff-unversioned']);
  });
});

describe('the install', () => {
  it('keeps the eight shells and every static file they name, then takes over', async () => {
    online(sw);

    await sw.install();

    const kept = [...sw.stores.get(CACHE)!.keys()].sort();
    expect(kept).toEqual([
      '/',
      '/_next/static/chunks/bout.js',
      '/_next/static/chunks/lazy-1.js',
      '/_next/static/chunks/main.js',
      '/_next/static/css/pad.css',
      '/_next/static/media/font.woff2',
      '/desk',
      '/gear',
      '/lices',
      '/lices/_',
      '/login',
      '/matches/_',
      '/offline',
    ]);
    expect(sw.took).toEqual(['skipWaiting']);
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

  // A first install has no cache to protect: it takes what it got.
  it('ends with nothing kept, and no failure, when there is no network at all', async () => {
    await expect(sw.install()).resolves.toBeUndefined();
    expect([...sw.stores.get(CACHE)!.keys()]).toEqual([]);
    expect(sw.took).toEqual(['skipWaiting']);
  });

  // The cache follows the deploy, so activate removes the cache of the worker
  // before. A tablet reloads just after a deploy and the wifi drops while the
  // shells are kept: half a cache must not replace a whole one.
  describe('of a new version, over a worker that is active', () => {
    const upgrade = () => {
      const next = worker('14f7b056', { active: true });
      online(next);
      return next;
    };

    it('fails when a file got no answer, and does not take over', async () => {
      const next = upgrade();
      next.network.delete('/_next/static/chunks/bout.js');

      await expect(next.install()).rejects.toThrow(/cut the install short/);
      expect(next.took).toEqual([]);
    });

    it('fails when a shell got no answer, or a fault of the server', async () => {
      const cut = upgrade();
      cut.network.delete('/lices/_');
      await expect(cut.install()).rejects.toThrow(/cut the install short/);

      const fault = upgrade();
      fault.network.set('/matches/_', () => new Response('restarting', { status: 502 }));
      await expect(fault.install()).rejects.toThrow(/cut the install short/);
      expect(fault.took).toEqual([]);
    });

    // A file the page names and the server does not have will not come at the
    // next try either: it must not hold every later version back for ever.
    it('goes on when the server says a file is absent', async () => {
      const next = upgrade();
      next.network.set('/_next/static/chunks/lazy-1.js', () => new Response('', { status: 404 }));
      next.network.set('/offline', () => new Response('', { status: 404 }));

      await expect(next.install()).resolves.toBeUndefined();
      expect(next.took).toEqual(['skipWaiting']);
    });

    it('takes over when everything was kept', async () => {
      const next = upgrade();

      await next.install();

      expect(next.took).toEqual(['skipWaiting']);
      expect(next.stores.get(CACHE)!.has('/matches/_')).toBe(true);
    });
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
    expect(await text(sw.ask('/whatever'))).toMatch(/main\.js"><\/script>\/$/);
    // A desk has its own kept page.
    expect(await text(sw.ask('/desk'))).toMatch(/main\.js"><\/script>\/desk$/);
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
    // Word for word the answer the pad keeps beside its classifier: the drill
    // gives that one, and the start page reads its `code`.
    expect(await answer?.json()).toEqual(await offlineResponse().json());
    expect(await offlineResponse().json()).toEqual({
      error: 'offline',
      code: 'offline',
      status: 503,
    });
  });
});
