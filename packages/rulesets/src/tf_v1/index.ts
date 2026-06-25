/**
 * packages/rulesets/src/tf_v1/index.ts
 *
 * TF_v1 ruleset — the canonical MyClash ruleset.
 * Implements the Ruleset interface from types.ts.
 */
import type {
  Exchange,
  Match,
  Pool,
  Registration,
  Ruleset,
  StandingsColumn,
  RankingRule,
} from '../types';
import { TFv1ConfigSchema, TFv1DefaultConfig, type TFv1Config } from './config';
import { computeMatchScore, isMatchOver } from './score';
import { computePoolStandings } from './standings';

const TF_V1_STANDINGS_COLUMNS: StandingsColumn[] = [
  // The TF_v1 ranking metric: (wins·winBonus + targetPoints) /
  // (timesHit + doublePenalty(doubles)). Shown first so it leads the table.
  { key: 'score', label: 'Score', type: 'number', sortDesc: true },
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

// Mirrors the canonical tiebreak order in standings.ts: score → wins →
// doubles (fewer better) → timesHit/hitsReceived (fewer better).
const TF_V1_RANKING_CHAIN: RankingRule[] = [
  { key: 'score', direction: 'desc' },
  { key: 'W', direction: 'desc' },
  { key: 'doubles', direction: 'asc' },
  { key: 'hitsReceived', direction: 'asc' },
];

export const TF_v1: Ruleset = {
  code: 'TF_v1',
  version: '1.0.0',
  displayName: 'TF (Tournois Fédéraux FFAMHE)',
  configSchema: TFv1ConfigSchema,

  computeMatchScore(match: Match, exchanges: Exchange[], config: unknown) {
    const cfg = TFv1ConfigSchema.parse(config ?? TFv1DefaultConfig);
    return computeMatchScore(match, exchanges, cfg);
  },

  isMatchOver(match: Match, exchanges: Exchange[], clockMs: number, config: unknown) {
    const cfg = TFv1ConfigSchema.parse(config ?? TFv1DefaultConfig);
    return isMatchOver(match, exchanges, clockMs, cfg);
  },

  computePoolStandings(
    pool: Pool,
    matches: Match[],
    registrations: Registration[],
    config: unknown,
  ) {
    const cfg = TFv1ConfigSchema.parse(config ?? TFv1DefaultConfig);
    return computePoolStandings(pool, matches, registrations, cfg);
  },

  standingsColumns: TF_V1_STANDINGS_COLUMNS,
  rankingChain: TF_V1_RANKING_CHAIN,

  metadata: {
    hasAfterblow: true,
    winBonus: TFv1DefaultConfig.winBonus,
    doublePenaltyFormula: TFv1DefaultConfig.doublePenaltyFormula,
    deepTargetDefault: TFv1DefaultConfig.targetValues.deepTarget,
    shallowTargetDefault: TFv1DefaultConfig.targetValues.shallowTarget,
  },
};

export { TFv1ConfigSchema, TFv1DefaultConfig, type TFv1Config };
export { computeMatchScore, isMatchOver } from './score';
export { computePoolStandings } from './standings';
export { doublePenalty, computeScore, computeAggregates } from './score';
