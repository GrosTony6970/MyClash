import { describe, expect, it } from 'vitest';
import {
  computeAfterblowDeltas,
  pointCapWinnerSide,
  DEFAULT_MATCH_FORMAT_CONFIG,
  type MatchFormatConfig,
} from './scoring-config';

const normalCap5: MatchFormatConfig = {
  ...DEFAULT_MATCH_FORMAT_CONFIG,
  pointCap: 5,
  scoringDirection: 'normal',
};
const reverseCap5: MatchFormatConfig = {
  ...DEFAULT_MATCH_FORMAT_CONFIG,
  pointCap: 5,
  scoringDirection: 'reverse_zero_loses',
};

describe('computeAfterblowDeltas', () => {
  describe('full mode — both fighters score', () => {
    it('gives the attacker and defender their button points', () => {
      expect(computeAfterblowDeltas('full', 2, 1)).toEqual({ attackerDelta: 2, defenderDelta: 1 });
      expect(computeAfterblowDeltas('full', 1, 1)).toEqual({ attackerDelta: 1, defenderDelta: 1 });
    });
  });

  describe('deductive mode — the afterblow deducts from the attacker, defender scores 0', () => {
    it('subtracts the defender points from the attacker (2-1 → +1 / 0)', () => {
      expect(computeAfterblowDeltas('deductive', 2, 1)).toEqual({
        attackerDelta: 1,
        defenderDelta: 0,
      });
    });

    it('can cancel the attacker entirely (1-1 → 0 / 0)', () => {
      expect(computeAfterblowDeltas('deductive', 1, 1)).toEqual({
        attackerDelta: 0,
        defenderDelta: 0,
      });
    });

    it('leaves the attacker whole when there is no deduction (2-0 → +2 / 0)', () => {
      expect(computeAfterblowDeltas('deductive', 2, 0)).toEqual({
        attackerDelta: 2,
        defenderDelta: 0,
      });
    });

    it('clamps the attacker at zero, never negative (1-2 → 0 / 0)', () => {
      expect(computeAfterblowDeltas('deductive', 1, 2)).toEqual({
        attackerDelta: 0,
        defenderDelta: 0,
      });
    });
  });
});

describe('pointCapWinnerSide', () => {
  describe('normal scoring — first to the cap wins', () => {
    it('returns the side that reached the cap', () => {
      expect(pointCapWinnerSide(5, 3, normalCap5)).toBe('red');
      expect(pointCapWinnerSide(3, 5, normalCap5)).toBe('blue');
    });

    it('returns null when neither side has reached the cap', () => {
      expect(pointCapWinnerSide(3, 4, normalCap5)).toBeNull();
    });

    it('returns null when both somehow reached the cap', () => {
      expect(pointCapWinnerSide(5, 5, normalCap5)).toBeNull();
    });
  });

  describe('reverse scoring — the side that hits zero loses', () => {
    it('returns the opponent of the side that hit zero', () => {
      expect(pointCapWinnerSide(2, 0, reverseCap5)).toBe('red');
      expect(pointCapWinnerSide(0, 2, reverseCap5)).toBe('blue');
    });

    it('returns null while both fighters still have points', () => {
      expect(pointCapWinnerSide(3, 2, reverseCap5)).toBeNull();
    });

    it('returns null when both reached zero', () => {
      expect(pointCapWinnerSide(0, 0, reverseCap5)).toBeNull();
    });
  });
});
