/**
 * `deriveFighterStats` — the per-fighter tallies a formula ruleset scores over.
 *
 * Split out of `formula.test.ts`, which had grown past the file budget. The seam
 * is real rather than convenient: this covers a module in `@myclash/rules`,
 * while `formula.test.ts` covers the AST evaluator and the ruleset factory
 * built on top of it.
 */
import { describe, expect, it } from 'vitest';
import { deriveFighterStats } from '@myclash/rules';
import type { Exchange, ScoredMatch } from '../types';

describe('deriveFighterStats', () => {
  function exchange(
    matchId: string,
    striker: 'red' | 'blue' | null,
    type: Exchange['type'],
    seq: number,
  ): Exchange {
    return {
      id: `${matchId}-${seq}`,
      clientUuid: 'c',
      matchId,
      sequence: seq,
      type,
      occurredAt: '',
      firstStrikerColor: striker,
      firstStrikeValue: striker ? 1 : null,
      afterblowValue: null,
      noExchangeReason: null,
      voided: false,
    };
  }

  function bout(id: string, red: string, blue: string, exchanges: Exchange[]): ScoredMatch {
    return {
      id,
      redRegistrationId: red,
      blueRegistrationId: blue,
      endReason: null,
      // This ruleset calls a bout by raw score, so the stored winner is not read.
      winnerRegistrationId: null,
      exchanges,
    };
  }

  it('counts victories, ties, losses and aggregates hits across matches', () => {
    const bouts = [
      // m1: A scores 2, B scores 1 → A wins
      bout('m1', 'fighter-A', 'fighter-B', [
        exchange('m1', 'red', 'clean', 1),
        exchange('m1', 'red', 'clean', 2),
        exchange('m1', 'blue', 'clean', 3),
      ]),
      // m2: A scores 1, C scores 1 → tie
      bout('m2', 'fighter-A', 'fighter-C', [
        exchange('m2', 'red', 'clean', 1),
        exchange('m2', 'blue', 'clean', 2),
      ]),
      // m3: D scores 2, A scores 0 → A loses, plus 1 double
      bout('m3', 'fighter-A', 'fighter-D', [
        exchange('m3', 'blue', 'clean', 1),
        exchange('m3', 'blue', 'clean', 2),
        exchange('m3', null, 'double', 3),
      ]),
    ];

    const stats = deriveFighterStats('fighter-A', bouts, 'full');
    expect(stats.victories).toBe(1);
    expect(stats.ties).toBe(1);
    expect(stats.losses).toBe(1);
    expect(stats.doubleHits).toBe(1);
    expect(stats.hitsGiven).toBe(3); // 2 + 1 + 0
    expect(stats.hitsReceived).toBe(4); // 1 + 1 + 2
  });

  it('ignores a fighter who did not fight the bout', () => {
    // The 'skips non-completed matches' case that used to sit here went with the
    // `status` field: `completedMatches` is finished bouts by contract, so a
    // scheduled one cannot be passed at all. This is the filter that remains.
    const stats = deriveFighterStats('C', [bout('m1', 'A', 'B', [])], 'full');
    expect(stats).toEqual({
      victories: 0,
      ties: 0,
      losses: 0,
      doubleHits: 0,
      hitsGiven: 0,
      hitsReceived: 0,
    });
  });
});

describe('deriveFighterStats at the doubles ceiling', () => {
  /**
   * This scorer re-derives from the RAW exchanges, so the engine's 0-0 collapse
   * is invisible to it. A bout stopped at the ceiling after two red hits was
   * therefore recording a VICTORY for red and a loss for blue — worse than the
   * draw the pool standings gave it, and in every organiser-authored formula.
   */
  const ex = (seq: number, striker: 'red' | null, type: Exchange['type']): Exchange => ({
    id: `m-md-${seq}`,
    clientUuid: 'c',
    matchId: 'm-md',
    sequence: seq,
    type,
    occurredAt: '',
    firstStrikerColor: striker,
    firstStrikeValue: striker ? 1 : null,
    afterblowValue: null,
    noExchangeReason: null,
    voided: false,
  });

  // Red is one clean hit ahead when the second double reaches the ceiling.
  const ceilingBout = (endReason: string | null): ScoredMatch => ({
    id: 'm-md',
    redRegistrationId: 'A',
    blueRegistrationId: 'B',
    winnerRegistrationId: null,
    endReason,
    exchanges: [ex(1, 'red', 'clean'), ex(2, null, 'double')],
  });

  it('counts a LOSS for both, not a victory for whoever was ahead', () => {
    expect(deriveFighterStats('A', [ceilingBout('max_doubles')], 'full')).toMatchObject({
      victories: 0,
      losses: 1,
      ties: 0,
    });
    expect(deriveFighterStats('B', [ceilingBout('max_doubles')], 'full')).toMatchObject({
      victories: 0,
      losses: 1,
      ties: 0,
    });
  });

  it('leaves the other two ceiling reasons to the raw score', () => {
    // 'max_doubles_result_stands' keeps the board, which the raw score already
    // reproduces; a null reason is every ordinary bout.
    for (const reason of ['max_doubles_result_stands', null]) {
      expect(deriveFighterStats('A', [ceilingBout(reason)], 'full')).toMatchObject({
        victories: 1,
        losses: 0,
      });
    }
  });
});

describe('deriveFighterStats afterblow netting', () => {
  const afterblowBout = {
    id: 'm1',
    redRegistrationId: 'A',
    blueRegistrationId: 'B',
    winnerRegistrationId: null,
    endReason: null,
    exchanges: [
      {
        id: 'e1',
        clientUuid: 'c',
        matchId: 'm1',
        sequence: 1,
        type: 'afterblow' as const,
        occurredAt: '',
        firstStrikerColor: 'red' as const,
        firstStrikeValue: 2 as const,
        afterblowValue: 1 as const,
        noExchangeReason: null,
        voided: false,
      },
    ],
  };

  it('nets by the mode it is HANDED, which is now a required argument', () => {
    // Full: attacker keeps 2, defender keeps 1. Deductive: attacker 2-1 = 1,
    // defender 0. Nothing defaults, so a caller cannot silently pick 'full'.
    expect(deriveFighterStats('A', [afterblowBout], 'full').hitsGiven).toBe(2);
    expect(deriveFighterStats('B', [afterblowBout], 'full').hitsGiven).toBe(1);
    expect(deriveFighterStats('A', [afterblowBout], 'deductive').hitsGiven).toBe(1);
    expect(deriveFighterStats('B', [afterblowBout], 'deductive').hitsGiven).toBe(0);
  });
});
