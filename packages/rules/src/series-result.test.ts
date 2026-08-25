/**
 * When a best-of series is finished, and who won it.
 *
 * The win target used to be the only way out, which left a series that could
 * not reach it running forever: a round nobody won counts for neither side, so
 * the round number climbed past `bestOf` with nothing to stop it and the pad
 * read "Round 4/3". These are the two ways a series ends.
 */
import { describe, expect, it } from 'vitest';
import { roundWinTarget, seriesResult } from './index';

const RED = { winnerColor: 'red' as const };
const BLUE = { winnerColor: 'blue' as const };
const DRAWN = { winnerColor: null };

describe('seriesResult', () => {
  it('clinches on the win target, before the rounds run out', () => {
    expect(seriesResult([RED, RED], 3)).toEqual({
      over: true,
      winnerColor: 'red',
      roundsSpent: false,
    });
    // One round short of it.
    expect(seriesResult([RED, BLUE], 3)).toMatchObject({ over: false, roundsSpent: false });
  });

  it('ends a series whose rounds are spent, to whoever leads on ROUND WINS', () => {
    // Red won one and the ceiling drew the other two. Red never reached 2, and
    // this is the series that used to run to round 4, then 5, then 6.
    expect(seriesResult([RED, DRAWN, DRAWN], 3)).toEqual({
      over: true,
      winnerColor: 'red',
      roundsSpent: true,
    });
  });

  it('calls a spent series LEVEL on round wins a drawn series', () => {
    expect(seriesResult([RED, BLUE, DRAWN], 3)).toEqual({
      over: true,
      winnerColor: null,
      roundsSpent: true,
    });
    expect(seriesResult([DRAWN, DRAWN, DRAWN], 3)).toEqual({
      over: true,
      winnerColor: null,
      roundsSpent: true,
    });
  });

  it('keeps a series with rounds left open, even with a leader', () => {
    // The bound is on ROUNDS, not on the tally: red leads 1-0 but round 3 is
    // still owed, and it may take the series to 1-1.
    expect(seriesResult([RED, DRAWN], 3)).toMatchObject({ over: false, roundsSpent: false });
  });

  it('cannot spend the rounds of a series that no drawn round can reach', () => {
    // `bestOf` is odd, so with every round won the target is always reached by
    // round N — `roundsSpent` is unreachable in a phase that cannot draw a
    // round, which is what bounds a bracket series to its own length.
    expect(seriesResult([RED, BLUE, RED], 3)).toEqual({
      over: true,
      winnerColor: 'red',
      roundsSpent: false,
    });
    expect(seriesResult([RED, BLUE, RED, BLUE, BLUE], 5)).toMatchObject({
      winnerColor: 'blue',
      roundsSpent: false,
    });
  });

  it('agrees with roundWinTarget on a single-round match', () => {
    expect(roundWinTarget(1)).toBe(1);
    expect(seriesResult([RED], 1)).toEqual({
      over: true,
      winnerColor: 'red',
      roundsSpent: false,
    });
    // A single round nobody won: spent, and drawn.
    expect(seriesResult([DRAWN], 1)).toEqual({
      over: true,
      winnerColor: null,
      roundsSpent: true,
    });
  });

  it('is not over before any round has closed', () => {
    expect(seriesResult([], 3)).toEqual({ over: false, winnerColor: null, roundsSpent: false });
  });
});
