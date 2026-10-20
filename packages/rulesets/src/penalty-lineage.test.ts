import { describe, expect, it } from 'vitest';
import { FFAMHE_FORFEIT_RULES } from '@myclash/types/forfeit-rules';
import { diffPenaltyBucket, projectPenaltyBucketFromLive } from './penalty-lineage';
import type { PenaltyBehaviourInput } from './content-hash';

const BASE: PenaltyBehaviourInput = {
  accumulationScope: 'match',
  yellowCardPoints: 0,
  redCardPoints: 1,
  blackCardPoints: 3,
  firstBlackCardForfeit: 'match',
  secondBlackCardForfeit: 'tournament',
  forfeitRules: FFAMHE_FORFEIT_RULES,
  entries: [
    { groupNumber: 1, refNumber: '1', sanctions: ['yellow', 'red', 'black'] },
    { groupNumber: 2, refNumber: '2', sanctions: ['red', 'black'] },
  ],
};

const clone = (o: PenaltyBehaviourInput): PenaltyBehaviourInput => JSON.parse(JSON.stringify(o));

describe('diffPenaltyBucket', () => {
  it('is unchanged for an identical definition', () => {
    expect(diffPenaltyBucket(BASE, clone(BASE))).toBe('unchanged');
  });

  it('changes when a card point changes', () => {
    const fork = clone(BASE);
    fork.redCardPoints = 2;
    expect(diffPenaltyBucket(BASE, fork)).toBe('changed');
  });

  it('changes when the accumulation scope changes', () => {
    const fork = clone(BASE);
    fork.accumulationScope = 'tournament';
    expect(diffPenaltyBucket(BASE, fork)).toBe('changed');
  });

  it('changes when a black-card forfeit scope changes', () => {
    const fork = clone(BASE);
    fork.firstBlackCardForfeit = 'tournament';
    expect(diffPenaltyBucket(BASE, fork)).toBe('changed');
  });

  it('changes when a forfeit rule changes (rulings 63-76)', () => {
    const fork = clone(BASE);
    fork.forfeitRules = { ...FFAMHE_FORFEIT_RULES, disqualifyAfter: 'off' };
    expect(diffPenaltyBucket(BASE, fork)).toBe('changed');
  });

  it('changes when a sanction ladder is reordered (escalation order is behaviour)', () => {
    const fork = clone(BASE);
    fork.entries = [
      { groupNumber: 1, refNumber: '1', sanctions: ['red', 'yellow', 'black'] },
      { groupNumber: 2, refNumber: '2', sanctions: ['red', 'black'] },
    ];
    expect(diffPenaltyBucket(BASE, fork)).toBe('changed');
  });

  it('is unchanged when entries are merely reordered (canonical sorts by group/ref)', () => {
    const fork = clone(BASE);
    fork.entries = [
      { groupNumber: 2, refNumber: '2', sanctions: ['red', 'black'] },
      { groupNumber: 1, refNumber: '1', sanctions: ['yellow', 'red', 'black'] },
    ];
    expect(diffPenaltyBucket(BASE, fork)).toBe('unchanged');
  });

  it('treats both-absent as unchanged and one-absent as changed', () => {
    expect(diffPenaltyBucket(null, null)).toBe('unchanged');
    expect(diffPenaltyBucket(BASE, null)).toBe('changed');
    expect(diffPenaltyBucket(null, BASE)).toBe('changed');
  });
});

describe('projectPenaltyBucketFromLive', () => {
  it('maps snake_case parent + embedded entries, coercing ref_number to string', () => {
    const row = {
      accumulation_scope: 'tournament',
      yellow_card_points: 0,
      red_card_points: 1,
      black_card_points: 3,
      first_black_card_forfeit: 'match',
      second_black_card_forfeit: 'tournament',
      forfeit_rules: FFAMHE_FORFEIT_RULES,
      penalty_ruleset_entries: [{ group_number: 1, ref_number: 1, sanctions: ['yellow', 'red'] }],
    };
    expect(projectPenaltyBucketFromLive(row)).toEqual({
      accumulationScope: 'tournament',
      yellowCardPoints: 0,
      redCardPoints: 1,
      blackCardPoints: 3,
      firstBlackCardForfeit: 'match',
      secondBlackCardForfeit: 'tournament',
      forfeitRules: FFAMHE_FORFEIT_RULES,
      entries: [{ groupNumber: 1, refNumber: '1', sanctions: ['yellow', 'red'] }],
    });
  });

  it('applies the parent-field defaults when columns are absent', () => {
    const out = projectPenaltyBucketFromLive({});
    expect(out.accumulationScope).toBe('match');
    expect(out.yellowCardPoints).toBe(0);
    expect(out.firstBlackCardForfeit).toBe('match');
    expect(out.secondBlackCardForfeit).toBe('tournament');
    expect(out.entries).toEqual([]);
  });
});
