import { describe, expect, it } from 'vitest';
import { neighboursOf, toInfo } from './useAdjacentMatches';

const tile = (id: string) => ({
  id,
  matchNumberLabel: null,
  roundCode: null,
  redName: 'Ana Red',
  blueName: 'Bo Blue',
  redClub: null,
  blueClub: null,
});

describe('neighboursOf', () => {
  it('shows nothing before the first read', () => {
    expect(neighboursOf(null, 'bout-1')).toEqual({
      previous: null,
      next: null,
      answered: false,
    });
  });

  it('shows the neighbours last read for this bout', () => {
    const held = { matchId: 'bout-1', previous: tile('bout-0'), next: tile('bout-2') };

    expect(neighboursOf(held, 'bout-1')).toEqual({
      previous: tile('bout-0'),
      next: tile('bout-2'),
      answered: true,
    });
  });

  // The last bout of a piste: "no neighbour" is the server's word, not a read still out.
  it('says the server answered when it answered that there is no neighbour', () => {
    const held = { matchId: 'bout-1', previous: null, next: null };

    expect(neighboursOf(held, 'bout-1')).toEqual({ previous: null, next: null, answered: true });
  });

  it("never shows another bout's neighbours: its Next would be this bout", () => {
    const held = { matchId: 'bout-1', previous: tile('bout-0'), next: tile('bout-2') };

    expect(neighboursOf(held, 'bout-2')).toEqual({
      previous: null,
      next: null,
      answered: false,
    });
  });

  it('shows nothing with no bout', () => {
    const held = { matchId: 'bout-1', previous: null, next: tile('bout-2') };

    expect(neighboursOf(held, null)).toEqual({ previous: null, next: null, answered: false });
  });
});

/**
 * The pad's "next" tile names Lyon Blades against Paris Rapiers with each team's colour chip
 * (call 6): the server sends the colour of a team side, null for a Fighter's.
 */
describe('toInfo', () => {
  it('keeps a team tile’s colours', () => {
    expect(
      toInfo({
        id: 'bout-2',
        matchNumberLabel: 'M2',
        roundCode: 'L1-P1-M2',
        redFighterName: 'Lyon Blades',
        blueFighterName: 'Paris Rapiers',
        redClub: null,
        blueClub: null,
        redColour: 'green',
        blueColour: 'purple',
      }),
    ).toEqual({
      id: 'bout-2',
      matchNumberLabel: 'M2',
      roundCode: 'L1-P1-M2',
      redName: 'Lyon Blades',
      blueName: 'Paris Rapiers',
      redClub: null,
      blueClub: null,
      redColour: 'green',
      blueColour: 'purple',
    });
  });

  it('gives a Fighter’s tile no colour, and an answer with no bout no tile', () => {
    const info = toInfo({ id: 'bout-3', redFighterName: 'Ana Red', blueFighterName: 'Bo Blue' });
    expect(info).toMatchObject({ redName: 'Ana Red', redColour: null, blueColour: null });
    expect(toInfo(null)).toBeNull();
  });
});
