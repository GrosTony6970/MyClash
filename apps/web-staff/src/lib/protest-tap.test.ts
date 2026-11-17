/**
 * The tap of a protest button (`protestTap`, the body of `useProtestTap`): the
 * protest is on the tablet before any network call, then the send is asked
 * for, then the sequence moves on. A double tap records one protest. The
 * clock is read at the tap, also while it runs.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { db } from '../offline/db';
import { getAllPending } from '../offline/outbox';
import { SyncEngine } from '../offline/sync';
import { clockAtTap, protestTap, type ProtestTapArgs } from './protest-tap';

const API_URL = 'http://localhost:4000';
const MATCH = { id: 'm1', redRegistrationId: 'reg-red', blueRegistrationId: 'reg-blue' };
const SUBMIT = { bout: { label: 'P1', red: 'Ana Red', blue: 'Bo Blue' }, round: 1 };

beforeEach(async () => {
  await db.outbox.clear();
  await db.synced.clear();
  await db.rejected.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** A tap over a fresh in-flight mark, with what the page passes. */
function tapWith(over: Partial<ProtestTapArgs> = {}) {
  const args: ProtestTapArgs = {
    match: MATCH,
    nextSequence: 3,
    submit: SUBMIT,
    clockTimeMs: () => 61_000,
    onRecorded: vi.fn(),
    ...over,
  };
  return { tap: protestTap(args, { current: false }), args };
}

describe('a tap of the protest button', () => {
  it('a protest tapped offline is in the outbox before any network call', async () => {
    // What a dead hall answers; each request says how many rows the queue held when it left.
    const seen: number[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        seen.push(await db.outbox.count());
        return Response.json({ error: 'offline', status: 503 }, { status: 503 });
      }),
    );
    const engine = new SyncEngine(API_URL);
    const { tap } = tapWith({ syncEngine: engine });

    await tap('red');
    await engine.drain();

    expect(seen.length, 'the send was asked for').toBeGreaterThan(0);
    expect(seen.every((rows) => rows === 1)).toBe(true);
    expect(await getAllPending()).toMatchObject([
      { kind: 'protest', registrationId: 'reg-red', cardedColor: 'red', sequence: 3 },
    ]);
  });

  it('queues, then asks for the send, then moves the sequence on', async () => {
    const order: string[] = [];
    // What the queue held when the send was asked for.
    let queuedAtSend: Promise<number> = Promise.resolve(-1);
    const sendBehind = vi.fn(() => {
      order.push('send');
      queuedAtSend = db.outbox.count();
    });
    const { tap } = tapWith({
      syncEngine: { sendBehind } as unknown as SyncEngine,
      onRecorded: () => order.push('recorded'),
    });

    await tap('blue');

    expect(order).toEqual(['send', 'recorded']);
    expect(await queuedAtSend, 'queued before the send').toBe(1);
    expect(await getAllPending()).toMatchObject([{ registrationId: 'reg-blue' }]);
  });

  it('sends nothing and moves nothing on when the tablet could not keep it', async () => {
    vi.spyOn(db.outbox, 'add').mockRejectedValue(new Error('QuotaExceededError'));
    const sendBehind = vi.fn();
    const { tap, args } = tapWith({ syncEngine: { sendBehind } as unknown as SyncEngine });

    await expect(tap('red')).rejects.toThrow('QuotaExceededError');

    expect(sendBehind).not.toHaveBeenCalled();
    expect(args.onRecorded).not.toHaveBeenCalled();
  });

  it('a second tap while the first is being written records nothing', async () => {
    const { tap, args } = tapWith();

    // The tap answers what it wrote: the ignored one answers nothing, and opens no card offer.
    const answers = await Promise.all([tap('red'), tap('red')]);
    const rows = await getAllPending();
    expect(rows).toHaveLength(1);
    expect(answers).toEqual([rows[0]?.clientUuid, null]);
    expect(args.onRecorded).toHaveBeenCalledOnce();
  });

  it('a second tap after the first was written records a second protest', async () => {
    const { tap } = tapWith();

    await tap('red');
    await tap('red');

    expect((await getAllPending()).map((row) => row.sequence)).toEqual([3, 4]);
  });

  it('a protest tapped while the clock runs is saved with the clock’s time at the tap', async () => {
    const running = {
      status: 'running' as const,
      activeMs: 30_000,
      runningFrom: '2026-11-17T10:00:00.000Z',
    };
    const at = Date.parse('2026-11-17T10:01:15.000Z');
    const { tap } = tapWith({ clockTimeMs: () => clockAtTap(running as never, at) });

    await tap('red');

    // 30 s banked at the last start, then 75 s of running.
    expect((await getAllPending())[0]?.clockTimeMs).toBe(105_000);
  });

  it('reads no clock when there is none, and a stopped clock as it stands', () => {
    expect(clockAtTap(null)).toBeNull();
    expect(clockAtTap({ status: 'halted', activeMs: 42_000, runningFrom: null } as never)).toBe(
      42_000,
    );
  });
});
