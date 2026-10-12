import { HttpException } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { supabaseChain, writesTo } from '../../common/testing/supabase-chain';
import {
  BOUT,
  NOW,
  PRESS,
  at,
  collide,
  refusalOf,
  row,
  wroteNothing,
} from './clock-late-press.fixtures';
import {
  RUNS,
  SPENT,
  STAFF,
  keepsItsRows,
  lateStep,
  level,
  taken,
  written,
} from './level-step.fixtures';

/** The fixtures say the story: a tablet's "Extra time 60s" reaches the server at 11:00. */
beforeEach(() => {
  vi.useFakeTimers({ now: new Date(NOW) });
});
afterEach(() => {
  vi.useRealTimers();
});

describe('a step of a level bout, sent late', () => {
  it('is written once, with its id, at the time of the tap, and answered with the clock', async () => {
    const { db, clock } = level(SPENT);

    const answer = await clock.advanceLevelResolution(BOUT, STAFF, lateStep('10:01:40'));

    // The clock alone: the tablet reads an answer as a clock by its `status`.
    expect(answer).toMatchObject({ matchId: BOUT, status: 'halted' });
    expect(db.writes.map((write) => write.row)).toEqual([
      {
        match_id: BOUT,
        sequence: 3,
        type: 'level_resolution',
        reason: 'extra time 60s',
        by_user_id: null,
        staff_account_id: 'staff-1',
        occurred_at: at('10:01:40'),
        adjustment_ms: -60_000,
        client_uuid: PRESS,
      },
    ]);
  });

  it('answers the clock as it is AFTER its rows: paused, the step counted, the time given', async () => {
    // The tablet takes this answer as the server's clock and stops folding its
    // own step: the clock from before the write would put it back to 0:00.
    const bout = level(RUNS, { status: 'running' });
    keepsItsRows(bout);

    const answer = await bout.clock.advanceLevelResolution(BOUT, STAFF, lateStep('10:01:40'));

    expect(answer).toMatchObject({
      status: 'halted',
      runningFrom: null,
      activeMs: 30_000,
      levelResolutionSteps: 1,
    });
    // The step is the row after the Halt: each takes its own sequence.
    const sequences = writesTo(bout.db, 'match_events').map(
      (write) => (write.row as { sequence: number }).sequence,
    );
    expect(sequences).toEqual([2, 3]);
  });

  it('pauses a clock that ran at the tap, there, and gives the time from there', async () => {
    // The clock ran from 10:00:00; the tap is at 10:01:40: 100 s, 10 s over.
    const { db, clock } = level(RUNS, { status: 'running' });

    await clock.advanceLevelResolution(BOUT, STAFF, lateStep('10:01:40'));

    expect(written(db)).toEqual([
      'match_events halt',
      'matches update',
      'match_events level_resolution',
    ]);
    const [halt, step] = writesTo(db, 'match_events').map((write) => write.row);
    expect(halt).toMatchObject({ sequence: 2, occurred_at: at('10:01:40') });
    expect(halt).not.toHaveProperty('client_uuid');
    // 90 s limit − 60 s given − 100 s fought.
    expect(step).toMatchObject({
      occurred_at: at('10:01:40'),
      adjustment_ms: -70_000,
      client_uuid: PRESS,
    });
    expect(writesTo(db, 'matches')[0]?.row).toEqual({ status: 'paused' });
  });

  it('judges the time as it was WHEN PRESSED, not when it arrives', async () => {
    // At 10:01:00 the clock had run a minute of its 90 s. At 11:00 it has run an hour.
    const { db, clock } = level(RUNS, { status: 'running' });

    const sent = clock.advanceLevelResolution(BOUT, STAFF, lateStep('10:01:00'));

    expect(await refusalOf(sent)).toEqual({ status: 400, code: 'time_not_finished' });
    wroteNothing(db);
  });

  it('is never placed before the row the bout ends with', async () => {
    const { db, clock } = level([...SPENT, row(3, 'adjust_time', '10:10:00')]);

    await clock.advanceLevelResolution(BOUT, STAFF, lateStep('10:01:40'));

    expect(writesTo(db, 'match_events')[0]?.row).toMatchObject({ occurred_at: at('10:10:00') });
  });

  it('takes the second step, sudden death, with no time on its row', async () => {
    const { db, clock } = level([...SPENT, taken(3, '10:01:40')]);

    await clock.advanceLevelResolution(BOUT, STAFF, lateStep('10:03:00', 1));

    expect(written(db)).toEqual(['match_events level_resolution']);
    const [step] = writesTo(db, 'match_events');
    expect(step?.row).toMatchObject({ reason: 'sudden death', client_uuid: PRESS });
    expect(step?.row).not.toHaveProperty('adjustment_ms');
  });
});

describe('a step the server holds, or that is already true', () => {
  const SAVED = taken(3, '10:01:40', { client_uuid: PRESS });

  it('a saved one is answered with the clock, and written no second time', async () => {
    const { db, clock } = level([...SPENT, SAVED]);

    const answer = await clock.advanceLevelResolution(BOUT, STAFF, lateStep('10:01:40'));

    expect(answer).toMatchObject({ status: 'halted', levelResolutionSteps: 1 });
    wroteNothing(db);
  });

  it.each(['completed', 'archived'])(
    'a saved one is answered on an Event that is %s',
    async (s) => {
      const { db, clock } = level([...SPENT, SAVED], {}, s);

      await expect(
        clock.advanceLevelResolution(BOUT, STAFF, lateStep('10:01:40')),
      ).resolves.toMatchObject({ levelResolutionSteps: 1 });
      wroteNothing(db);
    },
  );

  it('an id the server holds for another kind of press is a bad request', async () => {
    const { db, clock } = level([...SPENT, row(3, 'end', '10:01:40', { client_uuid: PRESS })]);

    const sent = clock.advanceLevelResolution(BOUT, STAFF, lateStep('10:01:40'));

    await expect(sent).rejects.toThrow('This id is the id of another press');
    wroteNothing(db);
  });

  it('a step another tablet took already is done: nothing is written (ruling 12)', async () => {
    const { db, clock } = level([...SPENT, taken(3, '10:01:35')]);

    const answer = await clock.advanceLevelResolution(BOUT, STAFF, lateStep('10:01:40'));

    expect(answer).toMatchObject({ levelResolutionSteps: 1 });
    wroteNothing(db);
  });

  it('a round that took fewer steps than the tablet counted refuses the step', async () => {
    const { db, clock } = level(SPENT);

    const sent = clock.advanceLevelResolution(BOUT, STAFF, lateStep('10:03:00', 1));

    expect(await refusalOf(sent)).toEqual({ status: 400, code: 'level_step_not_pending' });
    wroteNothing(db);
  });
});

describe('a new step the bout does not take', () => {
  it.each(['completed', 'archived'])('an Event that is %s refuses it', async (status) => {
    const { db, clock } = level(SPENT, {}, status);

    const sent = clock.advanceLevelResolution(BOUT, STAFF, lateStep('10:01:40'));

    expect(await refusalOf(sent)).toEqual({ status: 409, code: 'event_results_frozen' });
    wroteNothing(db);
  });

  it.each([
    ['a completed bout', { status: 'completed' }, lateStep('10:01:40'), 409, 'bout_completed'],
    [
      'a tap older than one day',
      {},
      { ...lateStep('10:01:40'), pressedAt: '2026-04-24T10:59:59.000Z' },
      409,
      'clock_press_too_old',
    ],
    [
      'a tap from before the bout was put back in play',
      { back_in_play_at: at('10:10:00') },
      lateStep('10:01:40'),
      409,
      'pressed_before_reopen',
    ],
    ['a locked bout', { locked_at: at('10:30:00') }, lateStep('10:01:40'), 400, 'match_locked'],
    ['a bout in another round', { current_round: 2 }, lateStep('10:01:40'), 409, 'round_not_open'],
    [
      'a round that waits for its next one',
      { awaiting_round_advance: true },
      lateStep('10:01:40'),
      400,
      'round_awaits_advance',
    ],
    ['a board that is not level', { red_score: 3 }, lateStep('10:01:40'), 400, 'bout_not_level'],
  ] as const)('%s: refused, and nothing is written', async (_name, bout, late, status, code) => {
    const { db, clock } = level(SPENT, bout);

    const sent = clock.advanceLevelResolution(BOUT, STAFF, late);

    expect(await refusalOf(sent)).toEqual({ status, code });
    wroteNothing(db);
  });

  it('a tap from before the bout’s last reset is for the fight that was cancelled', async () => {
    const { db, clock } = level([
      ...SPENT,
      row(3, 'reset_match', '10:05:00'),
      row(4, 'start', '10:06:00'),
      row(5, 'halt', '10:07:30'),
    ]);

    const sent = clock.advanceLevelResolution(BOUT, STAFF, lateStep('10:01:40'));

    expect(await refusalOf(sent)).toEqual({ status: 409, code: 'scored_before_reset' });
    wroteNothing(db);
  });

  it('a locked bout takes it from a caller who passes the lock', async () => {
    const { db, clock } = level(SPENT, { locked_at: at('10:30:00') });
    const organiser = { ...STAFF, canOverrideLocked: true };

    await clock.advanceLevelResolution(BOUT, organiser, lateStep('10:01:40'));

    expect(written(db)).toEqual(['match_events level_resolution']);
  });
});

describe('two writers, and a write that fails', () => {
  it('asks every rule again when its sequence was taken, and writes at the next one', async () => {
    const { db, rows, clock } = level(SPENT);
    collide(db, 1, () => rows.push(row(3, 'adjust_time', '10:01:35')));

    await clock.advanceLevelResolution(BOUT, STAFF, lateStep('10:01:40'));

    expect(writesTo(db, 'match_events')[0]?.row).toMatchObject({
      sequence: 4,
      type: 'level_resolution',
      client_uuid: PRESS,
    });
  });

  it('is done, and writes nothing, when the row that won is the same step of another tablet', async () => {
    const { db, rows, clock } = level(SPENT);
    collide(db, 1, () => rows.push(taken(3, '10:01:38')));

    const answer = await clock.advanceLevelResolution(BOUT, STAFF, lateStep('10:01:40'));

    expect(answer).toMatchObject({ levelResolutionSteps: 1 });
    wroteNothing(db);
  });

  it('is written at the third try, and after three collisions the tablet sends it again', async () => {
    const third = level(SPENT);
    collide(third.db, 2);
    await third.clock.advanceLevelResolution(BOUT, STAFF, lateStep('10:01:40'));
    expect(written(third.db)).toEqual(['match_events level_resolution']);

    const never = level(SPENT);
    collide(never.db, 3);
    const sent = never.clock.advanceLevelResolution(BOUT, STAFF, lateStep('10:01:40'));
    expect(await refusalOf(sent)).toEqual({ status: 409, code: 'clock_row_collided' });
    wroteNothing(never.db);
  });

  it('writes no step when the bout’s row is not put to paused: a fault the tablet sends again', async () => {
    const { db, clock } = level(RUNS, { status: 'running' });
    const real = db.service.from;
    db.service.from = vi.fn((table: string) => {
      const chain = real(table);
      if (table !== 'matches') return chain;
      chain.update = vi.fn(() =>
        supabaseChain({ data: null, error: { message: 'timeout' } }),
      ) as never;
      return chain;
    }) as never;

    const sent = clock.advanceLevelResolution(BOUT, STAFF, lateStep('10:01:40'));

    await expect(sent).rejects.toThrow('Clock halted, bout m1 not updated: timeout');
    await expect(sent).rejects.not.toBeInstanceOf(HttpException);
    // The Halt is in the timeline; the step, which carries the id, is not.
    expect(written(db)).toEqual(['match_events halt']);
  });

  it('finishes a send cut short after the Halt: the bout to paused, then the step', async () => {
    // The Halt of the first send is in the timeline; the bout's row still says running.
    const { db, clock } = level([...RUNS, row(2, 'halt', '10:01:40')], { status: 'running' });

    await clock.advanceLevelResolution(BOUT, STAFF, lateStep('10:01:40'));

    expect(written(db)).toEqual(['matches update', 'match_events level_resolution']);
    expect(writesTo(db, 'match_events')[0]?.row).toMatchObject({ adjustment_ms: -70_000 });
  });
});
