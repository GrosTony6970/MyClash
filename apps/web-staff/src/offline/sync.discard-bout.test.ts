/**
 * "Discard all of this match", through the engine (operator, 2026-10-11).
 *
 * The Discard of ONE refused row sends the rows of its bout that waited behind
 * it (`sync.hit-order.test.ts`). When the cause is the bout or the Event, each
 * is refused in its turn: 12 entries were 12 questions. The Discard of the
 * whole bout sends nothing.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import 'fake-indexeddb/auto';
import { getRejected, requeueRejectedEntry } from './outbox';
import { SyncEngine, type SyncState } from './sync';
import {
  API_URL,
  addHit,
  addPress,
  clearStore,
  heldRows,
  mockServer,
  queued,
  refused,
} from './sync.press.fixtures';

beforeEach(clearStore);

/** An engine whose states are kept, after one send of what the tablet holds. */
async function afterOneSend() {
  const engine = new SyncEngine(API_URL);
  const states: SyncState[] = [];
  engine.subscribe((state) => states.push(state));
  await engine.drain();
  const [held] = await getRejected();
  return { engine, heldId: held!.id as number, last: () => states.at(-1) };
}

describe('Discard of every row of a bout', () => {
  it('an Event that is over: 12 entries go in one step, and none is sent', async () => {
    for (let n = 0; n < 11; n += 1) await addHit('m1');
    await addPress('end', 'm1', 60);
    const { calls } = mockServer(() => refused(409, 'event_results_frozen'));
    const { engine, heldId, last } = await afterOneSend();
    expect(calls, 'the first is refused, the 11 behind it wait').toEqual(['exchanges m1']);

    expect(await engine.discardRejectedBout(heldId)).toBe(12);

    expect(await heldRows()).toEqual([]);
    expect(await queued()).toEqual([]);
    expect(last()).toMatchObject({ status: 'idle', pendingCount: 0, rejectedCount: 0 });
    // A send after it finds nothing: the 11 were not left for it.
    await engine.drain();
    expect(calls).toEqual(['exchanges m1']);
  });

  it('sends nothing of another bout, whose row goes with the next send', async () => {
    await addHit('m1');
    await addHit('m1');
    const { calls } = mockServer((call) =>
      call === 'exchanges m1' ? refused(409, 'match_locked') : undefined,
    );
    const { engine, heldId, last } = await afterOneSend();
    await addHit('m2');

    await engine.discardRejectedBout(heldId);

    expect(calls, 'the Discard sent nothing').toEqual(['exchanges m1']);
    // What the engine last said stands: the row of the other bout was not tried.
    expect(last()).toMatchObject({ status: 'error', pendingCount: 1, rejectedCount: 0 });
    await engine.drain();
    expect(calls, 'the second hit of m1 was never sent').toEqual(['exchanges m1', 'exchanges m2']);
  });

  it('says the state again when the held row is gone, and deletes nothing', async () => {
    await addHit('m1');
    await addHit('m1');
    mockServer(() => refused(409, 'match_locked'));
    const { engine, heldId, last } = await afterOneSend();
    expect(last()).toMatchObject({ pendingCount: 1, rejectedCount: 1 });
    // Another tab's Retry: the store moves, and this engine says nothing.
    await requeueRejectedEntry(heldId);

    expect(await engine.discardRejectedBout(heldId)).toBe(0);

    expect(await queued()).toEqual(['hit', 'hit']);
    expect(last()).toMatchObject({ pendingCount: 2, rejectedCount: 0 });
  });
});
