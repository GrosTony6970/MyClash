import { describe, expect, it } from 'vitest';
import { FFAMHE_FORFEIT_RULES, type ForfeitRulesInForce } from '@myclash/types/forfeit-rules';
import { editedForm, isChanged, resetLeaf, withoutLeaf } from './forfeit-leaves';

const RULESET: ForfeitRulesInForce = {
  ...FFAMHE_FORFEIT_RULES,
  firstBlackCard: 'match',
  secondBlackCard: 'tournament',
};
const INJURY_SCORE = ['reasons', 'injury', 'opponentScore'] as const;
const withInjuryScore = (opponentScore: number): ForfeitRulesInForce => ({
  ...RULESET,
  reasons: { ...RULESET.reasons, injury: { ...RULESET.reasons.injury, opponentScore } },
});
const NOTHING_SAVED = { ruleset: RULESET, saved: null };

describe('a Tournament’s forfeit form, leaf by leaf', () => {
  it('sets only the leaf a field moved', () => {
    expect(editedForm(null, RULESET, withInjuryScore(41), NOTHING_SAVED)).toEqual({
      reasons: { injury: { opponentScore: 41 } },
    });
    expect(
      editedForm(null, RULESET, { ...RULESET, secondBlackCard: 'none' }, NOTHING_SAVED),
    ).toEqual({ secondBlackCard: 'none' });
  });

  it('removes an edit moved back to the ruleset’s value by hand, unless the Tournament stores it', () => {
    const edited = { reasons: { injury: { opponentScore: 41 } } };

    expect(editedForm(edited, withInjuryScore(41), RULESET, NOTHING_SAVED)).toBeNull();
    // A stored change set to the ruleset's value is an override all the same (test 7).
    const saved = { ruleset: RULESET, saved: edited };
    expect(editedForm(edited, withInjuryScore(41), RULESET, saved)).toEqual({
      reasons: { injury: { opponentScore: 6 } },
    });
  });

  it('keeps a Reset not yet saved when another field is edited', () => {
    const saved = { disqualifyAfter: 4 };
    const form = { disqualifyAfter: null };

    expect(editedForm(form, RULESET, withInjuryScore(41), { ruleset: RULESET, saved })).toEqual({
      disqualifyAfter: null,
      reasons: { injury: { opponentScore: 41 } },
    });
  });

  it('resets a saved leaf to null, which the save sends', () => {
    const saved = { reasons: { injury: { opponentScore: 41 } } };
    const form = resetLeaf(saved, saved, INJURY_SCORE);

    expect(form).toEqual({ reasons: { injury: { opponentScore: null } } });
    expect(isChanged(form, INJURY_SCORE)).toBe(false);
  });

  it('removes an unsaved leaf and the parents it empties, so the form is as read', () => {
    const edited = { reasons: { injury: { opponentScore: 41 } } };

    expect(resetLeaf(edited, null, INJURY_SCORE)).toBeNull();
    expect(withoutLeaf({ ...edited, disqualifyAfter: 'off' }, INJURY_SCORE)).toEqual({
      disqualifyAfter: 'off',
    });
  });

  it('shows the badge for a change equal to the ruleset’s value (test 7)', () => {
    expect(isChanged({ disqualifyAfter: 2 }, ['disqualifyAfter'])).toBe(true);
  });
});
