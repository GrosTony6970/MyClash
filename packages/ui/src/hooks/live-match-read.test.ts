import { describe, expect, it, vi } from 'vitest';
import { readLiveMatch } from './live-match-read';

const API = 'https://api.example.test';
const ID = 'match-1';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** Answers each of the four reads by its path suffix. */
function api(answers: Record<string, () => Response>) {
  return vi.fn(async (url: string) => {
    const route = Object.keys(answers).find((suffix) => url.endsWith(suffix));
    if (!route) throw new Error(`unexpected read ${url}`);
    return answers[route]!();
  });
}

describe('readLiveMatch — the four reads behind a live scoreboard', () => {
  it('reads the bout, its cards, its exchanges and its clock with the login, never from a cache', async () => {
    const fetchImpl = api({
      '/display': () => json({ id: ID, hiddenFromPublic: true }),
      '/penalties': () => json([{ id: 'p' }]),
      '/exchanges': () => json([{ id: 'x' }]),
      '/clock': () => json({ status: 'paused', activeMs: 1000, runningFrom: null }),
    });

    const read = await readLiveMatch(API, ID, fetchImpl as never);

    for (const path of ['display', 'penalties', 'exchanges', 'clock']) {
      expect(fetchImpl).toHaveBeenCalledWith(`${API}/api/v1/matches/${ID}/${path}`, {
        cache: 'no-store',
        credentials: 'include',
      });
    }
    expect(read).toEqual({
      ok: true,
      match: { id: ID, hiddenFromPublic: true },
      penalties: [{ id: 'p' }],
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
