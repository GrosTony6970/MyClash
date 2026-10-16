import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchTournamentStats } from './stats-data';

/**
 * A club member opens the stats of her club's draft Tournament. The three reads went out with
 * no login, so the API answered them as for a stranger: empty. Each read now carries the login
 * the caller hands over (ruling 127a).
 */
const API = 'https://api.example.test';

function answering() {
  const fetched = vi.fn(async (_url: string, _init?: RequestInit) =>
    Response.json({}, { status: 200 }),
  );
  vi.stubGlobal('fetch', fetched);
  return fetched;
}

afterEach(() => vi.unstubAllGlobals());

describe('fetchTournamentStats', () => {
  it.each([
    ['the server, with the cookie header', { headers: { cookie: 'sb-access-token=a-login' } }],
    ['the browser, with its credentials', { credentials: 'include' as const }],
  ])('sends the login on each of its three reads: %s', async (_from, login) => {
    const fetched = answering();

    await fetchTournamentStats('t-1', API, login);

    expect(fetched.mock.calls.map(([url]) => url.replace(API, ''))).toEqual([
      '/api/v1/tournaments/t-1/stats/overview',
      '/api/v1/tournaments/t-1/stats/fighters',
      '/api/v1/tournaments/t-1/stats/target-values',
    ]);
    for (const [, init] of fetched.mock.calls) {
      expect(init).toEqual({ cache: 'no-store', ...login });
    }
  });
});
