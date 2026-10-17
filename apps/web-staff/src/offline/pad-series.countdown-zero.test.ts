/**
 * A bout that counts down, both fighters out of points on one unsent exchange.
 *
 * Countdown from 5, no wifi. Red has 1 point left, blue has 2. Red strikes for
 * 3 and blue answers with an afterblow of 3: red at -2, blue at -1. The board
 * stops at 0 - 0 and the fighter less far below zero wins (operator,
 * 2026-10-11). The tablet knows how far under each side went from the points
 * of its own unsent hits, and says so to the server's own rule.
 */
import { describe, expect, it } from 'vitest';
import type { ExchangeRow } from '@myclash/ui';
import { padSeries } from './pad-series';
import { FORMAT, ROUND_1, bout, end, hit } from './pad-series.fixtures';

const COUNTDOWN = { ...FORMAT, scoringDirection: 'reverse_zero_loses' as const };

/** A hit the tablet holds that the defender answered: `answer` points go the other way. */
const afterblow = (side: 'red' | 'blue', points: number, answer: number, round?: number) =>
  ({ ...hit(side, points, round), type: 'afterblow', defenderDelta: answer }) as ExchangeRow;

/** The server's row: red has 1 point left, blue has 2. */
const SERVER = { ...ROUND_1, redScore: 1, blueScore: 2 };
const BRACKET = { phaseType: 'single_elim' as const, matchNumberLabel: 'QF1' };

describe('a bout of one round that counts down, both out of points on the tablet', () => {
  const oneRound = (queued: ExchangeRow[]) =>
    padSeries(bout({ bestOf: 1, matchFormat: COUNTDOWN, server: SERVER, queued }));

  it('reads 0 - 0 and says how far under zero each side went', () => {
    expect(oneRound([afterblow('red', 3, 3)])).toMatchObject({
      redScore: 0,
      blueScore: 0,
      redBelowZero: 2,
      blueBelowZero: 1,
    });
  });

  it('says zero for a side that is not under zero', () => {
    expect(oneRound([hit('blue', 3)])).toMatchObject({
      redScore: 0,
      blueScore: 2,
      redBelowZero: 2,
      blueBelowZero: 0,
    });
  });

  it('says nothing of the kind in a bout that counts up', () => {
    const series = padSeries(bout({ bestOf: 1, queued: [hit('red', 9)] }));
    expect(Object.keys(series)).not.toContain('redBelowZero');
    expect(Object.keys(series)).not.toContain('blueBelowZero');
  });
});

describe('a round of a best-of bout that counts down, both out of points on the tablet', () => {
  const round = (queued: ExchangeRow[], over: Parameters<typeof bout>[0] = {}) =>
    padSeries(bout({ matchFormat: COUNTDOWN, server: SERVER, queued, ...over }));

  it('closes for the fighter less far below zero, in a bracket and in a Pool', () => {
    for (const phase of [BRACKET, {}]) {
      const series = round([afterblow('red', 3, 3, 1)], phase);
      expect(series.awaitingStart).toBe(true);
      expect(series.closed).toEqual([
        { round: 1, redScore: 0, blueScore: 0, winnerColor: 'blue', by: 'tablet' },
      ]);
      expect(series).toMatchObject({ redRoundWins: 0, blueRoundWins: 1 });
    }
  });

  it('gives a round "End round" closed to the winner that End was pressed on', () => {
    // A row of the bout was held, so the tablet closed nothing by itself and
    // the official pressed "End round" on 0 - 0, with blue less far below.
    const pressed = { ...end(1, 0, 0), endScore: { red: 0, blue: 0, winner: 'blue' as const } };
    const series = round([afterblow('red', 3, 3, 1)], { roundPresses: [pressed] });
    expect(series.closed).toEqual([
      { round: 1, redScore: 0, blueScore: 0, winnerColor: 'blue', by: 'tablet' },
    ]);
    // An End pressed on a board that names its leader carries no winner.
    const led = round([hit('blue', 1, 1)], { roundPresses: [end(1, 0, 2)] });
    expect(led.closed).toMatchObject([{ round: 1, winnerColor: 'blue' }]);
  });

  it('closes a true tie as a drawn round in a Pool', () => {
    // Red at 1, blue at 2: 3 off red and 4 off blue puts both at -2.
    const series = round([afterblow('red', 4, 3, 1)]);
    expect(series.closed).toEqual([
      { round: 1, redScore: 0, blueScore: 0, winnerColor: null, by: 'tablet' },
    ]);
  });

  it('keeps a true tie open in a bracket, and the next hit closes it', () => {
    const tied = round([afterblow('red', 4, 3, 1)], BRACKET);
    expect(tied).toMatchObject({ redScore: 0, blueScore: 0, awaitingStart: false, closed: [] });

    const decided = round([afterblow('red', 4, 3, 1), hit('blue', 1, 1)], BRACKET);
    expect(decided.closed).toMatchObject([{ round: 1, winnerColor: 'blue' }]);
  });

  it('decides a bout of a version from before 2026-10-11 by the board, as the server does', () => {
    // A 1.0.0 bout: the server sent the 2026-04 edition with it. Blue less far
    // below zero names nobody then: the board reads 0 - 0.
    const old = { edition: '2026-04' as const };
    expect(round([afterblow('red', 3, 3, 1)], old).closed).toEqual([
      { round: 1, redScore: 0, blueScore: 0, winnerColor: null, by: 'tablet' },
    ]);
    expect(round([afterblow('red', 3, 3, 1)], { ...old, ...BRACKET }).closed).toEqual([]);
  });
});
