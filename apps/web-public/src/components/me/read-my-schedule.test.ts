import { afterEach, describe, expect, it, vi } from 'vitest';
import { readMySchedule } from './read-my-schedule';

/**
 * What one read of a person's schedule means (quick win F1). The page said "Sign
 * in to see your schedule" after ANY answer that was not the schedule, so a
 * fighter with a weak signal believed they had none.
 */
const API = 'http://api.test';
const SCHEDULE = `${API}/api/v1/events/fal-2026/my-schedule`;
const response = (status: number, body: unknown = {}) =>
  new Response(JSON.stringify(body), { status });
const live = () => new AbortController().signal;

/** The server's answers, in the order the page asks. */
function answers(...list: (Response | Error)[]) {
  const fetched = vi.fn(async (_url: string, _init?: RequestInit) => {
    const next = list.shift();
    if (!next) throw new Error('the test gave no answer for this request');
    if (next instanceof Error) throw next;
    return next;
  });
  vi.stubGlobal('fetch', fetched);
  return fetched;
}
const asked = (fetched: ReturnType<typeof answers>) =>
  fetched.mock.calls.map(([url]) => url.replace(API, ''));
const read = (signal = live()) => readMySchedule(API, 'fal-2026', signal);

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('readMySchedule', () => {
  it('hands the schedule over', async () => {
    answers(response(200, { personId: 'p-1' }));
    expect(await read()).toEqual({ kind: 'data', data: { personId: 'p-1' } });
  });

  it('sends the login with the read', async () => {
    const fetched = answers(response(200));
    const signal = live();
    await read(signal);
    expect(fetched).toHaveBeenCalledWith(SCHEDULE, { credentials: 'include', signal });
  });

  it('reads a 401 as signed out: the server knows nobody on this device', async () => {
    answers(response(401));
    expect(await read()).toEqual({ kind: 'signedOut' });
  });

  it('reads a 404 as not found: the Event is unknown, or hidden from this caller', async () => {
    answers(response(404));
    expect(await read()).toEqual({ kind: 'notFound' });
  });

  it.each([400, 403, 429, 500, 502, 503])(
    'reads a %i as a failed read, not as signed out',
    async (status) => {
      answers(response(status));
      expect(await read()).toEqual({ kind: 'failed' });
    },
  );

  it('reads a request with no answer as a failed read', async () => {
    answers(new TypeError('fetch failed'));
    expect(await read()).toEqual({ kind: 'failed' });
  });

  it('reads an answer that is not a schedule as a failed read', async () => {
    answers(new Response('<html>', { status: 200 }));
    expect(await read()).toEqual({ kind: 'failed' });
  });

  it('says so when the page left before the answer: nothing is shown for it', async () => {
    const controller = new AbortController();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        controller.abort();
        throw new DOMException('aborted', 'AbortError');
      }),
    );
    expect(await read(controller.signal)).toEqual({ kind: 'aborted' });
  });
});

/**
 * The login cookie lasts an hour, and only `/me` renews it. Paul opens his
 * schedule after lunch: the read answers 401 for a login that is still good.
 * Read as "signed out", it took his schedule off the screen AND off the phone,
 * the copy this page keeps for a hall with no signal.
 */
describe('a login that only needs renewal', () => {
  // The renewal runs in a browser only: `fetchRenewingLogin` reads `window`.
  const inBrowser = () => vi.stubGlobal('window', globalThis);
  const me = (type: 'claimed' | 'guest' | 'anonymous') => response(200, { type });

  it('is renewed once, and the schedule is read again', async () => {
    inBrowser();
    const fetched = answers(response(401), me('claimed'), response(200, { personId: 'paul' }));

    expect(await read()).toEqual({ kind: 'data', data: { personId: 'paul' } });
    expect(asked(fetched)).toEqual([
      '/api/v1/events/fal-2026/my-schedule',
      '/api/v1/me',
      '/api/v1/events/fal-2026/my-schedule',
    ]);
  });

  it('a second 401 is the answer: an account with no row at this Event', async () => {
    inBrowser();
    const fetched = answers(response(401), me('claimed'), response(401));

    expect(await read()).toEqual({ kind: 'signedOut' });
    expect(fetched).toHaveBeenCalledTimes(3);
  });

  it.each(['anonymous', 'guest'] as const)(
    'a %s visitor is signed out, and the read is not sent again',
    async (type) => {
      inBrowser();
      const fetched = answers(response(401), me(type));

      expect(await read()).toEqual({ kind: 'signedOut' });
      expect(fetched).toHaveBeenCalledTimes(2);
    },
  );
});
