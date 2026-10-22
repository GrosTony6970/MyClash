import { describe, expect, it } from 'vitest';
import { withSwissWithdrawalKind } from './archive-swiss-entrants';

describe('withSwissWithdrawalKind — an archive made before 0243 and 0244', () => {
  it('takes a withdrawal as the organiser’s, an entrant still paired as none, and no round missed', () => {
    const { swissEntrants } = withSwissWithdrawalKind({
      swissEntrants: [
        { id: 'se-1', withdrawn_at_round: 3 },
        { id: 'se-2', withdrawn_at_round: null },
      ],
    });
    expect(swissEntrants).toEqual([
      { id: 'se-1', withdrawn_at_round: 3, withdrawn_by: 'hand', missed_rounds: [] },
      { id: 'se-2', withdrawn_at_round: null, withdrawn_by: null, missed_rounds: [] },
    ]);
  });

  it('keeps what a newer archive carries', () => {
    const row = { id: 'se-1', withdrawn_at_round: 3, withdrawn_by: 'status', missed_rounds: [2] };
    expect(withSwissWithdrawalKind({ swissEntrants: [row] }).swissEntrants).toEqual([row]);
  });
});
