/**
 * One finished bout, one result, whoever reads it (spec 2026-11-27-bout-result-is-stored).
 *
 * TF_v1's pool score counts a win from the stored winner only. The W/D/L columns
 * (`boutOutcomes`, the reader the standings use) and a club formula's
 * `victories` (`deriveFighterStats`) read the same bout. They disagreed on a
 * finished bout with no winner but unequal scores: those two gave the win to
 * the leader. The case that made one: a card after a doubles-limit draw
 * (ruling 1009) — the board is wiped to 0-0, then the card leaves 0 to -1.
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FORMULA_CONSTANTS,
  EDITION_2026_10,
  TF_v1,
  boutOutcomes,
  createFormulaRuleset,
  deriveFighterStats,
} from '../src';
import type { Exchange, ScoredMatch } from '../src/types';

const hit = (seq: number, over: Partial<Exchange>): Exchange => ({
  id: `ex-${seq}`,
  clientUuid: `uuid-${seq}`,
  matchId: 'm1',
  sequence: seq,
  type: 'clean',
  occurredAt: '2026-11-27T10:00:00.000Z',
  firstStrikerColor: null,
  firstStrikeValue: null,
  afterblowValue: null,
  noExchangeReason: null,
  voided: false,
  ...over,
});

/** Red hit once, then four doubles reached the limit, set to "draw"; a card took 1 from blue. */
const CARD_AFTER_DRAW: ScoredMatch = {
  id: 'm1',
  redRegistrationId: 'R',
  blueRegistrationId: 'B',
  winnerRegistrationId: null,
  endReason: 'max_doubles_draw',
  redScore: 0,
  blueScore: -1,
  exchanges: [
    hit(1, { firstStrikerColor: 'red', firstStrikeValue: 1 }),
    ...[2, 3, 4, 5].map((seq) => hit(seq, { type: 'double' })),
  ],
};

const VICTORIES = createFormulaRuleset(
  'Club_W',
  '1.0.0',
  'Club W',
  {
    scoreFormula: { type: 'var', name: 'victories' },
    constants: DEFAULT_FORMULA_CONSTANTS,
    tiebreakers: [],
  },
  EDITION_2026_10,
);

const pool = (ruleset: typeof TF_v1) =>
  ruleset.scorePoolFighters!({
    registrationIds: ['R', 'B'],
    completedMatches: [CARD_AFTER_DRAW],
    afterblowMode: 'full',
    config: {},
  });

describe('a card after a doubles-limit draw (ruling 1009)', () => {
  it('is a draw in the W/D/L columns', () => {
    expect(boutOutcomes(CARD_AFTER_DRAW)).toEqual({ red: 'draw', blue: 'draw' });
  });

  it('is a draw for a club formula: no victory for the fighter ahead', () => {
    expect(deriveFighterStats('R', [CARD_AFTER_DRAW], 'full')).toMatchObject({
      victories: 0,
      ties: 1,
      losses: 0,
    });
    expect(pool(VICTORIES).get('R')).toBe(0);
  });

  it('counts no win in TF_v1’s score either: the three agree', () => {
    // Red: no win, 1 point, never hit, 4 doubles: (0 x 3 + 1) / (0 + 4 x 3 / 3) = 0.25.
    // A win counted for the leader would read (3 + 1) / 4 = 1.
    expect(pool(TF_v1).get('R')).toBe(0.25);
  });
});
