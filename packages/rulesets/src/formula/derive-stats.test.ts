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

  /**
   * The STORED scores are stated, not implied by the exchanges: W/D/L comes from
   * the bout's own result now, and those two can legitimately differ.
   */
  function bout(
    id: string,
    red: string,
    blue: string,
    exchanges: Exchange[],
    redScore: number,
    blueScore: number,
    winnerRegistrationId: string | null = null,
  ): ScoredMatch {
    return {
      id,
      redRegistrationId: red,
      blueRegistrationId: blue,
      endReason: null,
      winnerRegistrationId,
      redScore,
      blueScore,
      exchanges,
    };
  }

  it('counts victories, ties, losses and aggregates hits across matches', () => {
    const bouts = [
      // m1: A scores 2, B scores 1 → A wins
      bout(
        'm1',
        'fighter-A',
        'fighter-B',
        [
          exchange('m1', 'red', 'clean', 1),
          exchange('m1', 'red', 'clean', 2),
          exchange('m1', 'blue', 'clean', 3),
        ],
        2,
        1,
      ),
      // m2: A scores 1, C scores 1 → tie
      bout(
        'm2',
        'fighter-A',
        'fighter-C',
        [exchange('m2', 'red', 'clean', 1), exchange('m2', 'blue', 'clean', 2)],
        1,
        1,
      ),
      // m3: D scores 2, A scores 0 → A loses, plus 1 double
      bout(
        'm3',
        'fighter-A',
        'fighter-D',
        [
          exchange('m3', 'blue', 'clean', 1),
          exchange('m3', 'blue', 'clean', 2),
          exchange('m3', null, 'double', 3),
        ],
        0,
        2,
      ),
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
    const stats = deriveFighterStats('C', [bout('m1', 'A', 'B', [], 0, 0)], 'full');
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
    // Only the two ZEROING reasons wipe the board. Under `result_stands` — and
    // on an ordinary bout — red's hit stands, which is the difference the test
    // below turns on.
    redScore: endReason === 'max_doubles' || endReason === 'max_doubles_draw' ? 0 : 1,
    blueScore: 0,
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

  it('leaves the other two ceiling reasons to the board', () => {
    // 'max_doubles_result_stands' keeps the board and a null reason is every
    // ordinary bout, so both are decided by the stored score like anything else.
    for (const reason of ['max_doubles_result_stands', null]) {
      expect(deriveFighterStats('A', [ceilingBout(reason)], 'full')).toMatchObject({
        victories: 1,
        losses: 0,
      });
    }
  });
});

describe('deriveFighterStats scores the bout that was fought', () => {
  /**
   * W/D/L used to come from a score RE-DERIVED from the exchanges, so anything
   * that decided a bout other than the exchanges was invisible: a forfeit, a
   * referee override, a penalty that flipped the result. And since
   * `victories`/`ties`/`losses` ARE this ruleset's W/D/L variables, an
   * org-authored pool derived W/D/L twice in one table, two different ways.
   */
  const ex = (seq: number, striker: 'red' | 'blue'): Exchange => ({
    id: `m-${seq}`,
    clientUuid: 'c',
    matchId: 'm-ff',
    sequence: seq,
    type: 'clean',
    occurredAt: '',
    firstStrikerColor: striker,
    firstStrikeValue: 1,
    afterblowValue: null,
    noExchangeReason: null,
    voided: false,
  });

  // A was two hits up and then forfeited: `scorePolicy: 'keep_current'` leaves
  // the board at 2-0 and names B the winner.
  const forfeited: ScoredMatch = {
    id: 'm-ff',
    redRegistrationId: 'A',
    blueRegistrationId: 'B',
    winnerRegistrationId: 'B',
    endReason: 'forfeit',
    redScore: 2,
    blueScore: 0,
    exchanges: [ex(1, 'red'), ex(2, 'red')],
  };

  it('honours the recorded winner over the hits on the board', () => {
    expect(deriveFighterStats('A', [forfeited], 'full')).toMatchObject({
      victories: 0,
      losses: 1,
    });
    expect(deriveFighterStats('B', [forfeited], 'full')).toMatchObject({
      victories: 1,
      losses: 0,
    });
  });

  it('reads the STORED board, not one re-summed from the exchanges', () => {
    // The distinction the forfeit above cannot show, because a recorded winner
    // short-circuits the scores entirely. Here there is NO winner: the doubles
    // ceiling wiped the board to 0-0 under `draw_zero_scores`, while the
    // exchanges still say red landed one. Re-summing them calls it a victory.
    const wiped: ScoredMatch = {
      id: 'm-wiped',
      redRegistrationId: 'A',
      blueRegistrationId: 'B',
      winnerRegistrationId: null,
      endReason: 'max_doubles_draw',
      redScore: 0,
      blueScore: 0,
      exchanges: [ex(1, 'red')],
    };

    expect(deriveFighterStats('A', [wiped], 'full')).toMatchObject({
      victories: 0,
      ties: 1,
      losses: 0,
    });
  });

  it('still counts the hits that were landed, which is a different question', () => {
    // `hitsGiven`/`hitsReceived` are named for hits and stay on the exchanges.
    // A really did land two, and forfeiting does not un-land them.
    expect(deriveFighterStats('A', [forfeited], 'full')).toMatchObject({
      hitsGiven: 2,
      hitsReceived: 0,
    });
  });
});

describe('deriveFighterStats afterblow netting', () => {
  const afterblowBout = {
    id: 'm1',
    redRegistrationId: 'A',
    blueRegistrationId: 'B',
    winnerRegistrationId: null,
    endReason: null,
    redScore: 2,
    blueScore: 1,
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
