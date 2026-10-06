import { describe, it, expect } from 'vitest';
import { forfeitEndReason, endedByForfeitRecord } from './forfeit-end-reason';

describe('endedByForfeitRecord (ruling 322)', () => {
  it.each(['injury', 'black_card_2', 'admin_correction'])(
    'a bout that a %s record completed holds that result',
    (reason) => {
      const bout = { status: 'completed', end_reason: forfeitEndReason(reason) };
      expect(endedByForfeitRecord(bout)).toBe(true);
    },
  );

  it.each(['first_to_points', 'time_limit', 'max_doubles', null, undefined, 'constructor'])(
    'a bout that ended with the reason %s follows its sheet',
    (end_reason) => {
      expect(endedByForfeitRecord({ status: 'completed', end_reason })).toBe(false);
    },
  );

  it.each(['scheduled', 'running', 'paused', 'voided'])(
    'a %s bout follows its sheet whatever reason its row still carries',
    (status) => {
      expect(endedByForfeitRecord({ status, end_reason: 'forfeit' })).toBe(false);
    },
  );
});

describe('forfeitEndReason', () => {
  it('maps a first black card to black_card', () => {
    expect(forfeitEndReason('black_card_1')).toBe('black_card');
  });

  it('maps a second black card to black_card', () => {
    expect(forfeitEndReason('black_card_2')).toBe('black_card');
  });

  it('maps a non-black-card forfeit reason to forfeit', () => {
    expect(forfeitEndReason('injury')).toBe('forfeit');
    expect(forfeitEndReason('voluntary')).toBe('forfeit');
    expect(forfeitEndReason('conduct_violation')).toBe('forfeit');
  });
});
