import { describe, expect, it } from 'vitest';
import { sideLabel } from './side-label';

/**
 * Pool A of Team Longsword holds Lyon Blades (green, with a logo) and Anna Martin of Salle Nord in
 * the individual Tournament next door. Each screen prints a side through one owner.
 */
const CLUB = { id: 'club-nord', name: 'Salle Nord', abbreviation: 'SN' };
const ANNA = {
  id: 'reg-anna',
  persons: { given_name: 'Anna', family_name: 'Martin', clubs: CLUB },
};
const LYON = {
  id: 'team-lyon',
  name: 'Lyon Blades',
  color: 'green',
  logo_url: 'https://cdn.example/lyon.png',
};

describe('sideLabel', () => {
  it('names a team by its own name, colour and logo, with no club', () => {
    expect(sideLabel(null, LYON)).toEqual({
      kind: 'team',
      id: 'team-lyon',
      name: 'Lyon Blades',
      club: null,
      colour: 'green',
      logoUrl: 'https://cdn.example/lyon.png',
    });
  });

  it('names a Registration by its Person and club, with no colour or logo', () => {
    expect(sideLabel(ANNA, null)).toEqual({
      kind: 'individual',
      id: 'reg-anna',
      name: 'Anna Martin',
      club: CLUB,
      colour: null,
      logoUrl: null,
    });
  });

  it('gives a team with no colour and no logo neither', () => {
    expect(sideLabel(null, { ...LYON, color: null, logo_url: null })).toMatchObject({
      colour: null,
      logoUrl: null,
    });
  });

  it('gives an empty name for a Registration whose Person is not read', () => {
    expect(sideLabel({ id: 'reg-anna', persons: null }, null)).toMatchObject({
      kind: 'individual',
      id: 'reg-anna',
      name: '',
      club: null,
    });
  });

  it('refuses a side that names both a Registration and a team', () => {
    expect(() => sideLabel(ANNA, LYON)).toThrow('a side is either a Registration or a Team');
  });
});
