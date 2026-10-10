/**
 * The second try of a hit the server answered 400 is read as a first answer.
 *
 * A 400 is re-sent once under a sequence read from the server. That second
 * send can meet an answer about the CALLER: the session ended, or
 * the person may not score (rulings 241, 244, 245). The hit was then put in
 * the refused-hits inbox under the first answer's reason, though nothing
 * refused it. It waits in the queue, as a first answer makes it wait, and a
 * refusal about the bout is held with its own code.
 *
 * It can meet no verdict at all too (ruling 344): no network, read-only mode, a
 * server fault, or the read of the next free number that fails. Nobody refused
 * the hit a second time, so it waits in the queue and goes with the next send.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { tellCallerRefusal } from './caller-refusal';
import { db } from './db';
import { enqueue, getRejected } from './outbox';
import { SyncEngine, type SyncState } from './sync';

const API_URL = 'http://localhost:4000';
const BAD_SEQUENCE = { status: 400, body: { message: 'duplicate key value' } };

beforeEach(async () => {
  await db.outbox.clear();
  await db.synced.clear();
  await db.rejected.clear();
  vi.restoreAllMocks();
});

type Answer = { status: number; body: unknown };

/**
 * Answers each POST from the sequence it carried. Another pad scored the bout:
 * the server holds sequence 4, which this tablet never saw, so the second try
 * goes at 5.
 */
function mockApi(
  post: (sequence: number) => Answer,
  read: () => Answer = () => ({ status: 200, body: [{ sequence: 4 }] }),
) {
  const posted: number[] = [];
  const answer = (r: Answer) =>
    Promise.resolve({
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      json: () => Promise.resolve(r.body),
    });
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation((_url: string, init?: { method?: string; body?: string }) => {
      if ((init?.method ?? 'GET') === 'GET') {
        // `read` may throw: a fetch with no service worker rejects.
        return Promise.resolve().then(read).then(answer);
      }
      const sequence = (JSON.parse(init?.body ?? '{}') as { sequence: number }).sequence;
      posted.push(sequence);
      return answer(post(sequence));
    }),
  );
  return { posted };
}

function addHit(sequence: number, clientUuid: string, matchId = 'm1') {
  return enqueue({
    clientUuid,
    matchId,
    sequence,
    type: 'clean',
    occurredAt: new Date().toISOString(),
    firstStrikerColor: 'red',
    firstStrikeValue: 1,
  });
}

async function drainWatched(): Promise<SyncState | undefined> {
  const engine = new SyncEngine(API_URL);
  const states: SyncState[] = [];
  engine.subscribe((state) => states.push(state));
  await engine.drain();
  return states.at(-1);
}

/**
 * Two hits wait, of two bouts; the first is answered 400, then `second` at its
 * new sequence. Two bouts: a hit that ends held stops the rows of its own.
 */
async function secondTry(second: Answer) {
  await addHit(1, 'uuid-bad');
  await addHit(2, 'uuid-behind', 'm2');
  const { posted } = mockApi((sequence) => (sequence === 1 ? BAD_SEQUENCE : second));
  return { last: await drainWatched(), posted };
}

const waiting = async () => (await db.outbox.orderBy('id').toArray()).map((row) => row.clientUuid);

describe('the second try meets an answer about the caller', () => {
  it.each<[string, Answer, string]>([
    ['a 401', { status: 401, body: {} }, 'signed-out'],
    [
      'an account that cannot score',
      { status: 403, body: { message: 'in English', code: 'account_cannot_score' } },
      'account-refused',
    ],
    [
      'a disabled staff account',
      { status: 403, body: { message: 'in English', code: 'staff_account_disabled' } },
      'pin-disabled',
    ],
  ])('%s: the hit waits, in order, and the drain ends there', async (_what, second, status) => {
    const { last, posted } = await secondTry(second);

    expect(posted, 'the hit behind it is not sent').toEqual([1, 5]);
    expect(await waiting()).toEqual(['uuid-bad', 'uuid-behind']);
    expect(await db.rejected.count(), 'a waiting hit is not a refused one').toBe(0);
    expect((await db.outbox.toArray()).map((row) => row.attempts)).toEqual([0, 0]);
    expect(last).toMatchObject({ status, pendingCount: 2, rejectedCount: 0 });
  });
});

describe('the second try meets a refusal about the bout', () => {
  it('a 409 is held with ITS code, not under the first answer', async () => {
    const { last, posted } = await secondTry({
      status: 409,
      body: { message: 'Event results are frozen', code: 'event_results_frozen' },
    });

    expect(posted, 'the queue goes on').toEqual([1, 5, 2]);
    expect(await getRejected()).toMatchObject([
      {
        clientUuid: 'uuid-bad',
        rejectedReason: 'Event results are frozen',
        rejectedCode: 'event_results_frozen',
      },
      { clientUuid: 'uuid-behind', rejectedCode: 'event_results_frozen' },
    ]);
    expect(last).toMatchObject({ status: 'error', pendingCount: 0, rejectedCount: 2 });
  });

  it('a 403 the edge wrote leaves the hit queued as a failed attempt', async () => {
    await addHit(1, 'uuid-bad');
    mockApi((sequence) => (sequence === 1 ? BAD_SEQUENCE : { status: 403, body: {} }));

    const last = await drainWatched();

    expect(await waiting()).toEqual(['uuid-bad']);
    expect((await db.outbox.toArray()).map((row) => row.attempts)).toEqual([1]);
    expect(await db.rejected.count()).toBe(0);
    expect(last).toMatchObject({ status: 'error', pendingCount: 1 });
  });
});

describe('the second try meets no verdict (ruling 344)', () => {
  /** What the service worker answers an API call with no network. */
  const NO_NETWORK: Answer = { status: 503, body: { error: 'offline', status: 503 } };
  const TAKEN: Answer = { status: 201, body: { id: 'srv' } };
  const attempts = async () => (await db.outbox.toArray()).map((row) => row.attempts);

  it.each<[string, Answer]>([
    ['no network', NO_NETWORK],
    ['a server fault', { status: 500, body: { message: 'Internal server error' } }],
    ['a throttled request', { status: 429, body: { message: 'Too Many Requests' } }],
  ])('%s: the hit waits in the queue, and the queue goes on', async (_what, second) => {
    await addHit(1, 'uuid-bad');
    await addHit(2, 'uuid-behind');
    const { posted } = mockApi((sequence) =>
      sequence === 1 ? BAD_SEQUENCE : sequence === 5 ? second : TAKEN,
    );

    const last = await drainWatched();

    expect(posted).toEqual([1, 5, 2]);
    expect(await waiting()).toEqual(['uuid-bad']);
    expect(await db.rejected.count(), 'nobody refused it a second time').toBe(0);
    expect(await attempts(), 'one failed try, as a first answer counts').toEqual([1]);
    expect(last).toMatchObject({ status: 'error', pendingCount: 1, rejectedCount: 0 });
  });

  it('read-only mode: the queue waits there, and no try is counted', async () => {
    const { last, posted } = await secondTry({
      status: 503,
      body: { message: 'Maintenance', code: 'read_only_mode' },
    });

    expect(posted, 'the hit behind it is not sent').toEqual([1, 5]);
    expect(await waiting()).toEqual(['uuid-bad', 'uuid-behind']);
    expect(await db.rejected.count()).toBe(0);
    expect(await attempts()).toEqual([0, 0]);
    expect(last).toMatchObject({ status: 'maintenance', pendingCount: 2, rejectedCount: 0 });
  });

  it.each<[string, () => Answer]>([
    ['finds no network', () => NO_NETWORK],
    ['is answered a server fault', () => ({ status: 500, body: {} })],
    [
      'throws',
      () => {
        throw new TypeError('Failed to fetch');
      },
    ],
  ])('the read of the next free number %s: the hit waits', async (_what, read) => {
    await addHit(1, 'uuid-bad');
    await addHit(2, 'uuid-behind');
    const { posted } = mockApi((sequence) => (sequence === 1 ? BAD_SEQUENCE : TAKEN), read);

    const last = await drainWatched();

    expect(posted, 'no second try without a number, and the queue goes on').toEqual([1, 2]);
    expect(await waiting()).toEqual(['uuid-bad']);
    expect(await db.rejected.count()).toBe(0);
    expect(await attempts()).toEqual([1]);
    expect(last).toMatchObject({ status: 'error', pendingCount: 1, rejectedCount: 0 });
  });

  it('three in a row with no network end the send as offline, not as refused', async () => {
    await addHit(1, 'uuid-a');
    await addHit(2, 'uuid-b');
    await addHit(3, 'uuid-c');
    await addHit(4, 'uuid-not-reached');
    mockApi((sequence) => (sequence === 5 ? NO_NETWORK : BAD_SEQUENCE));

    const last = await drainWatched();

    expect(await waiting()).toEqual(['uuid-a', 'uuid-b', 'uuid-c', 'uuid-not-reached']);
    expect(await attempts()).toEqual([1, 1, 1, 0]);
    expect(last).toMatchObject({ status: 'offline', pendingCount: 4, rejectedCount: 0 });
  });
});

describe('the second try that changes nothing', () => {
  it('a second 400 is held under the FIRST answer, and the queue goes on', async () => {
    await addHit(1, 'uuid-bad');
    await addHit(2, 'uuid-good', 'm2');
    const { posted } = mockApi((sequence) =>
      sequence === 2
        ? { status: 201, body: { id: 'srv-2' } }
        : { status: 400, body: { message: sequence === 1 ? 'Match is locked' : 'second' } },
    );

    const last = await drainWatched();

    expect(posted).toEqual([1, 5, 2]);
    expect(await getRejected()).toMatchObject([
      { clientUuid: 'uuid-bad', rejectedReason: 'Match is locked' },
    ]);
    expect((await db.synced.toArray()).map((row) => row.clientUuid)).toContain('uuid-good');
    expect(last).toMatchObject({ status: 'error', pendingCount: 0, rejectedCount: 1 });
  });

  it('a second try the server takes is saved at its new sequence', async () => {
    const { last, posted } = await secondTry({ status: 201, body: { id: 'srv-new' } });

    expect(posted).toEqual([1, 5, 2]);
    expect(await db.synced.where('clientUuid').equals('uuid-bad').first()).toMatchObject({
      sequence: 5,
      serverId: 'srv-new',
    });
    expect(last).toMatchObject({ status: 'idle', pendingCount: 0, rejectedCount: 0 });
  });

  it('a second try the server takes ends a refused press: the person may score', async () => {
    await addHit(1, 'uuid-bad');
    mockApi((sequence) => (sequence === 1 ? BAD_SEQUENCE : { status: 201, body: { id: 's' } }));
    const engine = new SyncEngine(API_URL);
    const states: SyncState[] = [];
    engine.subscribe((state) => states.push(state));
    tellCallerRefusal('staff_account_disabled');

    await engine.drain();

    expect(states.at(-1)).toMatchObject({ status: 'idle', pendingCount: 0 });
  });
});
