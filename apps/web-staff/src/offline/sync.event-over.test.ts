/**
 * A hit the server refuses with 409 is HELD, never read as saved.
 *
 * The drain used to read every 409 as "already on the server" and mark the hit
 * synced. The API never answers a repeated `client_uuid` that way: it hands the
 * saved row back with a 2xx. Its 409 on the two create routes is a refusal, an
 * Event that is over (`event_results_frozen`). So a pad that scored offline and
 * reconnected after its Event was completed showed a green bar over hits the
 * server never took, and forgot them.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { db } from './db';
import { enqueue, getRejected, quarantine, requeueRejected, requeueRejectedEntry } from './outbox';
import { SyncEngine, type SyncState } from './sync';

const API_URL = 'http://localhost:4000';
const EVENT_OVER = { message: 'Event results are frozen', code: 'event_results_frozen' };

beforeEach(async () => {
  await db.outbox.clear();
  await db.synced.clear();
  await db.rejected.clear();
  vi.restoreAllMocks();
});

/** Answers each POST from the sequence it carried; a GET lists the server's rows. */
function mockApi(post: (sequence: number) => { status: number; body: unknown }) {
  const posted: number[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation((_url: string, init?: { method?: string; body?: string }) => {
      if ((init?.method ?? 'GET') === 'GET') {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([]) });
      }
      const sequence = (JSON.parse(init?.body ?? '{}') as { sequence: number }).sequence;
      posted.push(sequence);
      const r = post(sequence);
      return Promise.resolve({
        ok: r.status >= 200 && r.status < 300,
        status: r.status,
        json: () => Promise.resolve(r.body),
      });
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

describe('drain — a hit refused because the Event is over (409)', () => {
  it('is held with the refusal’s code, and nothing is marked synced', async () => {
    await addHit(1, 'uuid-late');
    const { posted } = mockApi(() => ({ status: 409, body: EVENT_OVER }));
    const engine = new SyncEngine(API_URL);
    const states: SyncState[] = [];
    engine.subscribe((state) => states.push(state));

    await engine.drain();

    expect(await db.synced.count(), 'the server never took it').toBe(0);
    expect(await db.outbox.count(), 'it must not block the queue').toBe(0);
    const held = await getRejected();
    expect(held).toHaveLength(1);
    expect(held[0]).toMatchObject({
      clientUuid: 'uuid-late',
      rejectedReason: 'Event results are frozen',
      rejectedCode: 'event_results_frozen',
    });
    expect(posted, 'another sequence cannot make an over Event take it').toEqual([1]);
    expect(states.at(-1)).toMatchObject({ status: 'error', rejectedCount: 1 });
  });

  it('holds a 409 that carries no body, under its status', async () => {
    // An edge proxy can answer for the API: there is no sentence and no code.
    await addHit(1, 'uuid-late');
    mockApi(() => ({ status: 409, body: {} }));

    await new SyncEngine(API_URL).drain();

    const [held] = await getRejected();
    expect(held?.rejectedReason).toBe('HTTP 409');
    expect(held).not.toHaveProperty('rejectedCode');
    expect(await db.synced.count()).toBe(0);
  });

  it('is held again when a retry meets the same refusal', async () => {
    await addHit(1, 'uuid-late');
    mockApi(() => ({ status: 409, body: EVENT_OVER }));
    const engine = new SyncEngine(API_URL);
    await engine.drain();
    const [held] = await getRejected();

    await engine.retryRejectedEntry(held!.id as number);

    expect((await getRejected()).map((row) => row.rejectedCode)).toEqual(['event_results_frozen']);
    expect(await db.outbox.count()).toBe(0);
    expect(await db.synced.count()).toBe(0);
  });

  it('keeps draining the hits of another bout behind it', async () => {
    await addHit(1, 'uuid-late');
    await addHit(2, 'uuid-good', 'm2');
    mockApi((sequence) =>
      sequence === 1 ? { status: 409, body: EVENT_OVER } : { status: 201, body: { id: 'srv-2' } },
    );

    await new SyncEngine(API_URL).drain();

    expect((await db.synced.toArray()).map((row) => row.clientUuid)).toEqual(['uuid-good']);
    expect((await getRejected()).map((row) => row.clientUuid)).toEqual(['uuid-late']);
  });

  it('a 409 that answers the re-sent hit is a refusal too', async () => {
    // A 400 is re-sent once under a fresh sequence. That second answer used to
    // count a 409 as "saved" as well.
    await addHit(1, 'uuid-bad');
    await db.synced.add({
      clientUuid: 'uuid-old',
      matchId: 'm1',
      sequence: 4,
      serverId: 'srv-4',
      syncedAt: 0,
    });
    const { posted } = mockApi((sequence) =>
      sequence === 1
        ? { status: 400, body: { message: 'duplicate key value' } }
        : { status: 409, body: EVENT_OVER },
    );

    await new SyncEngine(API_URL).drain();

    expect(posted).toEqual([1, 5]);
    expect((await db.synced.toArray()).map((row) => row.clientUuid)).toEqual(['uuid-old']);
    expect((await getRejected()).map((row) => row.clientUuid)).toEqual(['uuid-bad']);
  });
});

describe('a held hit that is retried', () => {
  it.each<[string, (id: number) => Promise<unknown>]>([
    ['one', (id) => requeueRejectedEntry(id)],
    ['all', () => requeueRejected()],
  ])('goes back to the queue without its refusal (%s)', async (_which, retry) => {
    await quarantine(await addHit(1, 'uuid-late'), EVENT_OVER.message, EVENT_OVER.code);
    const [held] = await getRejected();
    expect(held?.rejectedCode).toBe('event_results_frozen');

    await retry(held!.id as number);

    const [queued] = await db.outbox.toArray();
    expect(queued?.clientUuid).toBe('uuid-late');
    expect(queued).not.toHaveProperty('rejectedCode');
    expect(queued).not.toHaveProperty('rejectedReason');
  });
});
