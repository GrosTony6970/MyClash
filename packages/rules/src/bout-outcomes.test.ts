import { describe, expect, it } from 'vitest';
import { boutOutcomes, winnerColorFrom } from './match-format';

/**
 * The one rule for what a finished bout was worth.
 *
 * Five sites derived this for themselves and gave a 3-1 time-out five different
 * answers — on the same fighter's profile the match-history strip said WIN, the
 * W/L tiles counted it in NEITHER column, and the form badge said D.
 */
const bout = (over: Record<string, unknown> = {}) => ({
  winnerRegistrationId: null,
  redRegistrationId: 'red',
  blueRegistrationId: 'blue',
  redScore: 0,
  blueScore: 0,
  endReason: null,
  ...over,
});

describe('boutOutcomes', () => {
  it('honours a recorded winner OVER the score', () => {
    // A forfeit, a walkover or a referee override can award a bout to the
    // fighter behind on points — the canonical reason explicit scores exist.
    expect(boutOutcomes(bout({ winnerRegistrationId: 'blue', redScore: 5, blueScore: 3 }))).toEqual(
      {
        red: 'loss',
        blue: 'win',
      },
    );
  });

  it('falls back to the score when no winner is recorded', () => {
    expect(boutOutcomes(bout({ redScore: 5, blueScore: 3 }))).toEqual({
      red: 'win',
      blue: 'loss',
    });
    expect(boutOutcomes(bout({ redScore: 4, blueScore: 4 }))).toEqual({
      red: 'draw',
      blue: 'draw',
    });
  });

  it('calls the doubles ceiling a LOSS FOR BOTH', () => {
    // The one outcome no single-sided answer can express, which is exactly how
    // it kept getting lost. 0-0 with no winner reads as a draw to both tests
    // above, so the reason has to come first.
    expect(boutOutcomes(bout({ endReason: 'max_doubles' }))).toEqual({
      red: 'loss',
      blue: 'loss',
    });
  });

  it('leaves the other two ceiling reasons to the winner and the score', () => {
    // 'max_doubles_draw' IS a 0-0 draw; 'max_doubles_result_stands' keeps a
    // real board. Adding either to the double-loss check would BREAK them.
    expect(boutOutcomes(bout({ endReason: 'max_doubles_draw' })).red).toBe('draw');
    expect(
      boutOutcomes(
        bout({ endReason: 'max_doubles_result_stands', winnerRegistrationId: 'red', redScore: 2 }),
      ),
    ).toEqual({ red: 'win', blue: 'loss' });
  });

  it('answers "nobody" for a winner naming neither side, rather than inventing one', () => {
    // A mismatched pairing. Falling through to the scores would crown someone
    // on data that is already known to be wrong.
    expect(
      boutOutcomes(bout({ winnerRegistrationId: 'someone-else', redScore: 5, blueScore: 3 })),
    ).toEqual({ red: 'draw', blue: 'draw' });
  });
});

describe('winnerColorFrom', () => {
  it('is the ladder resolveMatchWinner delegates to', () => {
    expect(winnerColorFrom(bout({ winnerRegistrationId: 'blue', redScore: 9 }))).toBe('blue');
    expect(winnerColorFrom(bout({ redScore: 3, blueScore: 1 }))).toBe('red');
    expect(winnerColorFrom(bout({ redScore: 1, blueScore: 1 }))).toBeNull();
    expect(winnerColorFrom(bout({ winnerRegistrationId: 'nobody' }))).toBeNull();
  });

  it('treats absent scores as zero, so an unplayed bout is not a win', () => {
    expect(winnerColorFrom({ redRegistrationId: 'red', blueRegistrationId: 'blue' })).toBeNull();
  });
});
