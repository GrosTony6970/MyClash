import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { db } from './db';
import { fetchWithCache, readCached, writeCached } from './cached-reads';

const PATH = '/api/v1/tournaments/t-1/match-config';
const BODY = { scoringConfig: { afterblowMode: 'full' }, matchFormat: { pointCap: 15 } };

/** The exact response the service worker manufactures for an offline /api/ call. */
const swOffline = () =>
  new Response(JSON.stringify({ error: 'offline', status: 503 }), {
    status: 503,
    headers: { 'Content-Type': 'application/json' },
  });

const ok = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

beforeEach(async () => {
  await db.reads.clear();
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('cached reads', () => {
  it('returns null for a path never fetched', async () => {
    expect(await readCached(PATH)).toBeNull();
  });

  it('round-trips a body and stamps when it was fetched', async () => {
    await writeCached(PATH, BODY);
    const cached = await readCached<typeof BODY>(PATH);
    expect(cached?.body).toEqual(BODY);
    expect(cached?.fetchedAt).toBeGreaterThan(0);
  });

  it('caches a successful fetch and reports it as fresh', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ok(BODY)));
    const result = await fetchWithCache<typeof BODY>('', PATH);
    expect(result?.fresh).toBe(true);
    expect(result?.body).toEqual(BODY);
    expect((await readCached<typeof BODY>(PATH))?.body).toEqual(BODY);
  });

  /**
   * THE CASE THIS MODULE EXISTS FOR. The service worker RESOLVES a synthetic
   * 503 rather than throwing, so `ok` is the only signal separating a real
   * answer from a manufactured one. A `catch`-only fallback would never fire
   * and the pad would arm the federal default in silence.
   */
  it('falls back to the cache on the service worker’s synthetic 503', async () => {
    await writeCached(PATH, BODY);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(swOffline()));

    const result = await fetchWithCache<typeof BODY>('', PATH);

    expect(result?.body).toEqual(BODY);
    expect(result?.fresh).toBe(false);
  });

  it('falls back to the cache when the request throws outright', async () => {
    // No service worker in control — local dev, or a first visit before it
    // activates. Same verdict.
    await writeCached(PATH, BODY);
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')));

    const result = await fetchWithCache<typeof BODY>('', PATH);

    expect(result?.body).toEqual(BODY);
    expect(result?.fresh).toBe(false);
  });

  /**
   * The one case where the pad genuinely does not know. It must return null so
   * the caller keeps its own defaults AND can say so — quietly arming the
   * federal +2/+1 on a custom ruleset is the bug this replaces.
   */
  it('returns null when the network fails and nothing is cached', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(swOffline()));
    expect(await fetchWithCache<typeof BODY>('', PATH)).toBeNull();
  });

  it('overwrites a stale entry when the network answers again', async () => {
    await writeCached(PATH, { scoringConfig: { afterblowMode: 'deductive' } });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ok(BODY)));

    const result = await fetchWithCache<typeof BODY>('', PATH);

    expect(result?.fresh).toBe(true);
    expect((await readCached<typeof BODY>(PATH))?.body).toEqual(BODY);
  });

  it('keys by path, so two tournaments do not share a config', async () => {
    await writeCached('/api/v1/tournaments/t-1/match-config', { scoringConfig: 'one' });
    await writeCached('/api/v1/tournaments/t-2/match-config', { scoringConfig: 'two' });

    expect(
      (await readCached<{ scoringConfig: string }>('/api/v1/tournaments/t-1/match-config'))?.body,
    ).toEqual({ scoringConfig: 'one' });
    expect(
      (await readCached<{ scoringConfig: string }>('/api/v1/tournaments/t-2/match-config'))?.body,
    ).toEqual({ scoringConfig: 'two' });
  });
});
