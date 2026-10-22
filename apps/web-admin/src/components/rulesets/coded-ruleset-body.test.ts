import { describe, expect, it } from 'vitest';
import { codedRulesetTfConfig, rulesetUpdateBody, targetsChanged } from './coded-ruleset-body';
import type { RulesetSubmitValue } from './RulesetForm';

const START_TARGETS = [
  { name: 'Deep', value: 2 },
  { name: 'Shallow', value: 1 },
];

/** A copy's stored tf_config: its own win bonus 5, cap 7, and a key the editor never shows. */
const STORED = {
  winBonus: 5,
  matchFormat: { pointCap: 7 },
  doublePenaltyFormula: 'n*(n-1)/2',
  extra: 'kept',
};

function submit(over: Record<string, unknown> = {}) {
  return {
    targets: START_TARGETS.map((target) => ({ ...target })),
    matchFormatDefaults: { pointCap: 7 },
    ownCoded: { winBonus: 5, doublePenaltyFormula: 'n*(n-1)/2' as const },
    ...over,
  };
}

/** Guards of the one tfConfig builder (operator rulings 59 and 136): only changes are written. */
describe('codedRulesetTfConfig', () => {
  it('writes an untouched Save back as stored, with nothing added', () => {
    expect(codedRulesetTfConfig(STORED, submit(), START_TARGETS)).toEqual(STORED);
  });

  it('removes a dial or the match format that now follows the engine', () => {
    const out = codedRulesetTfConfig(
      STORED,
      submit({ matchFormatDefaults: null, ownCoded: { doublePenaltyFormula: 'n*(n-1)/2' } }),
      START_TARGETS,
    );
    expect(out).toEqual({ doublePenaltyFormula: 'n*(n-1)/2', extra: 'kept' });
  });

  it('writes a changed double penalty, and drops one that now follows the engine', () => {
    const changed = codedRulesetTfConfig(
      STORED,
      submit({ ownCoded: { winBonus: 5, doublePenaltyFormula: 'n' } }),
      START_TARGETS,
    );
    const reset = codedRulesetTfConfig(
      STORED,
      submit({ ownCoded: { winBonus: 5 } }),
      START_TARGETS,
    );
    expect(changed['doublePenaltyFormula']).toBe('n');
    expect(reset).not.toHaveProperty('doublePenaltyFormula');
  });

  it('starts an empty row from nothing', () => {
    expect(
      codedRulesetTfConfig(
        null,
        submit({ matchFormatDefaults: null, ownCoded: {} }),
        START_TARGETS,
      ),
    ).toEqual({});
  });

  it('mirrors changed targets into the legacy deep/shallow pair', () => {
    const targets = [
      { name: 'Head', value: 5 },
      { name: 'Arm', value: 3 },
    ];
    const out = codedRulesetTfConfig(STORED, submit({ targets }), START_TARGETS);
    expect(out['targets']).toEqual(targets);
    expect(out['targetValues']).toEqual({ deepTarget: 5, shallowTarget: 3 });
  });

  it('tolerates a single target without inventing a shallow value', () => {
    const out = codedRulesetTfConfig(
      null,
      submit({ targets: [{ name: 'Only', value: 4 }] }),
      START_TARGETS,
    );
    expect(out['targetValues']).toEqual({ deepTarget: 4, shallowTarget: undefined });
  });
});

describe('rulesetUpdateBody', () => {
  const HEAD = { name: 'House', description: '', version: '1.0.0' };
  const data = (over: Record<string, unknown> = {}) =>
    ({ ...HEAD, scoreFormula: {}, ...submit(over) }) as unknown as RulesetSubmitValue;
  const start = { storedTfConfig: STORED, targets: START_TARGETS };

  it('writes a TF v1 edit to tf_config, the flat targets only when they changed', () => {
    const targets = [{ name: 'Head', value: 5 }];
    expect(rulesetUpdateBody('tf', start, data())).toEqual({ ...HEAD, tfConfig: STORED });
    expect(rulesetUpdateBody('tf', start, data({ targets }))).toMatchObject({ targets });
  });

  it('writes only Points cap’s own match format, to tf_config (ruling 139)', () => {
    expect(rulesetUpdateBody('pointsCap', start, data())).toEqual({
      ...HEAD,
      tfConfig: { matchFormat: { pointCap: 7 } },
    });
    expect(rulesetUpdateBody('pointsCap', start, data({ matchFormatDefaults: null }))).toEqual({
      ...HEAD,
      tfConfig: {},
    });
  });

  it('sends a formula ruleset’s form as it is', () => {
    const formula = data();
    expect(rulesetUpdateBody('formula', start, formula)).toBe(formula);
  });
});

describe('targetsChanged', () => {
  it('reads the same values in a new array as no change', () => {
    expect(
      targetsChanged(
        START_TARGETS,
        START_TARGETS.map((target) => ({ ...target })),
      ),
    ).toBe(false);
    expect(targetsChanged(START_TARGETS, [{ name: 'Deep', value: 3 }, START_TARGETS[1]!])).toBe(
      true,
    );
  });
});
