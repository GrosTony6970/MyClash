import { afterEach, describe, expect, it, vi } from 'vitest';
import { TF_v1_1_0_0 as OLD } from '@myclash/rulesets';
import {
  BOUT,
  hit,
  RUNNING_EVENT,
  setup,
  storedBout,
} from './scoring.service.corrections.fixtures';

/**
 * A Pool bout that counts down, at the doubles limit (operator, 2026-10-11):
 * a loss for both, as the same bout counting up. The limit wipes the board to
 * 0 - 0, and in a bout that counts down 0 - 0 reads as "both out of points":
 * the point cap, asked first, ended that bout as a draw. The rule is
 * `roundOutcome` in `@myclash/rules`; this holds what the server writes, for
 * a single fight and for a round.
 *
 * Countdown from 5, limit 3. Red hits for 2, then three doubles.
 */
const pool = (direction: 'normal' | 'reverse_zero_loses', bestOf = 1) => ({
  type: 'pool',
  tournaments: {
    ruleset_config: {
      matchFormat: {
        pointCap: 5,
        scoringDirection: direction,
        maxDoubleHits: 3,
        bestOf: { pool: bestOf, bracket: bestOf, finals: bestOf },
        levelAtTime: {
          pool: [{ kind: 'draw' }],
          bracket: [{ kind: 'sudden_death' }],
          finals: [{ kind: 'sudden_death' }],
        },
      },
    },
    scoring_config_json: null,
  },
});

const double = (seq: number) => ({
  ...hit(seq, 'red', 0),
  type: 'double',
  first_striker_color: null,
  first_strike_value: null,
});

const STORY = [hit(1, 'red', 2), double(2), double(3), double(4)];

const inPlay = (phases: ReturnType<typeof pool>, over: Record<string, unknown> = {}) =>
  storedBout({
    phases,
    match_number_label: 'L1-P1-M01',
    status: 'running',
    winner_registration_id: null,
    end_reason: null,
    red_score: 5,
    blue_score: 3,
    ...over,
  });

afterEach(() => vi.restoreAllMocks());

describe('ScoringService.recomputeMatchScore — a countdown bout at the doubles limit', () => {
  it.each(['reverse_zero_loses', 'normal'] as const)(
    'completes a Pool bout (%s) as a loss for both, at 0 - 0',
    async (direction) => {
      const { service, written, matchCompletion } = setup(
        inPlay(pool(direction)),
        STORY,
        RUNNING_EVENT,
      );

      await expect(service.recomputeMatchScore(BOUT)).resolves.toEqual({
        redScore: 0,
        blueScore: 0,
      });

      expect(written()?.row).toMatchObject({
        red_score: 0,
        blue_score: 0,
        status: 'completed',
        winner_registration_id: null,
        end_reason: 'max_doubles',
      });
      expect(matchCompletion.onMatchCompleted).toHaveBeenCalledWith(BOUT);
    },
  );

  it('names no winner when a card is on the wiped board', async () => {
    // 0 and -1: the cap, asked first, named blue the winner of a double loss.
    const card = { id: 'card-1', match_id: BOUT, score_delta: -1, registration_id: 'red' };
    const { service, written } = setup(inPlay(pool('reverse_zero_loses')), STORY, RUNNING_EVENT, [
      { ...card, voided: false, round_number: 1 },
    ]);

    await service.recomputeMatchScore(BOUT);

    expect(written()?.row).toMatchObject({
      red_score: -1,
      blue_score: 0,
      status: 'completed',
      winner_registration_id: null,
      end_reason: 'max_doubles',
    });
  });

  it('closes a round of a best-of bout as a round nobody won', async () => {
    const series = inPlay(pool('reverse_zero_loses', 3), {
      current_round: 1,
      rounds_json: [],
      red_round_wins: 0,
      blue_round_wins: 0,
      awaiting_round_advance: false,
    });
    const { service, written } = setup(series, STORY, RUNNING_EVENT);

    await service.recomputeMatchScore(BOUT);

    expect(written()?.row).toMatchObject({
      rounds_json: [
        { round: 1, redScore: 0, blueScore: 0, winnerColor: null, endReason: 'max_doubles' },
      ],
      red_round_wins: 0,
      blue_round_wins: 0,
      awaiting_round_advance: true,
    });
  });
});

/**
 * Ruling "TF_v1 version" (2026-10-16): a bout of TF_v1 1.0.0 is decided as it
 * was before 2026-10-11, when the cap was asked first.
 */
describe('ScoringService.recomputeMatchScore — a countdown bout of TF_v1 1.0.0 at the doubles limit', () => {
  it('ends it "first to points" with nobody ahead, as before', async () => {
    const bout = inPlay(pool('reverse_zero_loses'));
    const { service, written } = setup(bout, STORY, RUNNING_EVENT, [], [], OLD);

    await service.recomputeMatchScore(BOUT);

    expect(written()?.row).toMatchObject({
      status: 'completed',
      winner_registration_id: null,
      end_reason: 'first_to_points',
    });
  });

  it('names the fighter a card left ahead on the wiped board, as before', async () => {
    const card = { id: 'card-1', match_id: BOUT, score_delta: -1, registration_id: 'red' };
    const cards = [{ ...card, voided: false, round_number: 1 }];
    const bout = inPlay(pool('reverse_zero_loses'));
    const { service, written } = setup(bout, STORY, RUNNING_EVENT, cards, [], OLD);

    await service.recomputeMatchScore(BOUT);

    expect(written()?.row).toMatchObject({
      status: 'completed',
      winner_registration_id: 'blue',
      end_reason: 'first_to_points',
    });
  });
});
