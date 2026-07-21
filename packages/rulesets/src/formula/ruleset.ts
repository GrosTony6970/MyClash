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
import type {
  Exchange,
  Match,
  Pool,
  PoolStandingRow,
  Registration,
  Ruleset,
  StandingsColumn,
  RankingRule,
} from '../types';
import { deriveFighterStats } from './derive-stats';
import { evaluateFormula, type FormulaScope } from './evaluator';
import { doublePenalty, type DoublePenaltySpec } from '../tf_v1/double-penalty';
import {
  FORMULA_VARIABLE_KEYS,
  FormulaConfigSchema,
  type FormulaConfig,
  type Tiebreaker,
  type VariableKey,
} from './types';

function buildExchangeIndex(matches: Match[]): Map<string, Exchange[]> {
  const index = new Map<string, Exchange[]>();
  for (const match of matches) {
    const attached = (match as Match & { exchanges?: Exchange[] }).exchanges ?? [];
    index.set(match.id, attached);
  }
  return index;
}

function compareTiebreakers(
  scopeA: FormulaScope,
  scopeB: FormulaScope,
  tiebreakers: Tiebreaker[],
): number {
  for (const tb of tiebreakers) {
    const va = scopeA[tb.variable] ?? 0;
    const vb = scopeB[tb.variable] ?? 0;
    if (va === vb) continue;
    return tb.direction === 'desc' ? vb - va : va - vb;
  }
  return 0;
}

/**
 * Standings columns for a data-authored ruleset.
 *
 * Both of these used to be empty, so a tournament on an org-authored ruleset
 * rendered a "ruleset doesn't expose standings yet" empty state — on top of the
 * API refusing the request outright, because standings resolved through the
 * in-memory registry, which only holds the built-ins.
 *
 * `score` leads the table: it is THIS ruleset's `scoreFormula`, evaluated by
 * computePoolStandings below. The API must fill that column by asking the
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
 * ranks rows with `applyRanking(rows, rankingChain)` over the rendered columns —
 * the sort inside computePoolStandings only orders the rows returned from there,
 * and would be lost when the API re-ranks (notably in "overall" mode, where rows
 * from every pool are flattened and ranked again).
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
    configSchema: FormulaConfigSchema,

    computeMatchScore(match, exchanges, runtimeConfig) {
      return Generic_PointsCap.computeMatchScore(match, exchanges, runtimeConfig);
    },

    isMatchOver(match, exchanges, clockMs, runtimeConfig) {
      return Generic_PointsCap.isMatchOver(match, exchanges, clockMs, runtimeConfig);
    },

    computePoolStandings(
      _pool: Pool,
      matches: Match[],
      registrations: Registration[],
      _runtimeConfig: unknown,
    ): PoolStandingRow[] {
      const exchangesByMatch = buildExchangeIndex(matches);
      // afterblowMode is attached to the runtime config by the API (it lives in
      // scoring_config_json). Net deductive afterblows in the derived stats.
      const afterblowMode: AfterblowMode =
        (_runtimeConfig as { afterblowMode?: unknown } | null)?.afterblowMode === 'deductive'
          ? 'deductive'
          : 'full';

      const enriched = registrations.map((reg) => {
        const stats = deriveFighterStats(reg.id, matches, exchangesByMatch, afterblowMode);
        const scope = buildScope(stats, config);
        const score = evaluateFormula(config.scoreFormula, scope);
        return { reg, stats, scope, score };
      });

      enriched.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        const cmp = compareTiebreakers(a.scope, b.scope, config.tiebreakers);
        if (cmp !== 0) return cmp;
        const seedA = a.reg.seed ?? a.reg.bibNumber ?? Number.POSITIVE_INFINITY;
        const seedB = b.reg.seed ?? b.reg.bibNumber ?? Number.POSITIVE_INFINITY;
        return seedA - seedB;
      });

      return enriched.map((row, idx) => ({
        registrationId: row.reg.id,
        rank: idx + 1,
        wins: row.stats.victories,
        targetPoints: row.stats.hitsGiven,
        timesHit: row.stats.hitsReceived,
        doubles: row.stats.doubleHits,
        score: row.score,
      }));
    },

    standingsColumns: FORMULA_STANDINGS_COLUMNS,
    rankingChain: buildRankingChain(config.tiebreakers),

    /**
     * Previously omitted entirely, which made `metadata` undefined for every
     * org-authored ruleset. Anything driving UI off `metadata.hasAfterblow`
     * would then read `undefined` and hide afterblow for exactly the rulesets
     * self-service is meant to empower.
     *
     * `defaultAfterblowMode` is a SEED, not a runtime input: `computePoolStandings`
     * above still reads the live mode off the runtime config, because exchanges
     * store raw values netted at read.
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
      scoreFormula: null,
    },
  };
}

function buildScope(stats: { [k in VariableKey]?: number }, config: FormulaConfig): FormulaScope {
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
