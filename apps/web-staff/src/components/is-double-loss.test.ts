import { describe, it, expect } from 'vitest';
import { isDoubleLoss } from './is-double-loss';

describe('isDoubleLoss', () => {
  it('is true for a completed match that reached the double cap', () => {
    expect(isDoubleLoss('completed', 4, 4)).toBe(true);
  });

  it('is true when doubles exceed the cap (defensive ≥, not ===)', () => {
    expect(isDoubleLoss('completed', 5, 4)).toBe(true);
  });

  /**
   * Load-bearing beyond its original purpose. The double-count chip now
   * includes hits still queued on the tablet, so the referee can see the cap
   * coming while offline — and that is only safe BECAUSE this predicate refuses
   * to fire on a bout still being fought. A refactor that dropped the status
   * gate would let a provisional count declare a DOUBLE LOSS mid-bout.
   */
  it('is false while the match is still running, even at the cap', () => {
    expect(isDoubleLoss('running', 4, 4)).toBe(false);
    expect(isDoubleLoss('scheduled', 9, 4)).toBe(false);
  });

  it('is false for a completed match below the cap (a normal point-cap win)', () => {
    expect(isDoubleLoss('completed', 3, 4)).toBe(false);
  });

  it('is false when there is no double cap configured', () => {
    expect(isDoubleLoss('completed', 9, null)).toBe(false);
  });
});
