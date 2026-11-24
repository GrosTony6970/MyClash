import { describe, expect, it } from 'vitest';
import { sideKey } from './side-key';

describe('sideKey', () => {
  it('is the Registration id of an individual side', () => {
    expect(sideKey('reg-1', null)).toBe('reg-1');
  });
  it('is the Team id of a team side', () => {
    expect(sideKey(null, 'team-1')).toBe('team-1');
  });
  it('is null for a side not known yet, and reads undefined as null', () => {
    expect(sideKey(null, null)).toBeNull();
    expect(sideKey(undefined, undefined)).toBeNull();
  });
  it('throws when both are present: the database refuses that row', () => {
    expect(() => sideKey('reg-1', 'team-1')).toThrow(/both a Registration and a Team/);
  });
  it('does not read an empty string as an id', () => {
    expect(sideKey('', 'team-1')).toBe('team-1');
    expect(sideKey('', '')).toBeNull();
  });
});
