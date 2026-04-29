/**
 * packages/rulesets/src/tf_v1/index.ts
 *
 * TF_v1 ruleset — the canonical MyClash ruleset.
 * Implements the Ruleset interface from types.ts.
 */
import type { Exchange, Match, Pool, Registration, Ruleset } from '../types';
import { TFv1ConfigSchema, TFv1DefaultConfig, type TFv1Config } from './config';
import { computeMatchScore, isMatchOver } from './score';
import { computePoolStandings } from './standings';

export const TF_v1: Ruleset = {
  code: 'TF_v1',
  version: '1.0.0',
  displayName: 'TF v1 (Tournoi de Frappe)',
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
};

export { TFv1ConfigSchema, TFv1DefaultConfig, type TFv1Config };
export { computeMatchScore, isMatchOver } from './score';
export { computePoolStandings } from './standings';
export { doublePenalty, computeScore, computeAggregates } from './score';
