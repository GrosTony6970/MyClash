import { describe, expect, it } from 'vitest';
import type { RoundEvaluation } from '@myclash/rulesets';
import { correctedClosedRound, type ClosedRound } from './closed-round-correction';

/**
 * Ruling 247: the score of a closed round of a best-of series follows its
 * sheet; its winner never moves. `ev` is the round as its sheet reads NOW.
 */
const closed = (over: Partial<ClosedRound> = {}): ClosedRound => ({
  round: 1,
  redScore: 5,
  blueScore: 3,
  winnerColor: 'red',
  endReason: 'time_limit',
  ...over,
});

const reads = (
  redScore: number,
  blueScore: number,
  over: Partial<RoundEvaluation> = {},
): RoundEvaluation => ({
  score: { redScore, blueScore, doubles: 0 } as RoundEvaluation['score'],
  autoOver: false,
  winnerColor: null,
  endReason: null,
  ...over,
});

describe('correctedClosedRound', () => {
  it('a sheet that reads as the snapshot changes nothing', () => {
    expect(correctedClosedRound(closed(), reads(5, 3))).toEqual({ kind: 'same' });
  });

  it('the score follows while the same Fighter leads; the winner and the reason stay', () => {
    expect(correctedClosedRound(closed(), reads(4, 3))).toEqual({
      kind: 'score',
      round: closed({ redScore: 4, blueScore: 3 }),
    });
  });

  it('a round the cap closed may read below the cap: the leader keeps it', () => {
    const cap = closed({ redScore: 7, blueScore: 3, endReason: 'first_to_points' });
    expect(correctedClosedRound(cap, reads(6, 3))).toEqual({
      kind: 'score',
      round: { ...cap, redScore: 6 },
    });
  });

  it('refuses a sheet that gives the round to the other Fighter', () => {
    expect(correctedClosedRound(closed(), reads(2, 3))).toEqual({ kind: 'refuse' });
  });

  it('refuses a sheet that leaves a won round level', () => {
    expect(correctedClosedRound(closed(), reads(3, 3))).toEqual({ kind: 'refuse' });
  });

  it('the cap names the winner of a sheet that reaches it', () => {
    const blueAtCap = {
      autoOver: true,
      winnerColor: 'blue',
      endReason: 'first_to_points',
    } as const;
    expect(correctedClosedRound(closed(), reads(5, 7, blueAtCap))).toEqual({ kind: 'refuse' });
  });

  it('a round drawn on time stays drawn while its sheet is level', () => {
    const drawn = closed({ redScore: 3, blueScore: 3, winnerColor: null });
    expect(correctedClosedRound(drawn, reads(2, 2))).toEqual({
      kind: 'score',
      round: { ...drawn, redScore: 2, blueScore: 2 },
    });
    expect(correctedClosedRound(drawn, reads(3, 2))).toEqual({ kind: 'refuse' });
  });

  describe('a round the doubles ceiling closed', () => {
    const ceiling = closed({
      redScore: 0,
      blueScore: 0,
      winnerColor: null,
      endReason: 'max_doubles',
    });
    const atCeiling = { autoOver: true, winnerColor: null, endReason: 'max_doubles' } as const;

    it('stays as it is while its sheet still sits at the ceiling', () => {
      expect(correctedClosedRound(ceiling, reads(0, 0, atCeiling))).toEqual({ kind: 'same' });
    });

    it('a card on a wiped board gives nobody the round: the engine says who won, not the lead', () => {
      // A card is added after the wipe: the round reads -1 / 0 and is still drawn.
      const carded = { ...ceiling, redScore: -1 };
      expect(correctedClosedRound(carded, reads(-1, 0, atCeiling))).toEqual({ kind: 'same' });
    });

    it('is refused once its sheet is below the ceiling, level board or not', () => {
      // A level 3-3 would keep "no winner", under a reason that reads as a loss for both.
      expect(correctedClosedRound(ceiling, reads(3, 3))).toEqual({ kind: 'refuse' });
      expect(correctedClosedRound(ceiling, reads(4, 2))).toEqual({ kind: 'refuse' });
    });

    it('is refused when its sheet ends for another reason', () => {
      const cap = { autoOver: true, winnerColor: null, endReason: 'first_to_points' } as const;
      expect(correctedClosedRound(ceiling, reads(7, 7, cap))).toEqual({ kind: 'refuse' });
    });
  });
});
