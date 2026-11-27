/**
 * A venues bout on the pad: each round is fought over N won venues, and the
 * pad counts them as it counts the doubles: the server's clean hits of the
 * round plus the clean hits the tablet still holds.
 *
 * A table has no wifi. A best-of-3 Pool bout of 3 venues a round, stopped
 * once decided: red won one venue on the server, the tablet holds a second.
 * Red leads 2-0 with one venue left, so the round is decided and the tablet
 * closes it for red.
 */
import { describe, expect, it } from 'vitest';
import type { MatchFormatConfig } from '@myclash/types';
import type { ExchangeRow } from '@myclash/ui';
import { padSeries } from './pad-series';
import { FORMAT, ROUND_1, bout, double, hit, row } from './pad-series.fixtures';

const VENUES: MatchFormatConfig = {
  ...FORMAT,
  scoringUnit: 'venues',
  venuesPerRound: { pool: 3, bracket: 3, finals: 3 },
  stopWhenDecided: true,
};

/** A clean hit on the server's list: one venue to `side`, in `round`. */
const venue = (side: 'red' | 'blue', round: number): ExchangeRow => ({
  ...row('clean', round),
  scoringSide: side,
  scoreDelta: 1,
  defenderDelta: null,
});

describe('a best-of-3 venues bout with no network', () => {
  const redOneUp = { ...ROUND_1, redScore: 1 };

  it('closes round 1 for red on the tablet once its lead outruns the venues left', () => {
    const series = padSeries(
      bout({
        matchFormat: VENUES,
        server: redOneUp,
        exchanges: [venue('red', 1)],
        queued: [hit('red', 1, 1)],
      }),
    );
    expect(series.closed).toEqual([
      { round: 1, redScore: 2, blueScore: 0, winnerColor: 'red', by: 'tablet' },
    ]);
    expect(series).toMatchObject({ awaitingStart: true, by: 'tablet' });
  });

  it('keeps round 1 open while the venues left can still level it', () => {
    const series = padSeries(
      bout({
        matchFormat: VENUES,
        server: redOneUp,
        exchanges: [venue('red', 1)],
        queued: [hit('blue', 1, 1)],
      }),
    );
    expect(series.closed).toEqual([]);
    expect(series).toMatchObject({ redVenuesWon: 1, blueVenuesWon: 1, awaitingStart: false });
  });

  it('counts only the clean hits of the round as venues: a double wins nobody one', () => {
    const series = padSeries(
      bout({
        matchFormat: VENUES,
        server: { ...ROUND_1, currentRound: 2, roundsJson: [] },
        exchanges: [venue('red', 1), venue('blue', 2), row('double', 2)],
        queued: [double(2)],
      }),
    );
    expect(series).toMatchObject({ round: 2, redVenuesWon: 0, blueVenuesWon: 1 });
  });
});

describe('a single-round venues bout', () => {
  it('counts the venues the tablet still holds on the round it stands on', () => {
    const series = padSeries(
      bout({
        bestOf: 1,
        matchFormat: VENUES,
        queued: [hit('red', 1), hit('blue', 1), hit('red', 1)],
      }),
    );
    expect(series.redVenuesWon + series.blueVenuesWon).toBe(3);
    expect(series).toMatchObject({ redVenuesWon: 2, blueVenuesWon: 1 });
  });
});
