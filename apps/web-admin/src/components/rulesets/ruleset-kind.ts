/**
 * Ruleset kind predicate, in a dependency-free module so both RulesetForm and
 * ruleset-form-initial (which import values from each other) can share it
 * without an import cycle.
 */

/**
 * A ruleset whose maths is CODE — TF_v1 itself, or a `base_code` fork of it
 * ("Customise this format") that reuses the coded engine. Such a ruleset has no
 * authored score formula: the form shows the coded internals (winBonus, targets)
 * and reads/writes them through `tf_config`, not the formula editor + flat
 * columns. The single source of this predicate, so the 'TF_v1' literal does not
 * drift across RulesetForm, the hydration helper, and both edit pages.
 */
export function isCodedRuleset(code: string | null | undefined, baseCode?: string | null): boolean {
  return code === 'TF_v1' || baseCode === 'TF_v1';
}
