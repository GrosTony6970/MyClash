import { describe, expect, it } from 'vitest';
import { TF_v1 } from '@myclash/rulesets';
import { defaultRulesetVersion } from './ruleset-row-projection';
import { createRulesetRegistry } from '../rulesets/ruleset-registry';

describe('defaultRulesetVersion', () => {
  it("is a built-in's latest registered version", () => {
    const registry = createRulesetRegistry();
    registry.register({ ...TF_v1, version: '1.1.0' });
    expect(defaultRulesetVersion(registry, 'TF_v1')).toBe('1.1.0');
  });

  it('is 1.0.0 for a code no version of which is registered: a club ruleset', () => {
    expect(defaultRulesetVersion(createRulesetRegistry(), 'custom_house-a1b2')).toBe('1.0.0');
  });
});
