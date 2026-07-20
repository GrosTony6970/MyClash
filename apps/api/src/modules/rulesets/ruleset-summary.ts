/**
 * apps/api/src/modules/rulesets/ruleset-summary.ts
 *
 * The wire shape of a ruleset in a picker. Kept separate from the controller
 * so both the registry-only catalog and the org-aware, event-scoped catalog
 * project through exactly the same function — a picker that shows different
 * fields depending on which endpoint filled it is a bug waiting to happen.
 */
import type { RankingRule, Ruleset, RulesetMetadata, StandingsColumn } from '@myclash/rulesets';

export interface RulesetSummary {
  code: string;
  version: string;
  label: string;
  /** Tie-breaker chain applied to pool standings (in order, primary first). */
  rankingChain: RankingRule[];
  /** Columns the ruleset declares for the standings table. */
  standingsColumns: StandingsColumn[];
  /** Audit-friendly defaults (afterblow support, double-penalty formula, etc.). */
  metadata: RulesetMetadata;
  /**
   * False for the coded built-ins, true for an org-authored ruleset. Lets a
   * picker group or badge them without re-deriving "is this in the registry".
   */
  custom: boolean;
}

export function toRulesetSummary(ruleset: Ruleset, custom: boolean): RulesetSummary {
  return {
    code: ruleset.code,
    version: ruleset.version,
    label: ruleset.displayName ?? `${ruleset.code} v${ruleset.version}`,
    rankingChain: ruleset.rankingChain ?? [],
    standingsColumns: ruleset.standingsColumns ?? [],
    metadata: ruleset.metadata ?? {},
    custom,
  };
}
