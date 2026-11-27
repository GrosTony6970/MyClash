/**
 * A copy of TF_v1 is a club formula ruleset (ruling 2026-11-27). Until it is
 * edited it must score and rank exactly as TF_v1 does. This file proves it.
 *
 * It reads `fal2026.json` and never changes it: the FAL golden test
 * (`tf_v1.fal2026.test.ts`) stays the authority on TF_v1 itself.
 *
 * The FAL rows alone cannot tell "times hit" from "points received": they hold
 * aggregates, not hits. The afterblow golden bout can (red is hit twice but
 * concedes 3 points in full mode), and so can the deep hits in the pool below.
 */
import { describe, expect, it } from 'vitest';
import {
  DOUBLE_PENALTY_FORMULA_KEYS,
  EDITION_2026_10,
  TF_v1,
  buildFormulaScope,
  computeScore,
  createFormulaRuleset,
  evaluateFormula,
  tfV1AsFormula,
} from '../src';
import type { AfterblowMode, Exchange, Ruleset, ScoredMatch } from '../src/types';
import fixture from './fixtures/fal2026.json';

function formulaCopy(tfConfig?: unknown): Ruleset {
  const { formula, grammar } = tfV1AsFormula(tfConfig);
  return createFormulaRuleset('Club_TF', '1.0.0', 'Club TF', formula, EDITION_2026_10, grammar);
}

describe('TF_v1 as a formula — FAL 2026', () => {
  const { formula } = tfV1AsFormula();
  const rows = [...fixture.longsword.pool_standings, ...fixture.sidesword.pool_standings];

  it.each(rows)('$name scores the same as TF_v1', (row) => {
    const tf = computeScore({
      wins: row.wins,
      targetPoints: row.pts_plus,
      timesHit: row.pts_minus,
      doubles: row.doubles,
    });
    const scope = buildFormulaScope(
      {
        victories: row.wins,
        hitsGiven: row.pts_plus,
        hitsReceived: row.pts_minus,
        doubleHits: row.doubles,
      },
      formula,
    );
    expect(evaluateFormula(formula.scoreFormula, scope)).toBe(tf);
  });
});

// ── Bouts, scored end to end by both rulesets ────────────────────────────────

let seq = 0;
const hit = (over: Partial<Exchange>): Exchange => ({
  id: `ex-${++seq}`,
  clientUuid: `uuid-${seq}`,
  matchId: 'm',
  sequence: seq,
  type: 'clean',
  occurredAt: '2026-05-22T10:00:00.000Z',
  firstStrikerColor: null,
  firstStrikeValue: null,
  afterblowValue: null,
  noExchangeReason: null,
  voided: false,
  ...over,
});
const clean = (by: 'red' | 'blue', value: number) =>
  hit({ firstStrikerColor: by, firstStrikeValue: value });
const afterblow = (by: 'red' | 'blue', value: number, answer: number) =>
  hit({
    type: 'afterblow',
    firstStrikerColor: by,
    firstStrikeValue: value,
    afterblowValue: answer,
  });
const double = () => hit({ type: 'double' });

const bout = (
  id: string,
  red: string,
  blue: string,
  winner: string | null,
  exchanges: Exchange[],
): ScoredMatch => ({
  id,
  redRegistrationId: red,
  blueRegistrationId: blue,
  winnerRegistrationId: winner,
  endReason: null,
  redScore: winner === red ? 1 : 0,
  blueScore: winner === blue ? 1 : 0,
  exchanges,
});

/** The afterblow golden bout (`tf_v1.afterblow-golden.test.ts`), red winning. */
const GOLDEN = bout('golden', 'R', 'B', 'R', [
  clean('red', 2),
  clean('blue', 1),
  afterblow('red', 2, 1),
  afterblow('blue', 1, 2),
  double(),
  hit({ type: 'no_exchange', noExchangeReason: 'reset' }),
  hit({ firstStrikerColor: 'red', firstStrikeValue: 2, voided: true }),
]);

/** A pool of three with deep hits, two doubles and an afterblow. */
const POOL = [
  bout('m1', 'A', 'B', 'A', [clean('red', 2), clean('blue', 1), double(), double()]),
  bout('m2', 'B', 'C', 'B', [afterblow('red', 2, 1), clean('blue', 1), clean('red', 2)]),
  bout('m3', 'A', 'C', 'A', [clean('red', 1)]),
];

/** A fighter never hit, with no doubles: the zero denominator. */
const UNBEATEN = [bout('u1', 'A', 'B', 'A', [clean('red', 2), clean('red', 1)])];

function scores(ruleset: Ruleset, matches: ScoredMatch[], mode: AfterblowMode, config?: unknown) {
  const ids = [...new Set(matches.flatMap((m) => [m.redRegistrationId, m.blueRegistrationId]))];
  return ruleset.scorePoolFighters!({
    registrationIds: ids,
    completedMatches: matches,
    afterblowMode: mode,
    config,
  });
}

describe.each(['full', 'deductive'] as const)('TF_v1 as a formula — bouts, %s mode', (mode) => {
  it.each([
    ['the afterblow golden bout', [GOLDEN]],
    ['a pool of three', POOL],
    ['an unbeaten fighter', UNBEATEN],
  ] as const)('%s scores the same as TF_v1', (_name, matches) => {
    expect(scores(formulaCopy(), [...matches], mode)).toEqual(
      scores(TF_v1, [...matches], mode, {}),
    );
  });

  it('carries a copy’s own win bonus and double penalty', () => {
    const tfConfig = { winBonus: 5, doublePenaltyFormula: DOUBLE_PENALTY_FORMULA_KEYS.at(-1) };
    expect(scores(formulaCopy(tfConfig), POOL, mode)).toEqual(scores(TF_v1, POOL, mode, tfConfig));
  });
});

describe('TF_v1 as a formula — ranking and grammar', () => {
  it('ranks by the same chain', () => {
    expect(formulaCopy().rankingChain).toEqual(TF_v1.rankingChain);
  });

  it('plays the same targets and afterblow rule', () => {
    const copy = formulaCopy().metadata!;
    const tf = TF_v1.metadata!;
    expect(copy.targets).toEqual(tf.targets);
    expect(copy.hasAfterblow).toBe(tf.hasAfterblow);
    expect(copy.defaultAfterblowMode).toBe(tf.defaultAfterblowMode);
    expect(copy.afterblowValuation).toBe(tf.afterblowValuation);
    expect(copy.afterblowFixedValue).toBe(tf.afterblowFixedValue);
  });

  it('scores a bout the same as TF_v1', () => {
    const match = {
      ...GOLDEN,
      rulesetCode: 'Club_TF',
      rulesetVersion: '1.0.0',
      status: 'running' as const,
      phaseType: 'pool' as const,
    };
    for (const mode of ['full', 'deductive'] as const) {
      expect(formulaCopy().computeMatchScore(match, GOLDEN.exchanges, mode, {})).toEqual(
        TF_v1.computeMatchScore(match, GOLDEN.exchanges, mode, {}),
      );
    }
  });
});
