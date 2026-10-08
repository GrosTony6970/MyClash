import { afterEach, describe, expect, it, vi } from 'vitest';

import { readServerEntries } from './server-entries';

/**
 * The bout as the server holds it, for the undo (ruling 350).
 *
 * The two lists are public reads: to a caller they do not know they answer an
 * empty list with a 200. A pad whose login ran out would read "the server holds
 * nothing". So a read for who may score goes first, alone, and the whole read
 * has one time limit.
 */
const API_URL = 'http://localhost:4000';
const BOUT = '/api/v1/matches/m1';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': status >= 400 ? 'application/problem+json' : 'application/json' },
  });

/** Was the last request sent told to stop? */
let stopped: () => boolean | undefined = () => undefined;

/** A server that answers each path from `answers`; a path with no answer never answers. */
function server(answers: Record<string, () => Response | Promise<Response>>) {
  const asked: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: { signal?: AbortSignal }) => {
      const path = url.replace(API_URL, '');
      asked.push(path);
      stopped = () => init?.signal?.aborted;
      return answers[path] ? Promise.resolve(answers[path]()) : new Promise<Response>(() => {});
    }),
  );
  return asked;
}

const HIT = {
  id: 'ex-1',
  client_uuid: 'uuid-1',
  voided: false,
  sequence: 1,
  occurred_at: '2026-10-06T10:01:00.000Z',
};
const CARD = { id: 'card-2', client_uuid: 'uuid-2', voided: true, sequence: 2, occurred_at: null };
const LISTS = {
  [`${BOUT}/exchanges`]: () => json(200, [HIT]),
  [`${BOUT}/penalties`]: () => json(200, [CARD]),
};

describe('readServerEntries', () => {
  it('hands back every hit and card, each with the id the tablet gave it', async () => {
    server({ [`${BOUT}/penalty-ruleset`]: () => json(200, {}), ...LISTS });

    await expect(readServerEntries(API_URL, 'm1')).resolves.toEqual({
      rows: [
        {
          kind: 'exchange',
          id: 'ex-1',
          clientUuid: 'uuid-1',
          voided: false,
          sequence: 1,
          occurredAt: '2026-10-06T10:01:00.000Z',
        },
        {
          kind: 'penalty',
          id: 'card-2',
          clientUuid: 'uuid-2',
          voided: true,
          sequence: 2,
          occurredAt: '',
        },
      ],
    });
  });

  it('asks who may score FIRST: no list is read before that answer', async () => {
    let answer: (res: Response) => void = () => {};
    const asked = server({
      [`${BOUT}/penalty-ruleset`]: () => new Promise<Response>((resolve) => (answer = resolve)),
      ...LISTS,
    });

    const read = readServerEntries(API_URL, 'm1');
    await vi.waitFor(() => expect(asked).toEqual([`${BOUT}/penalty-ruleset`]));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(asked).toEqual([`${BOUT}/penalty-ruleset`]);

    answer(json(200, {}));
    await read;
    expect(asked.slice(1).sort()).toEqual([`${BOUT}/exchanges`, `${BOUT}/penalties`]);
  });

  it('a caller who may not score the bout: the refusal, and no list is read', async () => {
    const asked = server({
      [`${BOUT}/penalty-ruleset`]: () =>
        json(403, { status: 403, detail: 'no', code: 'FORBIDDEN' }),
      ...LISTS,
    });

    await expect(readServerEntries(API_URL, 'm1')).resolves.toMatchObject({
      failure: { status: 403, code: 'FORBIDDEN' },
    });
    expect(asked).toEqual([`${BOUT}/penalty-ruleset`]);
  });

  it.each([`${BOUT}/exchanges`, `${BOUT}/penalties`])(
    'a failed list (%s) fails the read: nothing is decided on half the bout',
    async (path) => {
      server({
        [`${BOUT}/penalty-ruleset`]: () => json(200, {}),
        ...LISTS,
        [path]: () => json(500, { status: 500, detail: 'boom', code: 'INTERNAL' }),
      });

      await expect(readServerEntries(API_URL, 'm1')).resolves.toMatchObject({
        failure: { status: 500 },
      });
    },
  );

  it('a server that never answers: the read ends at 4 seconds, not before', async () => {
    vi.useFakeTimers();
    server({});
    let ended: unknown = 'waiting';

    void readServerEntries(API_URL, 'm1').then((read) => (ended = read));
    await vi.advanceTimersByTimeAsync(3999);
    expect(ended).toBe('waiting');
    expect(stopped()).toBe(false);
    await vi.advanceTimersByTimeAsync(1);

    expect(ended).toEqual({ failure: { kind: 'aborted' } });
    expect(stopped(), 'the request left in the air is told to stop').toBe(true);
  });

  // A 401 makes the client renew the login through `/me`, a read with no limit of its own.
  it('a login that ran out on a dead network: the renewal is held to the same 4 seconds', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('window', globalThis); // the renewal runs in a browser only
    const asked = server({
      [`${BOUT}/penalty-ruleset`]: () => json(401, { status: 401, detail: 'no', code: 'x' }),
    });
    let ended: unknown = 'waiting';

    void readServerEntries(API_URL, 'm1').then((read) => (ended = read));
    await vi.advanceTimersByTimeAsync(4000);

    expect(asked).toEqual([`${BOUT}/penalty-ruleset`, '/api/v1/me']);
    expect(ended).toEqual({ failure: { kind: 'aborted' } });
  });
});
