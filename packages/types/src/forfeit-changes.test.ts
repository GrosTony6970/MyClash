import { describe, expect, it } from 'vitest';
import {
  applyForfeitPatch,
  FFAMHE_FORFEIT_RULES,
  mergeForfeitRules,
  type ForfeitChanges,
  type ForfeitRulesInForce,
} from './forfeit-rules';

/**
 * A Tournament's changes of its forfeit rules (ruling 65): stored as the keys it changed, saved as
 * a patch whose `null` leaf is a Reset, and laid over the ruleset's rules by one merge.
 */

const RULESET: ForfeitRulesInForce = {
  ...FFAMHE_FORFEIT_RULES,
  firstBlackCard: 'match',
  secondBlackCard: 'tournament',
};

const STORED: ForfeitChanges = {
  reasons: { injury: { fighter: 'withdrawn', opponentScore: 9 } },
  disqualifyAfter: 'off',
};

describe('applyForfeitPatch', () => {
  it('sets what is sent and keeps what is not', () => {
    expect(applyForfeitPatch(STORED, { blackCardOpponentScore: 11 })).toEqual({
      ...STORED,
      blackCardOpponentScore: 11,
    });
    expect(applyForfeitPatch(null, { reasons: { voluntary: { fighter: 'continues' } } })).toEqual({
      reasons: { voluntary: { fighter: 'continues' } },
    });
  });

  it('deletes a leaf sent as null, and leaves no parent it emptied', () => {
    expect(applyForfeitPatch(STORED, { reasons: { injury: { fighter: null } } })).toEqual({
      reasons: { injury: { opponentScore: 9 } },
      disqualifyAfter: 'off',
    });
    const resetInjury = { reasons: { injury: { fighter: null, opponentScore: null } } };
    expect(applyForfeitPatch(STORED, resetInjury)).toEqual({ disqualifyAfter: 'off' });
  });

  it('answers null once nothing is left: the Tournament changes nothing', () => {
    const resetAll = {
      reasons: { injury: { fighter: null, opponentScore: null } },
      disqualifyAfter: null,
    };
    expect(applyForfeitPatch(STORED, resetAll)).toBeNull();
    expect(applyForfeitPatch(null, { disqualifyAfter: null })).toBeNull();
  });
});

describe('mergeForfeitRules', () => {
  it('lays the changes over the ruleset, key by key', () => {
    const merged = mergeForfeitRules(RULESET, { ...STORED, secondBlackCard: 'match' });

    expect(merged.reasons.injury).toEqual({
      outcome: 'keep_current',
      opponentScore: 9,
      fighter: 'withdrawn',
    });
    expect(merged.reasons.voluntary).toEqual(RULESET.reasons.voluntary);
    expect(merged.disqualifyAfter).toBe('off');
    expect(merged.secondBlackCard).toBe('match');
    expect(merged.firstBlackCard).toBe('match');
  });

  it('reads a null leaf, a Reset not yet saved, as the ruleset’s', () => {
    const merged = mergeForfeitRules(RULESET, { disqualifyAfter: null, firstBlackCard: null });

    expect(merged).toEqual(RULESET);
    expect(mergeForfeitRules(RULESET, null)).toEqual(RULESET);
  });
});
