/**
 * packages/rulesets/src/formula/preview.ts
 *
 * Event-free dry-run of a formula ruleset's scoreFormula over sample fighters.
 * One helper, two jobs:
 *   - publish-time VALIDATION — reject a ruleset whose formula can score to a
 *     non-finite value (NaN / ±Infinity). A Zod-valid AST over finite constants
 *     is finite by construction EXCEPT arithmetic overflow (e.g. an unbounded
 *     constant like `pointsPerVictory = 1e308` times a high victory count), so
 *     this is the guard Zod parsing cannot provide.
 *   - catalog PREVIEW — the same sample scores, ranked, are a sensible "what
 *     would standings look like" preview.
 *
 * Scores exactly as a live tournament would: it reuses `buildFormulaScope`
 * (which also evaluates the named double-penalty sub-formula) + `evaluateFormula`.
 * Returns raw stats + score only — no display strings, so the caller owns i18n.
 */
import type { DerivedFighterStats, FormulaConfig } from './types';
import { buildFormulaScope } from './ruleset';
import { evaluateFormula } from './evaluator';

export interface FormulaScoringSampleRow {
  stats: DerivedFighterStats;
  score: number;
}

export interface FormulaScoringPreview {
  /** Sample fighters scored by the formula, ranked by score descending. */
  rows: FormulaScoringSampleRow[];
  /** True when ANY sample scored to a non-finite value — the signal a
   *  publish-time dry-run rejects on. */
  hasNonFinite: boolean;
}

/**
 * Synthetic archetypes: realistic enough to read as a preview, and the last
 * (high-activity) row probes arithmetic overflow from pathological constants.
 */
export const DEFAULT_PREVIEW_SAMPLES: readonly DerivedFighterStats[] = [
  { victories: 3, ties: 1, losses: 0, doubleHits: 1, hitsGiven: 15, hitsReceived: 6 },
  { victories: 2, ties: 1, losses: 2, doubleHits: 2, hitsGiven: 12, hitsReceived: 12 },
  { victories: 0, ties: 1, losses: 4, doubleHits: 3, hitsGiven: 6, hitsReceived: 18 },
  { victories: 20, ties: 4, losses: 4, doubleHits: 10, hitsGiven: 120, hitsReceived: 80 },
];

/** Non-finite sinks to the bottom so ranking stays stable in the reject case. */
const rankKey = (score: number): number =>
  Number.isFinite(score) ? score : Number.NEGATIVE_INFINITY;

/**
 * Dry-run `config.scoreFormula` over `samples` (default: {@link DEFAULT_PREVIEW_SAMPLES}).
 * Pure and event-free — no matches, exchanges, or DB.
 */
export function previewFormulaScoring(
  config: FormulaConfig,
  samples: readonly DerivedFighterStats[] = DEFAULT_PREVIEW_SAMPLES,
): FormulaScoringPreview {
  const rows: FormulaScoringSampleRow[] = samples.map((stats) => ({
    stats,
    score: evaluateFormula(config.scoreFormula, buildFormulaScope(stats, config)),
  }));
  const hasNonFinite = rows.some((r) => !Number.isFinite(r.score));
  const ranked = [...rows].sort((a, b) => rankKey(b.score) - rankKey(a.score));
  return { rows: ranked, hasNonFinite };
}
