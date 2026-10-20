import { describe, expect, it } from 'vitest';
import { disqualifyAfterOf, isCodedRuleset } from './effective-rules';

describe('disqualifyAfterOf', () => {
  it('answers a stored number above 0', () => {
    expect(disqualifyAfterOf({ tournamentPolicy: { disqualifyAfter: 3 } })).toBe(3);
  });

  it('answers null (off) for a missing setting, a missing policy and no settings at all', () => {
    expect(disqualifyAfterOf({ tournamentPolicy: { forfeitDrawsCount: true } })).toBeNull();
    expect(disqualifyAfterOf({ matchFormat: { pointCap: 7 } })).toBeNull();
    expect(disqualifyAfterOf(null)).toBeNull();
    expect(disqualifyAfterOf(undefined)).toBeNull();
  });

  it('answers null for a value the forfeit rule does not apply', () => {
    expect(disqualifyAfterOf({ tournamentPolicy: { disqualifyAfter: 0 } })).toBeNull();
    expect(disqualifyAfterOf({ tournamentPolicy: { disqualifyAfter: null } })).toBeNull();
    expect(disqualifyAfterOf({ tournamentPolicy: { disqualifyAfter: '2' } })).toBeNull();
  });
});

describe('isCodedRuleset', () => {
  it('is TF_v1 and a fork of it, nothing else', () => {
    expect(isCodedRuleset('TF_v1')).toBe(true);
    expect(isCodedRuleset('club_fork', 'TF_v1')).toBe(true);
    expect(isCodedRuleset('Generic_PointsCap')).toBe(false);
    expect(isCodedRuleset('club_formula', null)).toBe(false);
    expect(isCodedRuleset(null)).toBe(false);
  });
});
