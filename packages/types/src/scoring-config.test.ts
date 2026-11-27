import { describe, expect, it } from 'vitest';
import {
  buttonsInForce,
  computeAfterblowDeltas,
  pointCapWinnerColor,
  DEFAULT_MATCH_FORMAT_CONFIG,
  DEFAULT_SCORING_CONFIG,
  EDITION_2026_10,
  comparePenaltyEntries,
  protestRulesOf,
  type MatchFormatConfig,
} from './scoring-config';

describe('comparePenaltyEntries', () => {
  const at = (group_number: number, ref_number: string) => ({ group_number, ref_number });

  it('orders by group, then by ref as a person reads it: 2 before 10, letters after', () => {
    const list = [at(2, '1'), at(1, 'R7a'), at(1, '10'), at(1, '2')];
    expect([...list].sort(comparePenaltyEntries)).toEqual([
      at(1, '2'),
      at(1, '10'),
      at(1, 'R7a'),
      at(2, '1'),
    ]);
  });
});

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

describe('pointCapWinnerColor', () => {
  describe('normal scoring — first to the cap wins', () => {
    it('returns the side that reached the cap', () => {
      expect(pointCapWinnerColor({ redScore: 5, blueScore: 3 }, normalCap5, EDITION_2026_10)).toBe(
        'red',
      );
      expect(pointCapWinnerColor({ redScore: 3, blueScore: 5 }, normalCap5, EDITION_2026_10)).toBe(
        'blue',
      );
    });

    it('returns null when neither side has reached the cap', () => {
      expect(
        pointCapWinnerColor({ redScore: 3, blueScore: 4 }, normalCap5, EDITION_2026_10),
      ).toBeNull();
    });

    it('returns null when both somehow reached the cap', () => {
      expect(
        pointCapWinnerColor({ redScore: 5, blueScore: 5 }, normalCap5, EDITION_2026_10),
      ).toBeNull();
    });
  });

  describe('reverse scoring — the side that hits zero loses', () => {
    it('returns the opponent of the side that hit zero', () => {
      expect(pointCapWinnerColor({ redScore: 2, blueScore: 0 }, reverseCap5, EDITION_2026_10)).toBe(
        'red',
      );
      expect(pointCapWinnerColor({ redScore: 0, blueScore: 2 }, reverseCap5, EDITION_2026_10)).toBe(
        'blue',
      );
    });

    it('returns null while both fighters still have points', () => {
      expect(
        pointCapWinnerColor({ redScore: 3, blueScore: 2 }, reverseCap5, EDITION_2026_10),
      ).toBeNull();
    });

    it('returns null when both reached zero', () => {
      expect(
        pointCapWinnerColor({ redScore: 0, blueScore: 0 }, reverseCap5, EDITION_2026_10),
      ).toBeNull();
    });
  });
});

describe('protestRulesOf', () => {
  it('reads a Tournament saved before the protest limit as no limit and no offer', () => {
    expect(protestRulesOf({ sideColors: { red: 'red', blue: 'blue' } })).toEqual({
      limit: null,
      offerPenaltyRef: null,
    });
  });

  it('reads no display at all as no limit and no offer', () => {
    expect(protestRulesOf(null)).toEqual({ limit: null, offerPenaltyRef: null });
    expect(protestRulesOf(undefined)).toEqual({ limit: null, offerPenaltyRef: null });
  });

  it('reads the limit and the penalty the organiser chose', () => {
    expect(
      protestRulesOf({
        sideColors: { red: 'red', blue: 'blue' },
        protests: { limit: 2, offerPenaltyRef: '8' },
      }),
    ).toEqual({ limit: 2, offerPenaltyRef: '8' });
  });
});

/**
 * The buttons a bout scores with, derived at read from its stored buttons and
 * its scoring unit (venues ruling 5): a venues bout gets one "+1" per side.
 */
describe('buttonsInForce', () => {
  const stored = DEFAULT_SCORING_CONFIG.buttons;

  it('gives the stored buttons themselves in points mode', () => {
    expect(buttonsInForce(stored, 'points')).toBe(stored);
  });

  it('gives one +1 button, and one 1-1 afterblow, in venues mode', () => {
    expect(buttonsInForce(stored, 'venues')).toEqual({
      clean: [{ label: '+1', value: 1, visible: true }],
      afterblow: [{ label: '1-1', attackerPts: 1, defenderPts: 1, visible: true }],
    });
  });

  it('gives no afterblow button in venues mode to a grammar that has none', () => {
    expect(buttonsInForce({ clean: stored.clean, afterblow: [] }, 'venues')).toEqual({
      clean: [{ label: '+1', value: 1, visible: true }],
      afterblow: [],
    });
  });
});
