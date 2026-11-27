/**
 * The tap of a protest button (`protestTap`, the body of `useProtestTap`): the
 * protest is on the tablet before any network call, then the send is asked
 * for, then the sequence moves on. A double tap records one protest. The
 * clock is read at the tap, also while it runs.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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
    onNoFighter: vi.fn(),
    ...over,
  };
  return { tap: protestTap(args, new Set()), args };
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

  // A bracket bout whose blue Fighter is still to come: nobody is there to protest for.
  it('a tap of a corner with no Fighter records nothing, and says why', async () => {
    const { tap, args } = tapWith({ match: { ...MATCH, blueRegistrationId: null } });

    expect(await tap('blue')).toBeNull();

    expect(await getAllPending()).toEqual([]);
    expect(args.onRecorded).not.toHaveBeenCalled();
    expect(args.onNoFighter).toHaveBeenCalledOnce();
  });

  // Lyon Blades fight Paris Rapiers: the protest is the team's, one per team (call 3).
  it('a tap of a team’s corner queues the protest on the team, with no Registration', async () => {
    const teams = {
      id: 'm1',
      redRegistrationId: null,
      blueRegistrationId: null,
      redTeamId: 'team-lyon',
      blueTeamId: 'team-paris',
    };
    const { tap, args } = tapWith({ match: teams });

    await tap('blue');

    const [row] = await getAllPending();
    expect(row).toMatchObject({ kind: 'protest', teamId: 'team-paris', cardedColor: 'blue' });
    expect(row).not.toHaveProperty('registrationId');
    expect(args.onNoFighter).not.toHaveBeenCalled();
  });

  it('a tap of a corner with its Fighter says nothing of a missing one', async () => {
    const { tap, args } = tapWith({ match: { ...MATCH, blueRegistrationId: null } });

    await tap('red');

    expect(args.onNoFighter).not.toHaveBeenCalled();
    expect(args.onRecorded).toHaveBeenCalledOnce();
  });

  // The words the screen says: the pad's own refusal of a card with no Fighter.
  it('the screen says it in the reader’s language', () => {
    const view = readFileSync(join(__dirname, '..', 'components', 'MatchView.tsx'), 'utf8');
    expect(view).toContain(
      "onNoFighter: () => setClockError(t('pad.corrections.boutSideMissing')),",
    );
  });

  // Both taps read the same `nextSequence`: the screen has not drawn again between them.
  it('a second tap after the first was written records a second protest, with its own number', async () => {
    const { tap } = tapWith();

    await tap('red');
    await tap('red');

    expect((await getAllPending()).map((row) => row.sequence)).toEqual([3, 4]);
  });

  it('two Fighters protest at once: blue’s tap while red’s is written is kept, with its own number', async () => {
    const { tap, args } = tapWith();

    const answers = await Promise.all([tap('red'), tap('blue')]);

    const rows = await getAllPending();
    expect(answers.every((answer) => answer !== null)).toBe(true);
    expect(rows.map((row) => [row.cardedColor, row.registrationId]).sort()).toEqual([
      ['blue', 'reg-blue'],
      ['red', 'reg-red'],
    ]);
    expect(new Set(rows.map((row) => row.sequence)).size).toBe(2);
    expect(args.onRecorded).toHaveBeenCalledTimes(2);
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
