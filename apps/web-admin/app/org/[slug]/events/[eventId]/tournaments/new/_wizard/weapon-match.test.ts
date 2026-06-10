import { describe, expect, it } from 'vitest';
import { matchWeapon, WEAPONS } from './weapon-match';

describe('matchWeapon', () => {
  it('returns the weapon when the name is exactly that weapon', () => {
    expect(matchWeapon('Longsword')).toBe('Longsword');
  });

  it('matches a weapon embedded in a longer name', () => {
    expect(matchWeapon('Longsword Open 2027')).toBe('Longsword');
  });

  it('is case- and accent-insensitive', () => {
    expect(matchWeapon('LONGSWORD')).toBe('Longsword');
    expect(matchWeapon('sàbre cup')).toBe('Sabre');
  });

  it('prefers the most specific (multi-token) weapon over a shorter one', () => {
    expect(matchWeapon('Rapier & Dagger Cup')).toBe('Rapier & Dagger');
    expect(matchWeapon('Sidesword & Buckler Open')).toBe('Sidesword & Buckler');
  });

  it('ignores "&", "and" and punctuation between tokens', () => {
    expect(matchWeapon('Rapier and Dagger')).toBe('Rapier & Dagger');
  });

  it('returns null when nothing matches or the name is empty', () => {
    expect(matchWeapon('Open Steel Tournament')).toBeNull();
    expect(matchWeapon('')).toBeNull();
  });

  it('does not match on partial-word substrings (sabreur is not sabre)', () => {
    expect(matchWeapon('Sabreur Open')).toBeNull();
  });

  it('exposes the canonical weapon list', () => {
    expect(WEAPONS).toContain('Longsword');
    expect(WEAPONS).toContain('Rapier & Dagger');
    expect(WEAPONS).toHaveLength(12);
  });
});
