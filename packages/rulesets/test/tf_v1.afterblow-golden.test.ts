/**
 * Synthetic golden — afterblow netting, end to end, in BOTH modes.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 * `tf_v1.fal2026.test.ts` is the acceptance test CLAUDE.md hard rule 2 calls
 * immovable, but it is far narrower than its reputation: it feeds hand-built
 * `FighterAggregates` straight to `computeScore`. `computeAggregates`,
 * `computeMatchScore` and `computeMatchFormatScore` are never invoked, so
 * afterblow netting — the single rule with the most duplicate owners in this
 * repo — had ZERO golden coverage, in either mode, even though TF_v1 seeds
 * `deductive`.
 *
 * The FAL fixture cannot close that: its own note says per-exchange sequences
 * are unavailable (O-102 pending) and the data is aggregate-level, scraped from
 * a published results page. So this is a second, SYNTHETIC golden. It touches
 * neither `fal2026.json` nor `tf_v1.fal2026.test.ts`.
 *
 * ── What it holds ───────────────────────────────────────────────────────────
 * 1. The mode CHANGES the answer. Every score below differs between `full` and
 *    `deductive`, so a caller that forgets to thread the mode — the hazard: all
 *    nine mode parameters default to `full` while the product default is
 *    `deductive` — reds this file rather than shipping silently.
 * 2. The two independent derivation paths AGREE. `computeAggregates` (per
 *    fighter) and `computeMatchFormatScore` (per match, reached through
 *    `computeMatchScore`) net afterblow points separately. They must produce the
 *    same target points and times-hit for the same exchanges. This is the
 *    assertion that catches a duplicate owner drifting.
 * 3. Voided exchanges are excluded by both paths.
 *
 * Every expected number here is hand-derived from ARCHITECTURE.md §6.1/§6.2 and
 * written out in the comments, not copied from a run. If this test fails, fix
 * the engine — do not adjust the numbers.
 */
import { describe, it, expect } from 'vitest';
import { computeAggregates, computeMatchScore, computeScore } from '../src/tf_v1/score';
import { TFv1DefaultConfig } from '../src/tf_v1/config';
import type { Exchange, Match } from '../src/types';

const RED = 'reg-red';
const BLUE = 'reg-blue';

const match: Match = {
  id: 'match-1',
  redRegistrationId: RED,
  blueRegistrationId: BLUE,
  rulesetCode: 'TF_v1',
  rulesetVersion: '1.0.0',
  status: 'completed',
  phaseType: 'pool',
  matchNumberLabel: 'L1-P1-M01',
};

const exchange = (seq: number, over: Partial<Exchange>): Exchange => ({
  id: `ex-${seq}`,
  clientUuid: `uuid-${seq}`,
  matchId: match.id,
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

/**
 * One bout covering every exchange type, both afterblow directions, and a
 * voided row. Deliberately 1 double: `maxDoubleHits` defaults to 4
 * (`match-format.ts:71`) and a pool bout at the cap is a DOUBLE LOSS that zeroes
 * both scores, which would mask everything else here.
 */
const exchanges: Exchange[] = [
  // 1. Clean, red strikes for 2.  red +2, blue takes the hit.
  exchange(1, { type: 'clean', firstStrikerColor: 'red', firstStrikeValue: 2 }),
  // 2. Clean, blue strikes for 1. blue +1, red takes the hit.
  exchange(2, { type: 'clean', firstStrikerColor: 'blue', firstStrikeValue: 1 }),
  // 3. Afterblow, red first for 2, blue answers 1.
  //    full: red +2, blue +1     deductive: red +1 (2−1), blue +0
  //    Red is the first striker, so red takes the hit in either mode.
  exchange(3, {
    type: 'afterblow',
    firstStrikerColor: 'red',
    firstStrikeValue: 2,
    afterblowValue: 1,
  }),
  // 4. Afterblow, blue first for 1, red answers 2. The NEGATIVE clamp case:
  //    full: blue +1, red +2     deductive: blue +0 (max(0, 1−2)), red +0
  exchange(4, {
    type: 'afterblow',
    firstStrikerColor: 'blue',
    firstStrikeValue: 1,
    afterblowValue: 2,
  }),
  // 5. Double — no points, counts toward the penalty.
  exchange(5, { type: 'double', firstStrikerColor: null }),
  // 6. No exchange — no score effect at all.
  exchange(6, { type: 'no_exchange', firstStrikerColor: null, noExchangeReason: 'reset' }),
  // 7. VOIDED clean worth 2 to red. Must be invisible to both paths.
  exchange(7, { type: 'clean', firstStrikerColor: 'red', firstStrikeValue: 2, voided: true }),
];

// ── Hand-derived expectations ────────────────────────────────────────────────
//
//                        full          deductive
//   red target points    2+2+2 = 6     2+1+0 = 3
//   blue target points   1+1+1 = 3     1+0+0 = 1
//   red times hit        2 (ex2, ex3)  2  — the mode does not move this
//   blue times hit       2 (ex1, ex4)  2
//   doubles              1             1
const EXPECTED = {
  full: { redPoints: 6, bluePoints: 3, redHits: 2, blueHits: 2, doubles: 1 },
  deductive: { redPoints: 3, bluePoints: 1, redHits: 2, blueHits: 2, doubles: 1 },
} as const;

describe('afterblow netting — synthetic golden', () => {
  describe.each(['full', 'deductive'] as const)('%s mode', (mode) => {
    const want = EXPECTED[mode];

    it('computeMatchScore nets both sides', () => {
      const score = computeMatchScore(match, exchanges, TFv1DefaultConfig, mode);

      expect(score.redScore).toBe(want.redPoints);
      expect(score.blueScore).toBe(want.bluePoints);
      expect(score.redTargetPoints).toBe(want.redPoints);
      expect(score.blueTargetPoints).toBe(want.bluePoints);
      expect(score.redTimesHit).toBe(want.redHits);
      expect(score.blueTimesHit).toBe(want.blueHits);
      expect(score.doubles).toBe(want.doubles);
    });

    it('computeAggregates agrees with computeMatchScore, per fighter', () => {
      const red = computeAggregates(RED, match, exchanges, true, mode);
      const blue = computeAggregates(BLUE, match, exchanges, false, mode);
      const score = computeMatchScore(match, exchanges, TFv1DefaultConfig, mode);

      // The drift catcher: two independent implementations of the same rule.
      expect(red.targetPoints).toBe(score.redTargetPoints);
      expect(blue.targetPoints).toBe(score.blueTargetPoints);
      expect(red.timesHit).toBe(score.redTimesHit);
      expect(blue.timesHit).toBe(score.blueTimesHit);
      expect(red.doubles).toBe(score.doubles);
      expect(blue.doubles).toBe(score.doubles);

      // …and against the hand-derived table, so agreeing on a WRONG answer
      // still fails.
      expect(red.targetPoints).toBe(want.redPoints);
      expect(blue.targetPoints).toBe(want.bluePoints);
      expect(red.wins).toBe(1);
      expect(blue.wins).toBe(0);
    });

    it('a voided exchange scores nothing', () => {
      const withoutVoided = exchanges.filter((e) => !e.voided);

      expect(computeMatchScore(match, withoutVoided, TFv1DefaultConfig, mode)).toEqual(
        computeMatchScore(match, exchanges, TFv1DefaultConfig, mode),
      );
      expect(computeAggregates(RED, match, withoutVoided, true, mode)).toEqual(
        computeAggregates(RED, match, exchanges, true, mode),
      );
    });
  });

  /**
   * SCORE = (wins × winBonus + targetPoints) / (timesHit + doublePenalty(doubles))
   * winBonus = 3; the federal double penalty is n(n−1)/3, so 1 double costs 0.
   *
   *   red  full  (3 + 6) / (2 + 0) = 4.5   deductive  (3 + 3) / 2 = 3
   *   blue full  (0 + 3) / (2 + 0) = 1.5   deductive  (0 + 1) / 2 = 0.5
   */
  it('computeScore, end to end from exchanges', () => {
    const score = (reg: string, isWinner: boolean, mode: 'full' | 'deductive') =>
      computeScore(computeAggregates(reg, match, exchanges, isWinner, mode));

    expect(score(RED, true, 'full')).toBe(4.5);
    expect(score(BLUE, false, 'full')).toBe(1.5);
    expect(score(RED, true, 'deductive')).toBe(3);
    expect(score(BLUE, false, 'deductive')).toBe(0.5);
  });

  /**
   * The guard on this whole file. If netting ever stops depending on the mode,
   * every assertion above still passes with identical numbers and the suite
   * reports success while checking nothing. This is the one test that must fail
   * in that world.
   */
  it('the mode changes the answer', () => {
    const full = computeMatchScore(match, exchanges, TFv1DefaultConfig, 'full');
    const deductive = computeMatchScore(match, exchanges, TFv1DefaultConfig, 'deductive');

    expect(deductive.redScore).toBeLessThan(full.redScore);
    expect(deductive.blueScore).toBeLessThan(full.blueScore);
  });
});
