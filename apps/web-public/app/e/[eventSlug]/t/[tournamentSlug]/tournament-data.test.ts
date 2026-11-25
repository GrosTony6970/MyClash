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

/**
 * Anna (red) leads the final 5 to 2. Bea (blue) is behind on points, but Anna forfeits with an
 * injury and the score stands, so the record names Bea the winner. The public podium crowns Bea.
 * The podium once passed the whole slot to the winner helper; when the helper's keys were renamed
 * to side names, that call still compiled, found no recorded winner, and crowned the higher score.
 */
const final: BracketSlot = {
  id: 'slot-final',
  round: 1,
  position: 1,
  redFighterName: 'Anna',
  blueFighterName: 'Bea',
  redScore: 5,
  blueScore: 2,
  winnerRegistrationId: 'reg-bea',
  status: 'completed',
  matchId: 'match-final',
  redRegistrationId: 'reg-anna',
  blueRegistrationId: 'reg-bea',
};

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

  it('crowns the forfeit winner of a final won on the lower score', () => {
    const podium = derivePodium([final]);

    expect(podium?.gold).toEqual({ fighterName: 'Bea' });
    expect(podium?.silver).toEqual({ fighterName: 'Anna' });
  });
});
