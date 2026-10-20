import { describe, expect, it } from 'vitest';
import { isCodedRuleset } from './effective-rules';

describe('isCodedRuleset', () => {
  it('is TF_v1 and a fork of it, nothing else', () => {
    expect(isCodedRuleset('TF_v1')).toBe(true);
    expect(isCodedRuleset('club_fork', 'TF_v1')).toBe(true);
    expect(isCodedRuleset('Generic_PointsCap')).toBe(false);
    expect(isCodedRuleset('club_formula', null)).toBe(false);
    expect(isCodedRuleset(null)).toBe(false);
  });
});
