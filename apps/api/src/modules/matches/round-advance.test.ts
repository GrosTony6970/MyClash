import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { selectsFor, writesTo } from '../../common/testing/supabase-chain';
import {
  BOUT,
  HALTED,
  NOW,
  PRESS,
  RUNNING,
  at,
  refusalOf,
  row,
  wroteNothing,
} from './clock-late-press.fixtures';
import { OPEN, SAVED, STAFF, WAITS, advance, series, written } from './round-advance.fixtures';

/** The fixtures say the story: a tablet's "Start round 2" reaches the server at 11:00. */
beforeEach(() => {
  vi.useFakeTimers({ now: new Date(NOW) });
});
afterEach(() => {
  vi.useRealTimers();
});

describe('a late "Start round 2" on a bout that waits for it', () => {
  it('writes the round, then the clock at zero, then the bout, and reads the score again', async () => {
    const { db, scoring, recompute } = series();

    const answer = await scoring.advanceRound(BOUT, STAFF, advance('10:05:00'));

    expect(answer).toEqual({ currentRound: 2 });
    expect(written(db)).toEqual([
      'match_events round_advance',
      'match_events reset_clock',
      'matches update',
    ]);
    expect(writesTo(db, 'match_events')[0]?.row).toEqual({
      match_id: BOUT,
      sequence: 3,
      type: 'round_advance',
      reason: 'advance to round 2',
      by_user_id: null,
      staff_account_id: 'staff-1',
      occurred_at: at('10:05:00'),
      client_uuid: PRESS,
    });
    expect(writesTo(db, 'match_events')[1]?.row).toMatchObject({
      type: 'reset_clock',
      occurred_at: at('10:05:00'),
      staff_account_id: 'staff-1',
    });
    const [bout] = writesTo(db, 'matches');
    expect(bout?.row).toEqual({
      current_round: 2,
      awaiting_round_advance: false,
      updated_at: NOW,
    });
    expect(bout?.filters).toContainEqual({ method: 'eq', args: ['id', BOUT] });
    expect(recompute).toHaveBeenCalledWith(BOUT);
  });

  it('reads the bout it names, with its round, its wait and the status of its Event', async () => {
    const { db, scoring } = series();

    await scoring.advanceRound(BOUT, STAFF, advance('10:05:00'));

    expect(selectsFor(db.from, 'matches')[0]).toBe(
      'id, status, awaiting_round_advance, current_round, phases(tournaments(events(status)))',
    );
  });

  it.each([
    ['an hour ahead', 60],
    ['an hour behind', -60],
  ])('is placed by its age on a tablet whose clock is %s', async (_, skew) => {
    const { db, scoring } = series();

    await scoring.advanceRound(BOUT, STAFF, advance('10:05:00', 2, skew));

    expect(writesTo(db, 'match_events')[0]?.row).toMatchObject({ occurred_at: at('10:05:00') });
  });

  it('is never placed before the row the bout ends with', async () => {
    // The hit that closed round 1 reached the server late: its Halt is at 10:10.
    const { db, scoring } = series([...RUNNING, row(2, 'halt', '10:10:00')]);

    await scoring.advanceRound(BOUT, STAFF, advance('10:05:00'));

    expect(writesTo(db, 'match_events').map((write) => write.row)).toEqual([
      expect.objectContaining({ type: 'round_advance', occurred_at: at('10:10:00') }),
      expect.objectContaining({ type: 'reset_clock', occurred_at: at('10:10:00') }),
    ]);
  });

  it('halts a clock that still runs at the time of the press, then puts it to zero', async () => {
    const { db, scoring } = series(RUNNING);

    await scoring.advanceRound(BOUT, STAFF, advance('10:05:00'));

    expect(writesTo(db, 'match_events').map((write) => write.row)).toEqual([
      expect.objectContaining({ type: 'round_advance' }),
      expect.objectContaining({ type: 'halt', occurred_at: at('10:05:00') }),
    ]);
  });
});

describe('a late "Start round 2" the server already holds', () => {
  it('is answered and writes nothing when the round is open', async () => {
    const { db, scoring, recompute } = series([...HALTED, SAVED], OPEN);

    await expect(scoring.advanceRound(BOUT, STAFF, advance('10:05:00'))).resolves.toEqual({
      currentRound: 2,
    });
    wroteNothing(db);
    expect(recompute).not.toHaveBeenCalled();
  });

  it('is answered and writes nothing on an over Event, and on a bout reset since', async () => {
    const over = series([...HALTED, SAVED], OPEN, 'completed');
    await expect(over.scoring.advanceRound(BOUT, STAFF, advance('10:05:00'))).resolves.toEqual({
      currentRound: 2,
    });
    wroteNothing(over.db);

    const reset = series([...HALTED, SAVED, row(4, 'reset_match', '10:30:00')], {
      status: 'scheduled',
      current_round: 1,
      awaiting_round_advance: false,
    });
    await expect(reset.scoring.advanceRound(BOUT, STAFF, advance('10:05:00'))).resolves.toEqual({
      currentRound: 1,
    });
    wroteNothing(reset.db);
  });

  it('is finished when its bout still waits: no second row, the clock and the bout', async () => {
    // The first send wrote the row and failed before the bout moved.
    const { db, scoring, recompute } = series([...HALTED, SAVED]);

    await expect(scoring.advanceRound(BOUT, STAFF, advance('10:05:00'))).resolves.toEqual({
      currentRound: 2,
    });

    expect(written(db)).toEqual(['match_events reset_clock', 'matches update']);
    expect(writesTo(db, 'matches')[0]?.row).toMatchObject({ current_round: 2 });
    expect(recompute).toHaveBeenCalledWith(BOUT);
  });

  it('is finished whatever its age: the one-day rule is for a press the server never took', async () => {
    const { db, scoring } = series([...HALTED, SAVED]);
    const old = { ...advance('10:05:00'), pressedAt: '2026-04-24T10:59:59.000Z' };

    await expect(scoring.advanceRound(BOUT, STAFF, old)).resolves.toEqual({ currentRound: 2 });
    expect(written(db)).toEqual(['match_events reset_clock', 'matches update']);
  });

  it('is not finished on a bout a forfeit completed while it waited', async () => {
    // A forfeit completes the bout and leaves `awaiting_round_advance` set. The
    // clock is ended: finishing would reopen it, and take the bout's result away.
    const forfeited = [...HALTED, SAVED, row(4, 'end', '10:20:00')];
    const { db, scoring } = series(forfeited, { ...WAITS, status: 'completed' });

    await expect(scoring.advanceRound(BOUT, STAFF, advance('10:05:00'))).resolves.toEqual({
      currentRound: 1,
    });
    wroteNothing(db);
  });

  it.each(['completed', 'archived'])('is not finished on a %s Event', async (eventStatus) => {
    const { db, scoring } = series([...HALTED, SAVED], WAITS, eventStatus);

    await expect(scoring.advanceRound(BOUT, STAFF, advance('10:05:00'))).resolves.toEqual({
      currentRound: 1,
    });
    wroteNothing(db);
  });

  it('is not finished on a bout reset since, which waits again at the same round', async () => {
    const { db, scoring } = series([...HALTED, SAVED, row(4, 'reset_match', '10:30:00')]);

    expect(await refusalOf(scoring.advanceRound(BOUT, STAFF, advance('10:05:00')))).toEqual({
      status: 409,
      code: 'scored_before_reset',
    });
    wroteNothing(db);
  });
});

describe('a late "Start round" the server does not hold', () => {
  it('is done, and writes nothing, when somebody opened that round', async () => {
    const { db, scoring, recompute } = series(HALTED, OPEN);

    await expect(scoring.advanceRound(BOUT, STAFF, advance('10:05:00'))).resolves.toEqual({
      currentRound: 2,
    });
    wroteNothing(db);
    expect(recompute).not.toHaveBeenCalled();
  });

  it('is done on a completed bout too, when that round was opened', async () => {
    const { db, scoring } = series(HALTED, { ...OPEN, status: 'completed' });

    await expect(scoring.advanceRound(BOUT, STAFF, advance('10:05:00'))).resolves.toEqual({
      currentRound: 2,
    });
    wroteNothing(db);
  });

  it.each([
    ['the server does not see round 1 as closed', { ...WAITS, awaiting_round_advance: false }, 2],
    ['it opens round 3 and the bout waits for round 2', WAITS, 3],
  ])('is refused with its own code when %s', async (_, bout, round) => {
    const { db, scoring } = series(HALTED, bout);

    expect(await refusalOf(scoring.advanceRound(BOUT, STAFF, advance('10:05:00', round)))).toEqual({
      status: 409,
      code: 'round_not_waiting',
    });
    wroteNothing(db);
  });

  it.each(['completed', 'archived'])('is refused on a %s Event', async (eventStatus) => {
    const { db, scoring } = series(HALTED, WAITS, eventStatus);

    expect(await refusalOf(scoring.advanceRound(BOUT, STAFF, advance('10:05:00')))).toEqual({
      status: 409,
      code: 'event_results_frozen',
    });
    wroteNothing(db);
  });

  it('does not open a round of a completed bout', async () => {
    const { db, scoring } = series(HALTED, { ...WAITS, status: 'completed' });

    expect(await refusalOf(scoring.advanceRound(BOUT, STAFF, advance('10:05:00')))).toEqual({
      status: 409,
      code: 'bout_completed',
    });
    wroteNothing(db);
  });

  it('is refused when it was tapped more than a day before its send', async () => {
    const { db, scoring } = series();
    const old = { ...advance('10:05:00'), pressedAt: '2026-04-24T10:59:59.000Z' };

    expect(await refusalOf(scoring.advanceRound(BOUT, STAFF, old))).toEqual({
      status: 409,
      code: 'clock_press_too_old',
    });
    wroteNothing(db);
  });

  it('is refused when the bout was reset after the tap', async () => {
    const { db, scoring } = series([...HALTED, row(3, 'reset_match', '10:30:00')]);

    expect(await refusalOf(scoring.advanceRound(BOUT, STAFF, advance('10:05:00')))).toEqual({
      status: 409,
      code: 'scored_before_reset',
    });
    wroteNothing(db);
  });

  it('answers 404 for a bout that does not exist', async () => {
    const { scoring } = series();

    await expect(scoring.advanceRound('m2', STAFF, advance('10:05:00'))).rejects.toThrow(
      'Match m2 not found',
    );
  });
});
