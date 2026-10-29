/**
 * The forfeit rules in an audited change of a Tournament's rules (the audited settings change,
 * revisions 13-16 of its plan; operator rulings 142, 145, 147).
 *
 * A Tournament's forfeit rules are the rules IN FORCE: its penalty ruleset's, with its own stored
 * changes laid over them (`mergeForfeitRules`). Each leaf of them is one path here; the diff
 * (`forfeitRulesChanges`, `@myclash/rulesets`) emits these paths only, and `rulesChangeLines`
 * (`rules-change.ts`) words them. A leaf the list does not hold is `forfeitRules.unknown`, worded
 * "another forfeit rule changed" and carried with no value anywhere: a new forfeit rule is never a
 * change the lock cannot see.
 *
 * This module imports nothing from `rules-change.ts`: that one reads this one.
 */

/** Every leaf of the rules in force (`ForfeitRulesInForce`), spelt out: the reasons are not a tuple. */
export const FORFEIT_RULE_LEAF_PATHS = [
  'forfeitRules.disqualifyAfter',
  'forfeitRules.disqualifyBeforeFirstBout',
  'forfeitRules.blackCardOpponentScore',
  'forfeitRules.firstBlackCard',
  'forfeitRules.secondBlackCard',
  'forfeitRules.reasons.injury.outcome',
  'forfeitRules.reasons.injury.opponentScore',
  'forfeitRules.reasons.injury.fighter',
  'forfeitRules.reasons.voluntary.outcome',
  'forfeitRules.reasons.voluntary.opponentScore',
  'forfeitRules.reasons.voluntary.fighter',
  'forfeitRules.reasons.conduct_violation.outcome',
  'forfeitRules.reasons.conduct_violation.opponentScore',
  'forfeitRules.reasons.conduct_violation.fighter',
] as const;

/** A forfeit rule the list does not hold, or a stored change no leaf names: a path, no value. */
export const FORFEIT_UNKNOWN_PATH = 'forfeitRules.unknown';

export const FORFEIT_RULES_CHANGE_PATHS = [
  ...FORFEIT_RULE_LEAF_PATHS,
  FORFEIT_UNKNOWN_PATH,
] as const;

export type ForfeitRulesChangePath = (typeof FORFEIT_RULES_CHANGE_PATHS)[number];

/**
 * How a forfeit entry whose two values in force are EQUAL changed (ruling 147): the Tournament now
 * stores the ruleset's own value (`set`), or no longer stores one and follows the ruleset (`reset`).
 */
export type RulesChangeStored = 'set' | 'reset';

/**
 * The fields of a settings save that are rules: the only ones an audited save may carry beside
 * `audit` (`rules_change_mixed` otherwise), and the only ones the dialog sends again. The pair is
 * not one (it moves through the re-pin), nor is the card pin (it is refused on the clock first).
 */
export const RULES_SAVE_KEYS = ['rulesetConfig', 'scoringConfig', 'forfeitRules'] as const;

/** The words of each forfeit path, as WHOLE key literals (the i18n reverse sweep reads them). */
export const forfeitRulesChangeKey: Record<ForfeitRulesChangePath, string> = {
  'forfeitRules.disqualifyAfter': 'common.rulesChange.forfeit.disqualifyAfter',
  'forfeitRules.disqualifyBeforeFirstBout': 'common.rulesChange.forfeit.beforeFirstBout',
  'forfeitRules.blackCardOpponentScore': 'common.rulesChange.forfeit.blackCardScore',
  'forfeitRules.firstBlackCard': 'common.rulesChange.forfeit.firstBlackCard',
  'forfeitRules.secondBlackCard': 'common.rulesChange.forfeit.secondBlackCard',
  'forfeitRules.reasons.injury.outcome': 'common.rulesChange.forfeit.injuryOutcome',
  'forfeitRules.reasons.injury.opponentScore': 'common.rulesChange.forfeit.injuryScore',
  'forfeitRules.reasons.injury.fighter': 'common.rulesChange.forfeit.injuryFighter',
  'forfeitRules.reasons.voluntary.outcome': 'common.rulesChange.forfeit.voluntaryOutcome',
  'forfeitRules.reasons.voluntary.opponentScore': 'common.rulesChange.forfeit.voluntaryScore',
  'forfeitRules.reasons.voluntary.fighter': 'common.rulesChange.forfeit.voluntaryFighter',
  'forfeitRules.reasons.conduct_violation.outcome': 'common.rulesChange.forfeit.conductOutcome',
  'forfeitRules.reasons.conduct_violation.opponentScore': 'common.rulesChange.forfeit.conductScore',
  'forfeitRules.reasons.conduct_violation.fighter': 'common.rulesChange.forfeit.conductFighter',
  'forfeitRules.unknown': 'common.rulesChange.forfeit.unknown',
};

const REASON_OUTCOMES = {
  keep_current: 'common.rulesChange.forfeit.value.keepCurrent',
  fixed_loss: 'common.rulesChange.forfeit.value.fixedLoss',
  draw: 'common.rulesChange.forfeit.value.draw',
} as const;

const REASON_FIGHTERS = {
  continues: 'common.rulesChange.forfeit.value.continues',
  asks: 'common.rulesChange.forfeit.value.asks',
  withdrawn: 'common.rulesChange.forfeit.value.withdrawn',
  disqualified: 'common.rulesChange.forfeit.value.disqualified',
} as const;

const BLACK_CARD = {
  match: 'common.rulesChange.forfeit.value.cardMatch',
  tournament: 'common.rulesChange.forfeit.value.cardTournament',
  none: 'common.rulesChange.forfeit.value.cardNone',
} as const;

/** The known values of each forfeit enum path (`ForfeitReasonRule`, `BlackCardEffectName`). */
export const FORFEIT_ENUM_VALUE_KEYS: Partial<
  Record<ForfeitRulesChangePath, Readonly<Record<string, string>>>
> = {
  'forfeitRules.firstBlackCard': BLACK_CARD,
  'forfeitRules.secondBlackCard': BLACK_CARD,
  'forfeitRules.reasons.injury.outcome': REASON_OUTCOMES,
  'forfeitRules.reasons.injury.fighter': REASON_FIGHTERS,
  'forfeitRules.reasons.voluntary.outcome': REASON_OUTCOMES,
  'forfeitRules.reasons.voluntary.fighter': REASON_FIGHTERS,
  'forfeitRules.reasons.conduct_violation.outcome': REASON_OUTCOMES,
  'forfeitRules.reasons.conduct_violation.fighter': REASON_FIGHTERS,
};

/** A forfeit value shown as a bare number. */
export const FORFEIT_NUMBER_PATHS: ReadonlySet<string> = new Set([
  'forfeitRules.blackCardOpponentScore',
  'forfeitRules.reasons.injury.opponentScore',
  'forfeitRules.reasons.voluntary.opponentScore',
  'forfeitRules.reasons.conduct_violation.opponentScore',
]);

/** "Disqualify after": a count, or off. Worded before the enums: `'off'` is its one word. */
export const DISQUALIFY_AFTER_PATH = 'forfeitRules.disqualifyAfter';
export const DISQUALIFY_AFTER_OFF_KEY = 'common.rulesChange.forfeit.value.off';

/** The words of a forfeit entry whose two values in force are equal (ruling 147). */
export const STORED_KEY: Readonly<Record<RulesChangeStored, string>> = {
  set: 'common.rulesChange.storedSet',
  reset: 'common.rulesChange.storedReset',
};
