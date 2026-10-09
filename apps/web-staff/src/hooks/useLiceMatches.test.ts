import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { offlineResponse } from '../offline/failure-kind';
import { readLiceMatches } from './useLiceMatches';

/**
 * The piste's bout list, opened with no network.
 *
 * The official opens the piste in a hall with no wifi. The read was skipped
 * before its `try`, so the `finally` that ends the loading never ran: the
 * screen said "Loading" for ever, and he took the tablet for broken.
 */
const URL = 'http://api.test/api/v1/staff/lices/lice-1/matches';
const LIST = { liceName: 'Piste 1', matches: [] };
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('readLiceMatches', () => {
  it('asks nothing with no network, and says the list is out of reach', async () => {
    const fetchFn = vi.fn();
    expect(await readLiceMatches(URL, false, fetchFn)).toEqual({ kind: 'unreachable' });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('reads the list with the session, never from a cache', async () => {
    const fetchFn = vi.fn(async () => json(LIST));
    expect(await readLiceMatches(URL, true, fetchFn)).toEqual({ kind: 'data', data: LIST });
    expect(fetchFn).toHaveBeenCalledWith(URL, { credentials: 'include', cache: 'no-store' });
  });

  it('reads the service worker’s offline answer as out of reach', async () => {
    const read = await readLiceMatches(URL, true, async () => offlineResponse());
    expect(read).toEqual({ kind: 'unreachable' });
  });

  it('reads a request that never got an answer as out of reach', async () => {
    const read = await readLiceMatches(URL, true, async () => {
      throw new TypeError('Failed to fetch');
    });
    expect(read).toEqual({ kind: 'unreachable' });
  });

  it.each([401, 403])('reads a %i as signed out', async (status) => {
    const read = await readLiceMatches(URL, true, async () => json({}, status));
    expect(read).toEqual({ kind: 'signedOut' });
  });

  it.each([500, 502, 404])('reads a %i as a failed read, not as no network', async (status) => {
    const read = await readLiceMatches(URL, true, async () => json({ detail: 'x' }, status));
    expect(read).toEqual({ kind: 'failed' });
  });

  it('reads a 200 with a broken body as a failed read', async () => {
    const read = await readLiceMatches(URL, true, async () => new Response('<html>'));
    expect(read).toEqual({ kind: 'failed' });
  });
});

describe('the piste screen', () => {
  const hook = readFileSync(join(__dirname, 'useLiceMatches.ts'), 'utf8');
  const page = readFileSync(
    join(__dirname, '..', '..', 'app', 'lices', '[liceId]', 'page.tsx'),
    'utf8',
  );

  it('ends the loading after every read, the one with no network too', () => {
    const read = hook.indexOf('const read = await readLiceMatches(');
    const ended = hook.indexOf('setLoading(false);');
    expect(read).toBeGreaterThan(0);
    expect(ended).toBeGreaterThan(read);
    // Not behind a `try` the offline path never enters.
    expect(hook).not.toContain('} finally {');
  });

  it('keeps the list it has: only a good read writes it', () => {
    expect(hook.match(/setData\(/g)).toHaveLength(1);
    expect(hook).toContain("if (read.kind === 'data') setData(read.data);");
    expect(hook).toContain("setUnreachable(read.kind === 'unreachable');");
  });

  it('says "no connection" in place of the lists when it has no list and no network', () => {
    expect(page).toContain('{!data && unreachable ? (');
    expect(page).toContain("{t('scoring.lice.listUnreachable')}");
  });
});
