import { describe, expect, it } from 'vitest';
import {
  diffRulesetBuckets,
  projectRulesetBuckets,
  type RulesetBucketInputs,
  type RulesetBucketRow,
} from './lineage';
import { normalizeMatchFormatConfig } from './match-format';

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
  forfeitPolicy: null,
  tournamentPolicy: null,
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

  it('treats a pure target reordering as UNCHANGED (order is display, not behaviour)', () => {
    // Faithful to the content-hash's canonicalizeGrammar, which sorts targets by
    // name: reordering the pad's buttons changes no exchange's value, so the
    // grammar bucket must not light. (This inverts the pre-fidelity behaviour.)
    const fork = clone(BASE);
    fork.targets = [
      { name: 'Shallow', value: 1 },
      { name: 'Deep', value: 2 },
    ];
    expect(diffRulesetBuckets(BASE, fork).grammar).toBe('unchanged');
  });

  it('still flags grammar when a reorder ALSO changes a value', () => {
    const fork = clone(BASE);
    fork.targets = [
      { name: 'Shallow', value: 2 },
      { name: 'Deep', value: 2 },
    ];
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

  it('flags ranking + incompatible when forfeitPolicy changes (placing-affecting)', () => {
    // The high-stakes fidelity fix: forfeitPolicy re-ranks (it is in the coded
    // content-hash canonical), so a fork that changes it must NOT read compatible.
    const fork = clone(BASE);
    fork.forfeitPolicy = { reasons: { black_card_1: { tournamentState: 'disqualified' } } };
    const d = diffRulesetBuckets(BASE, fork);
    expect(d.ranking).toBe('changed');
    expect(d.rankingCompatible).toBe(false);
  });

  it('flags ranking + incompatible when tournamentPolicy changes (W/L/D tally)', () => {
    const fork = clone(BASE);
    fork.tournamentPolicy = { forfeitDrawsCount: true };
    const d = diffRulesetBuckets(BASE, fork);
    expect(d.ranking).toBe('changed');
    expect(d.rankingCompatible).toBe(false);
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
      normalizeMatchFormatConfig({ pointCap: 5, timeLimitsSeconds: { pool: 180 } }),
    );
  });

  it('defaults an empty/absent row to the safe fork baseline (full default matchFormat)', () => {
    const inputs = projectRulesetBuckets({});
    expect(inputs).toEqual({
      targets: null,
      hasAfterblow: false,
      afterblowValuation: null,
      afterblowFixedValue: null,
      matchFormat: normalizeMatchFormatConfig({}),
      winBonus: null,
      doublePenaltyFormula: null,
      forfeitPolicy: null,
      tournamentPolicy: null,
    });
  });

  it('projects forfeitPolicy + tournamentPolicy from tf_config into the ranking bucket', () => {
    const row: RulesetBucketRow = {
      ...CODED_ROW,
      tf_config: {
        ...(CODED_ROW.tf_config as object),
        forfeitPolicy: { reasons: { black_card_1: { tournamentState: 'disqualified' } } },
        tournamentPolicy: { forfeitDrawsCount: true },
      },
    };
    const inputs = projectRulesetBuckets(row);
    expect(inputs.forfeitPolicy).toEqual({
      reasons: { black_card_1: { tournamentState: 'disqualified' } },
    });
    expect(inputs.tournamentPolicy).toEqual({ forfeitDrawsCount: true });
  });

  it('reads end conditions through the real normalizer: a legacy alias equals its modern key', () => {
    // firstToPoints is the legacy alias for pointCap; the scorer's normalizer
    // resolves them identically, so the endConditions lamp must not light.
    const legacy: RulesetBucketRow = { tf_config: { matchFormat: { firstToPoints: 5 } } };
    const modern: RulesetBucketRow = { tf_config: { matchFormat: { pointCap: 5 } } };
    const diff = diffRulesetBuckets(projectRulesetBuckets(legacy), projectRulesetBuckets(modern));
    expect(diff.endConditions).toBe('unchanged');
  });

  it('reads end conditions through the real normalizer: absent equals explicit default', () => {
    const absent: RulesetBucketRow = { tf_config: { matchFormat: { pointCap: 5 } } };
    const explicitDefault: RulesetBucketRow = {
      tf_config: { matchFormat: { pointCap: 5, timerMode: 'countdown' } },
    };
    const diff = diffRulesetBuckets(
      projectRulesetBuckets(absent),
      projectRulesetBuckets(explicitDefault),
    );
    expect(diff.endConditions).toBe('unchanged');
  });

  it('reads end conditions through the real normalizer: a real timerMode change lights the lamp', () => {
    const countdown: RulesetBucketRow = { tf_config: { matchFormat: { pointCap: 5 } } };
    const countup: RulesetBucketRow = {
      tf_config: { matchFormat: { pointCap: 5, timerMode: 'countup' } },
    };
    const diff = diffRulesetBuckets(
      projectRulesetBuckets(countdown),
      projectRulesetBuckets(countup),
    );
    expect(diff.endConditions).toBe('changed');
  });

  it('falls back to a stable shape when a stored matchFormat is out of domain', () => {
    // Rulesets are validated at authoring, but a corrupt config must not crash the
    // lamp — an out-of-domain value degrades to the default shape rather than throwing.
    const corrupt: RulesetBucketRow = { tf_config: { matchFormat: { pointCap: -5 } } };
    expect(() => projectRulesetBuckets(corrupt)).not.toThrow();
    expect(projectRulesetBuckets(corrupt).matchFormat).toEqual(normalizeMatchFormatConfig({}));
  });
});
