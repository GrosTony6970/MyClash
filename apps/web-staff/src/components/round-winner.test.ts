import { describe, expect, it } from 'vitest';
import { closedRoundWinner } from './round-winner';

const rounds = [
  { round: 1, redScore: 3, blueScore: 1, winnerColor: 'red', endReason: 'first_to_points' },
  { round: 2, redScore: 0, blueScore: 0, winnerColor: null, endReason: 'max_doubles' },
  { round: 3, redScore: 1, blueScore: 3, winnerColor: 'blue', endReason: 'first_to_points' },
];

describe('closedRoundWinner', () => {
  it('reads the side the engine recorded for that round', () => {
    expect(closedRoundWinner(rounds, 1)).toBe('red');
    expect(closedRoundWinner(rounds, 3)).toBe('blue');
  });

  it('returns null for a round the engine gave no winner (double loss)', () => {
    // The old score comparison agreed here only because 0-0 ties; on any other
    // doubles-ended round it would have crowned whoever was ahead.
    expect(closedRoundWinner(rounds, 2)).toBeNull();
  });

  it('returns null for a round that is not closed yet', () => {
    expect(closedRoundWinner(rounds, 4)).toBeNull();
  });

  it('tolerates the unknown shapes rounds_json arrives as', () => {
    // `MatchInfo.roundsJson` is typed `unknown` — it comes straight off the row.
    expect(closedRoundWinner(null, 1)).toBeNull();
    expect(closedRoundWinner(undefined, 1)).toBeNull();
    expect(closedRoundWinner({ round: 1, winnerColor: 'red' }, 1)).toBeNull();
    expect(closedRoundWinner([null, 'nonsense', { round: 1 }], 1)).toBeNull();
  });
});
