import { foldClock } from '@myclash/rules';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { selectsFor, writesTo } from '../../common/testing/supabase-chain';
import { BOUT, NOW, at, collide, refusalOf, wroteNothing } from './clock-late-press.fixtures';
import {
  EARLY,
  RUNS,
  SPENT,
  STAFF,
  keepsItsRows,
  level,
  taken,
  written,
} from './level-step.fixtures';

/**
 * Taking a LEVEL bout one step down its phase's chain of remedies, pressed with
 * a network: the body with no id.
 *
 * `end` refuses a level bout and NAMES what it is waiting on; this is the route
 * where the referee says they play it. The step sent late by a tablet is
 * `level-step.late.test.ts`.
 */
beforeEach(() => {
  vi.useFakeTimers({ now: new Date(NOW) });
});
afterEach(() => {
  vi.useRealTimers();
});

describe('ClockService.advanceLevelResolution', () => {
  it('applies extra time: ONE row, which counts the step and carries its time', async () => {
    const { db, clock } = level(SPENT);

    const result = await clock.advanceLevelResolution(BOUT, STAFF);

    expect(result.applied).toEqual({ kind: 'extra_time', seconds: 60 });
    // NEGATIVE: the correction moves ELAPSED time, and a countdown shows
    // `limit − elapsed`. 90s spent of a 90s limit, plus 60s of extra time,
    // means 30s elapsed: a correction of −60s.
    expect(db.writes.map((write) => write.row)).toEqual([
      {
        match_id: BOUT,
        sequence: 3,
        type: 'level_resolution',
        reason: 'extra time 60s',
        by_user_id: null,
        staff_account_id: 'staff-1',
        occurred_at: NOW,
        adjustment_ms: -60_000,
      },
    ]);
  });

  it('applies sudden death without touching the clock', async () => {
    // There is no per-match limit to lift: the countdown simply sits at 00:00
    // and the pad shows a skull with a count-up instead of a numeral.
    const { db, clock } = level([...SPENT, taken(3, '10:01:40')]);

    const result = await clock.advanceLevelResolution(BOUT, STAFF);

    expect(result.applied).toEqual({ kind: 'sudden_death' });
    expect(written(db)).toEqual(['match_events level_resolution']);
    expect(writesTo(db, 'match_events')[0]?.row).toMatchObject({ reason: 'sudden death' });
    expect(writesTo(db, 'match_events')[0]?.row).not.toHaveProperty('adjustment_ms');
  });

  it('answers the step it took, and the clock as it is AFTER its row', async () => {
    const bout = level(SPENT);
    keepsItsRows(bout);

    const result = await bout.clock.advanceLevelResolution(BOUT, STAFF);

    expect(result.clock).toMatchObject({
      status: 'halted',
      activeMs: 30_000,
      levelResolutionSteps: 1,
    });
  });

  it('writes no correction in a phase with no time limit: there is nothing to extend', async () => {
    const { db, clock } = level(SPENT, {
      match_rules: {
        ruleset_config: {
          matchFormat: { timeLimitsSeconds: { pool: null, bracket: null, finals: null } },
        },
        scoring_config_json: {},
      },
    });

    const result = await clock.advanceLevelResolution(BOUT, STAFF);

    expect(result.applied).toEqual({ kind: 'extra_time', seconds: 60 });
    expect(writesTo(db, 'match_events')[0]?.row).toMatchObject({ reason: 'extra time 60s' });
    expect(writesTo(db, 'match_events')[0]?.row).not.toHaveProperty('adjustment_ms');
  });

  it('is not tried again by itself when another writer took its sequence: it has no id', async () => {
    // The row that won could be this very step from another device. A second
    // try would then take the NEXT step, sudden death, with nobody asked.
    const { db, rows, clock } = level(SPENT);
    collide(db, 1, () => rows.push(taken(3, '10:59:59')));

    const sent = clock.advanceLevelResolution(BOUT, STAFF);

    expect(await refusalOf(sent)).toEqual({ status: 409, code: 'clock_row_collided' });
    wroteNothing(db);
  });

  it('pauses a clock that runs, at the time of the step, before it gives the time', async () => {
    // Nobody paused the clock: it ran from 10:00:00 to the step, at 11:00:00.
    // Before, the clock kept running and the minute came off the closed part of
    // the clock, which was empty: the extra time was lost at once.
    const { db, rows, clock } = level(RUNS, { status: 'running' });

    await clock.advanceLevelResolution(BOUT, STAFF);

    expect(written(db)).toEqual([
      'match_events halt',
      'matches update',
      'match_events level_resolution',
    ]);
    const [halt, step] = writesTo(db, 'match_events').map((write) => write.row);
    expect(halt).toMatchObject({ type: 'halt', sequence: 2, occurred_at: NOW });
    expect(halt).not.toHaveProperty('client_uuid');
    expect(step).toMatchObject({ occurred_at: NOW });
    const [bout] = writesTo(db, 'matches');
    expect(bout?.row).toEqual({ status: 'paused' });
    expect(bout?.filters).toContainEqual({ method: 'eq', args: ['id', BOUT] });

    // The clock those rows add up to: paused, with exactly a minute to fight.
    const timeline = [...rows, halt, step] as Array<Record<string, unknown>>;
    const moves = timeline.map((one) => ({
      type: one['type'] as 'start',
      occurredAt: one['occurred_at'] as string,
      adjustmentMs: (one['adjustment_ms'] as number | undefined) ?? null,
    }));
    expect(foldClock(moves)).toMatchObject({ status: 'halted', activeMs: 30_000 });
  });

  it('refuses once the chain is spent', async () => {
    const { db, clock } = level([...SPENT, taken(3, '10:01:40'), taken(4, '10:02:50')]);

    const sent = clock.advanceLevelResolution(BOUT, STAFF);

    await expect(sent).rejects.toThrow(/No further remedy/);
    expect(await refusalOf(sent)).toEqual({ status: 400, code: 'level_step_not_pending' });
    wroteNothing(db);
  });

  it('refuses a POOL bout, whose chain is a draw', async () => {
    // Nothing to play out: a drawn pool bout is a real result, so the referee
    // simply ends it.
    const { db, clock } = level(SPENT, {
      match_number_label: 'L1-P1-M01',
      phases: { type: 'pool', tournaments: { events: { status: 'running' } } },
    });

    await expect(clock.advanceLevelResolution(BOUT, STAFF)).rejects.toThrow(/No further remedy/);
    wroteNothing(db);
  });

  it('refuses when the scores are NOT level', async () => {
    const { db, clock } = level(SPENT, { red_score: 3, blue_score: 1 });

    const sent = clock.advanceLevelResolution(BOUT, STAFF);

    await expect(sent).rejects.toThrow(/not level/);
    expect(await refusalOf(sent)).toEqual({ status: 400, code: 'bout_not_level' });
    wroteNothing(db);
  });

  it('refuses a bout that already carries a winner', async () => {
    // 0-0 with a recorded winner is a forfeit under a zeroing score policy. It
    // looks level and is decided; the ladder is what says so.
    const { clock } = level(SPENT, {
      red_score: 0,
      blue_score: 0,
      winner_registration_id: 'blue',
    });

    await expect(clock.advanceLevelResolution(BOUT, STAFF)).rejects.toThrow(/not level/);
  });

  it('refuses a completed bout, and a locked one', async () => {
    const completed = level(SPENT, { status: 'completed' });
    await expect(completed.clock.advanceLevelResolution(BOUT, STAFF)).rejects.toThrow(
      /already completed/,
    );
    wroteNothing(completed.db);

    const locked = level(SPENT, { locked_at: at('10:30:00') });
    expect(await refusalOf(locked.clock.advanceLevelResolution(BOUT, STAFF))).toEqual({
      status: 400,
      code: 'match_locked',
    });
    wroteNothing(locked.db);
  });

  it('takes a locked bout from a caller who passes the lock', async () => {
    const { db, clock } = level(SPENT, { locked_at: at('10:30:00') });

    await clock.advanceLevelResolution(BOUT, { ...STAFF, canOverrideLocked: true });

    expect(written(db)).toEqual(['match_events level_resolution']);
  });

  it('refuses while the bout still has time to run', async () => {
    // The other door onto the chain. Without this a referee could collect the
    // extra time at 2-2 with a minute still to fight, and the chain would be
    // spent before the bout was.
    const { db, clock } = level(EARLY);

    const sent = clock.advanceLevelResolution(BOUT, STAFF);

    await expect(sent).rejects.toThrow(/Time is not finished/);
    expect(await refusalOf(sent)).toEqual({ status: 400, code: 'time_not_finished' });
    wroteNothing(db);
  });

  it('puts the seconds back in COUNT-UP too', async () => {
    // `timerMode` is display only — the bout ends at the limit either way — so a
    // count-up bout that did not rewind could have its End accepted the instant
    // the extra time was granted, and the minute would exist only as advice.
    const { db, clock } = level(SPENT, {
      match_rules: {
        ruleset_config: { matchFormat: { timerMode: 'countup' } },
        scoring_config_json: {},
      },
    });

    await clock.advanceLevelResolution(BOUT, STAFF);

    expect(writesTo(db, 'match_events')[0]?.row).toMatchObject({ adjustment_ms: -60_000 });
  });

  it('refuses between the rounds of a best-of match', async () => {
    // The scores on the row are the CLOSED round's then — frozen, and often
    // level, because a drawn round is exactly what puts them there. A remedy
    // played against them burns a chain step on a round that is over.
    const { db, clock } = level(SPENT, { awaiting_round_advance: true });

    const sent = clock.advanceLevelResolution(BOUT, STAFF);

    await expect(sent).rejects.toThrow(/advance to the next round/);
    expect(await refusalOf(sent)).toEqual({ status: 400, code: 'round_awaits_advance' });
    wroteNothing(db);
  });

  it('asks for the columns it decides on', async () => {
    // The double answers with the whole row whatever the query asked for, so
    // every assertion above survives deleting these from the select while the
    // real read would return none of them.
    const { db, clock } = level(SPENT);

    await clock.advanceLevelResolution(BOUT, STAFF);

    expect(selectsFor(db.from, 'matches')[0]).toBe(
      'id, status, locked_at, current_round, red_registration_id, blue_registration_id, ' +
        'winner_registration_id, red_score, blue_score, match_number_label, ' +
        'awaiting_round_advance, back_in_play_at, ' +
        'phases(type, tournaments(events(status))), ' +
        'match_rules(ruleset_code, ruleset_version, ruleset_config, scoring_config_json)',
    );
  });
});
