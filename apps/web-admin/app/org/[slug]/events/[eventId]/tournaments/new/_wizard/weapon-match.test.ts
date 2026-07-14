import { describe, expect, it } from 'vitest';
import { matchWeapon } from './weapon-match';

// Stand-in for the shared weapon_catalog names (GET /api/v1/weapons), which the
// wizard now supplies to matchWeapon at runtime instead of a hardcoded list.
const CATALOG = [
  'Longsword',
  'Sabre',
  'Rapier',
  'Dagger',
  'Rapier & Dagger',
  'Sidesword',
  'Sidesword & Buckler',
] as const;

describe('matchWeapon', () => {
  it('returns the weapon when the name is exactly that weapon', () => {
    expect(matchWeapon('Longsword', CATALOG)).toBe('Longsword');
  });

  it('matches a weapon embedded in a longer name', () => {
    expect(matchWeapon('Longsword Open 2027', CATALOG)).toBe('Longsword');
  });

  it('is case- and accent-insensitive', () => {
    expect(matchWeapon('LONGSWORD', CATALOG)).toBe('Longsword');
    expect(matchWeapon('sàbre cup', CATALOG)).toBe('Sabre');
  });

  it('prefers the most specific (multi-token) weapon over a shorter one', () => {
    expect(matchWeapon('Rapier & Dagger Cup', CATALOG)).toBe('Rapier & Dagger');
    expect(matchWeapon('Sidesword & Buckler Open', CATALOG)).toBe('Sidesword & Buckler');
  });

  it('ignores "&", "and" and punctuation between tokens', () => {
    expect(matchWeapon('Rapier and Dagger', CATALOG)).toBe('Rapier & Dagger');
  });

  it('returns null when nothing matches or the name is empty', () => {
    expect(matchWeapon('Open Steel Tournament', CATALOG)).toBeNull();
    expect(matchWeapon('', CATALOG)).toBeNull();
  });

  it('does not match on partial-word substrings (sabreur is not sabre)', () => {
    expect(matchWeapon('Sabreur Open', CATALOG)).toBeNull();
  });

  it('returns null when the candidate list is empty (catalog not loaded yet)', () => {
    expect(matchWeapon('Longsword Open', [])).toBeNull();
  });
});
