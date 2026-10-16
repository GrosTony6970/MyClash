import { describe, expect, it } from 'vitest';
import { BOUT, hit, phase, setup, storedBout } from './scoring.service.corrections.fixtures';

/**
 * A best-of series won on its last hit moves its winner on in the bracket.
 *
 * Red wins round 1, then reaches the cap in round 2: the series is hers. A single fight tells
 * the bracket itself; a series told it only through the clock's End, which is skipped when the
 * clock is idle or already ended (a forfeit taken back ends it) and swallows its own failure.
 * The bout read "completed, red wins" and the next round of the bracket stayed empty.
 */
const bestOfThree = () => ({
  ...phase('single_elim'),
  tournaments: {
    ruleset_config: { matchFormat: { pointCap: 7, bestOf: { pool: 3, bracket: 3, finals: 3 } } },
    scoring_config_json: null,
  },
});

const ROUND_1_RED = {
  round: 1,
  redScore: 7,
  blueScore: 0,
  winnerColor: 'red',
  endReason: 'first_to_points',
};

function clinchedInRound2() {
  return setup(
    storedBout({
      phases: bestOfThree(),
      match_number_label: 'QF1',
      status: 'running',
      winner_registration_id: null,
      end_reason: null,
      current_round: 2,
      rounds_json: [ROUND_1_RED],
      red_round_wins: 1,
      blue_round_wins: 0,
    }),
    [hit(1, 'red', 3), hit(2, 'red', 3), hit(3, 'red', 1)].map((row) => ({
      ...row,
      round_number: 2,
    })),
  );
}

describe('ScoringService.recomputeMatchScore — a best-of series won on a hit', () => {
  it('tells the bracket, though the clock has no End to give (it is already ended)', async () => {
    const { service, matchCompletion, written } = clinchedInRound2();

    await service.recomputeMatchScore(BOUT);

    expect(written()?.row).toMatchObject({ status: 'completed', winner_registration_id: 'red' });
    expect(matchCompletion.onMatchCompleted.mock.calls).toEqual([[BOUT]]);
  });

  it('tells the bracket when the clock is idle: it never ran', async () => {
    const { service, clock, matchCompletion } = clinchedInRound2();
    clock.getClockState.mockResolvedValue({ levelResolutionSteps: 0, status: 'idle' });

    await service.recomputeMatchScore(BOUT);

    expect(matchCompletion.onMatchCompleted.mock.calls).toEqual([[BOUT]]);
  });

  it('does not tell the bracket of a series still being fought', async () => {
    const { service, matchCompletion } = setup(
      storedBout({
        phases: bestOfThree(),
        match_number_label: 'QF1',
        status: 'running',
        winner_registration_id: null,
        end_reason: null,
      }),
      [hit(1, 'red', 3)],
    );

    await service.recomputeMatchScore(BOUT);

    expect(matchCompletion.onMatchCompleted).not.toHaveBeenCalled();
  });
});
