import { describe, expect, it } from 'vitest';
import { withPinnedVersion, type SelectableRuleset } from './selectable-rulesets';

const LIST: SelectableRuleset[] = [
  { code: 'Generic_PointsCap', version: '1.1.0', label: 'Generic', custom: false },
  { code: 'TF_v1', version: '1.1.0', label: 'TF v1', custom: false },
  { code: 'custom_house', version: '1.0.2', label: 'House rules', custom: true },
];
const earlier = (code: string, version: string) => `${code} (${version}, earlier end rules)`;

describe('withPinnedVersion', () => {
  it('adds a Tournament pinned to an earlier version of a built-in, named for its end rules', () => {
    expect(withPinnedVersion(LIST, { code: 'TF_v1', version: '1.0.0' }, earlier)).toEqual([
      ...LIST,
      {
        code: 'TF_v1',
        version: '1.0.0',
        label: 'TF_v1 (1.0.0, earlier end rules)',
        custom: false,
      },
    ]);
  });

  it('adds nothing for a pin the list already holds', () => {
    expect(withPinnedVersion(LIST, { code: 'TF_v1', version: '1.1.0' }, earlier)).toBe(LIST);
  });

  it('adds nothing for a club ruleset, whose versions are not the end rules', () => {
    expect(withPinnedVersion(LIST, { code: 'custom_house', version: '1.0.1' }, earlier)).toBe(LIST);
    expect(withPinnedVersion(LIST, { code: 'custom_gone', version: '1.0.0' }, earlier)).toBe(LIST);
  });
});
