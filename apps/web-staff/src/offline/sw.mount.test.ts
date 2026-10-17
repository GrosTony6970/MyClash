import { beforeEach, describe, expect, it } from 'vitest';
import { STAFF_MOUNT } from '../lib/nav';
import { CACHE, online, worker, type Worker } from './sw.fixtures';

/**
 * The worker on the organiser site, registered as `/staff/sw.js` (O2a, ruling
 * "No-PIN piste"). There every address that is not under `/staff` is the
 * organiser app's: a shell kept at `/login` or a start page at `/` would be its
 * pages, not the scoring screen. `sw.test.ts` holds the referee site, at the root.
 */
let sw: Worker;
beforeEach(() => {
  sw = worker('14f7b056', { mount: STAFF_MOUNT });
});

/** Every address the worker asked the network for, but the static files. */
const pagesAsked = () => sw.asked.filter((path) => !path.includes('/_next/static/'));

describe('the shell of an address on the organiser site', () => {
  it('is the bout shell or the piste shell under the mount', () => {
    expect(sw.shellFor('/staff/matches/bout-1')).toBe('/staff/matches/_');
    expect(sw.shellFor('/staff/matches/bout-1/')).toBe('/staff/matches/_');
    expect(sw.shellFor('/staff/lices/lice-7')).toBe('/staff/lices/_');
  });

  it('is the start page under the mount for anything else', () => {
    for (const path of ['/staff', '/staff/', '/staff/login', '/staff/matches', '/staff/x/y']) {
      expect(sw.shellFor(path), path).toBe('/staff/');
    }
    expect(sw.shellFor('/staff/matches/bout-1/print')).toBe('/staff/');
  });
});

describe('the install on the organiser site', () => {
  it('keeps the eight shells under the mount, and no page of the organiser app', async () => {
    online(sw);

    await sw.install();

    const pages = [...sw.stores.get(CACHE)!.keys()].filter((key) => !key.includes('/_next/'));
    expect(pages.sort()).toEqual([
      '/staff/',
      '/staff/desk',
      '/staff/gear',
      '/staff/lices',
      '/staff/lices/_',
      '/staff/login',
      '/staff/matches/_',
      '/staff/offline',
    ]);
    expect(
      pagesAsked().every((path) => path.startsWith('/staff/')),
      pagesAsked().join(),
    ).toBe(true);
    expect(sw.stores.get(CACHE)!.has('/_next/static/chunks/bout.js')).toBe(true);
  });
});

describe('a navigation with no network on the organiser site', () => {
  const text = async (answer: Promise<Response> | undefined) => (await answer)?.text();

  beforeEach(async () => {
    online(sw);
    await sw.install();
    sw.network.clear();
    sw.asked.length = 0;
  });

  it('gives a bout the tablet never opened the bout shell', async () => {
    expect(await text(sw.ask('/staff/matches/bout-never-opened'))).toContain('chunks/bout.js');
  });

  it('gives a piste the piste shell, and any other address the start page under the mount', async () => {
    expect(await text(sw.ask('/staff/lices/lice-9'))).toContain('/staff/lices/_');
    expect(await text(sw.ask('/staff/whatever'))).toMatch(/main\.js"><\/script>\/staff\/$/);
  });

  it('gives the start page under the mount when the bout shell was not kept', async () => {
    sw.stores.get(CACHE)!.delete('/staff/matches/_');

    expect(await text(sw.ask('/staff/matches/bout-2'))).toMatch(/main\.js"><\/script>\/staff\/$/);
  });
});

describe('a request of the API on the organiser site', () => {
  // The API is at the root on both sites: the mount does not move it.
  it('is never kept, and with no network is the 503 the pad reads as "no network"', async () => {
    const answer = await sw.ask('/api/v1/matches/bout-1', 'cors');

    expect(answer?.status).toBe(503);
    expect(await answer?.json()).toMatchObject({ code: 'offline' });
  });
});
