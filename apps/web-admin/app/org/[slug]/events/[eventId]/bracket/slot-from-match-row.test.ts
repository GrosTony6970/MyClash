import { describe, expect, it } from 'vitest';
import type { BracketSlotData } from '@myclash/ui';
import { slotFromMatchRow } from './slot-from-match-row';

const LIVE: BracketSlotData = {
  id: 'slot-1',
  round: 2,
  position: 1,
  redFighterName: 'Anna',
  blueFighterName: 'Eve',
  redRegistrationId: 'reg-anna',
  blueRegistrationId: 'reg-eve',
  redScore: 3,
  blueScore: 1,
  winnerRegistrationId: null,
  status: 'running',
  matchId: 'match-1',
};

describe('slotFromMatchRow', () => {
  it('takes the winner a bout stores when it finishes, with its score and status', () => {
    const done = slotFromMatchRow(LIVE, {
      id: 'match-1',
      bracket_slot_id: 'slot-1',
      red_score: 5,
      blue_score: 1,
      status: 'completed',
      winner_registration_id: 'reg-anna',
    });
    expect(done).toMatchObject({
      redScore: 5,
      blueScore: 1,
      status: 'completed',
      winnerRegistrationId: 'reg-anna',
    });
  });

  it('clears the winner of a bout put back in play', () => {
    const reopened = slotFromMatchRow(
      { ...LIVE, status: 'completed', winnerRegistrationId: 'reg-anna' },
      { id: 'match-1', status: 'paused', winner_registration_id: null },
    );
    expect(reopened.winnerRegistrationId).toBeNull();
  });

  it('keeps what a change does not carry', () => {
    const kept = slotFromMatchRow({ ...LIVE, winnerRegistrationId: 'reg-eve' }, { id: 'match-1' });
    expect(kept).toMatchObject({ redScore: 3, status: 'running', winnerRegistrationId: 'reg-eve' });
  });
});
