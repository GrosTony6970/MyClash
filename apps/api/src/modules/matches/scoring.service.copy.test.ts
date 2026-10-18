import { describe, expect, it, vi } from 'vitest';
import { mockSupabase, writesTo } from '../../common/testing/supabase-chain';
import { ScoringService } from './scoring.service';
import { builtInResolver } from './built-in-resolver.fixtures';

/**
 * A bout is scored by its copy of its rules, never by its Tournament's rules of now (ruling
 * 2026-10-17: a bout keeps everything it started under).
 *
 * Each bout below started under one set of rules. Then the organiser changed the Tournament. The
 * bout's row holds its copy (`match_rules`); its phase still embeds the Tournament with the NEW
 * rules, exactly where the old reads took them from. The bout must follow its copy.
 */
const BOUT = 'm1';

/** A rule set as a Tournament and a copy both hold it. */
const rules = (matchFormat: Record<string, unknown>, scoring: Record<string, unknown> = {}) => ({
  ruleset_config: { matchFormat },
  scoring_config_json: scoring,
});

const singleFight = { pool: 1, bracket: 1, finals: 1 };
const bestOfThree = { pool: 3, bracket: 3, finals: 3 };

/** A running bracket bout: its copy says `copy`, its Tournament now says `tournament`. */
function bout(copy: ReturnType<typeof rules>, tournament: ReturnType<typeof rules>) {
  return {
    id: BOUT,
    red_registration_id: 'red',
    blue_registration_id: 'blue',
    ruleset_code: 'TF_v1',
    ruleset_version: '1.0.0',
    status: 'running',
    winner_registration_id: null,
    end_reason: null,
    red_score: 0,
    blue_score: 0,
    match_number_label: 'QF1',
    current_round: 1,
    rounds_json: null,
    red_round_wins: 0,
    blue_round_wins: 0,
    awaiting_round_advance: false,
    back_in_play_at: null,
    phases: { type: 'single_elim', tournaments: { ...tournament, events: { status: 'running' } } },
    match_rules: copy,
  };
}

function hit(seq: number, color: 'red' | 'blue', value: number) {
  return {
    id: `e${seq}`,
    client_uuid: `u${seq}`,
    match_id: BOUT,
    sequence: seq,
    type: 'clean',
    occurred_at: '2026-01-01T10:00:00Z',
    first_striker_color: color,
    first_strike_value: value,
    afterblow_value: null,
    no_exchange_reason: null,
    round_number: 1,
    voided: false,
  };
}

/** Red 5, Blue 3. */
const FIVE_THREE = [hit(1, 'red', 3), hit(2, 'red', 2), hit(3, 'blue', 3)];

function setup(row: Record<string, unknown>, sheet: Array<Record<string, unknown>>) {
  const db = mockSupabase({
    matches: { rows: [row] },
    exchanges: { rows: sheet },
    match_penalties: { rows: [] },
    match_forfeits: { rows: [] },
    match_events: { rows: [] },
  });
  const clock = {
    getClockState: vi
      .fn()
      .mockResolvedValue({ status: 'halted', totalActiveMs: 90_000, levelResolutionSteps: 0 }),
    clockAction: vi.fn().mockResolvedValue(undefined),
  };
  const matchCompletion = {
    onMatchCompleted: vi.fn().mockResolvedValue(undefined),
    onMatchUncompleted: vi.fn().mockResolvedValue(undefined),
    resultChangeContext: vi
      .fn()
      .mockResolvedValue({ eventOver: false, staysFinished: false, laterBoutFought: false }),
  };
  const service = new ScoringService(
    db as never,
    builtInResolver(),
    clock as never,
    matchCompletion as never,
  );
  const written = () => writesTo(db, 'matches')[0]?.row as Record<string, unknown> | undefined;
  return { service, written, matchCompletion };
}

describe('ScoringService — a bout follows its copy of its rules, not its Tournament of now', () => {
  it('a bout that started first to 5 is over at 5-3, though its Tournament now plays to 7', async () => {
    const { service, written, matchCompletion } = setup(
      bout(
        rules({ pointCap: 5, bestOf: singleFight }),
        rules({ pointCap: 7, bestOf: singleFight }),
      ),
      FIVE_THREE,
    );

    await service.recomputeMatchScore(BOUT);

    expect(written()).toMatchObject({
      red_score: 5,
      blue_score: 3,
      status: 'completed',
      winner_registration_id: 'red',
      end_reason: 'first_to_points',
    });
    expect(matchCompletion.onMatchCompleted).toHaveBeenCalledTimes(1);
  });

  it('a bout that started best of 3 waits for round 2 after a won round, though its Tournament now fights one round', async () => {
    const { service, written, matchCompletion } = setup(
      bout(
        rules({ pointCap: 5, bestOf: bestOfThree }),
        rules({ pointCap: 5, bestOf: singleFight }),
      ),
      FIVE_THREE,
    );

    await service.recomputeMatchScore(BOUT);

    expect(written()).toMatchObject({ awaiting_round_advance: true, red_round_wins: 1 });
    expect(written()).not.toHaveProperty('status');
    expect(matchCompletion.onMatchCompleted).not.toHaveBeenCalled();
  });

  it('the referee can end round 1 on time of a bout that started best of 3, though its Tournament now fights one round', async () => {
    const time = { timeLimitsSeconds: { pool: 90, bracket: 90, finals: 90 } };
    const { service, written } = setup(
      bout(
        rules({ pointCap: 10, bestOf: bestOfThree, ...time }),
        rules({ pointCap: 10, bestOf: singleFight, ...time }),
      ),
      [hit(1, 'red', 2), hit(2, 'blue', 1)],
    );

    await expect(service.endRoundOnTime(BOUT)).resolves.toEqual({ redScore: 2, blueScore: 1 });

    expect(written()).toMatchObject({ awaiting_round_advance: true, red_round_wins: 1 });
    const rounds = written()?.['rounds_json'] as Array<Record<string, unknown>>;
    expect(rounds[0]).toMatchObject({ round: 1, winnerColor: 'red', endReason: 'time_limit' });
  });

  it('an afterblow nets by the copy, deductive, though its Tournament now scores afterblows in full', async () => {
    // Red strikes 2, Blue answers 1. Deductive: Red max(0, 2 - 1) = 1, Blue 0. In full: 2 and 1.
    const afterblow = { ...hit(1, 'red', 2), type: 'afterblow', afterblow_value: 1 };
    const format = { pointCap: 5, bestOf: singleFight };
    const { service, written } = setup(
      bout(rules(format, { afterblowMode: 'deductive' }), rules(format, { afterblowMode: 'full' })),
      [afterblow],
    );

    await expect(service.recomputeMatchScore(BOUT)).resolves.toEqual({ redScore: 1, blueScore: 0 });

    expect(written()).toMatchObject({ red_score: 1, blue_score: 0 });
  });
});
