import { describe, expect, it } from 'vitest';
import { kindInForce, storedKind } from './tournament-kind';

/**
 * The kind a read Tournament row holds. A Pool of Team Longsword writes its seats and bouts in the
 * team columns because its read says `team`. A read whose select forgot `entrant_kind` must not
 * pass for an individual Tournament: its team bouts would be remade from null Registration ids.
 */
describe('storedKind', () => {
  it('gives the kind the row holds', () => {
    expect(storedKind('team')).toBe('team');
    expect(storedKind('individual')).toBe('individual');
  });

  it('throws on a missing column, a missing row, or any other value', () => {
    for (const value of [undefined, null, '', 'Team', 42]) {
      expect(() => storedKind(value)).toThrow("The Tournament's kind was not read");
    }
  });

  it('is not the save path: a body with no kind keeps the stored one there', () => {
    expect(kindInForce(undefined, {})).toBe('individual');
  });
});
