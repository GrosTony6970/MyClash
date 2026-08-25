/**
 * packages/rulesets/src/ruleset-grammar.test.ts
 *
 * Afterblow is a property of the RULESET, not of the string 'TF_v1'.
 *
 * Every ruleset must answer `hasAfterblow` so the tournament UI can stop
 * hardcoding one federation's grammar. The trap this file guards is that
 * `createFormulaRuleset` used to return no `metadata` at all: driving UI off
 * `metadata.hasAfterblow` would then read `undefined` and hide afterblow for
 * precisely the org-authored rulesets self-service exists to serve.
 */
import { describe, expect, it } from 'vitest';
import { TF_v1 } from './tf_v1';
import { Generic_PointsCap } from './generic_points_cap';
import { createFormulaRuleset } from './formula/ruleset';
import { DEFAULT_FORMULA_CONSTANTS, type FormulaConfig } from './formula/types';
import type { ScoredMatch } from './types';

const config: FormulaConfig = {
  scoreFormula: { type: 'var', name: 'victories' },
  constants: DEFAULT_FORMULA_CONSTANTS,
  tiebreakers: [],
};

describe('every ruleset declares its grammar', () => {
  it('TF_v1 has afterblow, defaulting to deductive', () => {
    expect(TF_v1.metadata?.hasAfterblow).toBe(true);
    // FFAMHE nets the retaliation against the attacker (deductive).
    expect(TF_v1.metadata?.defaultAfterblowMode).toBe('deductive');
    expect(TF_v1.metadata?.targets).toEqual([
      { name: 'Deep', value: 2 },
      { name: 'Shallow', value: 1 },
    ]);
  });

  it('Generic_PointsCap has no afterblow and one undifferentiated target', () => {
    expect(Generic_PointsCap.metadata?.hasAfterblow).toBe(false);
    expect(Generic_PointsCap.metadata?.defaultAfterblowMode).toBe(null);
    expect(Generic_PointsCap.metadata?.targets).toEqual([{ name: 'Hit', value: 1 }]);
  });

  it('a formula ruleset always carries metadata — never undefined', () => {
    const ruleset = createFormulaRuleset('custom_x', '1.0.0', 'Custom', config);
    expect(ruleset.metadata).toBeDefined();
    // Not `undefined`: a UI reading this must get a definite answer.
    expect(ruleset.metadata?.hasAfterblow).toBe(false);
  });

  it('renders the authored AST into a display scoreFormula (was null)', () => {
    const ruleset = createFormulaRuleset('custom_x', '1.0.0', 'Custom', {
      scoreFormula: {
        type: 'binop',
        op: '/',
        left: {
          type: 'binop',
          op: '*',
          left: { type: 'var', name: 'victories' },
          right: { type: 'var', name: 'pointsPerVictory' },
        },
        right: {
          type: 'binop',
          op: '+',
          left: { type: 'var', name: 'hitsReceived' },
          right: { type: 'var', name: 'doublePenalty' },
        },
      },
      constants: DEFAULT_FORMULA_CONSTANTS,
      tiebreakers: [],
    });
    expect(ruleset.metadata?.scoreFormula).toBe(
      'victories * pointsPerVictory / (hitsReceived + doublePenalty)',
    );
  });

  it('defaults preserve current behaviour for a row predating the columns', () => {
    // The UI gates afterblow on rulesetCode === 'TF_v1' today, so a custom
    // ruleset has never been offered afterblow controls. `false` keeps it that
    // way rather than silently switching on a new surface at deploy.
    const ruleset = createFormulaRuleset('custom_x', '1.0.0', 'Custom', config, null);
    expect(ruleset.metadata?.hasAfterblow).toBe(false);
    expect(ruleset.metadata?.defaultAfterblowMode).toBe(null);
    expect(ruleset.metadata?.targets).toBe(null);
  });

  it('declares an authored grammar when the row provides one', () => {
    const ruleset = createFormulaRuleset('custom_x', '1.0.0', 'Custom', config, {
      hasAfterblow: true,
      defaultAfterblowMode: 'deductive',
      targets: [
        { name: 'Head', value: 3 },
        { name: 'Body', value: 1 },
      ],
    });
    expect(ruleset.metadata?.hasAfterblow).toBe(true);
    expect(ruleset.metadata?.defaultAfterblowMode).toBe('deductive');
    expect(ruleset.metadata?.targets).toHaveLength(2);
  });

  it('reports no afterblow mode when the ruleset has no afterblow', () => {
    // A mode without the concept is meaningless, and would seed a tournament
    // with a setting its own grammar cannot produce.
    const ruleset = createFormulaRuleset('custom_x', '1.0.0', 'Custom', config, {
      hasAfterblow: false,
      defaultAfterblowMode: 'deductive',
    });
    expect(ruleset.metadata?.defaultAfterblowMode).toBe(null);
  });
});

describe('defaultAfterblowMode is a seed, never a runtime input', () => {
  // One afterblow: red struck for 2, blue retaliated for 1.
  const bout: ScoredMatch = {
    id: 'm1',
    redRegistrationId: 'r1',
    blueRegistrationId: 'r2',
    winnerRegistrationId: 'r1',
    endReason: null,
    exchanges: [
      {
        id: 'e1',
        clientUuid: 'e1',
        matchId: 'm1',
        sequence: 1,
        type: 'afterblow',
        occurredAt: '',
        firstStrikerColor: 'red',
        firstStrikeValue: 2,
        afterblowValue: 1,
        noExchangeReason: null,
        voided: false,
      },
    ],
  };

  /** score = hitsGiven, so the netted target points ARE the score. */
  const hitsGivenRuleset = (defaultAfterblowMode: 'full' | 'deductive') =>
    createFormulaRuleset(
      'custom_x',
      '1.0.0',
      'Custom',
      { ...config, scoreFormula: { type: 'var', name: 'hitsGiven' } },
      { hasAfterblow: true, defaultAfterblowMode },
    );

  it('scores by the TOURNAMENT mode it is handed, not the ruleset default', () => {
    // Exchanges store RAW button values and are netted at read. If the engine
    // preferred the ruleset's default over the tournament's live mode, editing
    // a ruleset would retroactively rewrite every score derived under it.
    //
    // The ruleset here declares 'full'. The tournament says 'deductive', and
    // deductive is what must win: attacker keeps 2 - 1 = 1, defender gets 0.
    const scores = hitsGivenRuleset('full').scorePoolFighters({
      registrationIds: ['r1', 'r2'],
      completedMatches: [bout],
      afterblowMode: 'deductive',
      config: {},
    });
    expect(scores.get('r1')).toBe(1);
    expect(scores.get('r2')).toBe(0);
  });

  it('and the other way round, so neither answer is the accidental one', () => {
    // The ruleset declares 'deductive' and the tournament says 'full'. Under
    // full both sides keep what they landed. Asserting only the case above
    // would pass even if the mode were ignored and 'deductive' hardcoded.
    const scores = hitsGivenRuleset('deductive').scorePoolFighters({
      registrationIds: ['r1', 'r2'],
      completedMatches: [bout],
      afterblowMode: 'full',
      config: {},
    });
    expect(scores.get('r1')).toBe(2);
    expect(scores.get('r2')).toBe(1);
  });
});
