/**
 * TF_v1 score.ts — 100% unit test coverage
 * Includes the §6.4 reference cross-check:
 *   Thibaud Jacquier-Bret: V=4, Pts+=37, Pts−=10, Dbl=2, Score=4.6
 *   SCORE = (4×3 + 37) / (10 + 2×1/3) = 49 / 10.67 ≈ 4.59 → rounds to 4.6
 */
import { describe, it, expect } from 'vitest';
import {
  WIN_BONUS,
  doublePenalty,
  computeScore,
  computeAggregates,
  computeMatchScore,
  isMatchOver,
  DOUBLE_PENALTY_FORMULAS,
  DOUBLE_PENALTY_FORMULA_KEYS,
  type DoublePenaltyFormula,
} from './score';
import { TFv1DefaultConfig, type TFv1Config } from './config';
import type { Exchange, Match } from '../types';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const BASE_MATCH: Match = {
  id: 'm1',
  redRegistrationId: 'reg-red',
  blueRegistrationId: 'reg-blue',
  rulesetCode: 'TF_v1',
  rulesetVersion: '1.0.0',
  status: 'running',
};

function makeExchange(overrides: Partial<Exchange>): Exchange {
  return {
    id: 'ex-1',
    clientUuid: 'uuid-1',
    matchId: 'm1',
    sequence: 1,
    type: 'clean',
    occurredAt: new Date().toISOString(),
    firstStrikerColor: 'red',
    firstStrikeValue: 1,
    afterblowValue: null,
    noExchangeReason: null,
    voided: false,
    ...overrides,
  };
}

// ── doublePenalty ─────────────────────────────────────────────────────────────

describe('doublePenalty', () => {
  it('returns 0 for 0 doubles', () => expect(doublePenalty(0)).toBe(0));
  it('returns 0 for 1 double', () => expect(doublePenalty(1)).toBe(0));
  it('returns 2/3 for 2 doubles', () => expect(doublePenalty(2)).toBeCloseTo(2 / 3));
  it('returns 2 for 3 doubles', () => expect(doublePenalty(3)).toBe(2));
  it('returns 4 for 4 doubles', () => expect(doublePenalty(4)).toBe(4));
  it('matches formula n*(n-1)/3', () => {
    for (let n = 0; n <= 10; n++) {
      expect(doublePenalty(n)).toBeCloseTo((n * (n - 1)) / 3);
    }
  });
});

// ── computeScore ──────────────────────────────────────────────────────────────

describe('computeScore', () => {
  it('returns numerator when denominator is 0 (edge case)', () => {
    expect(computeScore({ wins: 2, targetPoints: 5, timesHit: 0, doubles: 0 })).toBe(11);
  });

  it('returns 0 when numerator and denominator are both 0', () => {
    expect(computeScore({ wins: 0, targetPoints: 0, timesHit: 0, doubles: 0 })).toBe(0);
  });

  it('computes correctly for typical values', () => {
    // wins=2, targetPoints=10, timesHit=5, doubles=0
    // SCORE = (2*3 + 10) / (5 + 0) = 16/5 = 3.2
    expect(computeScore({ wins: 2, targetPoints: 10, timesHit: 5, doubles: 0 })).toBeCloseTo(3.2);
  });

  // ── §6.4 Reference cross-check ────────────────────────────────────────────
  it('§6.4 reference: Thibaud Jacquier-Bret V=4 Pts+=37 Pts−=10 Dbl=2 → Score≈4.59', () => {
    // SCORE = (4×3 + 37) / (10 + 2×(2-1)/3) = 49 / (10 + 2/3) = 49 / 10.667 ≈ 4.594
    const score = computeScore({ wins: 4, targetPoints: 37, timesHit: 10, doubles: 2 });
    expect(score).toBeCloseTo(4.594, 2);
    // Rounded to 1 decimal = 4.6
    expect(Math.round(score * 10) / 10).toBe(4.6);
  });

  it('WIN_BONUS is 3', () => expect(WIN_BONUS).toBe(3));
});

// ── Configurable ranking inputs ───────────────────────────────────────────────

describe('computeScore — ruleset-configured inputs', () => {
  const agg = { wins: 2, targetPoints: 10, timesHit: 5, doubles: 0 };

  it('honours a non-default winBonus', () => {
    // Both were hardcoded, so a super-admin amending the rulebook changed a
    // stored value the engine never read.
    expect(computeScore(agg)).toBeCloseTo(3.2); // (2*3 + 10) / 5
    expect(computeScore(agg, { winBonus: 5 })).toBeCloseTo(4); // (2*5 + 10) / 5
    expect(computeScore(agg, { winBonus: 0 })).toBeCloseTo(2); // (0 + 10) / 5
  });

  it('honours each whitelisted doublePenaltyFormula', () => {
    // 4 doubles, 0 hits taken → the denominator IS the double penalty.
    const d = { wins: 0, targetPoints: 12, timesHit: 0, doubles: 4 };
    expect(computeScore(d, { doublePenaltyFormula: 'n*(n-1)/3' })).toBeCloseTo(3); // /4
    expect(computeScore(d, { doublePenaltyFormula: 'n*(n-1)/2' })).toBeCloseTo(2); // /6
    expect(computeScore(d, { doublePenaltyFormula: 'n' })).toBeCloseTo(3); // /4
    // '0' zeroes the denominator, so the edge case returns the numerator.
    expect(computeScore(d, { doublePenaltyFormula: '0' })).toBe(12);
  });

  it('falls back to the federal formula for an unknown key', () => {
    // A stored config predating a whitelist entry must not 500 the standings.
    const unknown = 'n*(n-1)/7' as unknown as DoublePenaltyFormula;
    expect(doublePenalty(4, unknown)).toBe(doublePenalty(4));
  });

  it('every whitelisted key is a pure function of n, never evaluated', () => {
    // AGENTS.md hard rule #5 — the config carries a key, not an expression.
    for (const key of DOUBLE_PENALTY_FORMULA_KEYS) {
      expect(typeof DOUBLE_PENALTY_FORMULAS[key]).toBe('function');
      expect(DOUBLE_PENALTY_FORMULAS[key](0)).toBe(0);
    }
  });
});

// ── computeAggregates ─────────────────────────────────────────────────────────

describe('computeAggregates', () => {
  it('counts clean hit for red striker', () => {
    const ex = makeExchange({ type: 'clean', firstStrikerColor: 'red', firstStrikeValue: 1 });
    const agg = computeAggregates('reg-red', BASE_MATCH, [ex], false);
    expect(agg.targetPoints).toBe(1);
    expect(agg.timesHit).toBe(0);
  });

  it('counts times_hit for blue when red strikes clean', () => {
    const ex = makeExchange({ type: 'clean', firstStrikerColor: 'red', firstStrikeValue: 1 });
    const agg = computeAggregates('reg-blue', BASE_MATCH, [ex], false);
    expect(agg.targetPoints).toBe(0);
    expect(agg.timesHit).toBe(1);
  });

  it('counts 2pt clean hit', () => {
    const ex = makeExchange({ type: 'clean', firstStrikerColor: 'red', firstStrikeValue: 2 });
    const agg = computeAggregates('reg-red', BASE_MATCH, [ex], false);
    expect(agg.targetPoints).toBe(2);
  });

  it('afterblow: first striker gains first_strike_value AND receives afterblow (timesHit+1)', () => {
    const ex = makeExchange({
      type: 'afterblow',
      firstStrikerColor: 'red',
      firstStrikeValue: 1,
      afterblowValue: 1,
    });
    // Red struck first → red gains 1pt, red receives afterblow → red timesHit+1
    const redAgg = computeAggregates('reg-red', BASE_MATCH, [ex], false);
    expect(redAgg.targetPoints).toBe(1);
    expect(redAgg.timesHit).toBe(1);

    // Blue landed afterblow → blue gains afterblow_value
    const blueAgg = computeAggregates('reg-blue', BASE_MATCH, [ex], false);
    expect(blueAgg.targetPoints).toBe(1);
    expect(blueAgg.timesHit).toBe(0);
  });

  it('double: counts toward doubles for both fighters', () => {
    const ex = makeExchange({ type: 'double', firstStrikerColor: null, firstStrikeValue: null });
    const redAgg = computeAggregates('reg-red', BASE_MATCH, [ex], false);
    const blueAgg = computeAggregates('reg-blue', BASE_MATCH, [ex], false);
    expect(redAgg.doubles).toBe(1);
    expect(blueAgg.doubles).toBe(1);
    expect(redAgg.targetPoints).toBe(0);
    expect(blueAgg.targetPoints).toBe(0);
  });

  it('no_exchange: no effect on any aggregate', () => {
    const ex = makeExchange({
      type: 'no_exchange',
      firstStrikerColor: null,
      firstStrikeValue: null,
    });
    const agg = computeAggregates('reg-red', BASE_MATCH, [ex], false);
    expect(agg.targetPoints).toBe(0);
    expect(agg.timesHit).toBe(0);
    expect(agg.doubles).toBe(0);
  });

  it('voided exchanges are ignored', () => {
    const ex = makeExchange({
      type: 'clean',
      firstStrikerColor: 'red',
      firstStrikeValue: 2,
      voided: true,
    });
    const agg = computeAggregates('reg-red', BASE_MATCH, [ex], false);
    expect(agg.targetPoints).toBe(0);
  });

  it('win flag sets wins=1', () => {
    const agg = computeAggregates('reg-red', BASE_MATCH, [], true);
    expect(agg.wins).toBe(1);
  });

  it('loss sets wins=0', () => {
    const agg = computeAggregates('reg-red', BASE_MATCH, [], false);
    expect(agg.wins).toBe(0);
  });
});

// ── computeMatchScore ─────────────────────────────────────────────────────────

describe('computeMatchScore', () => {
  it('returns zero scores for empty exchange list', () => {
    const score = computeMatchScore(BASE_MATCH, [], TFv1DefaultConfig);
    expect(score.redScore).toBe(0);
    expect(score.blueScore).toBe(0);
    expect(score.doubles).toBe(0);
  });

  it('accumulates red score from clean hits', () => {
    const exchanges = [
      makeExchange({
        id: 'e1',
        sequence: 1,
        type: 'clean',
        firstStrikerColor: 'red',
        firstStrikeValue: 1,
      }),
      makeExchange({
        id: 'e2',
        sequence: 2,
        type: 'clean',
        firstStrikerColor: 'red',
        firstStrikeValue: 2,
      }),
    ];
    const score = computeMatchScore(BASE_MATCH, exchanges, TFv1DefaultConfig);
    expect(score.redScore).toBe(3);
    expect(score.blueScore).toBe(0);
    expect(score.blueTimesHit).toBe(2);
  });

  it('counts doubles correctly', () => {
    const exchanges = [
      makeExchange({
        id: 'e1',
        sequence: 1,
        type: 'double',
        firstStrikerColor: null,
        firstStrikeValue: null,
      }),
      makeExchange({
        id: 'e2',
        sequence: 2,
        type: 'double',
        firstStrikerColor: null,
        firstStrikeValue: null,
      }),
    ];
    const score = computeMatchScore(BASE_MATCH, exchanges, TFv1DefaultConfig);
    expect(score.doubles).toBe(2);
    expect(score.redScore).toBe(0);
    expect(score.blueScore).toBe(0);
  });

  it('afterblow: both fighters score', () => {
    const ex = makeExchange({
      type: 'afterblow',
      firstStrikerColor: 'red',
      firstStrikeValue: 1,
      afterblowValue: 1,
    });
    const score = computeMatchScore(BASE_MATCH, [ex], TFv1DefaultConfig);
    expect(score.redScore).toBe(1); // red struck first
    expect(score.blueScore).toBe(1); // blue landed afterblow
    expect(score.redTimesHit).toBe(1); // red received afterblow
  });
});

// ── isMatchOver ───────────────────────────────────────────────────────────────

describe('isMatchOver', () => {
  /** The score the caller would hold, from this bout's exchanges. */
  const scoreOf = (match: Match, exchanges: Exchange[], config: TFv1Config) =>
    computeMatchScore(match, exchanges, config, 'full');

  it('not over on an empty bout', () => {
    // The time-limit cases that used to sit here went with the branch: nothing
    // passes a clock any more, so a bout only ends on points or doubles.
    const result = isMatchOver(
      BASE_MATCH,
      scoreOf(BASE_MATCH, [], TFv1DefaultConfig),
      TFv1DefaultConfig,
    );
    expect(result.isOver).toBe(false);
  });

  it('over when first-to-points reached', () => {
    const config = {
      ...TFv1DefaultConfig,
      matchFormat: { ...TFv1DefaultConfig.matchFormat, firstToPoints: 5, timeLimitSeconds: null },
    };
    const exchanges = Array.from({ length: 5 }, (_, i) =>
      makeExchange({
        id: `e${i}`,
        sequence: i + 1,
        type: 'clean',
        firstStrikerColor: 'red',
        firstStrikeValue: 1,
      }),
    );
    const result = isMatchOver(BASE_MATCH, scoreOf(BASE_MATCH, exchanges, config), config);
    expect(result.isOver).toBe(true);
    expect(result.reason).toBe('first_to_points');
  });

  it('over when max doubles reached in a POOL match', () => {
    // Max-doubles is a pool-only end condition; the match must be a pool match.
    const config = {
      ...TFv1DefaultConfig,
      matchFormat: { ...TFv1DefaultConfig.matchFormat, maxDoubles: 3, timeLimitSeconds: null },
    };
    const exchanges = Array.from({ length: 3 }, (_, i) =>
      makeExchange({
        id: `e${i}`,
        sequence: i + 1,
        type: 'double',
        firstStrikerColor: null,
        firstStrikeValue: null,
      }),
    );
    const pool: Match = { ...BASE_MATCH, phaseType: 'pool' };
    const result = isMatchOver(pool, scoreOf(pool, exchanges, config), config);
    expect(result.isOver).toBe(true);
    expect(result.reason).toBe('max_doubles');
  });

  it('does NOT end a bracket/finals match on max doubles', () => {
    // Bracket & finals must resolve to a winner, so max-doubles never ends them.
    const config = {
      ...TFv1DefaultConfig,
      matchFormat: { ...TFv1DefaultConfig.matchFormat, maxDoubles: 3, timeLimitSeconds: null },
    };
    const exchanges = Array.from({ length: 3 }, (_, i) =>
      makeExchange({
        id: `e${i}`,
        sequence: i + 1,
        type: 'double',
        firstStrikerColor: null,
        firstStrikeValue: null,
      }),
    );
    const bout: Match = { ...BASE_MATCH, phaseType: 'single_elim', matchNumberLabel: 'QF1' };
    const bracket = isMatchOver(bout, scoreOf(bout, exchanges, config), config);
    expect(bracket.isOver).toBe(false);
  });
});
