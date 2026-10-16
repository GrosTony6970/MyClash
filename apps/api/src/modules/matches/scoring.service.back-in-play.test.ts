import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BOUT,
  hit,
  OVER_EVENT,
  RUNNING_EVENT,
  setup,
  storedBout,
} from './scoring.service.corrections.fixtures';

/**
 * A correction that puts a finished bout, or a closed round, back in play
 * marks the bout with the time of it (`backInPlayColumns`), in the same write.
 * A press a tablet made before that time is then refused
 * (`press-before-reopen.ts`). A correction that puts nothing back leaves no mark.
 */
const NOW = '2026-01-01T11:00:00.000Z';
/** The server's time of the card a tablet sent late, which caused the recompute. */
const CAUSED_AT = '2026-01-01T10:06:00.000Z';

beforeEach(() => {
  vi.useFakeTimers({ now: new Date(NOW) });
});
afterEach(() => {
  vi.useRealTimers();
});

describe('a finished bout of one round that a correction hands back to the referee', () => {
  // Red won 5-4 on time. The sheet now reads 3-4.
  const SHEET_3_4 = [hit(1, 'red', 3), hit(2, 'blue', 2), hit(3, 'blue', 2)];

  it('is marked as put back in play now, with its status', async () => {
    const { service, written } = setup(storedBout(), SHEET_3_4, RUNNING_EVENT);

    await service.recomputeMatchScore(BOUT);

    expect(written()?.row).toMatchObject({ status: 'paused', back_in_play_at: NOW });
  });

  it('is marked at the time of the row that caused it, when a tablet sent that row late', async () => {
    const { service, written } = setup(storedBout(), SHEET_3_4, RUNNING_EVENT);

    await service.recomputeMatchScore(BOUT, CAUSED_AT);

    expect(written()?.row).toMatchObject({ status: 'paused', back_in_play_at: CAUSED_AT });
  });

  // The desk put the bout back in play at 10:30 and it was completed again; the late card of
  // 10:06 hands it back once more. Its mark stays 10:30: a press of 10:20 was made before the
  // Reopen, and must stay refused.
  it('keeps a later mark the bout holds: a late card cannot move it back', async () => {
    const later = '2026-01-01T10:30:00.000Z';
    const { service, written } = setup(
      storedBout({ back_in_play_at: later }),
      SHEET_3_4,
      RUNNING_EVENT,
    );

    await service.recomputeMatchScore(BOUT, CAUSED_AT);

    expect(written()?.row).toMatchObject({ status: 'paused', back_in_play_at: later });
  });

  it('is not marked when it stays finished: an over Event', async () => {
    const { service, written } = setup(storedBout(), SHEET_3_4, OVER_EVENT);

    await service.recomputeMatchScore(BOUT);

    expect(written()?.row).toMatchObject({ red_score: 3, blue_score: 4 });
    expect(written()?.row).not.toHaveProperty('back_in_play_at');
  });

  it('is not marked when the un-completion is refused: the bout stays completed', async () => {
    const { service, written, matchCompletion } = setup(storedBout(), SHEET_3_4, RUNNING_EVENT);
    matchCompletion.onMatchUncompleted.mockRejectedValue(new Error('a later bout was fought'));

    await service.recomputeMatchScore(BOUT);

    expect(written()?.row).not.toHaveProperty('status');
    expect(written()?.row).not.toHaveProperty('back_in_play_at');
  });
});

describe('a closed round of a best-of series that a correction puts back in play', () => {
  const bestOfThree = {
    type: 'single_elim',
    tournaments: {
      ruleset_config: { matchFormat: { pointCap: 7, bestOf: { pool: 3, bracket: 3, finals: 3 } } },
      scoring_config_json: null,
    },
  };
  const inRound = (round: number, row: ReturnType<typeof hit>) => ({ ...row, round_number: round });
  // Round 1: Red 7, Blue 6, closed by the cap.
  const ROUND_1 = [
    hit(1, 'red', 3),
    hit(2, 'red', 3),
    hit(3, 'red', 1),
    hit(4, 'blue', 3),
    hit(5, 'blue', 3),
  ];
  const WON_7_6 = {
    round: 1,
    redScore: 7,
    blueScore: 6,
    winnerColor: 'red',
    endReason: 'first_to_points',
  };
  const without = (sheet: Array<{ id: string }>, ...ids: string[]) =>
    sheet.filter((row) => !ids.includes(row.id));
  const series = (over: Record<string, unknown> = {}) =>
    storedBout({
      phases: bestOfThree,
      match_number_label: 'QF1',
      status: 'running',
      winner_registration_id: null,
      end_reason: null,
      current_round: 1,
      rounds_json: [WON_7_6],
      red_round_wins: 1,
      blue_round_wins: 0,
      awaiting_round_advance: true,
      ...over,
    });
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
      current_round: 2,
      awaiting_round_advance: false,
      red_round_wins: 2,
      rounds_json: [WON_7_6, { ...WON_7_6, round: 2 }],
    });

  it('a round that waits for the next one: the bout is marked, and waits no more', async () => {
    // The cap hit of round 1 is voided: 4-6, below the cap.
    const { service, written } = setup(series(), without(ROUND_1, 'e1'), RUNNING_EVENT);

    await service.recomputeMatchScore(BOUT);

    expect(written()?.row).toMatchObject({
      rounds_json: null,
      awaiting_round_advance: false,
      back_in_play_at: NOW,
    });
    expect(written()?.row).not.toHaveProperty('status');
  });

  it('is marked at the time of the row that caused it', async () => {
    const { service, written } = setup(series(), without(ROUND_1, 'e1'), RUNNING_EVENT);

    await service.recomputeMatchScore(BOUT, CAUSED_AT);

    expect(written()?.row).toMatchObject({ rounds_json: null, back_in_play_at: CAUSED_AT });
  });

  it('keeps a later mark the bout holds: a late card cannot move it back', async () => {
    const later = '2026-01-01T10:30:00.000Z';
    const bout = series({ back_in_play_at: later });
    const { service, written } = setup(bout, without(ROUND_1, 'e1'), RUNNING_EVENT);

    await service.recomputeMatchScore(BOUT, CAUSED_AT);

    expect(written()?.row).toMatchObject({ rounds_json: null, back_in_play_at: later });
  });

  it('the round that won the series: the bout is marked, and is paused', async () => {
    const sheet = without([...ROUND_1, ...ROUND_2_WON], 'e8', 'e10');
    const { service, written } = setup(won(), sheet, RUNNING_EVENT);

    await service.recomputeMatchScore(BOUT);

    expect(written()?.row).toMatchObject({
      rounds_json: [WON_7_6],
      status: 'paused',
      back_in_play_at: NOW,
    });
  });

  it('is not marked when the series cannot be taken out of completed', async () => {
    const sheet = without([...ROUND_1, ...ROUND_2_WON], 'e8', 'e10');
    const { service, written, matchCompletion } = setup(won(), sheet, RUNNING_EVENT);
    matchCompletion.onMatchUncompleted.mockRejectedValue(new Error('a later bout was fought'));

    await service.recomputeMatchScore(BOUT);

    expect(written()?.row).not.toHaveProperty('status');
    expect(written()?.row).not.toHaveProperty('back_in_play_at');
  });

  it('is not marked by a correction that leaves every round closed', async () => {
    // Blue loses 3 points in round 1: 7-3, still Red's, still at the cap.
    const { service, written } = setup(series(), without(ROUND_1, 'e4'), RUNNING_EVENT);

    await service.recomputeMatchScore(BOUT);

    expect(written()?.row).toMatchObject({ rounds_json: [{ ...WON_7_6, blueScore: 3 }] });
    expect(written()?.row).not.toHaveProperty('back_in_play_at');
  });
});
