/**
 * An action in the refused-hits inbox does not turn the bar green over hits that wait.
 *
 * Discard and the two "nothing to retry" paths used to say `idle`. With no held
 * hit left, the bar went green ("ONLINE (2)") over a queue that a signed-out or
 * failing pad still holds, until the next drain. They now say again what the
 * engine last said while a hit still waits, and `idle` only when none does.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { db } from './db';
import { dequeueNewestForMatch, enqueue, getRejected, quarantine } from './outbox';
import { SyncEngine, type SyncState } from './sync';

const API_URL = 'http://localhost:4000';

beforeEach(async () => {
  await db.outbox.clear();
  await db.synced.clear();
  await db.rejected.clear();
  vi.restoreAllMocks();
});

function mockApi(status: number, body: unknown = {}) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation(() =>
      Promise.resolve({
        ok: status >= 200 && status < 300,
        status,
        json: () => Promise.resolve(body),
      }),
    ),
  );
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

/** One held hit and `waiting` hits in the queue, then a drain the server answers with `status`. */
async function drained(status: number, waiting: number, body: unknown = {}) {
  await quarantine(await addHit(1, 'uuid-held'), 'Match is locked');
  for (let i = 0; i < waiting; i += 1) await addHit(i + 2, `uuid-waiting-${i}`);
  mockApi(status, body);
  const engine = new SyncEngine(API_URL);
  await engine.drain();
  const states: SyncState[] = [];
  engine.subscribe((state) => states.push(state));
  const [held] = await getRejected();
  return { engine, heldId: held!.id as number, last: () => states.at(-1) };
}

describe('Discard in the refused-hits inbox', () => {
  it('keeps "session ended" while hits still wait for a sign-in', async () => {
    const { engine, heldId, last } = await drained(401, 2);

    await engine.discardRejectedEntry(heldId);

    expect(last()).toMatchObject({ status: 'signed-out', pendingCount: 2, rejectedCount: 0 });
  });

  it('keeps the sync error while a hit the server failed on still waits', async () => {
    const { engine, heldId, last } = await drained(500, 1);

    await engine.discardRejectedEntry(heldId);

    expect(last()).toMatchObject({ status: 'error', pendingCount: 1, rejectedCount: 0 });
  });

  it('keeps "offline" while the queue waits for the network', async () => {
    const { engine, heldId, last } = await drained(503, 3, { error: 'offline' });

    await engine.discardRejectedEntry(heldId);

    expect(last()).toMatchObject({ status: 'offline', pendingCount: 3, rejectedCount: 0 });
  });

  it('goes green once nothing waits and nothing is held', async () => {
    const { engine, heldId, last } = await drained(401, 0);

    await engine.discardRejectedEntry(heldId);

    expect(last()).toMatchObject({ status: 'idle', pendingCount: 0, rejectedCount: 0 });
  });

  it('goes green once the last waiting hit was undone', async () => {
    // The pad's undo removes a waiting hit from the queue and emits nothing.
    const { engine, heldId, last } = await drained(401, 1);
    await dequeueNewestForMatch('m1');

    await engine.discardRejectedEntry(heldId);

    expect(last()).toMatchObject({ status: 'idle', pendingCount: 0, rejectedCount: 0 });
  });

  it('says "syncing" while a drain runs, not what the drain before it ended in', async () => {
    // The race: an inbox action lands while a drain waits on the server.
    const { engine, heldId, last } = await drained(401, 1);
    let answer: (res: unknown) => void = () => undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(() => new Promise((resolve) => (answer = resolve))),
    );
    const running = engine.drain();
    await vi.waitFor(() => expect(last()?.status).toBe('error'));

    await engine.discardRejectedEntry(heldId);

    expect(last()).toMatchObject({ status: 'syncing', pendingCount: 1, rejectedCount: 0 });
    answer({ ok: true, status: 201, json: () => Promise.resolve({ id: 'srv' }) });
    await running;
    expect(last()).toMatchObject({ status: 'idle', pendingCount: 0 });
  });

  it('stays red while another hit is held', async () => {
    const { engine, heldId, last } = await drained(401, 0);
    await quarantine(await addHit(9, 'uuid-held-too'), 'Match is locked');

    await engine.discardRejectedEntry(heldId);

    expect(last()).toMatchObject({ status: 'error', pendingCount: 0, rejectedCount: 1 });
  });
});

describe('a Retry that finds nothing to retry', () => {
  it('of one hit another tab already dealt with keeps "session ended"', async () => {
    const { engine, heldId, last } = await drained(401, 2);
    await db.rejected.clear();

    expect(await engine.retryRejectedEntry(heldId)).toBe(false);

    expect(last()).toMatchObject({ status: 'signed-out', pendingCount: 2 });
  });

  it('of every held hit keeps "session ended"', async () => {
    const { engine, last } = await drained(401, 2);
    await db.rejected.clear();

    expect(await engine.retryRejected()).toBe(0);

    expect(last()).toMatchObject({ status: 'signed-out', pendingCount: 2 });
  });
});
