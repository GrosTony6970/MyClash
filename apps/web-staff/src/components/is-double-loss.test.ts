import { describe, it, expect } from 'vitest';
import { isDoubleLoss } from './is-double-loss';

describe('isDoubleLoss', () => {
  it('is true for a completed bout the server ended as a loss for both', () => {
    expect(isDoubleLoss('completed', 'max_doubles')).toBe(true);
  });

  /**
   * The doubles chip counts hits still queued on the tablet, so the referee
   * sees the limit coming while offline. The banner never reads that count: a
   * bout still being fought has no end reason, and its status says so.
   */
  it('is false while the bout is still fought, whatever its reason reads', () => {
    expect(isDoubleLoss('running', 'max_doubles')).toBe(false);
    expect(isDoubleLoss('paused', null)).toBe(false);
  });

  it('is false for a bout at the doubles limit that is no loss for both', () => {
    // The organiser's two other outcomes: a draw, and a result that stands.
    expect(isDoubleLoss('completed', 'max_doubles_draw')).toBe(false);
    expect(isDoubleLoss('completed', 'max_doubles_result_stands')).toBe(false);
  });

  it('is false for a best-of bout whose rounds ran out, and for any other end', () => {
    expect(isDoubleLoss('completed', 'rounds_spent')).toBe(false);
    expect(isDoubleLoss('completed', 'first_to_points')).toBe(false);
    expect(isDoubleLoss('completed', null)).toBe(false);
    expect(isDoubleLoss('completed', undefined)).toBe(false);
  });
});
