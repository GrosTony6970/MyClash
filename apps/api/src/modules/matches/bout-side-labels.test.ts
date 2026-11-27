import { describe, expect, it } from 'vitest';
import { boutSideLabels, sideNamesAndColours } from './bout-side-labels';

const LYON = { id: 'team-lyon', name: 'Lyon Blades', color: 'teal', logo_url: 'https://cdn/l.png' };
const ANNA = { id: 'reg-anna', persons: { given_name: 'Anna', family_name: 'Roux' } };

describe('the sides of a bout read', () => {
  it('names a team side by its team, with its colour, and a Fighter by her Person', () => {
    const sides = boutSideLabels({ red: null, red_team: LYON, blue: ANNA, blue_team: null });

    expect(sides.red).toMatchObject({
      kind: 'team',
      id: 'team-lyon',
      logoUrl: 'https://cdn/l.png',
    });
    expect(sideNamesAndColours(sides)).toEqual({
      redFighterName: 'Lyon Blades',
      blueFighterName: 'Anna Roux',
      redColour: 'teal',
      blueColour: null,
    });
  });

  // `sideLabel` answers '' for no name; the screens put "Red" / "Blue" in its place only for null.
  it('gives a side not known yet, and a Person with no name, no name: null, never empty', () => {
    const sides = boutSideLabels({
      red: null,
      red_team: null,
      blue: { id: 'reg-x', persons: { given_name: null, family_name: null } },
    });

    expect(sideNamesAndColours(sides)).toEqual({
      redFighterName: null,
      blueFighterName: null,
      redColour: null,
      blueColour: null,
    });
    expect(sides.red.id).toBeNull();
  });
});
