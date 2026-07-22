import { describe, expect, it } from 'vitest';
import { DEFAULT_PREVIEW_SAMPLES, previewFormulaScoring } from './preview';
import type { FormulaConfig } from './types';

// score = pointsPerVictory * victories + pointsPerTie * ties  (3W + 1T)
const LINEAR: FormulaConfig = {
  scoreFormula: {
    type: 'binop',
    op: '+',
    left: {
      type: 'binop',
      op: '*',
      left: { type: 'var', name: 'pointsPerVictory' },
      right: { type: 'var', name: 'victories' },
    },
    right: {
      type: 'binop',
      op: '*',
      left: { type: 'var', name: 'pointsPerTie' },
      right: { type: 'var', name: 'ties' },
    },
  },
  constants: { pointsPerVictory: 3, pointsPerTie: 1, pointsPerLoss: 0, doublePenalty: 0 },
  tiebreakers: [],
};

describe('previewFormulaScoring', () => {
  it('scores every default sample finitely and ranks by score descending', () => {
    const { rows, hasNonFinite } = previewFormulaScoring(LINEAR);
    expect(hasNonFinite).toBe(false);
    expect(rows).toHaveLength(DEFAULT_PREVIEW_SAMPLES.length);
    for (let i = 1; i < rows.length; i += 1) {
      expect(rows[i - 1]!.score).toBeGreaterThanOrEqual(rows[i]!.score);
    }
    // The 20-victory archetype (3*20 + 1*4 = 64) tops the table.
    expect(rows[0]!.stats.victories).toBe(20);
    expect(rows[0]!.score).toBe(64);
  });

  it('flags hasNonFinite when a pathological constant overflows to Infinity', () => {
    const overflow: FormulaConfig = {
      ...LINEAR,
      scoreFormula: {
        type: 'binop',
        op: '*',
        left: { type: 'var', name: 'pointsPerVictory' },
        right: { type: 'var', name: 'victories' },
      },
      constants: { ...LINEAR.constants, pointsPerVictory: 1e308 },
    };
    expect(previewFormulaScoring(overflow).hasNonFinite).toBe(true);
  });

  it('honours custom sample stats', () => {
    const { rows } = previewFormulaScoring(LINEAR, [
      { victories: 1, ties: 0, losses: 0, doubleHits: 0, hitsGiven: 0, hitsReceived: 0 },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.score).toBe(3);
  });

  it('wires the doublePenalty constant into the scope', () => {
    const cfg: FormulaConfig = {
      scoreFormula: {
        type: 'binop',
        op: '-',
        left: { type: 'var', name: 'victories' },
        right: { type: 'var', name: 'doublePenalty' },
      },
      constants: { pointsPerVictory: 3, pointsPerTie: 1, pointsPerLoss: 0, doublePenalty: 2 },
      tiebreakers: [],
    };
    const { rows } = previewFormulaScoring(cfg, [
      { victories: 5, ties: 0, losses: 0, doubleHits: 0, hitsGiven: 0, hitsReceived: 0 },
    ]);
    expect(rows[0]!.score).toBe(3); // 5 - 2
  });
});
