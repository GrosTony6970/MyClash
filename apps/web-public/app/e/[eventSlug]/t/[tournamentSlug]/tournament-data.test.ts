import { describe, expect, it } from 'vitest';
import { derivePodium, type BracketSlot } from './tournament-data';

/** A completed bout the red fighter won on points. Positions start at 1, as generated. */
function bout(round: number, position: number, red: string, blue: string): BracketSlot {
  return {
    id: `r${round}-p${position}`,
    round,
    position,
    redFighterName: red,
    blueFighterName: blue,
    redScore: 5,
    blueScore: 2,
    winnerRegistrationId: null,
    status: 'completed',
    matchId: null,
  };
}

describe('derivePodium', () => {
  it('reads a single-elimination podium from the Final and the bronze match', () => {
    const slots = [
      bout(1, 1, 'Anna', 'Cleo'),
      bout(1, 2, 'Eve', 'Gus'),
      bout(2, 1, 'Anna', 'Eve'),
      bout(2, 2, 'Cleo', 'Gus'),
    ];

    expect(derivePodium(slots, { phaseType: 'single_elim' })).toEqual({
      gold: { fighterName: 'Anna' },
      silver: { fighterName: 'Eve' },
      bronze: { fighterName: 'Cleo' },
      fourth: { fighterName: 'Gus' },
    });
  });
});
