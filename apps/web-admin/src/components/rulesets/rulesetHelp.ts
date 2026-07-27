/**
 * Deep help for the ruleset controls that genuinely change results.
 *
 * The editors already carry a one-line `*Help` caption saying what each
 * section IS. This is the second sentence those captions have no room for:
 * what the setting changes about the score a fighter ends up with. Afterblow
 * valuation, the double-hit penalty and the score formula are the settings an
 * organiser can get wrong without anything looking wrong.
 *
 * Follows `standings/columnHelp.ts`: the copy lives in i18n, this file is only
 * the concept → key mapping, and both halves are testable without rendering.
 *
 * Keys are written OUT IN FULL rather than composed from a base constant. A
 * `${BASE}.${leaf}` template starts with the interpolation, which the i18n
 * reverse sweep cannot derive a prefix from — it would report every leaf as
 * orphaned until someone added a MANUAL_PREFIXES entry. Full literals are also
 * greppable, which is how anyone will actually find them.
 */
type Translate = (key: string, values?: Record<string, string | number>) => string;

/** Every concept that has deep help. Adding one here without copy fails the i18n sweep. */
export type RulesetHelpKey =
  | 'targets'
  | 'afterblow'
  | 'afterblowValuation'
  | 'afterblowMode'
  | 'doublePenalty'
  | 'formula'
  | 'tiebreakers'
  | 'penaltyCosts'
  | 'penaltyVersioning'
  | 'seedingStrategy'
  | 'compensationTiers';

const RULESET_HELP: Record<RulesetHelpKey, string> = {
  targets: 'admin.rulesets.deepHelp.targets',
  afterblow: 'admin.rulesets.deepHelp.afterblow',
  afterblowValuation: 'admin.rulesets.deepHelp.afterblowValuation',
  afterblowMode: 'admin.rulesets.deepHelp.afterblowMode',
  doublePenalty: 'admin.rulesets.deepHelp.doublePenalty',
  formula: 'admin.rulesets.deepHelp.formula',
  tiebreakers: 'admin.rulesets.deepHelp.tiebreakers',
  penaltyCosts: 'admin.rulesets.deepHelp.penaltyCosts',
  penaltyVersioning: 'admin.rulesets.deepHelp.penaltyVersioning',
  seedingStrategy: 'admin.rulesets.deepHelp.seedingStrategy',
  compensationTiers: 'admin.rulesets.deepHelp.compensationTiers',
};

/** Resolve the deep-help text for a concept. */
export function rulesetHelp(key: RulesetHelpKey, t: Translate): string {
  return t(RULESET_HELP[key]);
}

/** The i18n key behind a concept — for tests, and for anyone grepping. */
export function rulesetHelpKey(key: RulesetHelpKey): string {
  return RULESET_HELP[key];
}

export const RULESET_HELP_KEYS = Object.keys(RULESET_HELP) as RulesetHelpKey[];
