/**
 * A bout's copy of its rules, as a `matches` read embeds it (`bout-rules.ts`): what every scoring
 * reader decides with. A bout with no copy is a fault, refused loudly: scored with its
 * Tournament's rules of now, it would be decided by rules it never started under.
 */
import { describe, expect, it } from 'vitest';
import { afterblowModeOf, boutRulesOf, cardPinOf } from './bout-rules';

const COPY = {
  ruleset_config: { matchFormat: { pointCap: 5 } },
  scoring_config_json: { afterblowMode: 'deductive' },
  penalty_ruleset_id: 'cards-a',
};

describe('boutRulesOf', () => {
  it('reads the copy the bout row embeds, as an object or a list of one', () => {
    const want = {
      rulesetConfig: COPY.ruleset_config,
      scoringConfig: COPY.scoring_config_json,
    };
    expect(boutRulesOf({ id: 'm1', match_rules: COPY })).toEqual(want);
    expect(boutRulesOf({ id: 'm1', match_rules: [COPY] })).toEqual(want);
  });

  it('reads a copy with no settings as none set', () => {
    expect(
      boutRulesOf({ id: 'm1', match_rules: { ruleset_config: null, scoring_config_json: null } }),
    ).toEqual({ rulesetConfig: {}, scoringConfig: {} });
  });

  it('refuses a bout that holds no copy, naming it', () => {
    expect(() => boutRulesOf({ id: 'm1', match_rules: null })).toThrow(
      'Bout m1 holds no copy of its rules',
    );
    expect(() => boutRulesOf({ id: 'm1', match_rules: [] })).toThrow('Bout m1');
  });
});

describe('afterblowModeOf', () => {
  it('nets an afterblow only when the copy says deductive', () => {
    expect(afterblowModeOf(boutRulesOf({ id: 'm1', match_rules: COPY }))).toBe('deductive');
    expect(afterblowModeOf({ rulesetConfig: {}, scoringConfig: {} })).toBe('full');
    expect(afterblowModeOf({ rulesetConfig: {}, scoringConfig: { afterblowMode: 'x' } })).toBe(
      'full',
    );
  });
});

describe('cardPinOf', () => {
  it('reads the card rules the copy pins, and none as none (the built-in)', () => {
    expect(cardPinOf({ id: 'm1', match_rules: COPY })).toBe('cards-a');
    expect(cardPinOf({ id: 'm1', match_rules: { penalty_ruleset_id: null } })).toBeNull();
  });

  it('refuses a bout that holds no copy, naming it', () => {
    expect(() => cardPinOf({ id: 'm1' })).toThrow('Bout m1 holds no copy of its rules');
  });
});
