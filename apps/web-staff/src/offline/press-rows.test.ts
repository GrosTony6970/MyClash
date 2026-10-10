/**
 * A clock press is a row of the queue, and no hit. Each place that read "not a
 * card" as "a hit" would have drawn a press as a clean hit, counted it in the
 * score, and let the undo take it back.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { DEFAULT_SCORING_CONFIG } from '@myclash/types';
import type { ClockState } from '../components/scoreboard-clock';
import { undoLastEntry } from '../lib/clear-last';
import { db, kindOf } from './db';
import { computeHeartbeatMetrics } from './heartbeat';
import { forgetBout, keepBout, keepClock, keptBout, keptClock } from './kept-bout';
import { discardRejected, getAllPending, getRejected, quarantine, requeueRejected } from './outbox';
import { pendingRowsForMatch, provisionalDeltas } from './pending-events';
import { heldPressesOf, holdsPress, queuePress, waitingBehind } from './press-queue';
import { AT_TEN, addHit, addPress, clearStore, queued } from './sync.press.fixtures';

beforeEach(async () => {
  await clearStore();
  await Promise.all([db.reads.clear(), db.undone.clear()]);
});

describe('kindOf', () => {
  it('reads a row from before the queue knew kinds as a hit', () => {
    expect(kindOf({})).toBe('exchange');
    expect(kindOf({ kind: 'penalty' })).toBe('penalty');
    expect(kindOf({ kind: 'press' })).toBe('press');
  });
});

describe('the bout’s list and its score', () => {
  it('draw no line and add no point for a press', async () => {
    await addPress('start');
    await addHit('m1', 'hit-1');
    await addPress('halt', 'm1', 30);

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
  it('takes back the hit before a press, never the press', async () => {
    await addPress('start');
    await addHit('m1', 'hit-1');
    await addPress('halt', 'm1', 30);
    // No network: the undo works on the tablet alone.
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    const taken: string[] = [];

    const outcome = await undoLastEntry({
      apiUrl: 'http://localhost:4000',
      matchId: 'm1',
      t: (key) => key,
      takeBack: async (entry) => {
        taken.push(entry.clientUuid);
        await db.outbox.delete(entry.id as number);
        return { kind: 'removed' };
      },
    });

    expect(outcome).toEqual({ kind: 'voided' });
    expect(taken).toEqual(['hit-1']);
    expect(await queued()).toEqual(['press start', 'press halt']);
  });

  it('finds nothing to undo in a bout that holds presses only', async () => {
    await addPress('start');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    const takeBack = vi.fn();

    await undoLastEntry({ apiUrl: 'http://localhost:4000', matchId: 'm1', t: (k) => k, takeBack });

    expect(takeBack).not.toHaveBeenCalled();
    expect(await queued()).toEqual(['press start']);
  });
});

describe('the heartbeat', () => {
  it('counts a press among what the tablet still holds', async () => {
    await addPress('start');
    await addHit();

    const metrics = computeHeartbeatMetrics(await getAllPending(), AT_TEN.wall + 60_000);

    expect(metrics.outboxDepth).toBe(2);
    expect(metrics.oldestPendingAgeSec).toBe(60);
  });
});

describe('a held row', () => {
  it('keeps its place in the queue, a press and a hit alike', async () => {
    const press = await addPress('start');
    const hitId = await addHit();
    await quarantine(press.id as number, 'refused', 'clock_press_out_of_order');
    await quarantine(hitId, 'refused', 'event_results_frozen');

    const [heldPress, heldHit] = await getRejected();

    expect(heldPress?.outboxId).toBe(press.id);
    expect(heldHit?.outboxId).toBe(hitId);
  });

  it('a row held before it knew its place goes back at the end', async () => {
    await db.rejected.add({
      clientUuid: 'old-hit',
      matchId: 'm1',
      sequence: 1,
      type: 'clean',
      occurredAt: new Date(AT_TEN.wall).toISOString(),
      createdAt: AT_TEN.wall,
      attempts: 1,
      rejectedReason: 'refused',
      rejectedAt: AT_TEN.wall,
    });
    await addPress('halt');

    expect(await requeueRejected()).toBe(1);

    expect(await queued()).toEqual(['press halt', 'hit']);
  });

  it('an End keeps the score it was pressed on, and no other press holds one', async () => {
    const end = await queuePress({
      matchId: 'm1',
      action: 'end',
      bout: { label: 'P1', red: 'Ana', blue: 'Bo' },
      endScore: { red: 2, blue: 1 },
    });
    const start = await addPress('start');

    expect((await db.outbox.get(end.id as number))?.endScore).toEqual({ red: 2, blue: 1 });
    expect(await db.outbox.get(start.id as number)).not.toHaveProperty('endScore');
  });

  it('says whether a tap of the clock waits on the tablet', async () => {
    await addHit();
    expect(await holdsPress()).toBe(false);

    await addPress('start');
    expect(await holdsPress()).toBe(true);
  });

  it('counts behind a held press the rows of its bout queued AFTER it, and no other', async () => {
    await addHit('m1', 'before');
    const press = await addPress('halt');
    await addHit('m1', 'after');
    await addHit('m2', 'other-bout');
    await quarantine(press.id as number, 'refused', 'clock_press_out_of_order');
    const [held] = await heldPressesOf('m1');

    expect(await waitingBehind(held!)).toBe(1);
    expect(await heldPressesOf('m2')).toEqual([]);
  });

  it('a bout that holds a refused hit holds no refused press', async () => {
    const hitId = await addHit('m1');
    await quarantine(hitId, 'refused', 'event_results_frozen');

    expect(await heldPressesOf('m1')).toEqual([]);
  });

  it('says what kind it was when it is discarded, and nothing for a row already gone', async () => {
    const press = await addPress('start');
    const hitId = await addHit();
    await quarantine(press.id as number, 'refused');
    await quarantine(hitId, 'refused');
    const [heldPress, heldHit] = await getRejected();

    expect(await discardRejected(heldPress!.id as number)).toBe('press');
    expect(await discardRejected(heldHit!.id as number)).toBe('exchange');
    expect(await discardRejected(heldHit!.id as number)).toBeNull();
    expect(await getRejected()).toEqual([]);
  });
});

describe('the copy of a bout’s clock', () => {
  const CLOCK: ClockState = {
    matchId: 'm1',
    status: 'halted',
    activeMs: 30_000,
    runningFrom: null,
    totalActiveMs: 30_000,
    startedAt: '2026-10-10T10:00:00.000Z',
  };

  it('is nothing for a bout whose clock the tablet never read', async () => {
    expect(await keptClock('m1')).toBeNull();
  });

  it('is the clock as the server gave it, under the bout this tablet asked for', async () => {
    await keepClock('m1', CLOCK);
    await keepClock('m2', { ...CLOCK, status: 'ended' });

    expect(await keptClock('m1')).toEqual(CLOCK);
    expect((await keptClock('m2'))?.status).toBe('ended');
  });

  it('leaves with the bout the server says is gone', async () => {
    await keepBout({ id: 'm1' } as Parameters<typeof keepBout>[0]);
    await keepClock('m1', CLOCK);
    await keepClock('m2', CLOCK);

    await forgetBout('m1');

    expect(await keptBout('m1')).toBeNull();
    expect(await keptClock('m1')).toBeNull();
    expect(await keptClock('m2'), 'another bout keeps its clock').toEqual(CLOCK);
  });
});
