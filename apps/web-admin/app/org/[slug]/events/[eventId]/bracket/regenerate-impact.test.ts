import { describe, expect, it } from 'vitest';
import { countPlayedMatches } from './regenerate-impact';

describe('countPlayedMatches', () => {
  it('counts running, paused and completed bouts', () => {
    expect(
      countPlayedMatches([
        { status: 'running', matchId: 'm1' },
        { status: 'paused', matchId: 'm2' },
        { status: 'completed', matchId: 'm3' },
      ]),
    ).toBe(3);
  });

  it('ignores what a regenerate costs nothing to lose', () => {
    expect(
      countPlayedMatches([
        { status: 'scheduled', matchId: 'm1' },
        { status: 'voided', matchId: 'm2' },
        // A slot the generator emitted but nothing was ever created for.
        { status: 'scheduled', matchId: null },
      ]),
    ).toBe(0);
  });

  it('does not count a status with no match row behind it', () => {
    // The API defaults `status` to 'scheduled' for a slot with no match, but a
    // stale or hand-built payload must not inflate a destruction warning.
    expect(countPlayedMatches([{ status: 'completed', matchId: null }])).toBe(0);
  });

  it('counts a 0-0 finish, which has no score to notice it by', () => {
    // Scoped on status rather than on a score: a double-defeat ends 0-0 and is
    // absolutely a bout that was fought.
    expect(countPlayedMatches([{ status: 'completed', matchId: 'm1' }])).toBe(1);
  });

  it('answers zero for an absent or empty slot list', () => {
    expect(countPlayedMatches(undefined)).toBe(0);
    expect(countPlayedMatches(null)).toBe(0);
    expect(countPlayedMatches([])).toBe(0);
  });
});
