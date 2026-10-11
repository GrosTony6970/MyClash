/**
 * Which closed rounds "End round" closed, as the pad reads them.
 *
 * The server never puts a round closed on time back in play: a cancelled hit
 * moves its score, and the round stays closed (`roundShouldReopen` in the
 * API's `scoring.service.ts`: the reason `time_limit`, or none). A round the
 * engine closed by itself goes back in play when its sheet no longer ends it.
 * The round-break screen says "the round stays closed" from this alone.
 */
import { describe, expect, it } from 'vitest';
import { padSeries } from './pad-series';
import { ROUND_1, bout, closedRound, end, hit } from './pad-series.fixtures';

/** The round the bout stands on, closed on the server with this reason. */
const closedWith = (endReason: string | null | undefined) => {
  const round = { ...closedRound(1, 3, 1), ...(endReason === undefined ? {} : { endReason }) };
  if (endReason === undefined) delete (round as { endReason?: string }).endReason;
  const server = { ...ROUND_1, awaitingRoundAdvance: true, roundsJson: [round] };
  return padSeries(bout({ server })).closed[0];
};

describe('a round "End round" closed', () => {
  it('is the server’s round with the reason "time_limit"', () => {
    expect(closedWith('time_limit')).toMatchObject({ round: 1, by: 'server', onTime: true });
  });

  // The server reads a row with no reason as closed by the official (`?? null`).
  it.each([null, undefined])('is the server’s round with no reason (%j)', (endReason) => {
    expect(closedWith(endReason)).toMatchObject({ onTime: true });
  });

  it.each(['first_to_points', 'max_doubles', 'max_doubles_draw', 'max_doubles_result_stands'])(
    'is not a round the engine closed by itself (%s)',
    (endReason) => {
      expect(closedWith(endReason)?.onTime).toBeUndefined();
    },
  );

  // While its "End round" waits on the tablet the undo is refused, so nothing reads this.
  it('is not said of a round the tablet closed', () => {
    const series = padSeries(bout({ queued: [hit('red', 2, 1)], roundPresses: [end(1, 2, 0)] }));
    expect(series.closed[0]).toMatchObject({ by: 'tablet' });
    expect(series.closed[0]?.onTime).toBeUndefined();
  });
});
