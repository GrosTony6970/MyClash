import { ConflictException, Logger } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { queriedTables } from '../../common/testing/supabase-chain';
import {
  BOUT,
  hit,
  OVER_EVENT,
  RUNNING_EVENT,
  setup,
  storedBout,
} from './scoring.service.corrections.fixtures';

/**
 * Ruling 247: a correction inside a CLOSED round of a best-of series.
 *
 * A closed round is a snapshot in `rounds_json`. A void in round 1 during round
 * 2 took the hit off the sheet and left round 1 reading its old score, in
 * silence. The round's score now follows its sheet. A correction that would
 * give the round to the other Fighter, or leave it level, is refused whole:
 * later rounds were fought from that result.
 *
 * A best of 3, first to 7. Round 1: Red 7, Blue 6, closed by the cap.
 */
const bestOfThree = {
  type: 'single_elim',
  tournaments: {
    ruleset_config: { matchFormat: { pointCap: 7, bestOf: { pool: 3, bracket: 3, finals: 3 } } },
    scoring_config_json: null,
  },
};
const inRound = (round: number, row: ReturnType<typeof hit>) => ({ ...row, round_number: round });
const ROUND_1 = [
  hit(1, 'red', 3),
  hit(2, 'red', 3),
  hit(3, 'red', 1),
  hit(4, 'blue', 3),
  hit(5, 'blue', 3),
];
const ROUND_2 = [inRound(2, hit(6, 'blue', 2))];
const WON_7_6 = {
  round: 1,
  redScore: 7,
  blueScore: 6,
  winnerColor: 'red',
  endReason: 'first_to_points',
};
const without = (sheet: Array<{ id: string }>, ...ids: string[]) =>
  sheet.filter((row) => !ids.includes(row.id));

/** The series in round 2, round 1 closed. */
const series = (over: Record<string, unknown> = {}) =>
  storedBout({
    phases: bestOfThree,
    match_number_label: 'QF1',
    status: 'running',
    winner_registration_id: null,
    end_reason: null,
    current_round: 2,
    rounds_json: [WON_7_6],
    red_round_wins: 1,
    blue_round_wins: 0,
    awaiting_round_advance: false,
    ...over,
  });
const refusal = expect.objectContaining({
  response: expect.objectContaining({ code: 'correction_changes_closed_round' }),
});

afterEach(() => vi.restoreAllMocks());

describe('ScoringService.assertCorrectionLands — a closed round of a best-of series', () => {
  it('lets through a void that keeps the round’s winner', async () => {
    // Blue loses 3 points: round 1 reads 7-3, still Red.
    const { db, service } = setup(series(), [...ROUND_1, ...ROUND_2], RUNNING_EVENT);

    await expect(
      service.assertCorrectionLands(BOUT, { dropExchangeIds: ['e4'] }),
    ).resolves.toBeUndefined();
    expect(db.writes).toEqual([]);
  });

  it('refuses a void that would give the round to the other Fighter, before any write', async () => {
    // Red loses 3 points: round 1 would read 4-6.
    const { db, service } = setup(series(), [...ROUND_1, ...ROUND_2], RUNNING_EVENT);

    const asked = service.assertCorrectionLands(BOUT, { dropExchangeIds: ['e1'] });

    await expect(asked).rejects.toBeInstanceOf(ConflictException);
    await expect(asked).rejects.toEqual(refusal);
    expect(db.writes).toEqual([]);
  });

  it('refuses a void that would leave the round level', async () => {
    // Red loses 1 point: 6-6.
    const { service } = setup(series(), [...ROUND_1, ...ROUND_2], RUNNING_EVENT);

    await expect(service.assertCorrectionLands(BOUT, { dropExchangeIds: ['e3'] })).rejects.toEqual(
      refusal,
    );
  });

  it('counts a voided card in the round it belongs to, and leaves the open round alone', async () => {
    // Round 1 on time, 4-3 for Red: Blue's 5 points stand at 3 under a 2-point card.
    const onTime = [hit(1, 'red', 2), hit(2, 'red', 2), hit(3, 'blue', 3), hit(4, 'blue', 2)];
    const card = { id: 'card-1', match_id: BOUT, score_delta: -2, registration_id: 'blue' };
    const { service } = setup(
      series({ rounds_json: [{ ...WON_7_6, redScore: 4, blueScore: 3, endReason: 'time_limit' }] }),
      [...onTime, ...ROUND_2],
      RUNNING_EVENT,
      [{ ...card, voided: false, round_number: 1 }],
    );
    // Without the card Blue leads 4-5.
    await expect(
      service.assertCorrectionLands(BOUT, { dropPenaltyIds: ['card-1'] }),
    ).rejects.toEqual(refusal);
    // A void in round 2, the open round, is no closed round's business.
    await expect(
      service.assertCorrectionLands(BOUT, { dropExchangeIds: ['e6'] }),
    ).resolves.toBeUndefined();
  });

  it('a round the cap closed, the last one, is reopened and not refused', async () => {
    // Round 1 is the current round, awaiting advance. Below the cap it goes back to the referee.
    const { service } = setup(
      series({ current_round: 1, awaiting_round_advance: true }),
      ROUND_1,
      RUNNING_EVENT,
    );

    await expect(
      service.assertCorrectionLands(BOUT, { dropExchangeIds: ['e1'] }),
    ).resolves.toBeUndefined();
  });

  it('a round closed on time, the last one, follows the same rule as an earlier one', async () => {
    const onTime = [hit(1, 'red', 2), hit(2, 'red', 2), hit(3, 'blue', 3)];
    const { service } = setup(
      series({
        current_round: 1,
        awaiting_round_advance: true,
        rounds_json: [{ ...WON_7_6, redScore: 4, blueScore: 3, endReason: 'time_limit' }],
      }),
      onTime,
      RUNNING_EVENT,
    );

    await expect(service.assertCorrectionLands(BOUT, { dropExchangeIds: ['e1'] })).rejects.toEqual(
      refusal,
    );
    await expect(
      service.assertCorrectionLands(BOUT, { dropExchangeIds: ['e3'] }),
    ).resolves.toBeUndefined();
  });

  it('a round already out of step with its sheet does not refuse an unrelated correction', async () => {
    // Round 1's sheet already reads 4-6 beside a snapshot that says Red won it.
    const { service } = setup(
      series(),
      [...without(ROUND_1, 'e1'), ...ROUND_2, inRound(2, hit(7, 'red', 1))],
      RUNNING_EVENT,
    );

    await expect(
      service.assertCorrectionLands(BOUT, { dropExchangeIds: ['e7'] }),
    ).resolves.toBeUndefined();
  });

  it('a finished series asks the same question of an earlier round', async () => {
    const won = series({ status: 'completed', winner_registration_id: 'red' });
    const { service } = setup(won, [...ROUND_1, ...ROUND_2]);

    await expect(service.assertCorrectionLands(BOUT, { dropExchangeIds: ['e1'] })).rejects.toEqual(
      refusal,
    );
  });

  it('counts a hit about to be restored, and one about to replace another', async () => {
    // Round 1 without Red's e1 reads 4-6 beside its snapshot. The restored row
    // (the fixture's e9: Red, 3 points, round 1) mends it: nothing to refuse.
    const { service } = setup(series(), [...without(ROUND_1, 'e1'), ...ROUND_2], RUNNING_EVENT);
    await expect(
      service.assertCorrectionLands(BOUT, { restoreExchangeIds: ['e9'] }),
    ).resolves.toBeUndefined();

    // An edit: Red's e3 (1 point) leaves, a hit of 3 for Blue takes its place in round 1: 6-9.
    const edited = setup(series(), [...ROUND_1, ...ROUND_2], RUNNING_EVENT);
    await expect(
      edited.service.assertCorrectionLands(BOUT, {
        dropExchangeIds: ['e3'],
        addExchanges: [hit(3, 'blue', 3)],
      }),
    ).rejects.toEqual(refusal);
  });

  describe('the LAST closed round, which the cap closed (ruling 247a)', () => {
    // Round 2: Red 7, Blue 6, and the series is won 2-0.
    const ROUND_2_WON = [
      inRound(2, hit(6, 'red', 3)),
      inRound(2, hit(7, 'red', 3)),
      inRound(2, hit(8, 'red', 1)),
      inRound(2, hit(9, 'blue', 3)),
      inRound(2, hit(10, 'blue', 3)),
    ];
    const won = () =>
      series({
        status: 'completed',
        winner_registration_id: 'red',
        end_reason: 'first_to_points',
        red_round_wins: 2,
        rounds_json: [WON_7_6, { ...WON_7_6, round: 2 }],
      });
    const flip = { dropExchangeIds: ['e6'] }; // Red loses 3 points: 4-6
    const sheet = [...ROUND_1, ...ROUND_2_WON];

    it('on a running Event with nothing fought from it, it reopens: nothing is refused', async () => {
      const { service } = setup(won(), sheet, RUNNING_EVENT);

      await expect(service.assertCorrectionLands(BOUT, flip)).resolves.toBeUndefined();
    });

    it.each([
      ['an over Event', OVER_EVENT],
      ['a later bout fought from the series', { ...RUNNING_EVENT, laterBoutFought: true }],
    ])('with %s it cannot reopen: it is a closed round like any other', async (_why, context) => {
      const { db, service } = setup(won(), sheet, context);

      await expect(service.assertCorrectionLands(BOUT, flip)).rejects.toEqual(refusal);
      // Blue loses 3 points: 7-3, still Red.
      await expect(
        service.assertCorrectionLands(BOUT, { dropExchangeIds: ['e9'] }),
      ).resolves.toBeUndefined();
      // Red loses 1 point: 6-6, level.
      await expect(
        service.assertCorrectionLands(BOUT, { dropExchangeIds: ['e8'] }),
      ).rejects.toEqual(refusal);
      expect(db.writes).toEqual([]);
    });

    it('a round that only awaits advance reopens on an over Event too: nothing to un-complete', async () => {
      const awaiting = series({ current_round: 1, awaiting_round_advance: true });
      const { service, matchCompletion } = setup(awaiting, ROUND_1, OVER_EVENT);

      await expect(
        service.assertCorrectionLands(BOUT, { dropExchangeIds: ['e1'] }),
      ).resolves.toBeUndefined();
      expect(matchCompletion.resultChangeContext).not.toHaveBeenCalled();
    });

    it('a context that cannot be read fails the question: nothing is written yet', async () => {
      const { db, service, matchCompletion } = setup(won(), sheet);
      matchCompletion.resultChangeContext.mockRejectedValueOnce(new Error('read failed'));

      await expect(service.assertCorrectionLands(BOUT, flip)).rejects.toThrow('read failed');
      expect(db.writes).toEqual([]);
    });

    it('the recompute moves its score on an over Event, and asks nobody to reopen it', async () => {
      // Red's e8 (1 point) is voided and Blue's e10 (3 points): round 2 reads 6-3, below the cap.
      const { service, written, matchCompletion, leagueRescore } = setup(
        won(),
        without(sheet, 'e8', 'e10'),
      );

      await service.recomputeMatchScore(BOUT);

      expect(matchCompletion.onMatchUncompleted).not.toHaveBeenCalled();
      expect(written()?.row).toMatchObject({
        rounds_json: [WON_7_6, { ...WON_7_6, round: 2, redScore: 6, blueScore: 3 }],
        red_round_wins: 2,
        red_score: 6,
        blue_score: 3,
      });
      expect(written()?.row).not.toHaveProperty('status');
      expect(written()?.row).not.toHaveProperty('winner_registration_id');
      expect(leagueRescore.afterResultWrite.mock.calls).toEqual([[BOUT]]);
    });

    it('the recompute still reopens it on a running Event', async () => {
      const { service, written, matchCompletion } = setup(
        won(),
        without(sheet, 'e8', 'e10'),
        RUNNING_EVENT,
      );

      await service.recomputeMatchScore(BOUT);

      expect(matchCompletion.onMatchUncompleted).toHaveBeenCalledTimes(1);
      expect(written()?.row).toMatchObject({ rounds_json: [WON_7_6], status: 'paused' });
    });

    it('a recompute that cannot read the context tries the reopen, as before', async () => {
      const { service, matchCompletion } = setup(won(), without(sheet, 'e8', 'e10'));
      matchCompletion.resultChangeContext.mockRejectedValueOnce(new Error('read failed'));

      await expect(service.recomputeMatchScore(BOUT)).resolves.toEqual({
        redScore: 6,
        blueScore: 3,
      });

      expect(matchCompletion.onMatchUncompleted).toHaveBeenCalledTimes(1);
    });
  });

  it('a single fight still being fought reads its row and nothing more', async () => {
    const { db, service } = setup(storedBout({ status: 'running' }), ROUND_1, RUNNING_EVENT);

    await service.assertCorrectionLands(BOUT, { dropExchangeIds: ['e1'] });

    expect(queriedTables(db.from)).toEqual(['matches']);
  });
});

describe('ScoringService.recomputeMatchScore — a closed round of a best-of series', () => {
  it('writes the round’s new score, and leaves its winner, the wins and the open round', async () => {
    // The void of e4 is in: round 1 reads 7-3.
    const { service, written } = setup(
      series(),
      [...without(ROUND_1, 'e4'), ...ROUND_2],
      RUNNING_EVENT,
    );

    await service.recomputeMatchScore(BOUT);

    expect(written()?.row).toMatchObject({
      rounds_json: [{ ...WON_7_6, blueScore: 3 }],
      red_round_wins: 1,
      blue_round_wins: 0,
      red_score: 0,
      blue_score: 2,
      current_round: 2,
    });
    expect(written()?.row).not.toHaveProperty('status');
    expect(written()?.row).not.toHaveProperty('winner_registration_id');
  });

  it('does not write the snapshots of a sheet that reads as they do', async () => {
    const { service, written } = setup(series(), [...ROUND_1, ...ROUND_2], RUNNING_EVENT);

    await service.recomputeMatchScore(BOUT);

    expect(written()?.row).not.toHaveProperty('rounds_json');
  });

  it('keeps the snapshot of a round its sheet now gives to the other Fighter, and says so', async () => {
    // A door that did not ask: the correction is already in.
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const { service, written } = setup(
      series(),
      [...without(ROUND_1, 'e1'), ...ROUND_2],
      RUNNING_EVENT,
    );

    await service.recomputeMatchScore(BOUT);

    expect(written()?.row).not.toHaveProperty('rounds_json');
    expect(written()?.row).toMatchObject({ red_round_wins: 1, blue_round_wins: 0 });
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/m1.*round 1/));
  });

  it('a last round that reopens leaves the earlier round’s new score behind it', async () => {
    // Round 2 closed 7-0 by the cap and awaits advance. Its cap hit is voided
    // (it reopens), and round 1 has lost Blue's e4 (it reads 7-3).
    const round2 = [inRound(2, hit(6, 'red', 3)), inRound(2, hit(7, 'red', 3))];
    const { service, written } = setup(
      series({
        awaiting_round_advance: true,
        red_round_wins: 2,
        rounds_json: [WON_7_6, { ...WON_7_6, round: 2, blueScore: 0 }],
      }),
      [...without(ROUND_1, 'e4'), ...round2],
      RUNNING_EVENT,
    );

    await service.recomputeMatchScore(BOUT);

    expect(written()?.row).toMatchObject({
      rounds_json: [{ ...WON_7_6, blueScore: 3 }],
      red_round_wins: 1,
      current_round: 2,
      red_score: 6,
      blue_score: 0,
    });
  });
});
