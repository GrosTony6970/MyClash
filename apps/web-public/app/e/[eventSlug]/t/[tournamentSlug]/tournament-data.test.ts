import { describe, expect, it } from 'vitest';
import { derivePodium, type BracketSlot } from './tournament-data';

/**
 * A completed bout the red fighter won on points, with the winner the server stores: the podium
 * reads the stored winner, never the score. Positions start at 1, as generated.
 */
function bout(round: number, position: number, red: string, blue: string): BracketSlot {
  return {
    id: `r${round}-p${position}`,
    round,
    position,
    redFighterName: red,
    blueFighterName: blue,
    redRegistrationId: `reg-${red}`,
    blueRegistrationId: `reg-${blue}`,
    redScore: 5,
    blueScore: 2,
    winnerRegistrationId: `reg-${red}`,
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
