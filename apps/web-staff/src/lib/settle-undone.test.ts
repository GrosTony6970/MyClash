import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';

import { db } from '../offline/db';
import { settleUndone } from './settle-undone';

/**
 * An undo the tablet wrote down is settled with the server (ruling 350).
 *
 * The referee undid hit 5 while the server could not be asked. The server held
 * it all the same: the answer to its send was lost. Once the server answers,
 * the pad voids it there. A void the server refuses for good is forgotten; one
 * it could not judge is tried again.
 */
const API_URL = 'http://localhost:4000';
const REASON =
  'Dernière saisie annulée sur la tablette de score / Last entry undone on the scoring pad';

beforeEach(async () => {
  await db.undone.clear();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': status >= 400 ? 'application/problem+json' : 'application/json' },
  });
const refusal = (status: number, code: string | null) =>
  json(status, code ? { status, detail: 'the server’s English', code } : { error: 'edge' });
const row = (id: string, clientUuid: string, voided = false) => ({
  id,
  client_uuid: clientUuid,
  voided,
  sequence: 1,
  occurred_at: '2026-10-06T10:01:00.000Z',
});

interface Server {
  mayScore?: () => Response;
  hits?: unknown[];
  cards?: unknown[];
  voids?: () => Response;
}

/** Did the last void carry a signal? A void with none can hold a run for ever. */
let voidCanBeStopped = false;

function server({ mayScore, hits = [], cards = [], voids }: Server) {
  const calls: Array<[string, string, unknown]> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: { method?: string; body?: string; signal?: unknown }) => {
      const path = url.replace(`${API_URL}/api/v1`, '');
      calls.push([init?.method ?? 'GET', path, init?.body ? JSON.parse(init.body) : undefined]);
      if (init?.method === 'PATCH') voidCanBeStopped = init.signal instanceof AbortSignal;
      if (init?.method === 'PATCH') return (voids ?? (() => json(200, { voided: true })))();
      if (path.endsWith('/penalty-ruleset')) return (mayScore ?? (() => json(200, {})))();
      // The bout itself: still in play, so an undo the tablet remembered is sent (ruling 366).
      if (!/\/(exchanges|penalties)$/.test(path)) return json(200, { status: 'running' });
      return json(200, path.endsWith('/exchanges') ? hits : cards);
    }),
  );
  const asked = (method: string) => calls.filter(([verb]) => verb === method).map(([, at]) => at);
  return { calls, asked };
}

const HOUR = 60 * 60 * 1000;
const wroteDown = (clientUuid: string, matchId = 'm1', hoursAgo = 0) =>
  db.undone.put({ clientUuid, matchId, undoneAt: Date.now() - hoursAgo * HOUR });
const stillWritten = async () => (await db.undone.toArray()).map((entry) => entry.clientUuid);

describe('settleUndone', () => {
  it('with nothing written down, asks the server nothing', async () => {
    const { calls } = server({});

    expect(await settleUndone(API_URL)).toEqual(new Map());
    expect(calls).toEqual([]);
  });

  it('voids a hit the server holds, with the undo’s fixed reason, and forgets it', async () => {
    await wroteDown('uuid-5');
    const { calls } = server({ hits: [row('ex-4', 'uuid-4'), row('ex-5', 'uuid-5')] });

    expect(await settleUndone(API_URL)).toEqual(new Map([['uuid-5', 'voided']]));

    expect(calls.at(-1)).toEqual(['PATCH', '/exchanges/ex-5/void', { reason: REASON }]);
    expect(voidCanBeStopped).toBe(true);
    expect(await stillWritten()).toEqual([]);
  });

  it('voids a card by the card’s route', async () => {
    await wroteDown('uuid-c');
    const { asked } = server({ cards: [row('card-1', 'uuid-c')] });

    await settleUndone(API_URL);

    expect(asked('PATCH')).toEqual(['/match-penalties/card-1/void']);
  });

  it('a 202 is a request filed for review: forgotten, and not said as voided', async () => {
    await wroteDown('uuid-5');
    server({ hits: [row('ex-5', 'uuid-5')], voids: () => json(202, { pendingReview: true }) });

    expect(await settleUndone(API_URL)).toEqual(new Map([['uuid-5', 'review']]));
    expect(await stillWritten()).toEqual([]);
  });

  it.each([
    ['holds no entry of that id', [row('ex-4', 'uuid-4')]],
    ['holds it voided', [row('ex-5', 'uuid-5', true)]],
  ])('the server %s: forgotten, and nothing is voided', async (_what, hits) => {
    await wroteDown('uuid-5');
    const { asked } = server({ hits });

    expect(await settleUndone(API_URL)).toEqual(new Map([['uuid-5', 'absent']]));

    expect(asked('PATCH')).toEqual([]);
    expect(await stillWritten()).toEqual([]);
  });

  it.each([
    ['a 401', () => refusal(401, 'unauthorized')],
    ['a 429', () => refusal(429, 'too_many_requests')],
    ['a 503', () => refusal(503, 'read_only_mode')],
    ['a 404 the edge wrote', () => refusal(404, null)],
    ['a 403 the edge wrote', () => refusal(403, null)],
    // About who is signed in: a pad of another piste today, the right one tomorrow.
    ['a 403 of the API', () => refusal(403, 'FORBIDDEN')],
  ])('the server could not be asked (%s): kept, and no list is trusted', async (_what, answer) => {
    await wroteDown('uuid-5');
    const { asked } = server({ mayScore: answer, hits: [] });

    expect(await settleUndone(API_URL)).toEqual(new Map([['uuid-5', 'kept']]));

    expect(asked('PATCH')).toEqual([]);
    expect(await stillWritten()).toEqual(['uuid-5']);
  });

  it('a bout that is gone: forgotten, with a trace', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await wroteDown('uuid-5');
    server({ mayScore: () => refusal(404, 'NOT_FOUND') });

    const settled = await settleUndone(API_URL);

    expect(settled.get('uuid-5')).toMatchObject({ refused: { status: 404 }, matchId: 'm1' });
    expect(await stillWritten()).toEqual([]);
    expect(console.warn).toHaveBeenCalledOnce();
  });

  it('an undo nobody could ask about for a day is let go, with a trace and no request', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await wroteDown('uuid-old', 'm1', 25);
    await wroteDown('uuid-new', 'm2', 23);
    const { asked } = server({});

    expect(await settleUndone(API_URL)).toEqual(
      new Map([
        ['uuid-old', 'expired'],
        ['uuid-new', 'absent'],
      ]),
    );

    expect(asked('GET').every((path) => path.startsWith('/matches/m2/'))).toBe(true);
    expect(await stillWritten()).toEqual([]);
    expect(console.warn).toHaveBeenCalledOnce();
  });

  it.each([
    [400, 'BAD_REQUEST'],
    [409, 'event_results_frozen'],
  ])('a void the server judged and refused (%s): forgotten, and said', async (status, code) => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await wroteDown('uuid-5');
    server({ hits: [row('ex-5', 'uuid-5')], voids: () => refusal(status, code) });

    const settled = await settleUndone(API_URL);

    expect(settled.get('uuid-5')).toMatchObject({ refused: { status, code }, matchId: 'm1' });
    expect(await stillWritten()).toEqual([]);
  });

  it.each([
    [500, 'INTERNAL'],
    [400, null],
    [403, 'FORBIDDEN'],
  ])('a void the server did not judge (%s, code %s): kept', async (status, code) => {
    await wroteDown('uuid-5');
    server({ hits: [row('ex-5', 'uuid-5')], voids: () => refusal(status, code) });

    expect(await settleUndone(API_URL)).toEqual(new Map([['uuid-5', 'kept']]));
    expect(await stillWritten()).toEqual(['uuid-5']);
  });

  it('reads each bout once, and only the bout asked for', async () => {
    await wroteDown('uuid-1', 'm1');
    await wroteDown('uuid-2', 'm1');
    await wroteDown('uuid-9', 'm2');
    const { asked } = server({});

    const settled = await settleUndone(API_URL, 'm1');

    expect([...settled.keys()].sort()).toEqual(['uuid-1', 'uuid-2']);
    expect(asked('GET')).toEqual([
      '/matches/m1/penalty-ruleset',
      '/matches/m1/exchanges',
      '/matches/m1/penalties',
    ]);
    expect(await stillWritten()).toEqual(['uuid-9']);
  });

  // The race: the undo's own run and the watcher's, over one entry.
  it('two runs at once void the entry once', async () => {
    await wroteDown('uuid-5');
    const { asked } = server({ hits: [row('ex-5', 'uuid-5')] });

    const [first, second] = await Promise.all([settleUndone(API_URL), settleUndone(API_URL)]);

    expect(first).toEqual(new Map([['uuid-5', 'voided']]));
    expect(second).toEqual(new Map());
    expect(asked('PATCH')).toHaveLength(1);
  });

  it('a run that threw does not stop the next one', async () => {
    await wroteDown('uuid-5');
    const { asked } = server({ hits: [row('ex-5', 'uuid-5')] });
    vi.spyOn(db.undone, 'toArray').mockRejectedValueOnce(new Error('the store failed'));

    await expect(settleUndone(API_URL)).rejects.toThrow('the store failed');
    await settleUndone(API_URL);

    expect(asked('PATCH')).toHaveLength(1);
  });
});
