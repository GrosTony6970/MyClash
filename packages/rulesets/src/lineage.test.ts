import { describe, expect, it } from 'vitest';
import {
  diffRulesetBuckets,
  normalizeMatchFormat,
  projectRulesetBuckets,
  type RulesetBucketInputs,
  type RulesetBucketRow,
} from './lineage';

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

describe('normalizeMatchFormat', () => {
  it('projects null/undefined to the fixed key set of nulls', () => {
    expect(normalizeMatchFormat(null)).toEqual({
      pointCap: null,
      scoringDirection: null,
      maxDoubleHits: null,
      timeLimitsSeconds: null,
      softClockLimitSeconds: null,
      bestOf: null,
    });
    expect(normalizeMatchFormat(undefined)).toEqual(normalizeMatchFormat(null));
  });

  it('keeps the six end-condition keys and drops everything else', () => {
    const out = normalizeMatchFormat({ pointCap: 7, timerMode: 'countdown', extra: 'x' });
    expect(out['pointCap']).toBe(7);
    expect(Object.keys(out).sort()).toEqual([
      'bestOf',
      'maxDoubleHits',
      'pointCap',
      'scoringDirection',
      'softClockLimitSeconds',
      'timeLimitsSeconds',
    ]);
  });
});

describe('projectRulesetBuckets', () => {
  const CODED_ROW: RulesetBucketRow = {
    targets: [
      { name: 'Deep', value: 2 },
      { name: 'Shallow', value: 1 },
    ],
    has_afterblow: true,
    afterblow_valuation: 'fixed',
    afterblow_fixed_value: 1,
    tf_config: {
      winBonus: 3,
      doublePenaltyFormula: 'n*(n-1)/3',
      matchFormat: { pointCap: 5, timeLimitsSeconds: { pool: 180 } },
    },
  };

  it('maps grammar from the columns and ranking/end-conditions from tf_config', () => {
    const inputs = projectRulesetBuckets(CODED_ROW);
    expect(inputs.targets).toEqual(CODED_ROW.targets);
    expect(inputs.hasAfterblow).toBe(true);
    expect(inputs.afterblowValuation).toBe('fixed');
    expect(inputs.afterblowFixedValue).toBe(1);
    expect(inputs.winBonus).toBe(3);
    expect(inputs.doublePenaltyFormula).toBe('n*(n-1)/3');
    expect(inputs.matchFormat).toEqual(
      normalizeMatchFormat({ pointCap: 5, timeLimitsSeconds: { pool: 180 } }),
    );
  });

  it('defaults an empty/absent grammar to the safe fork baseline', () => {
    const inputs = projectRulesetBuckets({});
    expect(inputs).toEqual({
      targets: null,
      hasAfterblow: false,
      afterblowValuation: null,
      afterblowFixedValue: null,
      matchFormat: normalizeMatchFormat(null),
      winBonus: null,
      doublePenaltyFormula: null,
    });
  });

  it('does not flag end conditions when the fork only carries an extra matchFormat key', () => {
    // The regression the normalization guards: the base's older tf_config seed
    // lacks a key (e.g. timerMode, outside the six) that the fork carries. The
    // fixed key set makes both sides compare over the same shape.
    const fork: RulesetBucketRow = {
      ...CODED_ROW,
      tf_config: {
        ...(CODED_ROW.tf_config as object),
        matchFormat: { pointCap: 5, timeLimitsSeconds: { pool: 180 }, timerMode: 'countdown' },
      },
    };
    const diff = diffRulesetBuckets(projectRulesetBuckets(CODED_ROW), projectRulesetBuckets(fork));
    expect(diff.endConditions).toBe('unchanged');
    expect(diff).toEqual({
      grammar: 'unchanged',
      endConditions: 'unchanged',
      ranking: 'unchanged',
      rankingCompatible: true,
    });
  });
});
