import { describe, expect, it } from 'vitest';
import { resolveRulesetGrammar } from './ruleset-defaults';
import { createRulesetRegistry } from '../rulesets/ruleset-registry';

/**
 * The grammar the tournament screens read (`ruleset_grammar`): a built-in resolves through the
 * in-memory registry and makes no query, so no database is passed. `hasVenues` is what hides the
 * "Score by" choice on a ruleset the server forces to points.
 */
describe('the grammar of a built-in ruleset', () => {
  const registry = createRulesetRegistry();
  const grammarOf = (code: string, version: string) =>
    resolveRulesetGrammar(undefined as never, registry, code, version);

  it('says Points cap has no venues, and TF_v1 has them', async () => {
    const pointsCap = registry.latestVersionOf('Generic_PointsCap') ?? '1.0.0';
    const tf = registry.latestVersionOf('TF_v1') ?? '1.0.0';
    expect((await grammarOf('Generic_PointsCap', pointsCap)).hasVenues).toBe(false);
    expect((await grammarOf('TF_v1', tf)).hasVenues).toBe(true);
  });
});
