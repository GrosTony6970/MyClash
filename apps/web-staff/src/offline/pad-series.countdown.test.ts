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
import { FORMAT, ROUND_1, bout, cardAgainstRed, double, hit, row } from './pad-series.fixtures';

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

/** A hit the SERVER's list holds: `points` to `side`, in `round`. */
const listed = (side: 'red' | 'blue', points: number, round?: number) => ({
  ...hit(side, points, round),
  pending: false,
});

/**
 * The server counts the score of a bout when it starts, and of a round when it
 * opens. A round in play at 0-0 is then really at 0-0 when its sheet explains
 * it: both fighters earned the cap or more (a true tie under zero in a bracket),
 * or the doubles limit wiped it (a bout somebody put back in play). Before, the
 * tablet read every 0-0 in play as "not scored" and showed such a bout cap to cap.
 */
describe('a countdown round in play at 0-0 that its sheet explains', () => {
  it('reads 0-0 when both fighters earned the cap on the server’s list', () => {
    const series = padSeries(oneRound(0, 0, { exchanges: [listed('red', 5), listed('blue', 6)] }));
    expect(series).toMatchObject({ redScore: 0, blueScore: 0 });
  });

  it('reads 0-0 when the doubles of the list reach the limit: that bout was wiped', () => {
    const wiped = [row('double'), row('double', 1), row('double', 1)];
    expect(padSeries(oneRound(0, 0, { exchanges: wiped }))).toMatchObject({
      redScore: 0,
      blueScore: 0,
    });
  });

  it('counts an unsent hit under a real 0-0, and says how far under', () => {
    const series = padSeries(
      oneRound(0, 0, {
        exchanges: [listed('red', 5), listed('blue', 5)],
        queued: [hit('blue', 1)],
      }),
    );
    expect(series).toMatchObject({ redScore: 0, blueScore: 0, redBelowZero: 1, blueBelowZero: 0 });
  });
});

/**
 * The row and the list are separate reads. The tablet's row can be the one from
 * before the Start while the list already holds the first hit: that 0-0 is a
 * row not read again, not two fighters out of points. Read as real, it would
 * close the round on the tablet at the next unsent hit.
 */
describe('a countdown round in play at 0-0 that its sheet does NOT explain', () => {
  it('reads from the cap when the list holds a hit that takes nobody to zero', () => {
    const stale = oneRound(0, 0, { exchanges: [listed('red', 2)], queued: [hit('red', 2)] });
    // One hit behind the server (the listed hit is not counted) until the row lands.
    expect(padSeries(stale)).toMatchObject({ redScore: 5, blueScore: 3 });
  });

  it('closes no round on such a row, with an entry of the tablet behind it', () => {
    const stale = bout({
      matchFormat: COUNTDOWN,
      exchanges: [listed('red', 2, 1)],
      queued: [hit('red', 2, 1)],
    });
    expect(padSeries(stale)).toMatchObject({ awaitingStart: false, closed: [], decided: null });
  });

  it('needs BOTH fighters out of points on the list: one is not a 0-0', () => {
    const series = padSeries(oneRound(0, 0, { exchanges: [listed('red', 7)] }));
    expect(series).toMatchObject({ redScore: 5, blueScore: 5 });
  });

  it('reads from the cap under the doubles limit, and where no limit wipes a bout', () => {
    const two = [row('double'), row('double')];
    expect(padSeries(oneRound(0, 0, { exchanges: two }))).toMatchObject({ redScore: 5 });

    const three = [...two, row('double')];
    // A bracket bout has no doubles limit.
    const bracket = oneRound(0, 0, { exchanges: three, phaseType: 'single_elim' });
    expect(padSeries(bracket)).toMatchObject({ redScore: 5, blueScore: 5 });
    // "The result stands" at the limit: the board is not wiped.
    const stands = { ...COUNTDOWN, maxDoubleHitOutcome: 'result_stands' as const };
    expect(padSeries(oneRound(0, 0, { exchanges: three, matchFormat: stands }))).toMatchObject({
      redScore: 5,
      blueScore: 5,
    });
  });

  it('counts the rows of the open round only, and a row with no round as round 1', () => {
    // Round 2 is open at 0-0. Round 1 was fought to both at zero; round 2 holds nothing.
    const server = { ...ROUND_1, currentRound: 2 };
    const roundOne = [listed('red', 5, 1), listed('blue', 5)];
    const inRoundTwo = bout({ matchFormat: COUNTDOWN, server, exchanges: roundOne, held: true });
    expect(padSeries(inRoundTwo)).toMatchObject({ round: 2, redScore: 5, blueScore: 5 });
    // The same rows explain a 0-0 of round 1.
    const inRoundOne = bout({ matchFormat: COUNTDOWN, exchanges: roundOne, held: true });
    expect(padSeries(inRoundOne)).toMatchObject({ round: 1, redScore: 0, blueScore: 0 });
  });

  it('reads a card of the list from the cap: a card can come before the Start', () => {
    // A card is given to a bout not started yet, and the list of cards lands
    // before the bout's row is read again: the row is not scored, the card counts.
    const series = padSeries(oneRound(0, 0, { penalties: [serverCardAgainstRed(1)] }));
    expect(series).toMatchObject({ redScore: 4, blueScore: 5 });
  });
});

/**
 * In a bout that counts down the doubles limit is asked before the point cap
 * (operator, 2026-10-11; `roundOutcome`). The one board where the tablet's
 * answer shows it: a round the limit wiped, with a card on it, put back in
 * play. It reads 0 and -1, and the cap alone would give that round to blue.
 */
describe('a countdown round at the doubles limit with a card on its wiped board', () => {
  it('is closed for nobody, at 0-0: the limit comes before the cap', () => {
    const series = padSeries(
      bout({
        matchFormat: COUNTDOWN,
        server: { ...ROUND_1, redScore: -1, blueScore: 0 },
        exchanges: [row('double', 1), row('double', 1), row('double', 1)],
        penalties: [serverCardAgainstRed(1, 1)],
        queued: [double(1)],
      }),
    );
    expect(series.closed).toEqual([
      { round: 1, redScore: 0, blueScore: 0, winnerColor: null, by: 'tablet' },
    ]);
    expect(series).toMatchObject({ redRoundWins: 0, blueRoundWins: 0, awaitingStart: true });
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

  it('keeps a row at 0-0 at 0-0 when the list holds a card: the row is the server’s score', () => {
    // The list of cards landed before the bout's row was read again.
    const series = padSeries(bout({ bestOf: 1, penalties: [serverCardAgainstRed(1)] }));
    expect(series).toMatchObject({ redScore: 0, blueScore: 0 });
  });
});
