/**
 * effective-rules.ts — the rules a Tournament plays under, as its settings screens show them
 *
 * The API answers them on `GET /tournaments/:id` (`effectiveRules`) and the screens read them, so
 * no screen holds a default of its own (operator rulings 43 and 46, 2026-10-20). This type is that
 * answer's contract: the API builds it, the screens and their fixtures are checked against it.
 */

import type { MatchFormatConfig } from '@myclash/rules/pad';
import type { TournamentLockConfig, TournamentScoringConfig } from './scoring-config';

/** The coded engine's own settings (TF_v1 or a fork of it), as the engine applies them. */
export interface EffectiveTfRules {
  winBonus: number;
  targetValues: { deepTarget: number; shallowTarget: number };
  tournamentPolicy: {
    forfeitDrawsCount: boolean;
    forfeitFighterBefore1stMatch: boolean;
    /** The forfeits that disqualify a fighter; null when the rule is off (`disqualifyAfterOf`). */
    disqualifyAfter: number | null;
  };
}

/** The settings a Tournament on a ruleset starts from: its ruleset's seed at the pinned version. */
export interface RulesStart {
  matchFormat: MatchFormatConfig;
  /** Null for a ruleset whose engine is not TF_v1's (`isCodedRuleset`). */
  tf: EffectiveTfRules | null;
  scoring: TournamentScoringConfig;
}

export interface EffectiveRules extends RulesStart {
  lock: TournamentLockConfig;
  /**
   * What the "Modified" badge and Reset compare with (operator ruling 51). Null when the seed could
   * not be read or the engine refuses it: the screens then show no badge and no Reset.
   */
  start: RulesStart | null;
}

/**
 * A ruleset whose maths is CODE: TF_v1 itself, or a `base_code` fork of it ("Customise this
 * format"). Such a ruleset owns `winBonus`, the target values and the Tournament policy. The ONE
 * owner of the predicate, for the API's `effectiveRules` and the admin screens.
 */
export function isCodedRuleset(code: string | null | undefined, baseCode?: string | null): boolean {
  return code === 'TF_v1' || baseCode === 'TF_v1';
}

/**
 * The number of forfeits that disqualify a fighter, as the forfeit rule applies it: a stored
 * number above 0, else null — the rule is off (operator ruling 48: a missing setting is off).
 * Read on the STORED settings, never on a parse, which would fill the schema's 2.
 */
export function disqualifyAfterOf(rulesetConfig: unknown): number | null {
  const policy =
    rulesetConfig && typeof rulesetConfig === 'object'
      ? (rulesetConfig as { tournamentPolicy?: unknown }).tournamentPolicy
      : undefined;
  const threshold =
    policy && typeof policy === 'object'
      ? (policy as { disqualifyAfter?: unknown }).disqualifyAfter
      : undefined;
  return typeof threshold === 'number' && threshold > 0 ? threshold : null;
}
