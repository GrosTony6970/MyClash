import { describe, expect, it } from 'vitest';
import { CLUB_START_FORFEIT_RULES, forfeitAsksOf, forfeitQuestion } from './forfeit-rules';

const ASKS = { injury: true, voluntary: false, conduct_violation: false };

describe('which reasons ask (the answer of `/match-config`)', () => {
  it('is each reason whose rule asks, and no other', () => {
    const rules = {
      ...CLUB_START_FORFEIT_RULES,
      reasons: {
        injury: { outcome: 'keep_current' as const, opponentScore: 6, fighter: 'asks' as const },
        voluntary: {
          outcome: 'fixed_loss' as const,
          opponentScore: 6,
          fighter: 'withdrawn' as const,
        },
        conduct_violation: {
          outcome: 'fixed_loss' as const,
          opponentScore: 6,
          fighter: 'continues' as const,
        },
      },
    };
    expect(forfeitAsksOf(rules)).toEqual(ASKS);
  });
});

describe('"can the Fighter continue?" on the pad (ruling 76)', () => {
  it('is asked for a reason whose rule asks, on a Pool or Swiss bout', () => {
    for (const phase of ['pool', 'swiss']) {
      expect(forfeitQuestion('injury', ASKS, phase)).toEqual({ ask: true, unconfirmed: false });
      expect(forfeitQuestion('voluntary', ASKS, phase)).toEqual({ ask: false, unconfirmed: false });
    }
  });

  it('is never asked on a bracket bout, nor for a black card', () => {
    const all = { injury: true, voluntary: true, conduct_violation: true };
    expect(forfeitQuestion('injury', all, 'single_elim').ask).toBe(false);
    expect(forfeitQuestion('injury', all, 'double_elim').ask).toBe(false);
    expect(forfeitQuestion('black_card_1', null, 'pool')).toEqual({
      ask: false,
      unconfirmed: false,
    });
  });

  it('is asked on a bout whose phase the pad does not know', () => {
    expect(forfeitQuestion('injury', ASKS, null).ask).toBe(true);
    expect(forfeitQuestion('injury', ASKS, undefined).ask).toBe(true);
  });

  it('is asked with no note while the rules are read, and with one when there is no answer', () => {
    expect(forfeitQuestion('conduct_violation', undefined, 'pool')).toEqual({
      ask: true,
      unconfirmed: false,
    });
    expect(forfeitQuestion('conduct_violation', null, 'pool')).toEqual({
      ask: true,
      unconfirmed: true,
    });
  });
});
