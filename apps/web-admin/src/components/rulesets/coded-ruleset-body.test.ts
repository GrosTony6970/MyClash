import { describe, expect, it } from 'vitest';
import { codedRulesetTfConfig, type CodedRulesetSubmitValue } from './coded-ruleset-body';
import { DEFAULT_MATCH_FORMAT_DEFAULTS } from './RulesetForm';

function value(over: Partial<CodedRulesetSubmitValue> = {}): CodedRulesetSubmitValue {
  return {
    targets: [
      { name: 'Deep', value: 2 },
      { name: 'Shallow', value: 1 },
    ],
    matchFormatDefaults: DEFAULT_MATCH_FORMAT_DEFAULTS,
    doublePenaltyFormula: null,
    tfV1Internals: { winBonus: 3, deepTarget: 2, shallowTarget: 1 },
    ...over,
  };
}

describe('codedRulesetTfConfig', () => {
  it('mirrors the first two named targets into the legacy deep/shallow pair', () => {
    // TF_v1 scoring still reads targetValues; the editor's source of truth is
    // the named list. Both must be written or the two disagree.
    const out = codedRulesetTfConfig(
      value({
        targets: [
          { name: 'Head', value: 5 },
          { name: 'Arm', value: 3 },
        ],
      }),
    );
    expect(out.targetValues).toEqual({ deepTarget: 5, shallowTarget: 3 });
    expect(out.targets).toEqual([
      { name: 'Head', value: 5 },
      { name: 'Arm', value: 3 },
    ]);
  });

  it('carries winBonus and the match format', () => {
    const out = codedRulesetTfConfig(
      value({ tfV1Internals: { winBonus: 7, deepTarget: 2, shallowTarget: 1 } }),
    );
    expect(out.winBonus).toBe(7);
    expect(out.matchFormat).toEqual(DEFAULT_MATCH_FORMAT_DEFAULTS);
  });

  it('sends an absent double penalty as undefined, not null', () => {
    // The API's tfConfig patch validates against TFv1ConfigSchema.partial();
    // an explicit null is a different thing from "not set".
    expect(
      codedRulesetTfConfig(value({ doublePenaltyFormula: null })).doublePenaltyFormula,
    ).toBeUndefined();
  });

  it('tolerates a single target without inventing a shallow value', () => {
    const out = codedRulesetTfConfig(value({ targets: [{ name: 'Only', value: 4 }] }));
    expect(out.targetValues).toEqual({ deepTarget: 4, shallowTarget: undefined });
  });
});
