import { describe, it, expect } from 'vitest';
import { afterblowButtonPoints } from './afterblow-button';

/**
 * The pad's afterblow BUTTON LABELS, in both modes.
 *
 * This was the pad's uncovered `computeAfterblowDeltas` call site. The other
 * one — the provisional score of a queued hit — is held by
 * `offline/pending-events.test.ts`. This one is what the referee reads at the
 * moment of scoring, and nothing looked at it.
 */
describe('afterblowButtonPoints', () => {
  const twoOne = { attackerPts: 2, defenderPts: 1 };

  describe('full mode — both fighters score', () => {
    it('keeps both raw values', () => {
      const points = afterblowButtonPoints('full', twoOne);

      expect(points.attackerDelta).toBe(2);
      expect(points.defenderDelta).toBe(1);
      expect(points.layout).toBe('pills');
    });
  });

  describe('deductive mode — the afterblow costs the striker', () => {
    it('subtracts the defender from the attacker, and the defender scores 0', () => {
      const points = afterblowButtonPoints('deductive', twoOne);

      expect(points.attackerDelta).toBe(1);
      expect(points.defenderDelta).toBe(0);
      expect(points.layout).toBe('net');
    });

    it('never goes negative — a bigger afterblow floors the striker at 0', () => {
      const points = afterblowButtonPoints('deductive', { attackerPts: 1, defenderPts: 2 });

      expect(points.attackerDelta).toBe(0);
      expect(points.defenderDelta).toBe(0);
    });
  });

  /**
   * The guard. Every assertion above still passes if the mode stops being
   * threaded and everything silently runs as `full` — except this one. A French
   * organiser on a deductive tournament would otherwise see full-mode labels
   * with no error anywhere.
   */
  it('the mode changes what the button shows', () => {
    const full = afterblowButtonPoints('full', twoOne);
    const deductive = afterblowButtonPoints('deductive', twoOne);

    expect(deductive.attackerDelta).toBeLessThan(full.attackerDelta);
    expect(deductive.defenderDelta).toBeLessThan(full.defenderDelta);
    expect(deductive.layout).not.toBe(full.layout);
  });

  describe('the unit beside a deductive total', () => {
    it('is singular for exactly one point', () => {
      // 2 − 1 = 1
      expect(afterblowButtonPoints('deductive', twoOne).pointsKey).toBe('scoring.lice.point');
    });

    it('is plural for none, and for more than one', () => {
      // 1 − 2 floors to 0
      expect(afterblowButtonPoints('deductive', { attackerPts: 1, defenderPts: 2 }).pointsKey).toBe(
        'scoring.lice.points',
      );
      // 3 − 1 = 2
      expect(afterblowButtonPoints('deductive', { attackerPts: 3, defenderPts: 1 }).pointsKey).toBe(
        'scoring.lice.points',
      );
    });
  });
});
