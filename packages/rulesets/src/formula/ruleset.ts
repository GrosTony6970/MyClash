/**
 * packages/rulesets/src/formula/ruleset.ts
 *
 * Factory that constructs a Ruleset plugin from a stored FormulaConfig
 * (score AST + constants + tiebreakers). Match-level scoring delegates to
 * Generic_PointsCap; only the standings/ranking path is custom — that's
 * where the formula lives.
 */
import { Generic_PointsCap } from '../generic_points_cap';
import type { AfterblowMode } from '../match-format';
import type { Ruleset, StandingsColumn, RankingRule } from '../types';
import { deriveFighterStats } from '@myclash/rules';
import { evaluateFormula, type FormulaScope } from '@myclash/rules';
import { renderFormula } from '@myclash/rules';
import { doublePenalty, type DoublePenaltySpec } from '../tf_v1/double-penalty';
import {
  FORMULA_VARIABLE_KEYS,
  type FormulaConfig,
  type Tiebreaker,
  type VariableKey,
} from './types';

/**
 * Standings columns for a data-authored ruleset.
 *
 * Both of these used to be empty, so a tournament on an org-authored ruleset
 * rendered a "ruleset doesn't expose standings yet" empty state — on top of the
 * API refusing the request outright, because standings resolved through the
 * in-memory registry, which only holds the built-ins.
 *
 * `score` leads the table: it is THIS ruleset's `scoreFormula`, evaluated by
 * scorePoolFighters below. The API must fill that column by asking the
 * ruleset — deriving it itself would substitute TF_v1's hardcoded formula and
 * silently rank an org's pool by somebody else's algorithm.
 *
 * Every other key is derived generically by the API from match scores,
 * exchanges and forfeits, so it is correct for any ruleset.
 */
const FORMULA_STANDINGS_COLUMNS: StandingsColumn[] = [
  { key: 'score', label: 'Score', type: 'number', sortDesc: true, decimals: 2 },
  { key: 'W', label: 'Wins', type: 'number', sortDesc: true },
  { key: 'L', label: 'Losses', type: 'number', sortDesc: false },
  { key: 'D', label: 'Draws', type: 'number', sortDesc: true },
  { key: 'F', label: 'Forfeits', type: 'number', sortDesc: false },
  { key: 'ptsScored', label: 'Points scored', type: 'number', sortDesc: true },
  { key: 'ptsConceded', label: 'Points conceded', type: 'number', sortDesc: false },
  { key: 'diff', label: 'Differential', type: 'number', sortDesc: true },
  { key: 'doubles', label: 'Doubles', type: 'number', sortDesc: false },
  { key: 'hitsGiven', label: 'Hits given', type: 'number', sortDesc: true },
  { key: 'hitsReceived', label: 'Hits received', type: 'number', sortDesc: false },
];

/**
 * Formula variables that correspond to a per-fighter standings column. The
 * remaining variables (pointsPerVictory, doublePenalty, …) are configured
 * constants — identical for every fighter, so useless as a tiebreak.
 */
const TIEBREAK_COLUMN_BY_VARIABLE: Partial<Record<VariableKey, string>> = {
  victories: 'W',
  losses: 'L',
  ties: 'D',
  doubleHits: 'doubles',
  hitsGiven: 'hitsGiven',
  hitsReceived: 'hitsReceived',
};

/**
 * Rank by this ruleset's score, then by the author's own tiebreakers.
 *
 * The tiebreakers must be projected onto standings-column keys because the API
 * ranks rows with `applyRanking(rows, rankingChain)` over the rendered columns.
 * This ruleset used to sort its own returned rows by the author's tiebreakers as
 * well, which was dead work: that ordering was discarded, because "overall" mode
 * flattens every pool and ranks them together.
 */
function buildRankingChain(tiebreakers: Tiebreaker[]): RankingRule[] {
  const chain: RankingRule[] = [{ key: 'score', direction: 'desc' }];
  for (const tb of tiebreakers) {
    const key = TIEBREAK_COLUMN_BY_VARIABLE[tb.variable];
    if (key && !chain.some((rule) => rule.key === key)) {
      chain.push({ key, direction: tb.direction });
    }
  }
  return chain;
}

/**
 * The grammar an org-authored ruleset declares about itself: what an exchange
 * can be, and what it is worth. Distinct from `FormulaConfig`, which is the
 * ranking half (score AST, constants, tiebreakers).
 *
 * Every field is optional and every default preserves TODAY's behaviour for a
 * row that predates these columns: `hasAfterblow: false` matches the UI, which
 * currently gates afterblow controls on `rulesetCode === 'TF_v1'` and so has
 * never offered them for a custom ruleset.
 */
export interface RulesetGrammar {
  targets?: ReadonlyArray<{ name: string; value: number }> | null;
  hasAfterblow?: boolean | null;
  defaultAfterblowMode?: AfterblowMode | null;
  /** See RulesetMetadata.afterblowValuation. */
  afterblowValuation?: 'fixed' | 'weighted' | null;
  afterblowFixedValue?: number | null;
}

export function createFormulaRuleset(
  code: string,
  version: string,
  displayName: string,
  config: FormulaConfig,
  grammar?: RulesetGrammar | null,
): Ruleset {
  const hasAfterblow = grammar?.hasAfterblow ?? false;
  return {
    code,
    version,
    displayName,
    computeMatchScore(match, exchanges, _afterblowMode, runtimeConfig) {
      // Match scoring delegates to Generic_PointsCap, which has no afterblow
      // concept. The authored formula is the standings half, below.
      return Generic_PointsCap.computeMatchScore(match, exchanges, _afterblowMode, runtimeConfig);
    },

    isMatchOver(match, score, runtimeConfig) {
      return Generic_PointsCap.isMatchOver(match, score, runtimeConfig);
    },

    scorePoolFighters({ registrationIds, completedMatches, afterblowMode }) {
      return new Map(
        registrationIds.map((id) => {
          const stats = deriveFighterStats(id, completedMatches, afterblowMode);
          return [id, evaluateFormula(config.scoreFormula, buildFormulaScope(stats, config))];
        }),
      );
    },

    standingsColumns: FORMULA_STANDINGS_COLUMNS,
    rankingChain: buildRankingChain(config.tiebreakers),

    /**
     * Previously omitted entirely, which made `metadata` undefined for every
     * org-authored ruleset. Anything driving UI off `metadata.hasAfterblow`
     * would then read `undefined` and hide afterblow for exactly the rulesets
     * self-service is meant to empower.
     *
     * `defaultAfterblowMode` is a SEED, not a runtime input: `scorePoolFighters`
     * above is HANDED the tournament's live mode, because exchanges store raw
     * values netted at read.
     */
    metadata: {
      hasAfterblow,
      defaultAfterblowMode: hasAfterblow ? (grammar?.defaultAfterblowMode ?? 'full') : null,
      // `fixed` is the default because it is what every ruleset behaved as
      // before the rule could be declared — a row that says nothing keeps its
      // two-button pad rather than silently doubling it.
      afterblowValuation: hasAfterblow ? (grammar?.afterblowValuation ?? 'fixed') : null,
      afterblowFixedValue: hasAfterblow ? (grammar?.afterblowFixedValue ?? 1) : null,
      targets: grammar?.targets ?? null,
      winBonus: null,
      doublePenaltyFormula: null,
      deepTargetDefault: null,
      shallowTargetDefault: null,
      // Render the authored AST to a display string so a custom ruleset shows
      // its formula on public surfaces, the way TF_v1 ships a static one. Raw
      // variable keys (no i18n) keep the dependency-free package i18n-free; a UI
      // may re-render with localized labels via the same renderFormula.
      scoreFormula: renderFormula(config.scoreFormula),
    },
  };
}

export function buildFormulaScope(
  stats: { [k in VariableKey]?: number },
  config: FormulaConfig,
): FormulaScope {
  const scope: Partial<FormulaScope> = {};
  for (const key of FORMULA_VARIABLE_KEYS) {
    scope[key] = 0;
  }
  return {
    ...(scope as FormulaScope),
    victories: stats.victories ?? 0,
    ties: stats.ties ?? 0,
    losses: stats.losses ?? 0,
    doubleHits: stats.doubleHits ?? 0,
    hitsGiven: stats.hitsGiven ?? 0,
    hitsReceived: stats.hitsReceived ?? 0,
    pointsPerVictory: config.constants.pointsPerVictory,
    pointsPerTie: config.constants.pointsPerTie,
    pointsPerLoss: config.constants.pointsPerLoss,
    // The named double-penalty sub-formula, evaluated over this fighter's
    // doubleHits, becomes the `doublePenalty` the score formula references.
    // Absent → the flat constant (default 0), so a ruleset with no double-hit
    // penalty is unchanged.
    doublePenalty:
      config.doublePenaltyFormula != null
        ? doublePenalty(stats.doubleHits ?? 0, config.doublePenaltyFormula as DoublePenaltySpec)
        : config.constants.doublePenalty,
  };
}
