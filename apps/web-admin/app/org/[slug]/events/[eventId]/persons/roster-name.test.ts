import { describe, expect, it } from 'vitest';
import { formatRosterName } from './roster-name';

describe('formatRosterName', () => {
  it('renders FAMILY (upper-cased) then given name', () => {
    expect(formatRosterName({ familyName: 'Adrien', givenName: 'Thomas' })).toBe('ADRIEN Thomas');
  });

  it('uses only the family name when there is no given name', () => {
    expect(formatRosterName({ familyName: 'Adrien', givenName: '' })).toBe('ADRIEN');
  });

  it('uses only the given name (unchanged case) when there is no family name', () => {
    expect(formatRosterName({ familyName: '', givenName: 'Thomas' })).toBe('Thomas');
  });

  it('returns an empty string when both parts are blank', () => {
    expect(formatRosterName({ familyName: '   ', givenName: '' })).toBe('');
  });
});
