import { describe, expect, it } from 'vitest';
import { poolMatchWinner } from './pool-match-winner';

describe('poolMatchWinner', () => {
  it('returns red when a completed match has red ahead', () => {
    expect(poolMatchWinner({ status: 'completed', redScore: 3, blueScore: 1 })).toBe('red');
  });

  it('returns blue when a completed match has blue ahead', () => {
    expect(poolMatchWinner({ status: 'completed', redScore: 1, blueScore: 3 })).toBe('blue');
  });

  it('returns null for a completed tie (no winner)', () => {
    expect(poolMatchWinner({ status: 'completed', redScore: 2, blueScore: 2 })).toBeNull();
  });

  it('returns null for a non-completed match, even with a score differential', () => {
    expect(poolMatchWinner({ status: 'scheduled', redScore: 3, blueScore: 0 })).toBeNull();
  });

  it('treats null scores as zero', () => {
    expect(poolMatchWinner({ status: 'completed', redScore: 1, blueScore: null })).toBe('red');
    expect(poolMatchWinner({ status: 'completed', redScore: null, blueScore: null })).toBeNull();
  });
});
