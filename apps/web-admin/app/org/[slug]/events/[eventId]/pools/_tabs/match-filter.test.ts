import { describe, expect, it } from 'vitest';
import { matchVisible, type FilterableBout } from './match-filter';

/** O29: "When does Martin fight?" is answered without scrolling sixty rows. */

const bout = (overrides: Partial<FilterableBout> = {}): FilterableBout => ({
  red_name: 'Hélène Martin',
  blue_name: 'Bo Lund',
  red_club_abbrev: 'Lyon Escrime',
  blue_club_abbrev: null,
  referees: [{ refereeName: 'Paul Durand' }],
  status: 'scheduled',
  ...overrides,
});

describe('matchVisible', () => {
  it('shows every bout to an empty filter', () => {
    expect(matchVisible(bout(), '', false)).toBe(true);
  });

  it('finds a fighter of either side, accents ignored', () => {
    expect(matchVisible(bout(), 'helene', false)).toBe(true);
    expect(matchVisible(bout(), 'lund', false)).toBe(true);
    expect(matchVisible(bout(), 'zoe', false)).toBe(false);
  });

  it('finds a club and a referee', () => {
    expect(matchVisible(bout(), 'lyon', false)).toBe(true);
    expect(
      matchVisible(bout({ red_club_abbrev: null, blue_club_abbrev: 'Lyon' }), 'lyon', false),
    ).toBe(true);
    expect(matchVisible(bout(), 'durand', false)).toBe(true);
  });

  it('hides the completed and the voided bouts when asked, and only those', () => {
    expect(matchVisible(bout({ status: 'completed' }), '', true)).toBe(false);
    expect(matchVisible(bout({ status: 'voided' }), '', true)).toBe(false);
    expect(matchVisible(bout({ status: 'running' }), '', true)).toBe(true);
    expect(matchVisible(bout({ status: 'completed' }), '', false)).toBe(true);
  });
});
