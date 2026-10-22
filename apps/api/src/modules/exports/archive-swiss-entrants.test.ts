import { describe, expect, it } from 'vitest';
import { withSwissWithdrawalKind } from './archive-swiss-entrants';

describe('withSwissWithdrawalKind — an archive made before 0243', () => {
  it('takes a withdrawal as the organiser’s, and an entrant still paired as none', () => {
    const { swissEntrants } = withSwissWithdrawalKind({
      swissEntrants: [
        { id: 'se-1', withdrawn_at_round: 3 },
        { id: 'se-2', withdrawn_at_round: null },
      ],
    });
    expect(swissEntrants).toEqual([
      { id: 'se-1', withdrawn_at_round: 3, withdrawn_by: 'hand' },
      { id: 'se-2', withdrawn_at_round: null, withdrawn_by: null },
    ]);
  });

  it('keeps the kind a newer archive carries', () => {
    const row = { id: 'se-1', withdrawn_at_round: 3, withdrawn_by: 'status' };
    expect(withSwissWithdrawalKind({ swissEntrants: [row] }).swissEntrants).toEqual([row]);
  });
});
