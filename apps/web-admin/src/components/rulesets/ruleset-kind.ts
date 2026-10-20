/**
 * Ruleset kind predicate, in a dependency-free module so both RulesetForm and
 * ruleset-form-initial (which import values from each other) can share it
 * without an import cycle.
 *
 * A ruleset whose maths is CODE — TF_v1 itself, or a `base_code` fork of it
 * ("Customise this format") — has no authored score formula: the form shows the
 * coded internals (winBonus, targets) and reads/writes them through `tf_config`.
 * The predicate's one owner is `@myclash/types/effective-rules` (a subpath,
 * so it stays off every page's bundle), which the API's `effectiveRules`
 * reads too.
 */
export { isCodedRuleset } from '@myclash/types/effective-rules';
