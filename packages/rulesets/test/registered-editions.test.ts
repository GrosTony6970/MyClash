/**
 * The gate of ruling "TF_v1 version" (2026-10-16): bump the version when an
 * engine's decision changes, and keep the old engine registered.
 *
 * Every built-in version is asked how a set of boards end, and its answers are
 * written here row by row. A version with no rows fails. A change to the shared
 * end decision that moves a registered version's answer fails: that change
 * needs a new version, and the old one keeps deciding as it did.
 *
 * The boards are scores, not exchanges: `isMatchOver` decides from the score
 * the caller holds. Countdown from 5, a doubles limit of 3 that wipes the board.
 */
import { describe, expect, it } from 'vitest';
import {
  BUILT_IN_RULESETS,
  DEFAULT_MATCH_FORMAT_CONFIG,
  GenericPointsCapDefaultConfig,
  TFv1DefaultConfig,
  pointCapWinnerColor,
  type Match,
  type MatchFormatConfig,
  type MatchScore,
  type Ruleset,
} from '../src/index';

const POOL = { phaseType: 'pool', matchNumberLabel: 'L1-P1-M01' } as const;
const BRACKET = { phaseType: 'single_elim', matchNumberLabel: 'QF1' } as const;
const DOWN = 'reverse_zero_loses';
const UP = 'normal';

interface Board {
  bout: typeof POOL | typeof BRACKET;
  direction: typeof DOWN | typeof UP;
  red: number;
  blue: number;
  doubles?: number;
  redBelowZero?: number;
  blueBelowZero?: number;
}

const BOARDS: Record<string, Board> = {
  'down, one out of points': { bout: POOL, direction: DOWN, red: 0, blue: 2 },
  'down, both out, pool': {
    ...{ bout: POOL, direction: DOWN, red: 0, blue: 0 },
    ...{ redBelowZero: 2, blueBelowZero: 1 },
  },
  'down, both out, bracket': {
    ...{ bout: BRACKET, direction: DOWN, red: 0, blue: 0 },
    ...{ redBelowZero: 2, blueBelowZero: 1 },
  },
  'down, both as far below, bracket': {
    ...{ bout: BRACKET, direction: DOWN, red: 0, blue: 0 },
    ...{ redBelowZero: 1, blueBelowZero: 1 },
  },
  'down, wiped at the doubles limit': { bout: POOL, direction: DOWN, red: 0, blue: 0, doubles: 3 },
  'down, a card behind on the wiped board': {
    ...{ bout: POOL, direction: DOWN, red: 0, blue: -1, doubles: 3 },
  },
  'up, at the cap': { bout: POOL, direction: UP, red: 5, blue: 3 },
  'up, at the cap and the doubles limit': {
    bout: POOL,
    direction: UP,
    red: 5,
    blue: 3,
    doubles: 3,
  },
  'up, at the doubles limit': { bout: POOL, direction: UP, red: 2, blue: 1, doubles: 3 },
};

type Answer = 'open' | `${'first_to_points' | 'max_doubles'}: ${'red' | 'blue' | 'nobody'}`;

const TF_BEFORE: Record<string, Answer> = {
  'down, one out of points': 'first_to_points: blue',
  'down, both out, pool': 'first_to_points: nobody',
  'down, both out, bracket': 'open',
  'down, both as far below, bracket': 'open',
  'down, wiped at the doubles limit': 'first_to_points: nobody',
  'down, a card behind on the wiped board': 'first_to_points: red',
  'up, at the cap': 'first_to_points: red',
  'up, at the cap and the doubles limit': 'first_to_points: red',
  'up, at the doubles limit': 'max_doubles: nobody',
};

const TF_SINCE: Record<string, Answer> = {
  ...TF_BEFORE,
  'down, both out, pool': 'first_to_points: blue',
  'down, both out, bracket': 'first_to_points: blue',
  'down, wiped at the doubles limit': 'max_doubles: nobody',
  'down, a card behind on the wiped board': 'max_doubles: nobody',
};

// No doubles limit: the cap alone ends a bout.
const GENERIC_BEFORE: Record<string, Answer> = {
  ...TF_BEFORE,
  'up, at the doubles limit': 'open',
};

const GENERIC_SINCE: Record<string, Answer> = {
  ...GENERIC_BEFORE,
  'down, both out, pool': 'first_to_points: blue',
  'down, both out, bracket': 'first_to_points: blue',
};

const ANSWERS: Record<string, Record<string, Answer>> = {
  'TF_v1@1.0.0': TF_BEFORE,
  'TF_v1@1.1.0': TF_SINCE,
  'Generic_PointsCap@1.0.0': GENERIC_BEFORE,
  'Generic_PointsCap@1.1.0': GENERIC_SINCE,
};

function format(direction: Board['direction']): MatchFormatConfig {
  return {
    ...DEFAULT_MATCH_FORMAT_CONFIG,
    pointCap: 5,
    scoringDirection: direction,
    maxDoubleHits: 3,
    maxDoubleHitOutcome: 'double_loss_zero_scores',
  };
}

function configOf(ruleset: Ruleset, matchFormat: MatchFormatConfig): unknown {
  const defaults = ruleset.code === 'TF_v1' ? TFv1DefaultConfig : GenericPointsCapDefaultConfig;
  return { ...defaults, matchFormat };
}

/** How `ruleset` ends `board`, and for whom, as the API reads it. */
function answer(ruleset: Ruleset, board: Board): Answer {
  const matchFormat = format(board.direction);
  const match = { ...board.bout, id: 'm1', redRegistrationId: 'r', blueRegistrationId: 'b' };
  const score: MatchScore = {
    redScore: board.red,
    blueScore: board.blue,
    doubles: board.doubles ?? 0,
    redWins: 0,
    blueWins: 0,
    redTargetPoints: 0,
    blueTargetPoints: 0,
    redTimesHit: 0,
    blueTimesHit: 0,
    ...(board.redBelowZero === undefined ? {} : { redBelowZero: board.redBelowZero }),
    ...(board.blueBelowZero === undefined ? {} : { blueBelowZero: board.blueBelowZero }),
  };
  const bout = { ...match, rulesetCode: ruleset.code, rulesetVersion: ruleset.version } as Match;
  const decision = ruleset.isMatchOver(bout, score, configOf(ruleset, matchFormat));
  if (!decision.isOver || decision.reason === null) return 'open';
  const winner =
    decision.reason === 'first_to_points'
      ? pointCapWinnerColor(score, matchFormat, ruleset.decisionEdition)
      : null;
  return `${decision.reason as 'first_to_points' | 'max_doubles'}: ${winner ?? 'nobody'}`;
}

describe('every built-in version decides as it was registered to', () => {
  it('has written answers for every registered version, and for every board', () => {
    const registered = BUILT_IN_RULESETS.map((r) => `${r.code}@${r.version}`);
    expect(registered.sort()).toEqual(Object.keys(ANSWERS).sort());
    for (const answers of Object.values(ANSWERS)) {
      expect(Object.keys(answers).sort()).toEqual(Object.keys(BOARDS).sort());
    }
  });

  for (const ruleset of BUILT_IN_RULESETS) {
    const key = `${ruleset.code}@${ruleset.version}`;
    it.each(Object.entries(BOARDS))(`${key}: %s`, (label, board) => {
      expect(answer(ruleset, board)).toBe(ANSWERS[key]?.[label]);
    });
  }
});
