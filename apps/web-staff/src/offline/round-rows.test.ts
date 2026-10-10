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
import { getAllPending, quarantine, requeueRejected, requeueRejectedEntry } from './outbox';
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

describe('the undo', () => {
  const undo = (takeBack: Parameters<typeof undoLastEntry>[0]['takeBack']) =>
    undoLastEntry({ apiUrl: 'http://localhost:4000', matchId: 'm1', t: (key) => key, takeBack });

  it('takes back the hit before a round press, never the round press', async () => {
    await addHit('m1', 'hit-1');
    await addRound('advance', 2, 'm1', 60);
    // No network: the undo works on the tablet alone.
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    const taken: string[] = [];

    const outcome = await undo(async (entry) => {
      taken.push(entry.clientUuid);
      await db.outbox.delete(entry.id as number);
      return { kind: 'removed' };
    });

    expect(outcome).toEqual({ kind: 'voided' });
    expect(taken).toEqual(['hit-1']);
    expect(await queued(), '"Start round 2" still goes to the server').toEqual(['round advance 2']);
  });

  it('finds nothing to undo in a bout that holds round presses only', async () => {
    await addRound('advance', 2);
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    const takeBack = vi.fn();

    await undo(takeBack);

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
