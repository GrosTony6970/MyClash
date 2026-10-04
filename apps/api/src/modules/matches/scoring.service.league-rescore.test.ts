import { describe, expect, it } from 'vitest';
import { BOUT, hit, phase, setup, storedBout } from './scoring.service.corrections.fixtures';

/**
 * Ruling 248: after a hit or a card moves a FINISHED bout, the recompute asks
 * for the League results of its Event to be scored again. Whether the Event is
 * over is `LeagueRescoreService`'s question (`league-rescore.service.test.ts`);
 * what is pinned here is WHEN the recompute asks, and that it asks last: a
 * League placement reads the bracket, and the bracket reads the row.
 */
const SHEET_3_4 = [hit(1, 'red', 3), hit(2, 'blue', 2), hit(3, 'blue', 2)];
const SHEET_5_3 = [hit(1, 'red', 3), hit(2, 'red', 2), hit(3, 'blue', 3)];
const SHEET_7_0 = [hit(1, 'red', 3), hit(2, 'red', 3), hit(3, 'red', 1)];

const bestOfThree = () => ({
  ...phase('single_elim'),
  tournaments: {
    ruleset_config: { matchFormat: { pointCap: 7, bestOf: { pool: 3, bracket: 3, finals: 3 } } },
    scoring_config_json: null,
  },
});

describe('ScoringService.recomputeMatchScore — the League results of the Event', () => {
  it('are asked for after the bracket is told of another winner', async () => {
    const { service, leagueRescore, bracketToldBeforeLeagues, matchCompletion } = setup(
      storedBout(),
      SHEET_3_4,
    );

    await service.recomputeMatchScore(BOUT);

    expect(matchCompletion.onResultChanged).toHaveBeenCalledTimes(1);
    expect(leagueRescore.afterResultWrite.mock.calls).toEqual([[BOUT]]);
    expect(bracketToldBeforeLeagues).toEqual([1]);
  });

  it('are asked for when only the score moves: a Pool ranks on points too', async () => {
    const { service, leagueRescore, written } = setup(storedBout(), SHEET_5_3);

    await service.recomputeMatchScore(BOUT);

    expect(written()?.row).not.toHaveProperty('winner_registration_id');
    expect(leagueRescore.afterResultWrite.mock.calls).toEqual([[BOUT]]);
  });

  it('are asked for when the hit ENDS the bout, after its completion is handed on', async () => {
    const { service, leagueRescore, bracketToldBeforeLeagues, matchCompletion } = setup(
      storedBout({ status: 'running', winner_registration_id: null, end_reason: null }),
      SHEET_7_0,
    );

    await service.recomputeMatchScore(BOUT);

    expect(matchCompletion.onMatchCompleted).toHaveBeenCalledTimes(1);
    expect(leagueRescore.afterResultWrite.mock.calls).toEqual([[BOUT]]);
    expect(bracketToldBeforeLeagues).toEqual([1]);
  });

  it('are NOT asked for by a hit of a bout still being fought', async () => {
    const { service, leagueRescore } = setup(
      storedBout({ status: 'running', winner_registration_id: null, end_reason: null }),
      SHEET_3_4,
    );

    await service.recomputeMatchScore(BOUT);

    expect(leagueRescore.afterResultWrite).not.toHaveBeenCalled();
  });

  it('are asked for by a correction in a finished best-of series', async () => {
    const closed = [
      { round: 1, redScore: 7, blueScore: 0, winnerColor: 'red', endReason: 'first_to_points' },
      { round: 2, redScore: 7, blueScore: 0, winnerColor: 'red', endReason: 'first_to_points' },
    ];
    const { service, leagueRescore } = setup(
      storedBout({
        phases: bestOfThree(),
        match_number_label: 'QF1',
        current_round: 2,
        rounds_json: closed,
        end_reason: 'first_to_points',
      }),
      SHEET_7_0.map((row) => ({ ...row, round_number: 2 })),
    );

    await service.recomputeMatchScore(BOUT);

    expect(leagueRescore.afterResultWrite.mock.calls).toEqual([[BOUT]]);
  });

  it('are NOT asked for by a hit in a best-of series still being fought', async () => {
    const { service, leagueRescore } = setup(
      storedBout({
        phases: bestOfThree(),
        match_number_label: 'QF1',
        status: 'running',
        winner_registration_id: null,
        end_reason: null,
      }),
      SHEET_3_4,
    );

    await service.recomputeMatchScore(BOUT);

    expect(leagueRescore.afterResultWrite).not.toHaveBeenCalled();
  });
});
