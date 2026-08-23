import { Generic_PointsCap, RulesetRegistry, TF_v1 } from '@myclash/rulesets';

/**
 * A registry holding the coded built-ins, and the one list of what those are.
 *
 * The API boots exactly one of these through `RulesetRegistryModule`. Tests
 * build their own per case, which is the isolation the old module-scope
 * singleton denied them: it was shared across every test in a file, so five
 * files called `registry.clear()` to undo each other and both production
 * writers guarded their `register` calls against having already run.
 *
 * `register` throws on a duplicate, deliberately — a built-in listed twice is a
 * boot failure here rather than a silently ignored second registration.
 */
export function createRulesetRegistry(): RulesetRegistry {
  const registry = new RulesetRegistry();
  for (const ruleset of [TF_v1, Generic_PointsCap]) registry.register(ruleset);
  return registry;
}
