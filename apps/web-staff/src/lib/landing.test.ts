import { describe, expect, it } from 'vitest';
import { arrivalPathForRole, landingPathForRole } from './landing';

describe('landingPathForRole', () => {
  it('sends a check-in account to the desk', () => {
    // Dropping them on the piste list would show an empty screen — they have no
    // Lice assignment and never will — with no clue where their job lives.
    expect(landingPathForRole('checkin')).toBe('/desk');
  });

  it('sends a scoring account to the piste list', () => {
    expect(landingPathForRole('scoring')).toBe('/lices');
  });

  it('sends a gear account to the gear table', () => {
    expect(landingPathForRole('gear')).toBe('/gear');
  });

  it('sends a photos account to the photo queue, never to the pistes', () => {
    // An if-chain ending in `return '/lices'` once let a new job land on the
    // piste list with nothing failing. The switch is exhaustive now.
    expect(landingPathForRole('photos')).toBe('/photos');
    expect(arrivalPathForRole('photos')).toBe('/photos');
  });

  it('falls back to the piste list for an unknown or missing role', () => {
    // Matches parseStaffRole's own fallback: a bare staff account has always
    // meant a scoring account, so a row written before the CHECK constraint
    // must not strand its holder on a blank page.
    expect(landingPathForRole(undefined)).toBe('/lices');
    expect(landingPathForRole(null)).toBe('/lices');
    expect(landingPathForRole('arbitre_table')).toBe('/lices');
  });
});
