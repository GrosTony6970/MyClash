import { describe, expect, it } from 'vitest';
import { BUILT_IN_RULESETS } from '@myclash/rulesets';
import { defaultRulesetConfigFor, defaultRulesetVersion } from './ruleset-row-projection';
import { createRulesetRegistry } from '../rulesets/ruleset-registry';

describe('defaultRulesetConfigFor', () => {
  // A version missing here seeds a new Tournament from the mirror row's
  // defaults, in silence: every registered version must have its own.
  it.each(BUILT_IN_RULESETS.map((r) => [r.code, r.version]))(
    'has the defaults of %s %s',
    (code, version) => {
      expect(Object.keys(defaultRulesetConfigFor(code, version))).not.toEqual([]);
    },
  );
});

describe('defaultRulesetVersion', () => {
  it("is a built-in's latest registered version, never the older one kept beside it", () => {
    const registry = createRulesetRegistry();
    expect(registry.has('TF_v1', '1.0.0')).toBe(true);
    expect(defaultRulesetVersion(registry, 'TF_v1')).toBe('1.1.0');
    expect(defaultRulesetVersion(registry, 'Generic_PointsCap')).toBe('1.1.0');
  });

  it('is 1.0.0 for a code no version of which is registered: a club ruleset', () => {
    expect(defaultRulesetVersion(createRulesetRegistry(), 'custom_house-a1b2')).toBe('1.0.0');
  });
});
