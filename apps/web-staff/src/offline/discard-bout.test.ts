/**
 * "Discard all of this match", in the store (operator, 2026-10-11).
 *
 * The story: an Event closes with 12 unsent entries of one bout on a tablet.
 * The server refuses the first; the Discard of one sends the next, which is
 * refused in its turn. One step takes every row of that bout off the tablet:
 * the refused ones and the ones that wait behind them.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import 'fake-indexeddb/auto';
import { db } from './db';
import { getRejected, quarantine, requeueRejectedEntry } from './outbox';
import { discardBoutOf } from './press-queue';
import {
  addCard,
  addHit,
  addPress,
  addRound,
  clearStore,
  heldRows,
  queued,
} from './sync.press.fixtures';

beforeEach(clearStore);

/** A hit of the bout that the server refused. Answers its row id in the inbox. */
async function refusedHit(matchId: string): Promise<number> {
  await quarantine(await addHit(matchId), 'Event results are frozen', 'event_results_frozen');
  const held = await db.rejected.where('matchId').equals(matchId).last();
  return held!.id as number;
}

describe('every row of the bout of a held row leaves the tablet', () => {
  it('the refused row and the rows of every kind that wait behind it', async () => {
    const heldId = await refusedHit('m1');
    await addHit('m1');
    await addCard('m1');
    await addRound('end', 1, 'm1', 30);
    await addPress('end', 'm1', 60);

    expect(await discardBoutOf(heldId)).toBe(5);

    expect(await heldRows()).toEqual([]);
    expect(await queued()).toEqual([]);
  });

  it('two refused rows of one bout both go', async () => {
    const first = await refusedHit('m1');
    await refusedHit('m1');
    await addHit('m1');

    expect(await discardBoutOf(first)).toBe(3);

    expect(await getRejected()).toEqual([]);
    expect(await queued()).toEqual([]);
  });

  it('leaves the rows of another bout, the refused and the waiting', async () => {
    const heldId = await refusedHit('m1');
    await addHit('m1');
    await refusedHit('m2');
    await addPress('end', 'm2', 60);

    expect(await discardBoutOf(heldId)).toBe(2);

    expect((await getRejected()).map((row) => row.matchId)).toEqual(['m2']);
    expect((await db.outbox.toArray()).map((row) => row.matchId)).toEqual(['m2']);
  });

  it('writes none of them down as undone or as taken by the server', async () => {
    const heldId = await refusedHit('m1');
    await addHit('m1');

    await discardBoutOf(heldId);

    expect(await db.undone.count()).toBe(0);
    expect(await db.synced.count()).toBe(0);
  });
});

describe('a held row that is gone', () => {
  it('deletes nothing: a Retry put it back in the queue, and it may be on its way', async () => {
    const heldId = await refusedHit('m1');
    await addHit('m1');
    await requeueRejectedEntry(heldId);

    expect(await discardBoutOf(heldId)).toBe(0);

    expect(await queued()).toEqual(['hit', 'hit']);
  });

  it('deletes nothing for an id the inbox never held', async () => {
    await addHit('m1');

    expect(await discardBoutOf(404)).toBe(0);

    expect(await queued()).toEqual(['hit']);
  });
});
