import { describe, expect, it } from 'vitest';
import { parseHashTab } from './parse-hash-tab';

const KNOWN = ['configure', 'matches', 'standings', 'referees'] as const;

describe('parseHashTab', () => {
  it('returns the top-level tab when the hash carries inner state (the bug case)', () => {
    expect(parseHashTab('#standings-by-pool', KNOWN)).toBe('standings');
  });

  it('returns the tab unchanged for a plain hash', () => {
    expect(parseHashTab('#standings', KNOWN)).toBe('standings');
  });

  it('returns null when nothing matches so callers pick the fallback', () => {
    expect(parseHashTab('#mystery', KNOWN)).toBeNull();
  });

  it('returns null for an empty hash', () => {
    expect(parseHashTab('', KNOWN)).toBeNull();
  });

  it('accepts hashes without the leading #', () => {
    expect(parseHashTab('standings-overall', KNOWN)).toBe('standings');
  });
});
