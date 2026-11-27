/**
 * A single-round venues bout: the pad ends none by itself, the official
 * presses "End match". At the venue limit that End is the result, as at the
 * cap: not early, not refused, and the board stands (no doubles-limit wipe).
 *
 * A 90s Pool bout of N venues, played out (no early stop), 30 seconds on the clock.
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MATCH_FORMAT_CONFIG,
  EDITION_2026_10,
  type MatchFormatConfig,
} from '@myclash/types';
import { endIsEarly, endRefusedOnPad, limitEnd, pressedOn } from './end-guard';

const venues = (n: number): MatchFormatConfig => ({
  ...DEFAULT_MATCH_FORMAT_CONFIG,
  timeLimitsSeconds: { pool: 90, bracket: 180, finals: 180 },
  scoringUnit: 'venues',
  venuesPerRound: { pool: n, bracket: n, finals: n },
  stopWhenDecided: false,
});
/** A board whose every point is a won venue. */
const board = (redScore: number, blueScore: number) => ({
  redScore,
  blueScore,
  doubles: 0,
  redVenuesWon: redScore,
  blueVenuesWon: blueScore,
});
const POOL = { phaseType: 'pool' as const, matchNumberLabel: null };

describe('"End match" at the venue limit', () => {
  it('is not early and not refused on a level Pool board with time left', () => {
    expect(endIsEarly(venues(4), 'pool', null, 30_000, board(2, 2), EDITION_2026_10)).toBe(false);
    expect(
      endRefusedOnPad({
        matchFormat: venues(4),
        ...POOL,
        elapsedMs: 30_000,
        score: board(2, 2),
        levelStepsTaken: 0,
        edition: EDITION_2026_10,
      }),
    ).toBeNull();
  });

  it('is still early short of the limit', () => {
    expect(endIsEarly(venues(3), 'pool', null, 30_000, board(1, 0), EDITION_2026_10)).toBe(true);
  });

  it('presses the End on the board as it stands, naming its leader', () => {
    expect(limitEnd(board(2, 1), POOL, venues(3), EDITION_2026_10)).toBeNull();
    expect(pressedOn(board(2, 1), venues(3), POOL, EDITION_2026_10)).toEqual({
      red: 2,
      blue: 1,
      winner: 'red',
    });
    // Level, where a Pool may end level: the board stands, and nobody is named.
    expect(pressedOn(board(2, 2), venues(4), POOL, EDITION_2026_10)).toEqual({ red: 2, blue: 2 });
  });
});
