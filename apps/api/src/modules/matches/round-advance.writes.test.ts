import { BadRequestException, HttpException } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { selectsFor, supabaseChain, writesTo } from '../../common/testing/supabase-chain';
import {
  BOUT,
  ENDED,
  HALTED,
  RUNNING,
  NOW,
  PRESS,
  collide,
  refusalOf,
  row,
  wroteNothing,
} from './clock-late-press.fixtures';
import { boutCompleted } from './late-press';
import { SAVED, STAFF, WAITS, advance, series, written } from './round-advance.fixtures';

/** A round advance that fails half way, that meets another writer, or that carries no id. */
beforeEach(() => {
  vi.useFakeTimers({ now: new Date(NOW) });
});
afterEach(() => {
  vi.useRealTimers();
});

describe('a round advance that fails half way', () => {
  it('does not move the bout when the clock cannot be put to zero', async () => {
    const { db, clock, scoring, recompute } = series();
    vi.spyOn(clock, 'clockAction').mockRejectedValue(new Error('duplicate key value'));

    const sent = scoring.advanceRound(BOUT, STAFF, advance('10:05:00'));

    await expect(sent).rejects.toThrow(
      'Clock of bout m1 not put to zero for round 2: duplicate key value',
    );
    // A plain error is a 5xx, which a pad sends again. A 400 or a 409 is held.
    await expect(sent).rejects.not.toBeInstanceOf(HttpException);
    expect(written(db)).toEqual(['match_events round_advance']);
    expect(recompute).not.toHaveBeenCalled();
  });

  it('stays "completed", and takes its row back, when the bout was completed as the round opened', async () => {
    // Its row taken back, a resend is judged afresh, and meets the same refusal; kept, the
    // resend was answered "taken", and the row put round 1's level chain back to its top.
    const { db, clock, scoring } = series();
    vi.spyOn(clock, 'clockAction').mockRejectedValue(boutCompleted());

    expect(await refusalOf(scoring.advanceRound(BOUT, STAFF, advance('10:05:00')))).toEqual({
      status: 409,
      code: 'bout_completed',
    });
    const rows = writesTo(db, 'match_events');
    expect(rows.map((write) => write.op)).toEqual(['insert', 'delete']);
    expect(rows[1]?.filters).toContainEqual({ method: 'eq', args: ['sequence', 3] });
  });

  it('refuses, never un-completes, a bout a forfeit completed just before its clock step', async () => {
    // The forfeit lands after the last check of the bout, before the Reopen of its ended clock
    // reads it: the Reopen un-completed the bout and voided the forfeit.
    const { db, scoring } = series(ENDED);
    let matchReads = 0;
    boutMeanwhile(db, FORFEITED, () => ++matchReads >= 4);

    expect(await refusalOf(scoring.advanceRound(BOUT, STAFF, advance('10:05:00')))).toEqual({
      status: 409,
      code: 'bout_completed',
    });
    expect(writesTo(db, 'match_events').map((write) => write.op)).toEqual(['insert', 'delete']);
    expect(writesTo(db, 'matches')).toEqual([]);
  });

  it('is a fault a pad sends again, also when the clock itself refuses with a 400', async () => {
    const { clock, scoring } = series();
    vi.spyOn(clock, 'clockAction').mockRejectedValue(new BadRequestException('duplicate key'));

    await expect(scoring.advanceRound(BOUT, STAFF, advance('10:05:00'))).rejects.not.toBeInstanceOf(
      HttpException,
    );
  });

  it('says so when the bout row is not updated', async () => {
    const { db, scoring, recompute } = series();
    const real = db.service.from;
    db.service.from = vi.fn((table: string) => {
      const chain = real(table);
      if (table !== 'matches') return chain;
      chain.update = vi.fn(() =>
        supabaseChain({ data: null, error: { message: 'timeout' } }),
      ) as never;
      return chain;
    }) as never;

    const sent = scoring.advanceRound(BOUT, STAFF, advance('10:05:00'));

    await expect(sent).rejects.toThrow('Round 2 is in the timeline, bout m1 not updated: timeout');
    await expect(sent).rejects.not.toBeInstanceOf(HttpException);
    expect(recompute).not.toHaveBeenCalled();
  });
});

describe('two writers on one round advance', () => {
  it('asks every rule again when its sequence was taken, and writes at the next one', async () => {
    const { db, rows, scoring } = series();
    collide(db, 1, () => rows.push(row(3, 'adjust_time', '10:00:35')));

    await scoring.advanceRound(BOUT, STAFF, advance('10:05:00'));

    expect(writesTo(db, 'match_events')[0]?.row).toMatchObject({
      sequence: 4,
      type: 'round_advance',
      client_uuid: PRESS,
    });
  });

  it('is answered, and written once, when another send saved it meanwhile', async () => {
    const { db, rows, scoring } = series();
    collide(db, 1, () => rows.push(SAVED));

    await scoring.advanceRound(BOUT, STAFF, advance('10:05:00'));

    // The row is the other send's: this one finishes the bout, which still waits.
    expect(written(db)).toEqual(['match_events reset_clock', 'matches update']);
  });

  it('is written at the third try, after two collisions', async () => {
    const { db, scoring } = series();
    collide(db, 2);

    await expect(scoring.advanceRound(BOUT, STAFF, advance('10:05:00'))).resolves.toEqual({
      currentRound: 2,
    });
    expect(writesTo(db, 'match_events')[0]?.row).toMatchObject({ type: 'round_advance' });
  });

  it('gives up after three tries, with the code the pad sends again on', async () => {
    const { db, scoring } = series();
    collide(db, 3);

    expect(await refusalOf(scoring.advanceRound(BOUT, STAFF, advance('10:05:00')))).toEqual({
      status: 409,
      code: 'clock_row_collided',
    });
    wroteNothing(db);
  });
});

describe('"Start round N+1" of the pad of before, with no id', () => {
  it('opens the next round now, and its row carries no id', async () => {
    const { db, scoring } = series();

    await expect(scoring.advanceRound(BOUT, STAFF)).resolves.toEqual({ currentRound: 2 });

    expect(written(db)).toEqual([
      'match_events round_advance',
      'match_events reset_clock',
      'matches update',
    ]);
    const [round, reset] = writesTo(db, 'match_events').map((write) => write.row);
    expect(round).toMatchObject({ sequence: 3, type: 'round_advance', occurred_at: NOW });
    expect(round).not.toHaveProperty('client_uuid');
    expect(reset).toMatchObject({ type: 'reset_clock', occurred_at: NOW });
    expect(writesTo(db, 'matches')[0]?.row).toMatchObject({ current_round: 2 });
  });

  it('is refused as before when its row cannot be written, and is not tried again', async () => {
    const { db, scoring } = series();
    collide(db, 1);

    await expect(scoring.advanceRound(BOUT, STAFF)).rejects.toThrow('duplicate key value');
    wroteNothing(db);
  });

  it('does not ask for the status of the Event: its door refused an over one', async () => {
    const { scoring } = series(HALTED, WAITS, 'completed');

    await expect(scoring.advanceRound(BOUT, STAFF)).resolves.toEqual({ currentRound: 2 });
  });
});

/**
 * Two sends of one "Start round 2" (S2, operator 2026-10-16). The second passed its rules while
 * the bout still waited; by the time it reaches the clock, the first has opened round 2 and the
 * referee has pressed Start. Reset then, round 2's clock went back to 0:00 under the fight.
 */
/** The bout as a forfeit between rounds leaves it: completed, still "awaiting" round 2. */
const FORFEITED = {
  status: 'completed',
  current_round: 1,
  awaiting_round_advance: true,
  locked_at: null,
  back_in_play_at: null,
  winner_registration_id: 'red',
  end_reason: 'forfeit',
  phases: { type: 'pool', tournaments: { ruleset_config: {}, events: { status: 'running' } } },
};

/** From `when` on (by default the write of this send's round row), the bout reads as `bout`. */
function boutMeanwhile(
  db: ReturnType<typeof series>['db'],
  bout: Record<string, unknown>,
  when = () => writesTo(db, 'match_events').length > 0,
) {
  const real = db.service.from;
  db.service.from = vi.fn((table: string) =>
    table === 'matches' && when()
      ? supabaseChain({ data: { id: BOUT, ...bout }, error: null })
      : real(table),
  ) as never;
}

describe('a round advance that another send has opened meanwhile', () => {
  const openedByTheOther = (db: ReturnType<typeof series>['db'], when?: () => boolean) =>
    boutMeanwhile(db, { current_round: 2, awaiting_round_advance: false }, when);

  it.each([
    ['sent late, with its id', advance('10:05:00')],
    ['of the pad of before', undefined],
  ])('touches neither the clock nor the bout: %s', async (_, late) => {
    const { db, clock, scoring, recompute } = series();
    openedByTheOther(db);
    const action = vi.spyOn(clock, 'clockAction');

    await expect(scoring.advanceRound(BOUT, STAFF, late)).resolves.toEqual({ currentRound: 2 });

    expect(written(db)).toEqual(['match_events round_advance']);
    expect(action).not.toHaveBeenCalled();
    expect(recompute).not.toHaveBeenCalled();
  });

  // Opened between this send's read of the clock and its Halt: the step asks again.
  it('does not halt a clock the other send set running after it read it', async () => {
    const { db, clock, scoring } = series(RUNNING);
    const read = vi.spyOn(clock, 'getClockState');
    openedByTheOther(db, () => read.mock.calls.length > 0);
    const action = vi.spyOn(clock, 'clockAction');

    await expect(scoring.advanceRound(BOUT, STAFF)).resolves.toEqual({ currentRound: 2 });

    expect(action).not.toHaveBeenCalled();
  });

  it('reads the status, the round and the wait of the bout before each clock step', async () => {
    const { db, scoring } = series();

    await scoring.advanceRound(BOUT, STAFF, advance('10:05:00'));

    expect(selectsFor(db.from, 'matches')).toContain(
      'status, current_round, awaiting_round_advance',
    );
  });
});

/**
 * The bout no longer waits for the round, and nobody opened it, after this send passed its
 * rules: the desk reset the bout, a Reopen put round 1 back in play, or a forfeit completed it
 * (which leaves the bout "awaiting" round 2). The advance is refused, never answered as an open
 * round 2 (the pad would drop its press as taken), and its row is taken back: a `round_advance`
 * row puts round 1's level chain back to its top. Before, the forfeit was undone too: the
 * advance's Reopen of the ended clock un-completed the bout and voided the forfeit.
 */
describe('a round advance whose bout was put back or completed meanwhile', () => {
  it.each([
    [
      'reset',
      { status: 'scheduled', current_round: 1, awaiting_round_advance: false },
      'round_not_waiting',
    ],
    [
      'reopened in round 1',
      { status: 'paused', current_round: 1, awaiting_round_advance: false },
      'round_not_waiting',
    ],
    [
      'completed by a forfeit',
      { status: 'completed', current_round: 1, awaiting_round_advance: true },
      'bout_completed',
    ],
  ])(
    'is refused, takes its row back, touches neither clock nor bout: %s',
    async (_, bout, code) => {
      const { db, clock, scoring, recompute } = series(ENDED);
      boutMeanwhile(db, bout);
      const action = vi.spyOn(clock, 'clockAction');

      expect(await refusalOf(scoring.advanceRound(BOUT, STAFF, advance('10:05:00')))).toEqual({
        status: 409,
        code,
      });
      const rows = writesTo(db, 'match_events');
      expect(rows.map((write) => write.op)).toEqual(['insert', 'delete']);
      expect(rows[1]?.filters).toContainEqual({ method: 'eq', args: ['sequence', 4] });
      expect(writesTo(db, 'matches')).toEqual([]);
      expect(action).not.toHaveBeenCalled();
      expect(recompute).not.toHaveBeenCalled();
    },
  );

  it('a resend of an advance cut short takes back the row it saved, not the next one', async () => {
    // Its row is at 3; the sequence read before its rules is 4, which nothing holds.
    const { db, scoring } = series([...HALTED, SAVED]);
    let matchReads = 0;
    const reset = { status: 'scheduled', current_round: 1, awaiting_round_advance: false };
    boutMeanwhile(db, reset, () => ++matchReads >= 2);

    expect(await refusalOf(scoring.advanceRound(BOUT, STAFF, advance('10:05:00')))).toEqual({
      status: 409,
      code: 'round_not_waiting',
    });
    const rows = writesTo(db, 'match_events');
    expect(rows.map((write) => write.op)).toEqual(['delete']);
    expect(rows[0]?.filters).toContainEqual({ method: 'eq', args: ['sequence', 3] });
  });
});
