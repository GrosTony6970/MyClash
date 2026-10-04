/**
 * A queued hit the server answers with 403 is HELD, like a refused one (ruling 242).
 *
 * A 403 is a caller who may not score THIS bout: a pad moved off its piste while
 * it was offline, a pad of another Event. The drain used to count it as a failed
 * attempt and leave it in the queue: the bar said "sync error", the hit was sent
 * again at every drain, and three of them in a row ended the drain, so a hit of
 * another bout behind them never went.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { db } from './db';
import { enqueue, getRejected } from './outbox';
import { SyncEngine, type SyncState } from './sync';
import { heldReason } from '../lib/refusal-copy';
import { syncBarLabel, syncPhaseOf } from '../lib/sync-bar';

const API_URL = 'http://localhost:4000';
const OFF_PISTE = { message: 'Staff account is not assigned to this Lice', code: 'FORBIDDEN' };

beforeEach(async () => {
  await db.outbox.clear();
  await db.synced.clear();
  await db.rejected.clear();
  vi.restoreAllMocks();
});

/** Answers each POST from the sequence it carried; counts the GETs. */
function mockApi(post: (sequence: number) => { status: number; body: unknown }) {
  const posted: number[] = [];
  const reads: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation((url: string, init?: { method?: string; body?: string }) => {
      if ((init?.method ?? 'GET') === 'GET') {
        reads.push(url);
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
  return { posted, reads };
}

function addHit(sequence: number, clientUuid: string) {
  return enqueue({
    clientUuid,
    matchId: 'm1',
    sequence,
    type: 'clean',
    occurredAt: new Date().toISOString(),
    firstStrikerColor: 'red',
    firstStrikeValue: 1,
  });
}

async function drainWatched(engine: SyncEngine): Promise<SyncState | undefined> {
  const states: SyncState[] = [];
  const stop = engine.subscribe((state) => states.push(state));
  await engine.drain();
  stop();
  return states.at(-1);
}

describe('drain — a hit the caller may not score (403)', () => {
  it('is held with the refusal’s words and code, and leaves the queue', async () => {
    await addHit(1, 'uuid-off-piste');
    mockApi(() => ({ status: 403, body: OFF_PISTE }));

    const last = await drainWatched(new SyncEngine(API_URL));

    expect(await db.outbox.count(), 'it must not wait in the queue').toBe(0);
    expect(await db.synced.count(), 'the server never took it').toBe(0);
    const held = await getRejected();
    expect(held).toHaveLength(1);
    expect(held[0]).toMatchObject({
      clientUuid: 'uuid-off-piste',
      rejectedReason: 'Staff account is not assigned to this Lice',
      rejectedCode: 'FORBIDDEN',
    });
    expect(last).toMatchObject({ status: 'error', pendingCount: 0, rejectedCount: 1 });
  });

  it('is sent once: another sequence cannot make the server take it', async () => {
    await addHit(1, 'uuid-off-piste');
    const { posted, reads } = mockApi(() => ({ status: 403, body: OFF_PISTE }));

    await new SyncEngine(API_URL).drain();

    expect(posted).toEqual([1]);
    expect(reads, 'no fresh sequence is read for it').toEqual([]);
  });

  it('three in a row do not end the drain: the hit behind them goes', async () => {
    // Three failed attempts in a row used to end the drain on "check connection".
    await addHit(1, 'uuid-1');
    await addHit(2, 'uuid-2');
    await addHit(3, 'uuid-3');
    await addHit(4, 'uuid-other-bout');
    const { posted } = mockApi((sequence) =>
      sequence === 4 ? { status: 201, body: { id: 'srv-4' } } : { status: 403, body: OFF_PISTE },
    );

    const last = await drainWatched(new SyncEngine(API_URL));

    expect(posted).toEqual([1, 2, 3, 4]);
    expect((await db.synced.toArray()).map((row) => row.clientUuid)).toEqual(['uuid-other-bout']);
    expect((await getRejected()).map((row) => row.clientUuid)).toEqual([
      'uuid-1',
      'uuid-2',
      'uuid-3',
    ]);
    expect(last).toMatchObject({ status: 'error', pendingCount: 0, rejectedCount: 3 });
  });

  it('a 403 with no code is the edge’s, about no hit: the queue waits', async () => {
    // The edge blocks a network (a roaming hotspot) with a bare 403. Held, a
    // whole queue would fill the inbox with a reason in no language.
    await addHit(1, 'uuid-1');
    await addHit(2, 'uuid-2');
    await addHit(3, 'uuid-3');
    await addHit(4, 'uuid-4');
    const { posted } = mockApi(() => ({ status: 403, body: {} }));

    const last = await drainWatched(new SyncEngine(API_URL));

    expect(await db.rejected.count()).toBe(0);
    expect(posted, 'three failed attempts in a row end the drain').toEqual([1, 2, 3]);
    expect((await db.outbox.orderBy('id').toArray()).map((row) => row.attempts)).toEqual([
      1, 1, 1, 0,
    ]);
    expect(last).toMatchObject({ status: 'error', pendingCount: 4, rejectedCount: 0 });
  });

  it('goes once the organiser has put the pad back and the operator retries', async () => {
    await addHit(1, 'uuid-off-piste');
    let assigned = false;
    mockApi(() =>
      assigned ? { status: 201, body: { id: 'srv-1' } } : { status: 403, body: OFF_PISTE },
    );
    const engine = new SyncEngine(API_URL);
    await engine.drain();

    assigned = true;
    await engine.retryRejected();

    expect((await db.synced.toArray()).map((row) => row.clientUuid)).toEqual(['uuid-off-piste']);
    expect(await db.rejected.count()).toBe(0);
  });
});

describe('what the pad says of it', () => {
  const t = (key: string) => key;

  it('the inbox says it in the reader’s language', () => {
    expect(heldReason({ rejectedReason: OFF_PISTE.message, rejectedCode: 'FORBIDDEN' }, t)).toBe(
      'scoring.quarantine.notAllowed',
    );
  });

  it('a held row with no code keeps the server’s words', () => {
    expect(heldReason({ rejectedReason: 'Match is locked' }, t)).toBe('Match is locked');
  });

  it('the bar counts it as a hit not recorded, not as a sync error', () => {
    expect(syncBarLabel(syncPhaseOf('online', 'error'), 1, t)).toBe('⚠ scoring.lice.hitsRefused');
  });
});
