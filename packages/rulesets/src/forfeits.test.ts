import { describe, expect, it } from 'vitest';
import {
  CLUB_START_FORFEIT_RULES,
  FFAMHE_FORFEIT_RULES,
  type ForfeitRules,
} from '@myclash/types/forfeit-rules';
import {
  BLACK_CARD_REASONS,
  COUNTED_FORFEIT_REASONS,
  FORFEIT_REASONS,
  forfeitOutcomeOf,
  ForfeitReasonSchema,
  ForfeitRulesSchema,
  isOverrideReason,
  OVERRIDE_REASONS,
  type ForfeitReason,
} from './forfeits';

describe('what a forfeit does under the FFAMHE penalty ruleset', () => {
  it.each([
    ['injury', 'keep_current', 6, 'ask'],
    ['voluntary', 'fixed_loss', 6, 'ask'],
    ['conduct_violation', 'fixed_loss', 6, 'disqualified'],
    // A black card's effect on the Fighter is its card rule's: the caller lays it over this.
    ['black_card_1', 'fixed_loss', 6, 'match_only'],
    ['black_card_2', 'fixed_loss', 6, 'match_only'],
  ] as Array<[ForfeitReason, string, number, string]>)(
    'records %s as TF_v1 did before the move',
    (reason, scorePolicy, opponentScore, tournamentState) => {
      expect(forfeitOutcomeOf(FFAMHE_FORFEIT_RULES, reason, 'pool')).toEqual({
        scorePolicy,
        lossScore: 0,
        opponentScore,
        tournamentState,
      });
    },
  );

  it('reads each rule the penalty ruleset sets, for a reason and for a black card', () => {
    const rules: ForfeitRules = {
      ...FFAMHE_FORFEIT_RULES,
      reasons: {
        ...FFAMHE_FORFEIT_RULES.reasons,
        voluntary: { outcome: 'keep_current', opponentScore: 9, fighter: 'withdrawn' },
      },
      blackCardOpponentScore: 11,
    };

    expect(forfeitOutcomeOf(rules, 'voluntary', 'pool')).toEqual({
      scorePolicy: 'keep_current',
      lossScore: 0,
      opponentScore: 9,
      tournamentState: 'withdrawn',
    });
    expect(forfeitOutcomeOf(rules, 'black_card_2', 'pool').opponentScore).toBe(11);
  });

  it('maps "continues" to a bout-only forfeit', () => {
    const rules: ForfeitRules = {
      ...FFAMHE_FORFEIT_RULES,
      reasons: {
        ...FFAMHE_FORFEIT_RULES.reasons,
        injury: { outcome: 'fixed_loss', opponentScore: 6, fighter: 'continues' },
      },
    };

    expect(forfeitOutcomeOf(rules, 'injury', 'pool').tournamentState).toBe('match_only');
  });
});

describe('a reason that counts as a draw (rulings 64, 72)', () => {
  const rules: ForfeitRules = {
    ...CLUB_START_FORFEIT_RULES,
    reasons: {
      ...CLUB_START_FORFEIT_RULES.reasons,
      injury: { outcome: 'draw', opponentScore: 8, fighter: 'continues' },
    },
  };

  it.each(['pool', 'swiss'])('is a draw on a %s bout', (phaseType) => {
    expect(forfeitOutcomeOf(rules, 'injury', phaseType).scorePolicy).toBe('draw');
  });

  it.each(['single_elim', 'double_elim'])(
    'is the reason’s loss on a %s bout, which has no draw',
    (phaseType) => {
      expect(forfeitOutcomeOf(rules, 'injury', phaseType)).toMatchObject({
        scorePolicy: 'fixed_loss',
        lossScore: 0,
        opponentScore: 8,
      });
    },
  );

  it('is a rule the stored shape holds', () => {
    expect(ForfeitRulesSchema.parse(rules)).toEqual(rules);
  });
});

describe('the stored forfeit rules', () => {
  it('both start values are a whole, valid shape', () => {
    expect(ForfeitRulesSchema.parse(FFAMHE_FORFEIT_RULES)).toEqual(FFAMHE_FORFEIT_RULES);
    expect(ForfeitRulesSchema.parse(CLUB_START_FORFEIT_RULES)).toEqual(CLUB_START_FORFEIT_RULES);
    expect(CLUB_START_FORFEIT_RULES.disqualifyAfter).toBe('off');
    expect(FFAMHE_FORFEIT_RULES.disqualifyAfter).toBe(2);
  });

  it.each([
    ['an opponent score of 0', { blackCardOpponentScore: 0 }],
    ['an opponent score of 100', { blackCardOpponentScore: 100 }],
    ['a fractional score', { blackCardOpponentScore: 1.5 }],
    ['"disqualify after" 0', { disqualifyAfter: 0 }],
    ['"disqualify after" 11', { disqualifyAfter: 11 }],
    ['off spelled null', { disqualifyAfter: null }],
    ['a key it does not know', { forfeitDrawsCount: true }],
  ])('refuses %s', (_what, over) => {
    expect(ForfeitRulesSchema.safeParse({ ...FFAMHE_FORFEIT_RULES, ...over }).success).toBe(false);
  });

  it('refuses a reason rule with a key it does not know, or one missing', () => {
    const injury = { ...FFAMHE_FORFEIT_RULES.reasons.injury, lossScore: 0 };
    const reasons = { ...FFAMHE_FORFEIT_RULES.reasons, injury };
    expect(ForfeitRulesSchema.safeParse({ ...FFAMHE_FORFEIT_RULES, reasons }).success).toBe(false);

    const { injury: _gone, ...twoReasons } = FFAMHE_FORFEIT_RULES.reasons;
    const missing = { ...FFAMHE_FORFEIT_RULES, reasons: twoReasons };
    expect(ForfeitRulesSchema.safeParse(missing).success).toBe(false);
  });
});

describe('the forfeits "disqualify after N" counts (rulings 56, 80)', () => {
  it('are the ones the Fighter chose: no black card, no override', () => {
    expect(COUNTED_FORFEIT_REASONS).toEqual(['injury', 'voluntary', 'conduct_violation']);
  });
});

describe('forfeit vs override classification', () => {
  // The guard that keeps a future reason from landing unclassified: every read
  // that counts forfeits filters by FORFEIT_REASONS, so a reason in neither
  // list would be silently invisible to the standings and the exports.
  it('partitions the reason enum exhaustively', () => {
    const classified = [...FORFEIT_REASONS, ...OVERRIDE_REASONS];

    expect([...classified].sort()).toEqual([...ForfeitReasonSchema.options].sort());
    expect(new Set(classified).size).toBe(classified.length);
  });

  it('names a rule for every forfeit reason that is not a black card', () => {
    const ruled = FORFEIT_REASONS.filter(
      (reason) => !(BLACK_CARD_REASONS as readonly string[]).includes(reason),
    );
    expect(Object.keys(FFAMHE_FORFEIT_RULES.reasons).sort()).toEqual([...ruled].sort());
  });

  it.each(FORFEIT_REASONS)('treats %s as a forfeit', (reason) => {
    expect(isOverrideReason(reason)).toBe(false);
  });

  it.each(OVERRIDE_REASONS)('treats %s as an override', (reason) => {
    expect(isOverrideReason(reason)).toBe(true);
  });

  it('reads an unknown reason as a forfeit, not an override', () => {
    // Direction matters: an unrecognised value must not gain the override's
    // exemption from the DQ counters and the HEMA Ratings exclusion.
    expect(isOverrideReason('something_else')).toBe(false);
  });

  it.each(OVERRIDE_REASONS)('gives %s an explicit, state-neutral outcome', (reason) => {
    const outcome = forfeitOutcomeOf(FFAMHE_FORFEIT_RULES, reason, 'pool');

    expect(outcome.scorePolicy).toBe('explicit');
    expect(outcome.tournamentState).toBe('match_only');
  });
});
