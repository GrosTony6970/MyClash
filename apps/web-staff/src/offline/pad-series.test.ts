/**
 * The pad's view of a bout's rounds.
 *
 * A table has no wifi. Red reaches 5 in round 1 of a best-of-3: the tablet
 * closes the round on the score it shows, the official taps "Start round 2",
 * and round 2 is played from 0-0. The server knows none of it yet.
 */
import { describe, expect, it } from 'vitest';
import { padSeries } from './pad-series';
import {
  FORMAT,
  ROUND_1,
  bout,
  cardAgainstRed,
  closedRound,
  double,
  end,
  hit,
  row,
  start,
} from './pad-series.fixtures';

describe('the doubles of the open round', () => {
  const round2 = { ...ROUND_1, currentRound: 2, roundsJson: [closedRound(1, 5, 2)] };

  it('counts the doubles of the open round only, as the server does', () => {
    const series = padSeries(
      bout({
        server: round2,
        exchanges: [row('double', 1), row('double', 1), row('clean', 2), row('double', 2)],
      }),
    );
    expect(series).toMatchObject({ round: 2, doubles: 1, doublesLimit: 3 });
  });

  it('adds the doubles the tablet still holds of that round', () => {
    const series = padSeries(
      bout({
        server: round2,
        exchanges: [row('double', 1), row('double', 2)],
        queued: [double(2), hit('red', 1, 2)],
      }),
    );
    expect(series.doubles).toBe(2);
  });

  it('reads a server row with no round as round 1, as the server does', () => {
    const exchanges = [row('double'), row('double', null)];
    expect(padSeries(bout({ exchanges })).doubles).toBe(2);
    expect(padSeries(bout({ server: round2, exchanges })).doubles).toBe(0);
  });

  it('counts every double of a single-round bout, whatever its rows say', () => {
    const series = padSeries(
      bout({
        bestOf: 1,
        exchanges: [row('double', 1), row('double', 2), row('double')],
        queued: [double()],
      }),
    );
    expect(series).toMatchObject({ round: 1, doubles: 4, doublesLimit: 3 });
  });
});

describe('the doubles limit that applies', () => {
  const limit = (phaseType: ReturnType<typeof bout>['phaseType']) =>
    padSeries(bout({ phaseType })).doublesLimit;

  it("is the format's limit in a pool and in a Swiss round", () => {
    expect(limit('pool')).toBe(3);
    expect(limit('swiss')).toBe(3);
  });

  it('is none in a bracket, and for a bout whose phase is not known: the server applies none', () => {
    expect(limit('single_elim')).toBeNull();
    expect(limit('double_elim')).toBeNull();
    expect(limit(undefined)).toBeNull();
  });

  it('is none when the format has none', () => {
    const matchFormat = { ...FORMAT, maxDoubleHits: null };
    expect(padSeries(bout({ matchFormat })).doublesLimit).toBeNull();
  });
});

describe('a single-round bout', () => {
  it('is one round: the server’s score plus everything the tablet holds, never closed here', () => {
    const series = padSeries(
      bout({
        bestOf: 1,
        server: { ...ROUND_1, redScore: 3, blueScore: 1 },
        queued: [hit('red', 2), hit('blue', 1, 4)],
      }),
    );
    expect(series).toMatchObject({
      round: 1,
      redScore: 5,
      blueScore: 2,
      closed: [],
      awaitingStart: false,
      decided: null,
      by: 'server',
    });
  });
});

describe('the server’s view: nothing waits on the tablet', () => {
  it('is the server’s open round and its score', () => {
    const series = padSeries(bout({ server: { ...ROUND_1, redScore: 3, blueScore: 1 } }));
    expect(series).toMatchObject({
      round: 1,
      redScore: 3,
      blueScore: 1,
      awaitingStart: false,
      decided: null,
      by: 'server',
      redRoundWins: 0,
      blueRoundWins: 0,
    });
  });

  it('closes nothing by itself: a score at the cap on the server’s open round is the server’s to close', () => {
    const series = padSeries(bout({ server: { ...ROUND_1, redScore: 5, blueScore: 2 } }));
    expect(series).toMatchObject({ awaitingStart: false, closed: [], by: 'server' });
  });

  it('waits for "Start round 2" when the server closed round 1', () => {
    const server = { ...ROUND_1, awaitingRoundAdvance: true, redScore: 5, blueScore: 2 };
    const series = padSeries(bout({ server: { ...server, roundsJson: [closedRound(1, 5, 2)] } }));
    expect(series).toMatchObject({ round: 1, awaitingStart: true, redRoundWins: 1, by: 'server' });
    expect(series.closed).toEqual([
      { round: 1, redScore: 5, blueScore: 2, winnerColor: 'red', by: 'server' },
    ]);
  });

  it('is decided when the server’s closed rounds give a side two rounds of three', () => {
    const roundsJson = [closedRound(1, 5, 2), closedRound(2, 5, 4)];
    const series = padSeries(bout({ server: { ...ROUND_1, currentRound: 2, roundsJson } }));
    expect(series).toMatchObject({ awaitingStart: false, decided: { winnerColor: 'red' } });
  });

  it('reads a `rounds_json` that is no list, or a row that is no round, as nothing closed', () => {
    expect(padSeries(bout({ server: { ...ROUND_1, roundsJson: null } })).closed).toEqual([]);
    expect(
      padSeries(bout({ server: { ...ROUND_1, roundsJson: [{ nope: 1 }, 'x'] } })).closed,
    ).toEqual([]);
  });
});

describe('the tablet closes a round with no network', () => {
  it('at the cap, on the score it shows: the server’s part plus the hits it holds', () => {
    const series = padSeries(
      bout({ server: { ...ROUND_1, redScore: 3, blueScore: 2 }, queued: [hit('red', 2, 1)] }),
    );
    expect(series).toMatchObject({ round: 1, redScore: 5, blueScore: 2, awaitingStart: true });
    expect(series.by).toBe('tablet');
    expect(series.closed).toEqual([
      { round: 1, redScore: 5, blueScore: 2, winnerColor: 'red', by: 'tablet' },
    ]);
    expect(series.redRoundWins).toBe(1);
  });

  it('not under the cap: the round stays open, and the view is still the server’s', () => {
    const series = padSeries(bout({ queued: [hit('red', 4, 1)] }));
    expect(series).toMatchObject({ redScore: 4, awaitingStart: false, closed: [], by: 'server' });
  });

  it('at the doubles limit, with nobody winning a round the limit wipes, at 0-0 as the server puts it', () => {
    const series = padSeries(bout({ queued: [double(1), double(1), double(1), hit('red', 2, 1)] }));
    expect(series.awaitingStart).toBe(true);
    expect(series.closed).toEqual([
      { round: 1, redScore: 0, blueScore: 0, winnerColor: null, by: 'tablet' },
    ]);
    expect(series).toMatchObject({ redScore: 0, blueScore: 0 });
  });

  it('at the doubles limit with "the result stands": the round keeps its points and its leader', () => {
    const matchFormat = { ...FORMAT, maxDoubleHitOutcome: 'result_stands' as const };
    const queued = [double(1), double(1), double(1), hit('red', 2, 1)];
    expect(padSeries(bout({ matchFormat, queued })).closed).toEqual([
      { round: 1, redScore: 2, blueScore: 0, winnerColor: 'red', by: 'tablet' },
    ]);
  });

  it('not at the doubles limit in a bracket: the server applies none there', () => {
    const queued = [double(1), double(1), double(1)];
    expect(padSeries(bout({ phaseType: 'single_elim', queued })).awaitingStart).toBe(false);
  });

  it('counts a card the tablet holds in the round’s score', () => {
    const series = padSeries(
      bout({ queued: [hit('red', 5, 1)], queuedPenalties: [cardAgainstRed(1, 1)] }),
    );
    expect(series).toMatchObject({ redScore: 4, awaitingStart: false });
  });

  it('by "End round", for the leader of the score it was pressed on', () => {
    const series = padSeries(bout({ queued: [hit('blue', 3, 1)], roundPresses: [end(1, 1, 3)] }));
    expect(series.awaitingStart).toBe(true);
    expect(series.closed).toEqual([
      { round: 1, redScore: 1, blueScore: 3, winnerColor: 'blue', by: 'tablet' },
    ]);
    expect(series).toMatchObject({ redScore: 1, blueScore: 3 });
  });

  it('counts a queued row with no round, or of a round the server passed, in the server’s open round', () => {
    const server = { ...ROUND_1, currentRound: 2, roundsJson: [closedRound(1, 5, 0)] };
    const series = padSeries(bout({ server, queued: [hit('red', 2), hit('red', 1, 1)] }));
    expect(series).toMatchObject({ round: 2, redScore: 3 });
  });
});

describe('round 2 on the tablet, before the server knows of it', () => {
  const round1 = [hit('red', 5, 1)];

  it('opens at 0-0 when "Start round 2" is queued, with round 1 to the tablet’s winner', () => {
    const series = padSeries(bout({ queued: round1, roundPresses: [start(2)] }));
    expect(series).toMatchObject({
      round: 2,
      redScore: 0,
      blueScore: 0,
      doubles: 0,
      awaitingStart: false,
      redRoundWins: 1,
      by: 'tablet',
    });
  });

  it('opens at 0-0 whatever the server’s round 1 stood at: that score is round 1’s', () => {
    const server = { ...ROUND_1, redScore: 3, blueScore: 2 };
    const series = padSeries(
      bout({ server, queued: [hit('red', 2, 1)], roundPresses: [start(2)] }),
    );
    expect(series).toMatchObject({ round: 2, redScore: 0, blueScore: 0 });
    expect(series.closed[0]).toMatchObject({ round: 1, redScore: 5, blueScore: 2 });
  });

  it('counts the hits of round 2 in round 2, and not in round 1', () => {
    const series = padSeries(
      bout({ queued: [...round1, hit('blue', 3, 2), double(2)], roundPresses: [start(2)] }),
    );
    expect(series).toMatchObject({ round: 2, redScore: 0, blueScore: 3, doubles: 1 });
    expect(series.closed[0]).toMatchObject({ round: 1, redScore: 5, blueScore: 0 });
  });

  it('stays in round 2 once the server took "Start round 2" and the bout is not read again', () => {
    // The advance left the queue; the server's row still says round 1.
    const series = padSeries(bout({ queued: [hit('blue', 3, 2)] }));
    expect(series).toMatchObject({ round: 2, blueScore: 3, by: 'tablet' });
  });

  it('is decided when the tablet’s rounds give a side two of three, and no "Start round" is next', () => {
    const series = padSeries(
      bout({ queued: [...round1, hit('red', 5, 2)], roundPresses: [start(2)] }),
    );
    expect(series).toMatchObject({
      round: 2,
      awaitingStart: false,
      decided: { winnerColor: 'red' },
      redRoundWins: 2,
      by: 'tablet',
    });
  });

  it('goes to round 3 at one round each, and is decided there', () => {
    const queued = [...round1, hit('blue', 5, 2), hit('blue', 5, 3)];
    const series = padSeries(bout({ queued, roundPresses: [start(2), start(3)] }));
    expect(series).toMatchObject({ round: 3, decided: { winnerColor: 'blue' }, blueRoundWins: 2 });
  });

  it('keeps the server’s own closed round over the tablet’s count of it', () => {
    const server = { ...ROUND_1, awaitingRoundAdvance: true, roundsJson: [closedRound(1, 5, 4)] };
    const series = padSeries(bout({ server, roundPresses: [start(2)] }));
    expect(series.closed).toEqual([
      { round: 1, redScore: 5, blueScore: 4, winnerColor: 'red', by: 'server' },
    ]);
    expect(series).toMatchObject({ round: 2, by: 'tablet' });
  });
});

describe('where the tablet predicts nothing', () => {
  const ahead = { queued: [hit('red', 5, 1), hit('blue', 2, 2)], roundPresses: [start(2)] };

  it('on a bout the server has completed or voided: a forfeit at a round break waits for no round', () => {
    const server = { ...ROUND_1, awaitingRoundAdvance: true, over: true };
    const series = padSeries(bout({ ...ahead, server }));
    expect(series).toMatchObject({ round: 1, awaitingStart: false, by: 'server' });
  });
});

describe('the server’s own word for "a round waits"', () => {
  it('is read from its row, also when `rounds_json` holds no row of that round', () => {
    const server = { ...ROUND_1, awaitingRoundAdvance: true, redScore: 5, blueScore: 2 };
    expect(padSeries(bout({ server }))).toMatchObject({
      awaitingStart: true,
      redScore: 5,
      blueScore: 2,
    });
  });

  it('is not said by a closed round alone: the row says the round does not wait', () => {
    const server = { ...ROUND_1, roundsJson: [closedRound(1, 5, 2)] };
    expect(padSeries(bout({ server })).awaitingStart).toBe(false);
  });
});

describe('a row of the bout is held in the inbox', () => {
  it('gives the server’s round: the tablet closes nothing and opens nothing', () => {
    const series = padSeries(
      bout({ queued: [hit('red', 5, 1), hit('blue', 2, 2)], roundPresses: [start(2)], held: true }),
    );
    expect(series).toMatchObject({ round: 1, awaitingStart: false, closed: [], by: 'server' });
  });

  it('shows what the tablet holds in that round, whatever round it was tapped in', () => {
    const series = padSeries(
      bout({ queued: [hit('red', 5, 1), hit('blue', 2, 2), double(2)], held: true }),
    );
    expect(series).toMatchObject({ redScore: 5, blueScore: 2, doubles: 1 });
  });
});
