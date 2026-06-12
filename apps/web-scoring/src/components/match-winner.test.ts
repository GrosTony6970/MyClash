import { describe, expect, it } from 'vitest';
import { matchWinnerSide } from './match-winner';

describe('matchWinnerSide', () => {
  it('returns the side with the highest score, null on a tie', () => {
    expect(matchWinnerSide(4, 1)).toBe('red');
    expect(matchWinnerSide(1, 4)).toBe('blue');
    expect(matchWinnerSide(3, 3)).toBeNull();
    expect(matchWinnerSide(0, 0)).toBeNull();
  });
});
