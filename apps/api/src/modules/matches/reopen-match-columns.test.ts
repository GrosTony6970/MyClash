import { describe, it, expect } from 'vitest';
import { popLastClosedRoundColumns, reopenedResultColumns } from './reopen-match-columns';

/**
 * The round pop moved here out of `ClockService` so the penalty-void reopen in
 * `ScoringService` could share it rather than grow a second copy. It had NO
 * test of its own in either place — nothing in `clock.service.test.ts` mentions
 * `rounds_json` — so both callers were relying on code nothing watched.
 */
describe('popLastClosedRoundColumns', () => {
  const round = (n: number, winnerColor: 'red' | 'blue' | null) => ({
    round: n,
    redScore: 3,
    blueScore: 1,
    winnerColor,
    endReason: 'first_to_points',
  });

  it('pops the last round and re-derives the tallies from what is left', () => {
    const cols = popLastClosedRoundColumns([round(1, 'red'), round(2, 'blue'), round(3, 'red')], 3);

    expect(cols).toMatchObject({
      red_round_wins: 1,
      blue_round_wins: 1,
      current_round: 3,
      awaiting_round_advance: false,
      winner_registration_id: null,
      end_reason: null,
    });
    expect(cols?.['rounds_json']).toHaveLength(2);
  });

  it('writes NULL rather than an empty array when the last round is popped', () => {
    // `parseRoundsJson` tolerates either, but the column's own default is null
    // and an empty array reads as "a best-of match with no rounds yet" to
    // anything inspecting the row directly.
    expect(popLastClosedRoundColumns([round(1, 'red')], 1)?.['rounds_json']).toBeNull();
  });

  it('falls back to the given round number when the snapshot carries none', () => {
    expect(popLastClosedRoundColumns([{ winnerColor: 'red' }], 4)?.['current_round']).toBe(4);
  });

  it('returns null when there is no closed round to pop', () => {
    // How a single-round match falls through: the clock's reopen then KEEPS its
    // winner, so a bare reopen → end round-trip preserves the result.
    expect(popLastClosedRoundColumns(null, 1)).toBeNull();
    expect(popLastClosedRoundColumns([], 1)).toBeNull();
  });
});

describe('reopenedResultColumns', () => {
  it('clears the result but not the fact that the bout was fought', () => {
    const cols = reopenedResultColumns();

    expect(cols).toEqual({
      status: 'paused',
      winner_registration_id: null,
      end_reason: null,
      ended_at: null,
    });
    // `started_at` is absent on purpose — `hasBeenFought` reads it, and a bout
    // that was played stays played.
    expect(cols).not.toHaveProperty('started_at');
  });
});
