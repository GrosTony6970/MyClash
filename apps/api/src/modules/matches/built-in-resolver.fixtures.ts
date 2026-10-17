import { RulesetResolver } from './ruleset-resolver.service';
import { createRulesetRegistry } from '../rulesets/ruleset-registry';

/**
 * The resolver a scoring test hands the scorer: the real one, over the registry
 * of the built-ins, which answers a built-in's pair with no read. A bout that
 * names another pair does not resolve, and the scorer refuses it: no test scores
 * with an engine its bout does not name.
 */
export function builtInResolver(): RulesetResolver {
  const noReads = {
    service: {
      from: () => {
        throw new Error('a test resolver reads no stored ruleset');
      },
    },
  };
  return new RulesetResolver(noReads as never, createRulesetRegistry());
}
