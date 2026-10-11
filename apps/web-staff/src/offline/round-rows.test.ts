/**
 * A round press ("Start round 2", "End round") is a row of the queue, and no
 * hit. Each place that reads "not a card" as "a hit" would draw it as a clean
 * hit, count it in the score, let the undo delete it, or give it a number of
 * the bout's sequence. The twin of `press-rows.test.ts`: a clock press had the
 * same four doors.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { DEFAULT_SCORING_CONFIG } from '@myclash/types';
import { undoLastEntry } from '../lib/clear-last';
import { db, kindOf } from './db';
import {
  enqueue,
  getAllPending,
  quarantine,
  queueCard,
  requeueRejected,
  requeueRejectedEntry,
} from './outbox';
import { pendingRowsForMatch, provisionalDeltas } from './pending-events';
import { addHit, addRound, clearStore, queued } from './sync.press.fixtures';

beforeEach(async () => {
  await clearStore();
  await Promise.all([db.reads.clear(), db.undone.clear()]);
});

describe('kindOf', () => {
  it('reads a round press as its own kind', () => {
    expect(kindOf({ kind: 'round' })).toBe('round');
  });
});

describe('the bout’s list and its score', () => {
  it('draw no line and add no point for a round press', async () => {
    await addHit('m1', 'hit-1');
    await addRound('end', 1, 'm1', 30);
    await addRound('advance', 2, 'm1', 60);

    const rows = pendingRowsForMatch({
      entries: await getAllPending(),
      config: DEFAULT_SCORING_CONFIG,
      serverExchanges: [],
      serverPenalties: [],
    });

    expect(rows.exchanges.map((row) => row.client_uuid)).toEqual(['hit-1']);
    expect(rows.penalties).toEqual([]);
    expect(
      provisionalDeltas({ ...rows, redRegistrationId: 'red', blueRegistrationId: 'blue' }),
    ).toEqual({ red: 2, blue: 0 });
  });
});

describe('the round of a queued hit or card, as the bout’s list gives it', () => {
  const roundsOf = async () => {
    const rows = pendingRowsForMatch({
      entries: await getAllPending(),
      config: DEFAULT_SCORING_CONFIG,
      serverExchanges: [],
      serverPenalties: [],
    });
    return [...rows.exchanges, ...rows.penalties].map((row) => row.round_number);
  };
  const hitIn = (round?: number) =>
    enqueue({
      clientUuid: crypto.randomUUID(),
      matchId: 'm1',
      sequence: 1,
      type: 'clean',
      occurredAt: '2026-10-10T10:00:00.000Z',
      firstStrikerColor: 'red',
      firstStrikeValue: 1,
      ...(round === undefined ? {} : { round }),
    });

  it('is the round the row was queued with', async () => {
    await hitIn(1);
    await addRound('advance', 2, 'm1', 60);
    await hitIn(2);

    expect(await roundsOf()).toEqual([1, 2]);
  });

  it('is never under the round a "Start round" queued BEFORE it opens', async () => {
    // A hit queued while "Start round 2" was held in the inbox (round 1 on the
    // screen), then put behind it again by a Retry: the server counts it in round 2.
    await addRound('advance', 2);
    await db.outbox.add({
      clientUuid: 'late',
      matchId: 'm1',
      sequence: 1,
      type: 'clean',
      occurredAt: '2026-10-10T10:00:00.000Z',
      round: 1,
      createdAt: 0,
      attempts: 0,
    });

    expect(await roundsOf()).toEqual([2]);
  });

  it('is unknown for a row queued with no round and behind no "Start round"', async () => {
    await hitIn();
    await addRound('end', 1, 'm1', 60);

    expect(await roundsOf()).toEqual([null]);
  });

  it('is given to a queued card too', async () => {
    await addRound('advance', 3);
    await queueCard({
      matchId: 'm1',
      sequence: 1,
      registrationId: 'reg-1',
      directCard: 'yellow',
      reason: 'late',
    });

    expect(await roundsOf()).toEqual([3]);
  });
});

describe('the undo', () => {
  const undo = (takeBack: Parameters<typeof undoLastEntry>[0]['takeBack']) =>
    undoLastEntry({ apiUrl: 'http://localhost:4000', matchId: 'm1', t: (key) => key, takeBack });

  /** An undo that removes the row from the queue, and says which. */
  function removing(taken: string[]): Parameters<typeof undo>[0] {
    return async (entry) => {
      taken.push(entry.clientUuid);
      await db.outbox.delete(entry.id as number);
      return { kind: 'removed' };
    };
  }

  it('takes back a hit of the round in play, behind "Start round 2"', async () => {
    await addHit('m1', 'hit-1');
    await addRound('advance', 2, 'm1', 60);
    await addHit('m1', 'hit-2');
    // No network: the undo works on the tablet alone.
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    const taken: string[] = [];

    expect(await undo(removing(taken))).toEqual({
      kind: 'voided',
      entry: { clientUuid: 'hit-2' },
    });

    expect(taken).toEqual(['hit-2']);
    expect(await queued()).toEqual(['hit', 'round advance 2']);
  });

  it.each(['advance', 'end'] as const)(
    'stops at a round the tablet closed: a hit before a queued "%s" is not taken back',
    async (action) => {
      await addHit('m1', 'hit-1');
      await addRound(action, action === 'advance' ? 2 : 1, 'm1', 60);
      const fetched = vi.fn().mockRejectedValue(new Error('offline'));
      vi.stubGlobal('fetch', fetched);
      const taken: string[] = [];

      const outcome = await undo(removing(taken));

      // Taking it back would make the round press a lie: its round is no longer over.
      expect(outcome).toEqual({ kind: 'failed', message: 'scoring.rounds.undoStopsAtRound' });
      expect(taken).toEqual([]);
      expect(
        fetched,
        'the server is asked for nothing: its newest entry is of that round too',
      ).not.toHaveBeenCalled();
      expect(await queued()).toHaveLength(2);
    },
  );

  it('says the same in a bout that holds round presses only', async () => {
    await addRound('advance', 2);
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    const takeBack = vi.fn();

    expect(await undo(takeBack)).toEqual({
      kind: 'failed',
      message: 'scoring.rounds.undoStopsAtRound',
    });

    expect(takeBack).not.toHaveBeenCalled();
    expect(await queued()).toEqual(['round advance 2']);
  });
});

describe('a held round press put back in the queue', () => {
  it('by the bar’s Retry: takes no number of the sequence, and the hit behind it gets the next one', async () => {
    const round = await addRound('advance', 2);
    const hitId = await addHit();
    await quarantine(round.id as number, 'refused', 'round_not_waiting');
    await quarantine(hitId, 'refused', 'round_awaits_advance');

    expect(await requeueRejected()).toBe(2);

    const rows = await db.outbox.orderBy('id').toArray();
    expect(rows.map((row) => [row.kind ?? 'exchange', row.sequence])).toEqual([
      ['round', 0],
      ['exchange', 1],
    ]);
  });

  it('by its own Retry: keeps the sequence of a press, at the place it had', async () => {
    await addHit();
    const round = await addRound('advance', 2);
    await quarantine(round.id as number, 'refused', 'round_not_waiting');
    const [held] = await db.rejected.toArray();

    expect(await requeueRejectedEntry(held?.id as number)).toBe(true);

    const back = await db.outbox.get(round.id as number);
    expect(back).toMatchObject({ kind: 'round', roundAction: 'advance', round: 2, sequence: 0 });
  });
});

// web-staff has no React test setup: the two screens are held as text.
describe('the screens', () => {
  const read = (...path: string[]) => readFileSync(join(__dirname, '..', ...path), 'utf8');

  it('the inbox names a held round press by its button and its round', () => {
    expect(read('components', 'QuarantineInbox.tsx')).toMatch(
      /case 'round':\s+return heldRoundLabel\(entry, t\);/,
    );
  });

  it('the bout’s screen counts a held round press among the held presses', () => {
    expect(read('hooks', 'usePadClock.ts')).toContain('heldPresses: held.filter(isTap),');
  });
});
