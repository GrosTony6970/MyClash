import { describe, expect, it } from 'vitest';
import { shouldCollapseEmptySections } from './should-collapse-empty-sections';

const EMPTY = { live: 0, published: 0, past: 0 };

describe('shouldCollapseEmptySections', () => {
  it('collapses when the platform holds nothing and no filter is active', () => {
    expect(shouldCollapseEmptySections(EMPTY, false)).toBe(true);
  });

  it('does NOT collapse a filtered search that matched nothing', () => {
    // The per-section messages carry the query ("no live events match 'x'").
    // One generic card would drop it and read as an empty platform.
    expect(shouldCollapseEmptySections(EMPTY, true)).toBe(false);
  });

  it('does not collapse when any single section has events', () => {
    expect(shouldCollapseEmptySections({ ...EMPTY, live: 1 }, false)).toBe(false);
    expect(shouldCollapseEmptySections({ ...EMPTY, published: 1 }, false)).toBe(false);
    expect(shouldCollapseEmptySections({ ...EMPTY, past: 1 }, false)).toBe(false);
  });

  it('does not collapse when only past events remain', () => {
    // A platform whose events are all over is not a new platform, and telling
    // its visitors there is nothing here would be false -- the results are the
    // most linkable content it has.
    expect(shouldCollapseEmptySections({ live: 0, published: 0, past: 12 }, false)).toBe(false);
  });
});
