/**
 * What the screen remembers of the rounds while a send is out (plan 14.3).
 *
 * The wifi is back. The tablet sends round 1's hits, "Start round 2", round
 * 2's hits. Each row the server takes leaves the queue at once, and the bout's
 * row is read only when the send has ended. Computed again in the middle, from
 * the rows not sent yet, a round at its cap would read "open" with the scoring
 * buttons live, and round 1 would read 0-0 with no winner.
 */
import { describe, expect, it } from 'vitest';
import { padSeries } from './pad-series';
import { ROUND_1, bout, closedRound, hit, start } from './pad-series.fixtures';
import { rememberSeries } from './pad-series-memory';

const remember = (
  now: ReturnType<typeof padSeries>,
  before: ReturnType<typeof padSeries> | null,
  held = false,
) => rememberSeries(now, before, held, 3);

/** Red reached the cap in round 1 on the tablet: the round-break screen is up. */
const closedOnTablet = padSeries(bout({ queued: [hit('red', 5, 1)] }));
/** The server took the hit, and the bout is not read again: its row is old. */
const staleServer = padSeries(bout());

describe('a round the tablet closed', () => {
  it('stays closed while the queue is empty and the server’s row is old', () => {
    expect(staleServer).toMatchObject({ awaitingStart: false, by: 'server' });

    const shown = remember(staleServer, closedOnTablet);

    expect(shown).toBe(closedOnTablet);
    expect(shown).toMatchObject({ awaitingStart: true, redScore: 5, by: 'tablet' });
  });

  it('gives way to the server’s row once that row has the round closed', () => {
    const server = { ...ROUND_1, awaitingRoundAdvance: true, redScore: 5 };
    const confirmed = padSeries(
      bout({ server: { ...server, roundsJson: [closedRound(1, 5, 0)] } }),
    );

    const shown = remember(confirmed, closedOnTablet);

    expect(shown).toBe(confirmed);
    expect(shown.closed[0]?.by).toBe('server');
  });

  it('gives way when a row of the bout is held: the server’s row stands', () => {
    expect(remember(staleServer, closedOnTablet, true)).toBe(staleServer);
  });

  it('is not remembered from a view that was the server’s own', () => {
    const fromServer = padSeries(
      bout({
        server: { ...ROUND_1, awaitingRoundAdvance: true, roundsJson: [closedRound(1, 5, 0)] },
      }),
    );
    expect(remember(staleServer, fromServer)).toBe(staleServer);
    expect(remember(staleServer, null)).toBe(staleServer);
  });
});

describe('round 2 opened on the tablet', () => {
  const inRound2 = padSeries(bout({ queued: [hit('red', 5, 1)], roundPresses: [start(2)] }));

  it('stays open when the server took "Start round 2" and its row still says round 1', () => {
    const shown = remember(staleServer, inRound2);

    expect(shown).toBe(inRound2);
    expect(shown.round).toBe(2);
  });

  it('gives way to the server’s row once that row is in round 2', () => {
    const server = { ...ROUND_1, currentRound: 2, roundsJson: [closedRound(1, 5, 0)] };
    const caughtUp = padSeries(bout({ server }));

    expect(remember(caughtUp, inRound2)).toBe(caughtUp);
  });
});

describe('a round the tablet closed, counted again in the middle of a send', () => {
  /** Round 1 was closed 5-0 on the tablet, and round 2 is in play. */
  const before = padSeries(
    bout({ queued: [hit('red', 5, 1), hit('blue', 2, 2)], roundPresses: [start(2)] }),
  );
  /** The server took round 1's hit: only round 2's rows wait, and the server's row is old. */
  const midSend = padSeries(bout({ queued: [hit('blue', 2, 2)], roundPresses: [start(2)] }));

  it('reads 0-0 with no winner when it is computed alone', () => {
    expect(midSend.closed).toEqual([
      { round: 1, redScore: 0, blueScore: 0, winnerColor: null, by: 'tablet' },
    ]);
    expect(midSend.redRoundWins).toBe(0);
  });

  it('keeps the score and the winner it was closed on', () => {
    const shown = remember(midSend, before);

    expect(shown.closed).toEqual([
      { round: 1, redScore: 5, blueScore: 0, winnerColor: 'red', by: 'tablet' },
    ]);
    expect(shown).toMatchObject({ round: 2, blueScore: 2, redRoundWins: 1, by: 'tablet' });
  });

  it('keeps the series decided: the deciding hit left the queue, an End press still waits', () => {
    const decided = padSeries(
      bout({ queued: [hit('red', 5, 1), hit('red', 5, 2)], roundPresses: [start(2)] }),
    );
    // Round 1's hit and "Start round 2" are taken; the server's row is old.
    const later = padSeries(bout({ queued: [hit('red', 4, 2)] }));
    expect(later.decided).toBeNull();

    const shown = remember(later, decided);

    expect(shown).toMatchObject({ decided: { winnerColor: 'red' }, redRoundWins: 2, round: 2 });
    expect(shown.awaitingStart).toBe(false);
  });

  it('takes the server’s closed round over the one it kept, while the tablet is ahead in a later round', () => {
    // The server confirmed round 1 at 5-1 and is in round 2; the tablet closed round 2 by itself.
    const server = { ...ROUND_1, currentRound: 2, roundsJson: [closedRound(1, 5, 1)] };
    const now = padSeries(bout({ server, queued: [hit('blue', 5, 2)] }));
    expect(now.by).toBe('tablet');

    const shown = remember(now, before);

    expect(shown.closed).toEqual([
      { round: 1, redScore: 5, blueScore: 1, winnerColor: 'red', by: 'server' },
      { round: 2, redScore: 0, blueScore: 5, winnerColor: 'blue', by: 'tablet' },
    ]);
  });

  it('takes the server’s closed round over the one it kept', () => {
    const server = { ...ROUND_1, currentRound: 2, roundsJson: [closedRound(1, 5, 1)] };
    const now = padSeries(bout({ server, queued: [hit('blue', 2, 2)] }));

    const shown = remember(now, before);

    expect(shown.closed).toEqual([
      { round: 1, redScore: 5, blueScore: 1, winnerColor: 'red', by: 'server' },
    ]);
  });
});
