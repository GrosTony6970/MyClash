/**
 * TF_v1 written as a club formula ruleset: what a copy of TF_v1 starts from.
 *
 * A copy of TF_v1 is a formula ruleset the club can edit freely (ruling
 * 2026-11-27). Until it is edited, it scores and ranks exactly as TF_v1 does;
 * `test/tf_v1.as-formula.parity.test.ts` proves it on the FAL 2026 data and on
 * the afterblow golden bout. TF_v1 itself stays coded.
 *
 *   score = (victories × pointsPerVictory + hitsGiven) / (hitsReceived + doublePenalty)
 *
 * It holds because the formula language reads TF_v1's own numbers:
 * `hitsReceived` is TF_v1's times-hit count, `hitsGiven` its target points,
 * `x / 0 = x` its zero-denominator rule, and `doublePenalty` the same
 * `doublePenalty(n, spec)`.
 *
 * `tfConfig` is the source's stored `tf_config` (a copy of a copy carries its
 * own win bonus, double penalty and targets), or nothing for TF_v1 itself.
 *
 * Pure: no I/O.
 */
import { DEFAULT_FORMULA_CONSTANTS, type FormulaConfig, type FormulaNode } from '../formula/types';
import { TFv1ConfigSchema } from './config';
import type { DoublePenaltySpec } from './double-penalty';
import { TF_V1_AFTERBLOW } from './index';
import type { Target } from './targets';

const v = (
  name: 'victories' | 'pointsPerVictory' | 'hitsGiven' | 'hitsReceived' | 'doublePenalty',
): FormulaNode => ({
  type: 'var',
  name,
});

const TF_V1_SCORE_FORMULA: FormulaNode = {
  type: 'binop',
  op: '/',
  left: {
    type: 'binop',
    op: '+',
    left: { type: 'binop', op: '*', left: v('victories'), right: v('pointsPerVictory') },
    right: v('hitsGiven'),
  },
  right: { type: 'binop', op: '+', left: v('hitsReceived'), right: v('doublePenalty') },
};

/** Every field set: a copy of TF_v1 states each rule rather than leaving one to a default. */
export interface TfV1AsFormula {
  formula: FormulaConfig & { doublePenaltyFormula: DoublePenaltySpec };
  grammar: { targets: Target[] } & typeof TF_V1_AFTERBLOW;
}

export function tfV1AsFormula(tfConfig?: unknown): TfV1AsFormula {
  const cfg = TFv1ConfigSchema.parse(tfConfig ?? {});
  return {
    formula: {
      scoreFormula: TF_V1_SCORE_FORMULA,
      constants: { ...DEFAULT_FORMULA_CONSTANTS, pointsPerVictory: cfg.winBonus },
      // TF_v1's chain after the score: wins, then doubles and hits received, fewest first.
      tiebreakers: [
        { variable: 'victories', direction: 'desc' },
        { variable: 'doubleHits', direction: 'asc' },
        { variable: 'hitsReceived', direction: 'asc' },
      ],
      doublePenaltyFormula: cfg.doublePenaltyFormula,
    },
    grammar: { targets: cfg.targets, ...TF_V1_AFTERBLOW },
  };
}
