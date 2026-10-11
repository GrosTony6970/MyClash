/**
 * The rounds of a best-of bout that counts down, with no network.
 *
 * Best-of-3 in a Pool, each fighter starts a round at 5. Red takes blue to
 * zero: the tablet closes round 1 on the score it shows. "Start round 2" puts
 * both fighters back at 5, and round 2 is played. The server knows none of it
 * yet, and its row still reads 0-0.
 */
import { describe, expect, it } from 'vitest';
import type { ExchangeRow } from '@myclash/ui';
import { padSeries } from './pad-series';
import { FORMAT, ROUND_1, bout, cardAgainstRed, hit, start } from './pad-series.fixtures';

const COUNTDOWN = {
  ...FORMAT,
  scoringDirection: 'reverse_zero_loses' as const,
  levelAtTime: {
    pool: [{ kind: 'draw' as const }],
    bracket: [{ kind: 'sudden_death' as const }],
    finals: [{ kind: 'sudden_death' as const }],
  },
};

const countdown = (over: Parameters<typeof bout>[0]) => bout({ matchFormat: COUNTDOWN, ...over });

/** One afterblow the tablet still holds: `points` to red, and as many to blue. */
const afterblowBothWays = (points: number, round: number): ExchangeRow => ({
  ...hit('red', points, round),
  type: 'afterblow',
  defenderDelta: points,
});

describe('a best-of bout that counts down, with no network', () => {
  it('closes the round when a fighter is at zero, for the other fighter', () => {
    const series = padSeries(countdown({ queued: [hit('red', 3, 1), hit('red', 2, 1)] }));
    expect(series).toMatchObject({ round: 1, awaitingStart: true, decided: null, by: 'tablet' });
    expect(series.closed).toEqual([
      { round: 1, redScore: 5, blueScore: 0, winnerColor: 'red', by: 'tablet' },
    ]);
  });

  it('keeps the round open while both fighters hold points', () => {
    const series = padSeries(countdown({ queued: [hit('red', 3, 1), hit('blue', 4, 1)] }));
    expect(series).toMatchObject({ redScore: 1, blueScore: 2, awaitingStart: false, closed: [] });
  });

  it('opens round 2 with both fighters at the cap, and does not close it', () => {
    const series = padSeries(countdown({ queued: [hit('red', 5, 1)], roundPresses: [start(2)] }));
    expect(series).toMatchObject({
      round: 2,
      redScore: 5,
      blueScore: 5,
      awaitingStart: false,
      decided: null,
      redRoundWins: 1,
      by: 'tablet',
    });
  });

  it('counts the hits of round 2 down from the cap', () => {
    const series = padSeries(
      countdown({ queued: [hit('red', 5, 1), hit('blue', 2, 2)], roundPresses: [start(2)] }),
    );
    expect(series).toMatchObject({ round: 2, redScore: 3, blueScore: 5, redQueued: -2 });
  });

  it('is decided when a fighter has won two rounds', () => {
    const series = padSeries(
      countdown({ queued: [hit('red', 5, 1), hit('red', 5, 2)], roundPresses: [start(2)] }),
    );
    expect(series).toMatchObject({ decided: { winnerColor: 'red' }, redRoundWins: 2 });
  });
});

describe('the server’s cards of a best-of bout', () => {
  /** A card the SERVER holds, that takes 1 point off red, in `round`. */
  const serverCard = (round: number) => ({ ...cardAgainstRed(1, round), pending: false });
  // Round 2 on the server: red has 1 point left and a card of -1, so its row says 0.
  const server = { ...ROUND_1, currentRound: 2, redScore: 0, blueScore: 5 };

  it('stop a side at zero before the cards of the OPEN round only', () => {
    const queued = [hit('blue', 3, 2)];
    const ofRound2 = padSeries(
      countdown({ server, penalties: [serverCard(2)], queued, held: true }),
    );
    expect(ofRound2).toMatchObject({ redScore: -1, blueScore: 5 });
    // The same card in round 1: the row's 0 is red's earned part, with no card in it.
    const ofRound1 = padSeries(
      countdown({ server, penalties: [serverCard(1)], queued, held: true }),
    );
    expect(ofRound1).toMatchObject({ redScore: 0, blueScore: 5 });
  });

  it('count in a round the tablet opened, when the list of cards lands before the bout’s row', () => {
    // The server took "Start round 2" and a card of round 2; the row on screen is round 1's.
    const args = { penalties: [serverCard(2)], queued: [hit('blue', 2, 2)] };
    expect(padSeries(countdown(args))).toMatchObject({ round: 2, redScore: 2, blueScore: 5 });
    expect(padSeries(bout(args))).toMatchObject({ round: 2, redScore: -1, blueScore: 2 });
  });
});

describe('both fighters at zero on one afterblow', () => {
  it('is a drawn round in a Pool, whose chain allows a draw', () => {
    const series = padSeries(countdown({ queued: [afterblowBothWays(5, 1)] }));
    expect(series.closed).toEqual([
      { round: 1, redScore: 0, blueScore: 0, winnerColor: null, by: 'tablet' },
    ]);
  });

  it('leaves the round open in a bracket, which cannot end level', () => {
    const series = padSeries(
      countdown({ phaseType: 'single_elim', queued: [afterblowBothWays(5, 1)] }),
    );
    expect(series).toMatchObject({ redScore: 0, blueScore: 0, awaitingStart: false, closed: [] });
  });
});
