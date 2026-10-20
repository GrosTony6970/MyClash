/**
 * forfeit-rules.ts — what a forfeit does, as a penalty ruleset sets it (operator rulings 63-76,
 * 2026-10-20)
 *
 * Every forfeit and disqualification rule lives in the PENALTY ruleset, beside its 1st and 2nd
 * black card settings. The scoring ruleset holds none (ruling 68). The Zod schema that checks a
 * stored value is `ForfeitRulesSchema` in `@myclash/rulesets`, pinned to this interface; this
 * subpath holds no Zod, so a screen can import it without the engine.
 */

/** A forfeit a Fighter chose, or an official recorded against them. Black cards are their own. */
export type ForfeitRuleReason = 'injury' | 'voluntary' | 'conduct_violation';

export const FORFEIT_RULE_REASONS: readonly ForfeitRuleReason[] = [
  'injury',
  'voluntary',
  'conduct_violation',
];

export interface ForfeitReasonRule {
  /** What the bout counts as: the score it stood at, or a loss of 0 to `opponentScore`. */
  outcome: 'keep_current' | 'fixed_loss';
  /** The forfeiting Fighter's opponent's score on a loss, 1-99. */
  opponentScore: number;
  /** What happens to the Fighter: continues, the official is asked, withdrawn, or disqualified. */
  fighter: 'continues' | 'asks' | 'withdrawn' | 'disqualified';
}

export interface ForfeitRules {
  reasons: Record<ForfeitRuleReason, ForfeitReasonRule>;
  /** The Fighter's own forfeits that disqualify them, 1-10, or `'off'`. */
  disqualifyAfter: number | 'off';
  /** A forfeit before the Fighter's 1st bout is fought disqualifies them. */
  disqualifyBeforeFirstBout: boolean;
  /** A black card forfeit is a loss of 0 to this, 1-99 (ruling 69). */
  blackCardOpponentScore: number;
}

const START_REASONS: ForfeitRules['reasons'] = {
  injury: { outcome: 'keep_current', opponentScore: 6, fighter: 'asks' },
  voluntary: { outcome: 'fixed_loss', opponentScore: 6, fighter: 'asks' },
  conduct_violation: { outcome: 'fixed_loss', opponentScore: 6, fighter: 'disqualified' },
};

/** The built-in FFAMHE penalty ruleset's: what a TF_v1 Tournament did before the move. */
export const FFAMHE_FORFEIT_RULES: ForfeitRules = {
  reasons: START_REASONS,
  disqualifyAfter: 2,
  disqualifyBeforeFirstBout: false,
  blackCardOpponentScore: 6,
};

/** What a brand-new club penalty ruleset starts with: "disqualify after" is off (ruling 67). */
export const CLUB_START_FORFEIT_RULES: ForfeitRules = {
  ...FFAMHE_FORFEIT_RULES,
  disqualifyAfter: 'off',
};
