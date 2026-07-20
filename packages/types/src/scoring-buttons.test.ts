/**
 * The referee pad's buttons, derived from a ruleset's declared grammar.
 *
 * The gate here is the first test: for TF_v1's targets and FFAMHE's `fixed`
 * valuation, the derived buttons must be BYTE-IDENTICAL to the hardcoded
 * DEFAULT_SCORING_CONFIG. This is the federation's primary scoring surface,
 * pressed live on a piste — deriving it must not quietly change it.
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_SCORING_CONFIG, buildScoringButtons, type ScoringGrammar } from './scoring-config';

const TF_V1_GRAMMAR: ScoringGrammar = {
  targets: [
    { name: 'Deep', value: 2 },
    { name: 'Shallow', value: 1 },
  ],
  hasAfterblow: true,
  afterblowValuation: 'fixed',
  afterblowFixedValue: 1,
};

describe('buildScoringButtons — the federal pad must not move', () => {
  it('reproduces DEFAULT_SCORING_CONFIG exactly for TF_v1', () => {
    expect(buildScoringButtons(TF_V1_GRAMMAR)).toEqual(DEFAULT_SCORING_CONFIG.buttons);
  });

  it('produces exactly the two afterblow buttons FFAMHE publishes columns for', () => {
    // ARCHITECTURE.md's FAL 2026 columns are 1-1 and 2-1. There is no 2-2.
    expect(buildScoringButtons(TF_V1_GRAMMAR).afterblow.map((b) => b.label)).toEqual([
      '2-1',
      '1-1',
    ]);
  });
});

describe('buildScoringButtons — clean buttons', () => {
  it('emits one per target, in the order the author arranged them', () => {
    const buttons = buildScoringButtons({
      ...TF_V1_GRAMMAR,
      targets: [
        { name: 'Limb', value: 1 },
        { name: 'Head', value: 3 },
      ],
    });
    // Not sorted: the operator controls the order of their own targets.
    expect(buttons.clean.map((b) => b.label)).toEqual(['+1', '+3']);
  });

  it('handles a single undifferentiated target', () => {
    const buttons = buildScoringButtons({
      targets: [{ name: 'Hit', value: 1 }],
      hasAfterblow: false,
      afterblowValuation: 'fixed',
      afterblowFixedValue: 1,
    });
    expect(buttons.clean).toEqual([{ label: '+1', value: 1, visible: true }]);
  });
});

describe('buildScoringButtons — valuation drives the grid', () => {
  it('fixed: one button per target, defender always the fixed value', () => {
    const buttons = buildScoringButtons({
      ...TF_V1_GRAMMAR,
      targets: [
        { name: 'Head', value: 3 },
        { name: 'Torso', value: 2 },
        { name: 'Limb', value: 1 },
      ],
    });
    expect(buttons.afterblow.map((b) => b.label)).toEqual(['3-1', '2-1', '1-1']);
    expect(buttons.afterblow.every((b) => b.defenderPts === 1)).toBe(true);
  });

  it('fixed: honours a fixed value other than 1', () => {
    const buttons = buildScoringButtons({ ...TF_V1_GRAMMAR, afterblowFixedValue: 2 });
    expect(buttons.afterblow.map((b) => b.label)).toEqual(['2-2', '1-2']);
  });

  it('weighted: the full attacker x defender product', () => {
    const buttons = buildScoringButtons({ ...TF_V1_GRAMMAR, afterblowValuation: 'weighted' });
    expect(buttons.afterblow.map((b) => b.label)).toEqual(['2-2', '2-1', '1-2', '1-1']);
  });

  it('weighted: scales as N squared', () => {
    const buttons = buildScoringButtons({
      ...TF_V1_GRAMMAR,
      afterblowValuation: 'weighted',
      targets: [
        { name: 'Head', value: 3 },
        { name: 'Torso', value: 2 },
        { name: 'Limb', value: 1 },
      ],
    });
    expect(buttons.afterblow).toHaveLength(9);
  });
});

describe('buildScoringButtons — no afterblow', () => {
  it('returns an EMPTY array, never a missing key', () => {
    // An empty array survives ensureButtonArray; a missing key gets
    // DEFAULT_SCORING_CONFIG's 2-1/1-1 pair injected on the next PATCH, handing
    // afterblow buttons to a ruleset that has no afterblow.
    const buttons = buildScoringButtons({ ...TF_V1_GRAMMAR, hasAfterblow: false });
    expect(buttons.afterblow).toEqual([]);
    expect(Array.isArray(buttons.afterblow)).toBe(true);
  });

  it('ignores the valuation entirely when there is no afterblow', () => {
    const buttons = buildScoringButtons({
      ...TF_V1_GRAMMAR,
      hasAfterblow: false,
      afterblowValuation: 'weighted',
    });
    expect(buttons.afterblow).toEqual([]);
  });
});

describe('buildScoringButtons — the scoring pad’s constraints', () => {
  it('never emits an attackerPts the exchange schema would reject', () => {
    // useScoringSubmit sends attackerPts as firstStrikeValue, which
    // createExchangeSchema bounds to 1..10. A 400 there is terminal: the
    // offline queue drops the exchange rather than retrying it.
    for (const valuation of ['fixed', 'weighted'] as const) {
      const buttons = buildScoringButtons({
        targets: [
          { name: 'Head', value: 10 },
          { name: 'Limb', value: 1 },
        ],
        hasAfterblow: true,
        afterblowValuation: valuation,
        afterblowFixedValue: 1,
      });
      for (const button of buttons.afterblow) {
        expect(button.attackerPts).toBeGreaterThanOrEqual(1);
        expect(button.attackerPts).toBeLessThanOrEqual(10);
        expect(button.defenderPts).toBeGreaterThanOrEqual(0);
        expect(button.defenderPts).toBeLessThanOrEqual(10);
      }
      for (const button of buttons.clean) {
        expect(button.value).toBeGreaterThanOrEqual(1);
        expect(button.value).toBeLessThanOrEqual(10);
      }
    }
  });

  it('marks every derived button visible, so a seeded pad is usable immediately', () => {
    const buttons = buildScoringButtons(TF_V1_GRAMMAR);
    expect(buttons.clean.every((b) => b.visible)).toBe(true);
    expect(buttons.afterblow.every((b) => b.visible)).toBe(true);
  });
});
