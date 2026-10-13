import { describe, expect, it, vi } from 'vitest';
import { readMySchedule } from './read-my-schedule';

/**
 * What one read of the guest schedule means (quick win F1). The page said "Sign
 * in to see your schedule" after ANY answer that was not the schedule, so a
 * fighter with a weak signal believed they had none.
 */
const URL = 'http://api.test/schedule';
const answering = (status: number, body: unknown = {}) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
const live = () => new AbortController().signal;

describe('readMySchedule', () => {
  it('hands the schedule over', async () => {
    const read = await readMySchedule(URL, live(), answering(200, { personId: 'p-1' }));
    expect(read).toEqual({ kind: 'data', data: { personId: 'p-1' } });
  });

  it('sends the login with the read', async () => {
    const fetchMock = answering(200);
    const signal = live();
    await readMySchedule(URL, signal, fetchMock);
    expect(fetchMock).toHaveBeenCalledWith(URL, { credentials: 'include', signal });
  });

  it('reads a 401 as signed out: the server knows nobody on this device', async () => {
    expect(await readMySchedule(URL, live(), answering(401))).toEqual({ kind: 'signedOut' });
  });

  it.each([400, 403, 404, 429, 500, 502, 503])(
    'reads a %i as a failed read, not as signed out',
    async (status) => {
      expect(await readMySchedule(URL, live(), answering(status))).toEqual({ kind: 'failed' });
    },
  );

  it('reads a request with no answer as a failed read', async () => {
    const dead = vi.fn(async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;
    expect(await readMySchedule(URL, live(), dead)).toEqual({ kind: 'failed' });
  });

  it('reads an answer that is not a schedule as a failed read', async () => {
    const html = vi.fn(
      async () => new Response('<html>', { status: 200 }),
    ) as unknown as typeof fetch;
    expect(await readMySchedule(URL, live(), html)).toEqual({ kind: 'failed' });
  });

  it('says so when the page left before the answer: nothing is shown for it', async () => {
    const controller = new AbortController();
    const left = vi.fn(async () => {
      controller.abort();
      throw new DOMException('aborted', 'AbortError');
    }) as unknown as typeof fetch;
    expect(await readMySchedule(URL, controller.signal, left)).toEqual({ kind: 'aborted' });
  });
});
