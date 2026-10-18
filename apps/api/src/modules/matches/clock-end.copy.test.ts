import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { writesTo, type SupabaseRow } from '../../common/testing/supabase-chain';
import { BOUT, NOW, refusalOf, setup, wroteNothing } from './clock-late-press.fixtures';
import { SPENT, STAFF, level } from './level-step.fixtures';

/**
 * The End of a bout and a step of a level bout decide with the bout's copy of its rules
 * (migration 0229), never with its Tournament's rules of now.
 *
 * Ruled 2026-10-17: a bout keeps everything it started under. The organiser starts a bout, then
 * changes the rules of the Tournament while it runs. The clock of that bout still reads the rules
 * it started under. So each bout below holds a copy that says one thing, inside a Tournament that
 * NOW says another, in the place the clock read before.
 */
beforeEach(() => {
  vi.useFakeTimers({ now: new Date(NOW) });
});
afterEach(() => {
  vi.useRealTimers();
});

/** The match format of the bout's copy, and the one its Tournament holds now. */
function rules(copy: SupabaseRow, tournamentNow: SupabaseRow, type = 'pool'): SupabaseRow {
  return {
    phases: {
      type,
      tournaments: {
        ruleset_config: { matchFormat: tournamentNow },
        events: { status: 'running' },
      },
    },
    match_rules: { ruleset_config: { matchFormat: copy }, scoring_config_json: {} },
  };
}

const DRAW = { pool: [{ kind: 'draw' }] };
const SUDDEN_DEATH = { pool: [{ kind: 'sudden_death' }] };
const LEVEL = { red_score: 2, blue_score: 2 };

describe('the End of a bout that ran out of time follows its copy', () => {
  it('a Pool bout level at time is a draw: its copy says so, its Tournament now says sudden death', async () => {
    const bout = { ...LEVEL, ...rules({ levelAtTime: DRAW }, { levelAtTime: SUDDEN_DEATH }) };
    const { db, clock } = setup(SPENT, bout);

    await clock.clockAction(BOUT, 'end');

    const [write] = writesTo(db, 'matches');
    expect(write?.row).toMatchObject({ status: 'completed' });
    expect(write?.row).not.toHaveProperty('winner_registration_id');
    expect(write?.row).not.toHaveProperty('end_reason');
  });

  it('a Pool bout level at time waits for sudden death: its copy says so, its Tournament now says a draw', async () => {
    const bout = { ...LEVEL, ...rules({ levelAtTime: SUDDEN_DEATH }, { levelAtTime: DRAW }) };
    const { db, clock } = setup(SPENT, bout);

    expect(await refusalOf(clock.clockAction(BOUT, 'end'))).toEqual({
      status: 400,
      code: 'level_at_time_unresolved',
    });
    wroteNothing(db);
  });

  it('a bracket bout of best of three names no winner at time, though its Tournament now fights one round', async () => {
    // The rounds of a best-of are decided by the round route. Read as one round, the End named
    // red the winner of the whole bout at 3 - 1.
    const bout = {
      red_score: 3,
      blue_score: 1,
      match_number_label: 'QF1',
      ...rules(
        { bestOf: { pool: 1, bracket: 3, finals: 3 } },
        { bestOf: { pool: 1, bracket: 1, finals: 1 } },
        'single_elim',
      ),
    };
    const { db, clock } = setup(SPENT, bout);

    await clock.clockAction(BOUT, 'end');

    const [write] = writesTo(db, 'matches');
    expect(write?.row).toMatchObject({ status: 'completed' });
    expect(write?.row).not.toHaveProperty('winner_registration_id');
    expect(write?.row).not.toHaveProperty('end_reason');
  });
});

describe('a step of a level bout follows its copy', () => {
  it('plays the extra time of its copy, though its Tournament now goes straight to sudden death', async () => {
    const copy = { bracket: [{ kind: 'extra_time', seconds: 30 }, { kind: 'sudden_death' }] };
    const now = { bracket: [{ kind: 'sudden_death' }] };
    const { db, clock } = level(
      SPENT,
      rules({ levelAtTime: copy }, { levelAtTime: now }, 'single_elim'),
    );

    const result = await clock.advanceLevelResolution(BOUT, STAFF);

    expect(result.applied).toEqual({ kind: 'extra_time', seconds: 30 });
    expect(writesTo(db, 'match_events')[0]?.row).toMatchObject({
      type: 'level_resolution',
      reason: 'extra time 30s',
      adjustment_ms: -30_000,
    });
  });
});
