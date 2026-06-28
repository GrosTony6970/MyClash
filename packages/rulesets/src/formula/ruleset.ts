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

// FormulaRuleset doesn't expose pre-defined standings; the standings tab will
// render a "Ruleset doesn't expose standings yet" empty state for tournaments
// using this ruleset.
const FORMULA_STANDINGS_COLUMNS: StandingsColumn[] = [];
const FORMULA_RANKING_CHAIN: RankingRule[] = [];

export function createFormulaRuleset(
  code: string,
  version: string,
  displayName: string,
  config: FormulaConfig,
): Ruleset {
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
    rankingChain: FORMULA_RANKING_CHAIN,
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
    doublePenalty: config.constants.doublePenalty,
  };
}
