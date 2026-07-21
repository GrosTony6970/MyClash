import { describe, expect, it } from 'vitest';
import { diffRulesetBuckets, type RulesetBucketInputs } from './lineage';

const BASE: RulesetBucketInputs = {
  targets: [
    { name: 'Deep', value: 2 },
    { name: 'Shallow', value: 1 },
  ],
  hasAfterblow: true,
  afterblowValuation: 'fixed',
  afterblowFixedValue: 1,
  matchFormat: { pointCap: 5, timeLimitsSeconds: { pool: 180, bracket: 180 } },
  winBonus: 3,
  doublePenaltyFormula: 'n*(n-1)/3',
};

const clone = (o: RulesetBucketInputs): RulesetBucketInputs => JSON.parse(JSON.stringify(o));

describe('diffRulesetBuckets', () => {
  it('reports every bucket unchanged for an identical fork (ranking compatible)', () => {
    const d = diffRulesetBuckets(BASE, clone(BASE));
    expect(d).toEqual({
      grammar: 'unchanged',
      endConditions: 'unchanged',
      ranking: 'unchanged',
      rankingCompatible: true,
    });
  });

  it('flags grammar when a target value changes, leaving the rest', () => {
    const fork = clone(BASE);
    fork.targets = [
      { name: 'Deep', value: 3 },
      { name: 'Shallow', value: 1 },
    ];
    const d = diffRulesetBuckets(BASE, fork);
    expect(d.grammar).toBe('changed');
    expect(d.endConditions).toBe('unchanged');
    expect(d.ranking).toBe('unchanged');
  });

  it('flags grammar when afterblow valuation changes', () => {
    const fork = clone(BASE);
    fork.afterblowValuation = 'weighted';
    expect(diffRulesetBuckets(BASE, fork).grammar).toBe('changed');
  });

  it('flags end conditions on a nested matchFormat change (deep compare)', () => {
    const fork = clone(BASE);
    (fork.matchFormat as { timeLimitsSeconds: { pool: number } }).timeLimitsSeconds.pool = 120;
    const d = diffRulesetBuckets(BASE, fork);
    expect(d.endConditions).toBe('changed');
    expect(d.grammar).toBe('unchanged');
    expect(d.ranking).toBe('unchanged');
  });

  it('flags ranking + marks incompatible when winBonus changes', () => {
    const fork = clone(BASE);
    fork.winBonus = 5;
    const d = diffRulesetBuckets(BASE, fork);
    expect(d.ranking).toBe('changed');
    expect(d.rankingCompatible).toBe(false);
  });

  it('flags ranking when the double-penalty formula changes', () => {
    const fork = clone(BASE);
    fork.doublePenaltyFormula = 'n';
    const d = diffRulesetBuckets(BASE, fork);
    expect(d.ranking).toBe('changed');
    expect(d.rankingCompatible).toBe(false);
  });

  it('treats a target reordering as a grammar change (the pad order changed)', () => {
    const fork = clone(BASE);
    fork.targets = [
      { name: 'Shallow', value: 1 },
      { name: 'Deep', value: 2 },
    ];
    expect(diffRulesetBuckets(BASE, fork).grammar).toBe('changed');
  });
});
