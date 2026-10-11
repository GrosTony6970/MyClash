/**
 * A round's score on the pad when the bout counts down.
 *
 * Countdown, first to lose 5: each fighter starts at 5 and a hit takes its
 * points off the OPPONENT. A table has no wifi and red hits for 2: the server
 * will say red 5, blue 3. The tablet must say so at once, not red 7, blue 5.
 */
import { describe, expect, it } from 'vitest';
import type { Penalty } from '@myclash/ui';
import { padSeries } from './pad-series';
import { FORMAT, ROUND_1, bout, cardAgainstRed, hit } from './pad-series.fixtures';

const COUNTDOWN = { ...FORMAT, scoringDirection: 'reverse_zero_loses' as const };

/** A card the SERVER holds, that takes `points` off red. */
const serverCardAgainstRed = (points: number, round?: number): Penalty => ({
  ...cardAgainstRed(points, round),
  pending: false,
});

/** A countdown bout of one round, with the server's row at `red`-`blue`. */
const oneRound = (red: number, blue: number, over: Parameters<typeof bout>[0] = {}) =>
  bout({
    bestOf: 1,
    matchFormat: COUNTDOWN,
    server: { ...ROUND_1, redScore: red, blueScore: blue },
    ...over,
  });

describe('an unsent hit of a countdown bout', () => {
  it('takes its points off the opponent, and the hitter keeps their number', () => {
    const series = padSeries(oneRound(5, 5, { queued: [hit('red', 2)] }));
    expect(series).toMatchObject({ redScore: 5, blueScore: 3, redQueued: 0, blueQueued: -2 });
  });

  it('does the same in the open round of a best-of bout', () => {
    const series = padSeries(
      bout({
        matchFormat: COUNTDOWN,
        server: { ...ROUND_1, redScore: 4, blueScore: 5 },
        queued: [hit('blue', 1, 1)],
        held: true,
      }),
    );
    expect(series).toMatchObject({ redScore: 3, blueScore: 5, redQueued: -1, blueQueued: 0 });
  });

  it('stops at zero, as the server’s score does', () => {
    const series = padSeries(oneRound(1, 5, { queued: [hit('blue', 3)] }));
    expect(series).toMatchObject({ redScore: 0, blueScore: 5, redQueued: -1 });
  });

  it('stops at zero BEFORE the cards: a card the server holds still counts under it', () => {
    // Red had 1 point left and a card of -1: the server's row says 0.
    const series = padSeries(
      oneRound(0, 5, { penalties: [serverCardAgainstRed(1)], queued: [hit('blue', 3)] }),
    );
    expect(series).toMatchObject({ redScore: -1, blueScore: 5, redQueued: -1 });
  });
});

describe('an unsent card of a countdown bout', () => {
  it('lands on the carded fighter’s own number', () => {
    const series = padSeries(oneRound(5, 5, { queuedPenalties: [cardAgainstRed(1)] }));
    expect(series).toMatchObject({ redScore: 4, blueScore: 5, redQueued: -1, blueQueued: 0 });
  });
});

describe('a countdown round the server has not scored yet', () => {
  it('reads cap to cap: the server’s row is 0-0 until the first hit', () => {
    expect(padSeries(oneRound(0, 0))).toMatchObject({ redScore: 5, blueScore: 5 });
    expect(padSeries(bout({ matchFormat: COUNTDOWN }))).toMatchObject({
      redScore: 5,
      blueScore: 5,
    });
  });

  it('counts the first hits down from the cap', () => {
    const series = padSeries(oneRound(0, 0, { queued: [hit('red', 2)] }));
    expect(series).toMatchObject({ redScore: 5, blueScore: 3, blueQueued: -2 });
  });

  it('is not a round that waits for "Start round": that 0-0 is the server’s (a wiped round)', () => {
    const server = { ...ROUND_1, awaitingRoundAdvance: true };
    expect(padSeries(bout({ matchFormat: COUNTDOWN, server }))).toMatchObject({
      redScore: 0,
      blueScore: 0,
    });
  });

  it('is not a bout that is over: that 0-0 is its result', () => {
    const server = { ...ROUND_1, over: true };
    expect(padSeries(oneRound(0, 0, { server }))).toMatchObject({ redScore: 0, blueScore: 0 });
  });
});

describe('a bout that counts up reads as before', () => {
  it('adds a hit to the hitter and a card to the carded fighter, over the server’s row', () => {
    const series = padSeries(
      bout({
        bestOf: 1,
        server: { ...ROUND_1, redScore: 3, blueScore: 1 },
        // The server's row holds this card already.
        penalties: [serverCardAgainstRed(1)],
        queued: [hit('red', 2)],
        queuedPenalties: [cardAgainstRed(1)],
      }),
    );
    expect(series).toMatchObject({ redScore: 4, blueScore: 1, redQueued: 1, blueQueued: 0 });
  });

  it('keeps a row at 0-0 at 0-0', () => {
    expect(padSeries(bout({ bestOf: 1 }))).toMatchObject({ redScore: 0, blueScore: 0 });
  });
});
