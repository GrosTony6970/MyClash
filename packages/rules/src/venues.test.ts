/**
 * Venues scoring: a round limited by a number of won exchanges.
 *
 * In `venues` mode a clean hit is worth 1 to its striker, whatever the button,
 * and wins one venue. An afterblow, a double and a no-exchange win nothing. A
 * round ends when N venues are spent, or earlier when the lead on the board can
 * no longer be caught in the venues left (`stopWhenDecided`).
 */
import { describe, expect, it } from 'vitest';
import {
  computeMatchFormatScore,
  EDITION_2026_10,
  exchangeDeltas,
  getEffectiveVenuesPerRound,
  roundOutcome,
  type AfterblowMode,
  type Exchange,
  type MatchFormatConfig,
  type ScoringUnit,
} from './index';

function config(over: Partial<MatchFormatConfig> = {}): MatchFormatConfig {
  return {
    pointCap: 5,
    scoringDirection: 'normal',
    timerMode: 'countdown',
    timeLimitsSeconds: { pool: 90, bracket: 90, finals: 90 },
    softClockLimitSeconds: 5,
    maxDoubleHits: 3,
    maxDoubleHitOutcome: 'double_loss_zero_scores',
    bestOf: { pool: 3, bracket: 3, finals: 3 },
    levelAtTime: {
      pool: [{ kind: 'draw' }],
      bracket: [{ kind: 'sudden_death' }],
      finals: [{ kind: 'sudden_death' }],
    },
    scoringUnit: 'venues',
    venuesPerRound: { pool: 5, bracket: 5, finals: 5 },
    stopWhenDecided: true,
    ...over,
  };
}

const POOL = { phaseType: 'pool' as const, matchNumberLabel: 'M1' };
const BRACKET = { phaseType: 'single_elim' as const, matchNumberLabel: 'QF1' };
const OPEN = { autoOver: false, winnerColor: null, endReason: null };

let seq = 0;
function ex(over: Partial<Exchange>): Exchange {
  seq += 1;
  return {
    id: `ex-${seq}`,
    clientUuid: `uuid-${seq}`,
    matchId: 'm1',
    sequence: seq,
    type: 'clean',
    occurredAt: '2026-11-27T10:00:00.000Z',
    firstStrikerColor: 'red',
    firstStrikeValue: 1,
    afterblowValue: null,
    noExchangeReason: null,
    voided: false,
    ...over,
  };
}

/** Clean red 2, clean blue 1, afterblow red 2-1, a double, a no-exchange. */
const MIXED: Exchange[] = [
  ex({ type: 'clean', firstStrikerColor: 'red', firstStrikeValue: 2 }),
  ex({ type: 'clean', firstStrikerColor: 'blue', firstStrikeValue: 1 }),
  ex({ type: 'afterblow', firstStrikerColor: 'red', firstStrikeValue: 2, afterblowValue: 1 }),
  ex({ type: 'double', firstStrikerColor: null, firstStrikeValue: null }),
  ex({ type: 'no_exchange', firstStrikerColor: null, firstStrikeValue: null }),
];

describe('computeMatchFormatScore in venues mode', () => {
  it('scores 1 per clean hit whatever the button', () => {
    expect(computeMatchFormatScore(POOL, MIXED, config())).toMatchObject({
      redScore: 1,
      blueScore: 1,
      redVenuesWon: 1,
      blueVenuesWon: 1,
      doubles: 1,
      // A stat follows the board: the venue's 1, not the button's 2.
      redTargetPoints: 1,
      blueTargetPoints: 1,
      // Who was hit is unchanged: the afterblow still hit red.
      redTimesHit: 2,
      blueTimesHit: 1,
    });
  });

  it('afterblow wins no venue in full mode either', () => {
    const afterblow = [
      ex({ type: 'afterblow', firstStrikerColor: 'red', firstStrikeValue: 1, afterblowValue: 1 }),
    ];
    expect(computeMatchFormatScore(POOL, afterblow, config(), 'full')).toMatchObject({
      redScore: 0,
      blueScore: 0,
      redVenuesWon: 0,
      blueVenuesWon: 0,
    });
  });

  it('points mode counts venues without changing the score', () => {
    // Full mode: red 2 + afterblow 2, blue 1 + afterblow 1.
    expect(computeMatchFormatScore(POOL, MIXED, config({ scoringUnit: 'points' }))).toEqual({
      redScore: 4,
      blueScore: 2,
      redWins: 0,
      blueWins: 0,
      redTargetPoints: 4,
      blueTargetPoints: 2,
      redTimesHit: 2,
      blueTimesHit: 1,
      doubles: 1,
      redVenuesWon: 1,
      blueVenuesWon: 1,
    });
  });

  it('skips a voided clean hit', () => {
    const voided = [ex({ type: 'clean', firstStrikerColor: 'red', voided: true })];
    expect(computeMatchFormatScore(POOL, voided, config())).toMatchObject({
      redScore: 0,
      redVenuesWon: 0,
    });
  });
});

describe('exchangeDeltas', () => {
  const clean = (color: 'red' | 'blue', value: number) =>
    ex({ type: 'clean', firstStrikerColor: color, firstStrikeValue: value });
  const afterblow = ex({
    type: 'afterblow',
    firstStrikerColor: 'red',
    firstStrikeValue: 2,
    afterblowValue: 1,
  });
  const double = ex({ type: 'double', firstStrikerColor: null, firstStrikeValue: null });
  const none = ex({ type: 'no_exchange', firstStrikerColor: null, firstStrikeValue: null });
  const noStriker = ex({ type: 'clean', firstStrikerColor: null, firstStrikeValue: 2 });

  it.each<
    [
      string,
      Exchange,
      AfterblowMode,
      ScoringUnit,
      { red: number; blue: number; venue: 'red' | 'blue' | null },
    ]
  >([
    ['clean red 2', clean('red', 2), 'full', 'points', { red: 2, blue: 0, venue: 'red' }],
    ['clean red 2', clean('red', 2), 'full', 'venues', { red: 1, blue: 0, venue: 'red' }],
    ['clean blue 3', clean('blue', 3), 'full', 'points', { red: 0, blue: 3, venue: 'blue' }],
    ['clean blue 3', clean('blue', 3), 'full', 'venues', { red: 0, blue: 1, venue: 'blue' }],
    ['afterblow red 2-1', afterblow, 'full', 'points', { red: 2, blue: 1, venue: null }],
    ['afterblow red 2-1', afterblow, 'full', 'venues', { red: 0, blue: 0, venue: null }],
    ['afterblow red 2-1', afterblow, 'deductive', 'points', { red: 1, blue: 0, venue: null }],
    ['afterblow red 2-1', afterblow, 'deductive', 'venues', { red: 0, blue: 0, venue: null }],
    ['double', double, 'full', 'points', { red: 0, blue: 0, venue: null }],
    ['double', double, 'full', 'venues', { red: 0, blue: 0, venue: null }],
    ['no exchange', none, 'full', 'points', { red: 0, blue: 0, venue: null }],
    ['no exchange', none, 'full', 'venues', { red: 0, blue: 0, venue: null }],
    ['clean, no striker', noStriker, 'full', 'points', { red: 0, blue: 0, venue: null }],
    ['clean, no striker', noStriker, 'full', 'venues', { red: 0, blue: 0, venue: null }],
  ])('%s, %s afterblow, %s', (_name, exchange, mode, unit, expected) => {
    expect(exchangeDeltas(exchange, mode, unit)).toEqual(expected);
  });
});

describe('roundOutcome in venues mode', () => {
  it('stops a decided round', () => {
    const score = { redScore: 3, blueScore: 0, doubles: 0, redVenuesWon: 3, blueVenuesWon: 0 };
    expect(roundOutcome(POOL, score, config(), EDITION_2026_10)).toEqual({
      autoOver: true,
      winnerColor: 'red',
      endReason: 'venue_limit',
    });
  });

  it('plays on when early stop is off', () => {
    const playOn = config({ stopWhenDecided: false });
    const decided = { redScore: 3, blueScore: 0, doubles: 0, redVenuesWon: 3, blueVenuesWon: 0 };
    expect(roundOutcome(POOL, decided, playOn, EDITION_2026_10)).toEqual(OPEN);
    const spent = { redScore: 4, blueScore: 1, doubles: 0, redVenuesWon: 4, blueVenuesWon: 1 };
    expect(roundOutcome(POOL, spent, playOn, EDITION_2026_10)).toEqual({
      autoOver: true,
      winnerColor: 'red',
      endReason: 'venue_limit',
    });
  });

  it('a card keeps a round open', () => {
    // Two card points for blue: lead 1, two venues left.
    const score = { redScore: 3, blueScore: 2, doubles: 0, redVenuesWon: 3, blueVenuesWon: 0 };
    expect(roundOutcome(POOL, score, config(), EDITION_2026_10)).toEqual(OPEN);
  });

  it('a card can decide a round early', () => {
    // Two card points for red: lead 4, three venues left.
    const score = { redScore: 4, blueScore: 0, doubles: 0, redVenuesWon: 2, blueVenuesWon: 0 };
    expect(roundOutcome(POOL, score, config(), EDITION_2026_10)).toEqual({
      autoOver: true,
      winnerColor: 'red',
      endReason: 'venue_limit',
    });
  });

  it('an even N level in a bracket stays open, in a pool is a draw', () => {
    const four = config({ venuesPerRound: { pool: 4, bracket: 4, finals: 4 } });
    const level = { redScore: 2, blueScore: 2, doubles: 0, redVenuesWon: 2, blueVenuesWon: 2 };
    expect(roundOutcome(BRACKET, level, four, EDITION_2026_10)).toEqual(OPEN);
    expect(roundOutcome(POOL, level, four, EDITION_2026_10)).toEqual({
      autoOver: true,
      winnerColor: null,
      endReason: 'venue_limit',
    });
    // The next won venue puts someone ahead and ends the bracket round.
    const next = { redScore: 3, blueScore: 2, doubles: 0, redVenuesWon: 3, blueVenuesWon: 2 };
    expect(roundOutcome(BRACKET, next, four, EDITION_2026_10)).toEqual({
      autoOver: true,
      winnerColor: 'red',
      endReason: 'venue_limit',
    });
  });

  it('the point cap is not read in venues mode', () => {
    const score = { redScore: 2, blueScore: 0, doubles: 0, redVenuesWon: 2, blueVenuesWon: 0 };
    expect(roundOutcome(POOL, score, config({ pointCap: 2 }), EDITION_2026_10)).toEqual(OPEN);
  });

  it('the doubles ceiling still ends a pool round', () => {
    const score = { redScore: 1, blueScore: 0, doubles: 3, redVenuesWon: 1, blueVenuesWon: 0 };
    expect(roundOutcome(POOL, score, config({ maxDoubleHits: 3 }), EDITION_2026_10)).toEqual({
      autoOver: true,
      winnerColor: null,
      endReason: 'max_doubles',
    });
  });
});

describe('getEffectiveVenuesPerRound', () => {
  const perPhase = config({ venuesPerRound: { pool: 3, bracket: 5, finals: 7 } });

  it('reads the venues of the bout’s phase', () => {
    expect(getEffectiveVenuesPerRound(POOL, perPhase)).toBe(3);
    expect(getEffectiveVenuesPerRound(BRACKET, perPhase)).toBe(5);
    expect(
      getEffectiveVenuesPerRound({ phaseType: 'single_elim', matchNumberLabel: 'F' }, perPhase),
    ).toBe(7);
  });

  it('reads the pool’s value for a Swiss bout with no Swiss value of its own', () => {
    const swiss = { phaseType: 'swiss' as const, matchNumberLabel: 'R1' };
    expect(getEffectiveVenuesPerRound(swiss, perPhase)).toBe(3);
    const ownSwiss = config({ venuesPerRound: { pool: 3, swiss: 9, bracket: 5, finals: 7 } });
    expect(getEffectiveVenuesPerRound(swiss, ownSwiss)).toBe(9);
  });
});
