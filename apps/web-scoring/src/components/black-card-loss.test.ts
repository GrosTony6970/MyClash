import { describe, it, expect } from 'vitest';
import { blackCardLossRegistrationId } from './black-card-loss';
import type { MatchPenalty } from '../hooks/usePenalties';

function penalty(p: Partial<MatchPenalty>): MatchPenalty {
  return {
    id: 'p1',
    sequence: 1,
    registration_id: 'reg-x',
    card: 'yellow',
    source: 'ruleset',
    short_name: null,
    reason: null,
    score_delta: 0,
    causes_match_forfeit: false,
    voided: false,
    ...p,
  };
}

describe('blackCardLossRegistrationId', () => {
  it('returns the carded fighter when a black card ended the match', () => {
    const penalties = [
      penalty({ card: 'yellow', registration_id: 'reg-a' }),
      penalty({ card: 'black', registration_id: 'reg-b' }),
    ];
    expect(blackCardLossRegistrationId('black_card', penalties)).toBe('reg-b');
  });

  it('returns null when the match did not end on a black card', () => {
    const penalties = [penalty({ card: 'black', registration_id: 'reg-b' })];
    expect(blackCardLossRegistrationId('max_doubles', penalties)).toBeNull();
    expect(blackCardLossRegistrationId(null, penalties)).toBeNull();
  });

  it('ignores a voided black card', () => {
    const penalties = [penalty({ card: 'black', registration_id: 'reg-b', voided: true })];
    expect(blackCardLossRegistrationId('black_card', penalties)).toBeNull();
  });
});
