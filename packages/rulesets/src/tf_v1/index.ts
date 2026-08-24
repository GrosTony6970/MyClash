/**
 * packages/rulesets/src/tf_v1/index.ts
 *
 * TF_v1 ruleset — the canonical MyClash ruleset.
 * Implements the Ruleset interface from types.ts.
 */
import type {
  AfterblowMode,
  Exchange,
  Match,
  MatchScore,
  Ruleset,
  ScorePoolFightersInput,
  StandingsColumn,
  RankingRule,
} from '../types';
import { computeAggregates, computeScore, type FighterAggregates } from '@myclash/rules';
import { TFv1ConfigSchema, TFv1DefaultConfig, type TFv1Config } from './config';
import { computeMatchScore, isMatchOver } from './score';
import { formatDoublePenalty } from './double-penalty';

const TF_V1_STANDINGS_COLUMNS: StandingsColumn[] = [
  // The TF_v1 ranking metric: (wins·winBonus + targetPoints) /
  // (timesHit + doublePenalty(doubles)). Shown first so it leads the table.
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
  displayName: 'TF_v1',

  computeMatchScore(
    match: Match,
    exchanges: Exchange[],
    afterblowMode: AfterblowMode,
    config: unknown,
  ) {
    const cfg = TFv1ConfigSchema.parse(config ?? TFv1DefaultConfig);
    return computeMatchScore(match, exchanges, cfg, afterblowMode);
  },

  isMatchOver(match: Match, score: MatchScore, config: unknown) {
    return isMatchOver(match, score, TFv1ConfigSchema.parse(config ?? TFv1DefaultConfig));
  },

  scorePoolFighters({
    registrationIds,
    completedMatches,
    afterblowMode,
    config,
  }: ScorePoolFightersInput) {
    const cfg = TFv1ConfigSchema.parse(config ?? TFv1DefaultConfig);
    const totals = new Map<string, FighterAggregates>(
      registrationIds.map((id) => [id, { wins: 0, targetPoints: 0, timesHit: 0, doubles: 0 }]),
    );

    for (const match of completedMatches) {
      for (const regId of [match.redRegistrationId, match.blueRegistrationId]) {
        const running = totals.get(regId);
        if (!running) continue;
        const bout = computeAggregates(
          regId,
          match,
          match.exchanges,
          match.winnerRegistrationId === regId,
          afterblowMode,
        );
        running.wins += bout.wins;
        running.targetPoints += bout.targetPoints;
        running.timesHit += bout.timesHit;
        running.doubles += bout.doubles;
      }
    }

    // winBonus and doublePenaltyFormula come from the ruleset config. They were
    // hardcoded once, so a super-admin amending the federal rulebook changed a
    // stored value the engine never read.
    return new Map(
      [...totals].map(([id, agg]) => [
        id,
        computeScore(agg, {
          winBonus: cfg.winBonus,
          doublePenaltyFormula: cfg.doublePenaltyFormula,
        }),
      ]),
    );
  },

  standingsColumns: TF_V1_STANDINGS_COLUMNS,
  rankingChain: TF_V1_RANKING_CHAIN,

  metadata: {
    hasAfterblow: true,
    defaultAfterblowMode: 'deductive',
    // FFAMHE scores the retaliation at a flat 1 regardless of target — see
    // the ARCHITECTURE.md FAL columns (1-1, 2-1; no 2-2).
    afterblowValuation: 'fixed',
    afterblowFixedValue: 1,
    winBonus: TFv1DefaultConfig.winBonus,
    doublePenaltyFormula: formatDoublePenalty(TFv1DefaultConfig.doublePenaltyFormula),
    targets: TFv1DefaultConfig.targets,
    deepTargetDefault: TFv1DefaultConfig.targetValues.deepTarget,
    shallowTargetDefault: TFv1DefaultConfig.targetValues.shallowTarget,
    scoreFormula: 'score = (wins × winBonus + targetPoints) / (timesHit + doublePenalty(doubles))',
  },
};

export { TFv1ConfigSchema, TFv1DefaultConfig, type TFv1Config };
export {
  TargetSchema,
  TargetsSchema,
  AuthoredTargetsSchema,
  DEFAULT_TARGETS,
  MAX_TARGETS,
  MAX_STORED_TARGET_VALUE,
  MAX_AUTHORED_TARGET_VALUE,
  withDerivedTargets,
  type Target,
} from './targets';
export { computeMatchScore, isMatchOver } from './score';
export { doublePenalty, computeScore, computeAggregates } from './score';
export {
  DOUBLE_PENALTY_FORMULAS,
  DOUBLE_PENALTY_FORMULA_KEYS,
  DOUBLE_PENALTY_VARIABLE,
  DEFAULT_DOUBLE_PENALTY_FORMULA,
  FEDERAL_DOUBLE_PENALTY_AST,
  DoublePenaltySpecSchema,
  evaluateDoublePenaltyAst,
  isDoublePenaltyAst,
  formatDoublePenalty,
  type DoublePenaltyFormula,
  type DoublePenaltySpec,
} from './double-penalty';
