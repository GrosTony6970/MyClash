import { describe, expect, it } from 'vitest';
import { countPoolFighters } from './count-pool-fighters';

describe('countPoolFighters', () => {
  it('returns the distinct fighter count for a 4-fighter Berger pool (6 matches)', () => {
    // 4-fighter round-robin: every fighter plays every other once = 6 matches.
    // Each fighter appears in 3 matches, half red / half blue depending on Berger.
    const matches = [
      { red_registration_id: 'a', blue_registration_id: 'b' },
      { red_registration_id: 'c', blue_registration_id: 'd' },
      { red_registration_id: 'a', blue_registration_id: 'c' },
      { red_registration_id: 'd', blue_registration_id: 'b' },
      { red_registration_id: 'a', blue_registration_id: 'd' },
      { red_registration_id: 'b', blue_registration_id: 'c' },
    ];
    expect(countPoolFighters(matches)).toBe(4);
  });

  it('skips null sides so bye / unseeded slots do not inflate the count', () => {
    const matches = [
      { red_registration_id: 'a', blue_registration_id: 'b' },
      { red_registration_id: 'a', blue_registration_id: null },
      { red_registration_id: null, blue_registration_id: 'b' },
    ];
    expect(countPoolFighters(matches)).toBe(2);
  });

  it('returns 0 for an empty match list', () => {
    expect(countPoolFighters([])).toBe(0);
  });
});
