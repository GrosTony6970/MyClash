import { describe, expect, it } from 'vitest';
import { rosterReadOnOpen } from './roster-read';

describe('rosterReadOnOpen', () => {
  it('reads a roster never read', () => {
    expect(rosterReadOnOpen({ roster: null, failed: false, reading: false })).toBe(true);
  });

  it('reads again after a failed read, with or without an older list on screen', () => {
    expect(rosterReadOnOpen({ roster: null, failed: true, reading: false })).toBe(true);
    expect(rosterReadOnOpen({ roster: [{}], failed: true, reading: false })).toBe(true);
  });

  it('keeps a roster that was read', () => {
    expect(rosterReadOnOpen({ roster: [], failed: false, reading: false })).toBe(false);
    expect(rosterReadOnOpen({ roster: [{}], failed: false, reading: false })).toBe(false);
  });

  it('never starts a second read while one is out', () => {
    expect(rosterReadOnOpen({ roster: null, failed: false, reading: true })).toBe(false);
    expect(rosterReadOnOpen({ roster: null, failed: true, reading: true })).toBe(false);
  });
});
