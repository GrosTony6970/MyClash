import { describe, expect, it, vi } from 'vitest';
import type { Match as RulesetMatch, Ruleset } from '@myclash/rulesets';
import { mockSupabase, selectsFor, writesTo } from '../../common/testing/supabase-chain';
import { ScoringService } from './scoring.service';
import { builtInResolver } from './built-in-resolver.fixtures';
import type { RulesetResolver } from './ruleset-resolver.service';
import {
  BOUT,
  OVER_EVENT,
  RULES,
  RUNNING_EVENT,
  storedBout,
} from './scoring.service.corrections.fixtures';

/**
 * A side of a bout is a Registration or a team (0282). Scoring hands the engine each side's one
 * key (`sideKey`), and writes the winner the engine names back into that side's own column
 * (`winnerColumns`). A team bout of the 1b slice has no Registration on either side.
 *
 * The story: the red team and the blue team fight a Pool bout, first to 7. Red reaches 7.
 */
const TEAMS = {
  red_registration_id: null,
  blue_registration_id: null,
  red_team_id: 'team-r',
  blue_team_id: 'team-b',
  winner_team_id: null,
};

/** A clean hit, as the `exchanges` table holds it, in the round it was given in. */
function hit(seq: number, color: 'red' | 'blue', value: number, round = 1) {
  return {
    id: `e${seq}`,
    match_id: BOUT,
    sequence: seq,
    type: 'clean',
    occurred_at: '2026-01-01T00:00:00Z',
    first_striker_color: color,
    first_strike_value: value,
    afterblow_value: null,
    no_exchange_reason: null,
    round_number: round,
    voided: false,
  };
}

/** Red reaches the cap of 7. */
const RED_TO_SEVEN = (round = 1) => [
  hit(1, 'red', 3, round),
  hit(2, 'red', 3, round),
  hit(3, 'red', 1, round),
];

/** The same rules, fought as a best-of-3 in a Pool. */
const BEST_OF_3 = {
  ...RULES,
  ruleset_config: {
    matchFormat: {
      ...RULES.ruleset_config.matchFormat,
      bestOf: { pool: 3, bracket: 3, finals: 3 },
    },
  },
};

/** Round 1, won by red 7-0: a second won round clinches the series. */
const RED_WON_ROUND_1 = {
  round: 1,
  redScore: 7,
  blueScore: 0,
  winnerColor: 'red',
  endReason: 'first_to_points',
};

/** The bout's reads of `matches`, whole: the double ignores the projection. */
const MATCH_ROW_READ =
  'id, red_registration_id, blue_registration_id, red_team_id, blue_team_id, status, winner_registration_id, winner_team_id, end_reason, red_score, blue_score, match_number_label, current_round, rounds_json, red_round_wins, blue_round_wins, awaiting_round_advance, back_in_play_at, started_at, phases(type), ' +
  'match_rules(ruleset_code, ruleset_version, ruleset_config, scoring_config_json)';
const ROUND_CONTEXT_READ =
  'id, red_registration_id, blue_registration_id, red_team_id, blue_team_id, status, winner_registration_id, winner_team_id, match_number_label, current_round, rounds_json, red_round_wins, blue_round_wins, awaiting_round_advance, back_in_play_at, phases(type, tournaments(events(status))), ' +
  'match_rules(ruleset_code, ruleset_version, ruleset_config, scoring_config_json)';

/** The real built-in engines, each recording the Match it is handed to score. */
function watchedResolver() {
  const real = builtInResolver();
  const handed: RulesetMatch[] = [];
  const resolve = async (code: string, version: string): Promise<Ruleset | null> => {
    const ruleset = await real.resolve(code, version);
    if (!ruleset) return null;
    const watched = Object.create(ruleset) as Ruleset;
    watched.computeMatchScore = (match, ...rest) => {
      handed.push(match);
      return ruleset.computeMatchScore(match, ...rest);
    };
    return watched;
  };
  return { resolver: { resolve } as unknown as RulesetResolver, handed };
}

function setup(
  bout: Record<string, unknown>,
  sheet: Array<Record<string, unknown>>,
  context: Record<string, boolean> = RUNNING_EVENT,
) {
  const db = mockSupabase({
    matches: { rows: [bout] },
    exchanges: { rows: sheet },
    match_penalties: { rows: [] },
    match_forfeits: { rows: [] },
    match_events: { rows: [] },
  });
  const { resolver, handed } = watchedResolver();
  const matchCompletion = {
    onMatchCompleted: vi.fn().mockResolvedValue(undefined),
    onMatchUncompleted: vi.fn().mockResolvedValue(undefined),
    resultChangeContext: vi.fn().mockResolvedValue(context),
    onResultChanged: vi.fn().mockResolvedValue(undefined),
  };
  const clock = {
    getClockState: vi.fn().mockResolvedValue({ levelResolutionSteps: 0, status: 'ended' }),
    clockAction: vi.fn().mockResolvedValue(undefined),
  };
  const leagueRescore = { afterResultWrite: vi.fn().mockResolvedValue(undefined) };
  const service = new ScoringService(
    db as never,
    resolver,
    clock as never,
    matchCompletion as never,
    leagueRescore as never,
  );
  const written = () => writesTo(db, 'matches')[0]?.row;
  return { db, service, handed, written, matchCompletion };
}

/** A team bout still being fought, red and blue at 0. */
const runningTeams = (over: Record<string, unknown> = {}) =>
  storedBout({
    ...TEAMS,
    status: 'running',
    winner_registration_id: null,
    end_reason: null,
    red_score: 0,
    blue_score: 0,
    ...over,
  });

describe('ScoringService — the engine is handed each side by its key', () => {
  it('hands the engine a team bout with its two teams', async () => {
    const { service, handed } = setup(runningTeams(), [hit(1, 'red', 3)]);

    await service.recomputeMatchScore(BOUT);

    expect(handed.length).toBeGreaterThan(0);
    expect(handed[0]).toMatchObject({ redSideId: 'team-r', blueSideId: 'team-b' });
  });

  it('hands the engine no red side as null, never an empty id', async () => {
    // A card voided on a bout whose red Fighter was taken off still recomputes it (Task 7a).
    const { service, handed } = setup(
      storedBout({
        red_registration_id: null,
        red_team_id: null,
        blue_team_id: null,
        status: 'running',
        winner_registration_id: null,
        end_reason: null,
      }),
      [],
    );

    await service.recomputeMatchScore(BOUT);

    expect(handed[0]?.redSideId).toBeNull();
    expect(handed[0]?.blueSideId).toBe('blue');
  });

  it('reads both kinds of side, and both winner columns, with the bout', async () => {
    const { db, service } = setup(runningTeams(), [hit(1, 'red', 3)]);

    await service.recomputeMatchScore(BOUT);

    expect(selectsFor(db.from, 'matches')).toEqual([MATCH_ROW_READ]);
  });

  it('reads both kinds of side, and both winner columns, for a round ended on time', async () => {
    const { db, service } = setup(runningTeams({ match_rules: BEST_OF_3, current_round: 1 }), [
      hit(1, 'red', 3),
    ]);

    await service.endRoundOnTime(BOUT);

    expect(selectsFor(db.from, 'matches')).toEqual([ROUND_CONTEXT_READ]);
  });
});

describe('ScoringService — the winner is written into its own side', () => {
  it('a team bout the engine ends for red names the red team', async () => {
    const { service, written } = setup(runningTeams(), RED_TO_SEVEN());

    await service.recomputeMatchScore(BOUT);

    expect(written()).toMatchObject({
      status: 'completed',
      winner_registration_id: null,
      winner_team_id: 'team-r',
      end_reason: 'first_to_points',
    });
  });

  it('a correction that gives a finished team bout to blue names the blue team', async () => {
    // Red won 5-4 on time. A void leaves 3-4, and the Event is over: the bout stays finished.
    const finished = storedBout({
      ...TEAMS,
      winner_registration_id: null,
      winner_team_id: 'team-r',
    });
    const { service, written } = setup(
      finished,
      [hit(1, 'red', 3), hit(2, 'blue', 2), hit(3, 'blue', 2)],
      OVER_EVENT,
    );

    await service.recomputeMatchScore(BOUT);

    expect(written()).toMatchObject({
      red_score: 3,
      blue_score: 4,
      winner_registration_id: null,
      winner_team_id: 'team-b',
      end_reason: 'time_limit',
    });
  });

  it('a best-of series the red team clinches on the cap names the red team', async () => {
    const { service, written } = setup(
      runningTeams({
        match_rules: BEST_OF_3,
        current_round: 2,
        rounds_json: [RED_WON_ROUND_1],
        red_round_wins: 1,
      }),
      [
        ...RED_TO_SEVEN(1),
        ...RED_TO_SEVEN(2).map((one) => ({ ...one, sequence: one.sequence + 3 })),
      ],
    );

    await service.recomputeMatchScore(BOUT);

    expect(written()).toMatchObject({
      status: 'completed',
      red_round_wins: 2,
      winner_registration_id: null,
      winner_team_id: 'team-r',
    });
  });

  it('a best-of series the red team clinches on time names the red team', async () => {
    const { service, written } = setup(
      runningTeams({
        match_rules: BEST_OF_3,
        current_round: 2,
        rounds_json: [RED_WON_ROUND_1],
        red_round_wins: 1,
      }),
      [...RED_TO_SEVEN(1), { ...hit(4, 'red', 2, 2) }],
    );

    await service.endRoundOnTime(BOUT);

    expect(written()).toMatchObject({
      status: 'completed',
      red_round_wins: 2,
      winner_registration_id: null,
      winner_team_id: 'team-r',
    });
  });

  it('a finished team bout put back in play keeps no winner in either column', async () => {
    // Red won 7-4 on the cap. A void leaves 3-4 on a running Event: back to the referee.
    const finished = storedBout({
      ...TEAMS,
      winner_registration_id: null,
      winner_team_id: 'team-r',
      end_reason: 'first_to_points',
      red_score: 7,
    });
    const { service, written, matchCompletion } = setup(finished, [
      hit(1, 'red', 3),
      hit(2, 'blue', 2),
      hit(3, 'blue', 2),
    ]);

    await service.recomputeMatchScore(BOUT);

    expect(matchCompletion.onMatchUncompleted).toHaveBeenCalled();
    expect(written()).toMatchObject({
      status: 'paused',
      winner_registration_id: null,
      winner_team_id: null,
    });
  });
});
