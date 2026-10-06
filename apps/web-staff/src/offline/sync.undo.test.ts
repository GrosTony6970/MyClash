/**
 * The undo tapped while the pad sends (ruling 317).
 *
 * The pad's undo used to ask "is a send running?" and, while one ran, void the
 * newest hit the SCREEN had last read from the server: the hit before the one
 * just pressed, which then went to the server all the same. The engine now
 * knows the one row that is out. Every other row is deleted on the tablet and
 * is not sent; the row that is out is waited for, and named when it landed.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { db } from './db';
import * as outbox from './outbox';
import { enqueue, getAllPending, getRejected } from './outbox';
import { SyncEngine, type SyncState } from './sync';

const API_URL = 'http://localhost:4000';
const SAVED = { status: 201, body: { id: 'srv-1' } };

beforeEach(async () => {
  await db.outbox.clear();
  await db.synced.clear();
  await db.rejected.clear();
  vi.restoreAllMocks();
});

type Answer = { status: number; body: unknown };

/** Every POST waits for `answer`; `posted` names each one sent, in order. */
function heldApi() {
  const posted: string[] = [];
  const waiting: Array<(res: unknown) => void> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation((_url: string, init?: { body?: string }) => {
      posted.push((JSON.parse(init?.body ?? '{}') as { clientUuid: string }).clientUuid);
      return new Promise((resolve) => waiting.push(resolve));
    }),
  );
  const answer = async ({ status, body }: Answer) => {
    await vi.waitFor(() => expect(waiting.length).toBeGreaterThan(0));
    waiting.shift()?.({
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(body),
    });
  };
  return { posted, answer };
}

function addHit(sequence: number, clientUuid: string, matchId = 'm1') {
  return enqueue({
    clientUuid,
    matchId,
    sequence,
    type: 'clean',
    occurredAt: `2026-10-06T10:0${sequence}:00.000Z`,
    firstStrikerColor: 'red',
    firstStrikeValue: 1,
  });
}

/** An engine whose send of the hit `uuid-1` waits on the server, `behind` more hits after it. */
async function sending(behind = 0) {
  const api = heldApi();
  await addHit(1, 'uuid-1');
  for (let i = 2; i < behind + 2; i += 1) await addHit(i, `uuid-${i}`);
  const engine = new SyncEngine(API_URL);
  const states: SyncState[] = [];
  engine.subscribe((state) => states.push(state));
  const first = engine.drain();
  await vi.waitFor(() => expect(api.posted).toEqual(['uuid-1']));
  return { ...api, engine, states, first };
}

describe('the undo of a hit pressed while another is on its way', () => {
  it('removes the hit just pressed, at once, and the send never posts it', async () => {
    const { engine, first, posted, answer } = await sending();
    await addHit(2, 'uuid-2');
    engine.sendBehind();

    await expect(engine.takeBackNewest('m1')).resolves.toEqual({ kind: 'removed' });
    await answer(SAVED);
    await first;

    expect(posted).toEqual(['uuid-1']);
    expect(await getAllPending()).toHaveLength(0);
    expect(await db.synced.count()).toBe(1);
  });

  it('a row the pass had already listed is not sent once the undo removed it', async () => {
    // Listed at the start of the pass, behind the hit that is out.
    const { engine, first, posted, answer } = await sending(2);

    await expect(engine.takeBackNewest('m1')).resolves.toEqual({ kind: 'removed' });
    await answer(SAVED);
    await vi.waitFor(() => expect(posted).toHaveLength(2));
    await answer(SAVED);
    await first;

    expect(posted).toEqual(['uuid-1', 'uuid-2']);
    expect(await db.synced.count()).toBe(2);
  });

  it('says the new count, and the send ends green', async () => {
    const { engine, states, first, answer } = await sending(1);

    await engine.takeBackNewest('m1');
    expect(states.at(-1)).toMatchObject({ status: 'syncing', pendingCount: 1 });
    await answer(SAVED);
    await first;

    expect(states.at(-1)).toMatchObject({ status: 'idle', pendingCount: 0 });
    expect(states.map((state) => state.status)).not.toContain('error');
  });

  it('a removed row is not an answer: three failures around it are still three in a row', async () => {
    // The pass lists a hit that is out, the hit the undo removes, then two of another bout.
    const api = heldApi();
    await addHit(1, 'uuid-1');
    await addHit(2, 'uuid-2');
    await addHit(3, 'other-1', 'm2');
    await addHit(4, 'other-2', 'm2');
    const engine = new SyncEngine(API_URL);
    const states: SyncState[] = [];
    engine.subscribe((state) => states.push(state));
    const first = engine.drain();
    await vi.waitFor(() => expect(api.posted).toEqual(['uuid-1']));
    const failed = { status: 500, body: { message: 'boom' } };

    await engine.takeBackNewest('m1');
    for (const sent of [1, 2, 3]) {
      await vi.waitFor(() => expect(api.posted).toHaveLength(sent));
      await api.answer(failed);
    }
    await first;

    expect(api.posted).toEqual(['uuid-1', 'other-1', 'other-2']);
    expect(states.at(-1)).toMatchObject({ status: 'error', pendingCount: 3 });
    expect(states.at(-1)?.lastError).toMatch(/check connection/);
  });
});

describe('the undo of the hit that is on its way', () => {
  it('waits for its answer, then names it as landed with the server’s id', async () => {
    const { engine, first, answer } = await sending();
    let taken: unknown = 'waiting';

    const undo = engine.takeBackNewest('m1').then((result) => (taken = result));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(taken, 'nothing is decided before the server answers').toBe('waiting');
    expect(await getAllPending(), 'and the row is not deleted under the send').toHaveLength(1);

    await answer(SAVED);
    await Promise.all([undo, first]);

    expect(taken).toMatchObject({
      kind: 'landed',
      serverId: 'srv-1',
      entry: { clientUuid: 'uuid-1' },
    });
  });

  it('a hit the server refused is discarded from the held ones', async () => {
    const { engine, states, first, answer } = await sending();

    const undo = engine.takeBackNewest('m1');
    await answer({ status: 409, body: { message: 'Event results are frozen', code: 'x' } });

    await expect(undo).resolves.toEqual({ kind: 'removed' });
    await first;
    expect(await getRejected()).toHaveLength(0);
    expect(states.at(-1)).toMatchObject({ status: 'idle', rejectedCount: 0 });
  });

  // Not proof the server took nothing: a hit it did take shows at the next read of the bout.
  it('a hit whose send failed is removed from the tablet', async () => {
    const { engine, first, answer } = await sending();

    const undo = engine.takeBackNewest('m1');
    await answer({ status: 500, body: { message: 'boom' } });

    await expect(undo).resolves.toEqual({ kind: 'removed' });
    await first;
    expect(await getAllPending()).toHaveLength(0);
  });

  it('a hit that waits for a signed-out pad is removed from the tablet', async () => {
    const { engine, states, first, answer } = await sending();

    const undo = engine.takeBackNewest('m1');
    await answer({ status: 401, body: {} });

    await expect(undo).resolves.toEqual({ kind: 'removed' });
    await first;
    expect(await getAllPending()).toHaveLength(0);
    expect(states.at(-1)).toMatchObject({ status: 'idle', pendingCount: 0 });
  });
});

describe('the undo and the send’s claim of the same row', () => {
  // The race: the undo picks the newest row at the moment the send claims it.
  // Both are write transactions on the outbox, so one sees the other's work.
  it('the claim first: the undo waits, and the row is not deleted', async () => {
    const api = heldApi();
    await addHit(1, 'uuid-1');
    const engine = new SyncEngine(API_URL);
    const claim = vi.spyOn(outbox, 'claimForSend');

    const first = engine.drain();
    await vi.waitFor(() => expect(claim).toHaveBeenCalled());
    const undo = engine.takeBackNewest('m1');
    await vi.waitFor(() => expect(api.posted).toEqual(['uuid-1']));
    expect(await getAllPending()).toHaveLength(1);
    await api.answer(SAVED);

    await expect(undo).resolves.toMatchObject({ kind: 'landed', serverId: 'srv-1' });
    await first;
  });

  it('the undo first: the send finds the row gone and posts nothing', async () => {
    const api = heldApi();
    await addHit(1, 'uuid-1');
    const engine = new SyncEngine(API_URL);

    // Asked before the send starts: its delete is queued ahead of the claim.
    const undo = engine.takeBackNewest('m1');
    const first = engine.drain();

    await expect(undo).resolves.toEqual({ kind: 'removed' });
    await first;
    expect(api.posted).toEqual([]);
    expect(await db.synced.count()).toBe(0);
  });
});

describe('the undo with no send running', () => {
  it('removes the newest hit of THAT bout, and says the count', async () => {
    await addHit(1, 'uuid-1');
    await addHit(2, 'uuid-other', 'm2');
    const engine = new SyncEngine(API_URL);
    const states: SyncState[] = [];
    engine.subscribe((state) => states.push(state));

    await expect(engine.takeBackNewest('m1')).resolves.toEqual({ kind: 'removed' });

    expect((await getAllPending()).map((entry) => entry.clientUuid)).toEqual(['uuid-other']);
    expect(states.at(-1)).toMatchObject({ pendingCount: 1 });
  });

  it('answers "none" when nothing waits for the bout, and says nothing', async () => {
    const engine = new SyncEngine(API_URL);
    const states: SyncState[] = [];
    engine.subscribe((state) => states.push(state));

    await expect(engine.takeBackNewest('m1')).resolves.toEqual({ kind: 'none' });
    expect(states).toEqual([]);
  });
});
