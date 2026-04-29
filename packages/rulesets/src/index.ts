/**
 * @myclash/rulesets — public API
 */

// Types
export type {
  Ruleset,
  Exchange,
  ExchangeType,
  StrikerColor,
  Match,
  Registration,
  Pool,
  Phase,
  Event,
  MatchScore,
  MatchEndDecision,
  PoolStandingRow,
  FinalRankingRow,
  FighterAggregates,
} from './types';

// Registry
export { registry } from './registry';

// TF_v1 ruleset
export { TF_v1 } from './tf_v1';
export { TFv1ConfigSchema, TFv1DefaultConfig } from './tf_v1/config';
export type { TFv1Config } from './tf_v1/config';
export { computeMatchScore, isMatchOver, computePoolStandings } from './tf_v1';
export { doublePenalty, computeScore, computeAggregates } from './tf_v1/score';
