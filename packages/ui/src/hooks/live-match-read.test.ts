import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readLiveMatch } from './live-match-read';

const API = 'https://api.example.test';
const ID = 'match-1';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** Answers each of the five reads by its path suffix. */
function api(answers: Record<string, () => Response>) {
  return vi.fn(async (url: string) => {
    const route = Object.keys(answers).find((suffix) => url.endsWith(suffix));
    if (!route) throw new Error(`unexpected read ${url}`);
    return answers[route]!();
  });
}

describe('readLiveMatch — the five reads behind a live scoreboard', () => {
  it('reads the bout, its cards, its protests, its exchanges and its clock with the login, never from a cache', async () => {
    const fetchImpl = api({
      '/display': () => json({ id: ID, hiddenFromPublic: true }),
      '/penalties': () => json([{ id: 'p' }]),
      '/protests': () => json([{ id: 'pr' }]),
      '/exchanges': () => json([{ id: 'x' }]),
      '/clock': () => json({ status: 'paused', activeMs: 1000, runningFrom: null }),
    });

    const read = await readLiveMatch(API, ID, fetchImpl as never);

    for (const path of ['display', 'penalties', 'protests', 'exchanges', 'clock']) {
      expect(fetchImpl).toHaveBeenCalledWith(`${API}/api/v1/matches/${ID}/${path}`, {
        cache: 'no-store',
        credentials: 'include',
      });
    }
    expect(read).toEqual({
      ok: true,
      match: { id: ID, hiddenFromPublic: true },
      penalties: [{ id: 'p' }],
      protests: [{ id: 'pr' }],
      exchanges: [{ id: 'x' }],
      clock: { status: 'paused', activeMs: 1000, runningFrom: null },
    });
  });

  it('keeps what it has for a side read that failed', async () => {
    const read = await readLiveMatch(
      API,
      ID,
      api({
        '/display': () => json({ id: ID }),
        '/penalties': () => json({ detail: 'x' }, 500),
        '/protests': () => json({ detail: 'x' }, 500),
        '/exchanges': () => json([]),
        '/clock': () => json({ detail: 'x' }, 503),
      }) as never,
    );

    expect(read).toEqual({ ok: true, match: { id: ID }, exchanges: [] });
  });

  it("reports a refused bout in the API's own words, detail first", async () => {
    const read = await readLiveMatch(
      API,
      ID,
      api({
        '/display': () => json({ detail: 'Match not found', message: 'other' }, 404),
        '/penalties': () => json([]),
        '/protests': () => json([]),
        '/exchanges': () => json([]),
        '/clock': () => json({}),
      }) as never,
    );

    expect(read).toEqual({ ok: false, error: { status: 404, message: 'Match not found' } });
  });

  it('reports a network failure as status 0', async () => {
    const read = await readLiveMatch(
      API,
      ID,
      vi.fn(() => Promise.reject(new TypeError('fetch failed'))) as never,
    );

    expect(read).toEqual({ ok: false, error: { status: 0, message: 'fetch failed' } });
  });
});

/**
 * `pnpm db:realtime-bindings` holds the other direction (a bound table must be
 * published). It stays green when the binding is simply missing, and then a
 * protest reaches a live scoreboard only at its next unrelated change.
 */
describe('useLiveMatch — the live channel', () => {
  it('binds the protests of the bout, as it binds its cards', () => {
    const source = readFileSync(join(__dirname, 'useLiveMatch.ts'), 'utf8');
    expect(source).toMatch(
      /table: 'match_protests',\s+filter: `match_id=eq\.\$\{matchId\}`,\s+\},\s+\(\) => scheduleRefresh\(\),/,
    );
  });
});
