import { Logger } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BOUT,
  hit,
  RUNNING_EVENT,
  setup,
  storedBout,
} from './scoring.service.corrections.fixtures';

/**
 * A bout that counts down, both fighters out of points on one exchange
 * (operator, 2026-10-11): the fighter less far below zero wins, the board
 * stops at 0 - 0. The rule is `capLeader` in `@myclash/rules`; this holds that
 * the server's count reaches it, for a single fight and for a round.
 *
 * Countdown from 5. Red has 1 point left, blue has 2. Red strikes for 3 and
 * blue answers with an afterblow of 3: red at -2, blue at -1. Blue wins.
 */
/**
 * The bout's copy of its rules (0229), its engine included: the version a bout
 * made today carries, unless a test names another.
 */
const countdown = (bestOf = 1, version = '1.1.0') => ({
  ruleset_code: 'TF_v1',
  ruleset_version: version,
  ruleset_config: {
    matchFormat: {
      pointCap: 5,
      scoringDirection: 'reverse_zero_loses',
      maxDoubleHits: null,
      bestOf: { pool: bestOf, bracket: bestOf, finals: bestOf },
      levelAtTime: {
        pool: [{ kind: 'draw' }],
        bracket: [{ kind: 'sudden_death' }],
        finals: [{ kind: 'sudden_death' }],
      },
    },
  },
  scoring_config_json: { afterblowMode: 'full' },
});

const afterblow = (seq: number, color: 'red' | 'blue', value: number, answer: number) => ({
  ...hit(seq, color, value),
  type: 'afterblow',
  afterblow_value: answer,
});

const BEFORE = [hit(1, 'blue', 4), hit(2, 'red', 3)];
const STORY = [...BEFORE, afterblow(3, 'red', 3, 3)];
const TRUE_TIE = [hit(1, 'blue', 4), hit(2, 'red', 4), afterblow(3, 'red', 2, 2)];

const inPlay = (type: 'pool' | 'single_elim', over: Record<string, unknown> = {}) =>
  storedBout({
    phases: { type },
    match_rules: countdown(),
    match_number_label: type === 'pool' ? 'L1-P1-M01' : 'QF1',
    status: 'running',
    winner_registration_id: null,
    end_reason: null,
    red_score: 1,
    blue_score: 2,
    ...over,
  });

afterEach(() => vi.restoreAllMocks());

describe('ScoringService.recomputeMatchScore — both at zero in a bout that counts down', () => {
  it.each(['single_elim', 'pool'] as const)(
    'completes a %s bout for the fighter less far below zero',
    async (type) => {
      const { service, written, matchCompletion } = setup(inPlay(type), STORY, RUNNING_EVENT);

      await expect(service.recomputeMatchScore(BOUT)).resolves.toEqual({
        redScore: 0,
        blueScore: 0,
      });

      expect(written()?.row).toMatchObject({
        red_score: 0,
        blue_score: 0,
        status: 'completed',
        winner_registration_id: 'blue',
        end_reason: 'first_to_points',
      });
      expect(matchCompletion.onMatchCompleted).toHaveBeenCalledWith(BOUT);
    },
  );

  it('stores no "below zero" number on the bout', async () => {
    const { service, written } = setup(inPlay('single_elim'), STORY, RUNNING_EVENT);

    await service.recomputeMatchScore(BOUT);

    const columns = Object.keys(written()?.row as Record<string, unknown>);
    expect(columns.filter((column) => /below/i.test(column))).toEqual([]);
  });

  it('ends a true tie as a draw in a Pool', async () => {
    const { service, written } = setup(inPlay('pool'), TRUE_TIE, RUNNING_EVENT);

    await service.recomputeMatchScore(BOUT);

    expect(written()?.row).toMatchObject({
      status: 'completed',
      winner_registration_id: null,
      end_reason: 'first_to_points',
    });
  });

  it('keeps a true tie open in a bracket, and the next hit ends it', async () => {
    const tied = setup(inPlay('single_elim'), TRUE_TIE, RUNNING_EVENT);
    await tied.service.recomputeMatchScore(BOUT);
    expect(tied.written()?.row).toMatchObject({ red_score: 0, blue_score: 0 });
    expect(tied.written()?.row).not.toHaveProperty('status');

    const decided = setup(inPlay('single_elim'), [...TRUE_TIE, hit(4, 'red', 1)], RUNNING_EVENT);
    await decided.service.recomputeMatchScore(BOUT);
    expect(decided.written()?.row).toMatchObject({
      status: 'completed',
      winner_registration_id: 'red',
    });
  });

  it('puts the bout back in play when the afterblow is taken back', async () => {
    // The bout the story completed, read again without its last exchange.
    const completed = inPlay('single_elim', {
      status: 'completed',
      winner_registration_id: 'blue',
      end_reason: 'first_to_points',
      red_score: 0,
      blue_score: 0,
    });
    const { service, written, matchCompletion } = setup(completed, BEFORE, RUNNING_EVENT);

    await service.recomputeMatchScore(BOUT);

    expect(matchCompletion.onMatchUncompleted).toHaveBeenCalled();
    expect(written()?.row).toMatchObject({
      red_score: 1,
      blue_score: 2,
      winner_registration_id: null,
      end_reason: null,
    });
  });

  it('counts a card as the score counts it', async () => {
    // Blue is less far below by hits, and a card takes 2 more off blue: red wins.
    const card = { id: 'card-1', match_id: BOUT, score_delta: -2, registration_id: 'blue' };
    const { service, written } = setup(inPlay('single_elim'), STORY, RUNNING_EVENT, [
      { ...card, voided: false, round_number: 1 },
    ]);

    await service.recomputeMatchScore(BOUT);

    expect(written()?.row).toMatchObject({
      status: 'completed',
      winner_registration_id: 'red',
    });
  });

  it('does not read the board alone once a card is on it', async () => {
    // Red at -3 and blue at -1 by hits, and a card takes 1 more off blue: -2.
    // The board reads 0 and -1, which alone would name red.
    const sheet = [...BEFORE, afterblow(3, 'red', 3, 4)];
    const card = { id: 'card-1', match_id: BOUT, score_delta: -1, registration_id: 'blue' };
    const { service, written } = setup(inPlay('single_elim'), sheet, RUNNING_EVENT, [
      { ...card, voided: false, round_number: 1 },
    ]);

    await service.recomputeMatchScore(BOUT);

    expect(written()?.row).toMatchObject({
      red_score: 0,
      blue_score: -1,
      status: 'completed',
      winner_registration_id: 'blue',
    });
  });

  it('leaves a bout decided this way as it is when its sheet is counted again', async () => {
    // A correction elsewhere on the sheet that moves no point: the stored
    // result (0 - 0, blue, by the cap) is what the sheet still gives.
    const completed = inPlay('single_elim', {
      status: 'completed',
      winner_registration_id: 'blue',
      end_reason: 'first_to_points',
      red_score: 0,
      blue_score: 0,
    });
    const { service, written, matchCompletion } = setup(completed, STORY, RUNNING_EVENT);

    await service.recomputeMatchScore(BOUT);

    expect(matchCompletion.onMatchUncompleted).not.toHaveBeenCalled();
    expect(matchCompletion.onResultChanged).not.toHaveBeenCalled();
    expect(written()?.row).toMatchObject({ red_score: 0, blue_score: 0 });
    for (const column of ['status', 'winner_registration_id', 'end_reason']) {
      expect(written()?.row).not.toHaveProperty(column);
    }
  });
});

describe('ScoringService.recomputeMatchScore — a round of a best-of bout that counts down', () => {
  const series = (type: 'pool' | 'single_elim') =>
    inPlay(type, {
      match_rules: countdown(3),
      current_round: 1,
      rounds_json: [],
      red_round_wins: 0,
      blue_round_wins: 0,
      awaiting_round_advance: false,
    });

  it.each(['single_elim', 'pool'] as const)(
    'closes a %s round for the fighter less far below zero',
    async (type) => {
      const { service, written } = setup(series(type), STORY, RUNNING_EVENT);

      await service.recomputeMatchScore(BOUT);

      expect(written()?.row).toMatchObject({
        rounds_json: [
          {
            round: 1,
            redScore: 0,
            blueScore: 0,
            winnerColor: 'blue',
            endReason: 'first_to_points',
          },
        ],
        red_round_wins: 0,
        blue_round_wins: 1,
        awaiting_round_advance: true,
      });
    },
  );

  it('keeps a round closed this way as it is when a later round is counted', async () => {
    // Round 1 was closed 0 - 0 for blue. A hit of round 2 counts every closed
    // round again from its own sheet: round 1 must read the same, not drawn.
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const closed = {
      round: 1,
      redScore: 0,
      blueScore: 0,
      winnerColor: 'blue',
      endReason: 'first_to_points',
    };
    const inRoundTwo = {
      ...series('single_elim'),
      current_round: 2,
      rounds_json: [closed],
      blue_round_wins: 1,
    };
    const sheet = [...STORY, { ...hit(4, 'red', 1), round_number: 2 }];
    const { service, written } = setup(inRoundTwo, sheet, RUNNING_EVENT);

    await service.recomputeMatchScore(BOUT);

    // Round 2: red took 1 off blue.
    expect(written()?.row).toMatchObject({
      red_score: 5,
      blue_score: 4,
      red_round_wins: 0,
      blue_round_wins: 1,
    });
    // The snapshot of round 1 is not written again, and nothing is refused.
    expect(written()?.row).not.toHaveProperty('rounds_json');
    const refused = warn.mock.calls.filter(([line]) =>
      /kept the result of round/.test(String(line)),
    );
    expect(refused).toEqual([]);
  });

  it('keeps a bracket round open on a true tie', async () => {
    const { service, written } = setup(series('single_elim'), TRUE_TIE, RUNNING_EVENT);

    await service.recomputeMatchScore(BOUT);

    expect(written()?.row).toMatchObject({ awaiting_round_advance: false });
    expect(written()?.row).not.toHaveProperty('rounds_json');
  });

  it('keeps a bracket round of TF_v1 1.0.0 open: its edition reads the board', async () => {
    const bout = { ...series('single_elim'), match_rules: countdown(3, '1.0.0') };
    const { service, written } = setup(bout, STORY, RUNNING_EVENT);

    await service.recomputeMatchScore(BOUT);

    expect(written()?.row).toMatchObject({ awaiting_round_advance: false });
    expect(written()?.row).not.toHaveProperty('rounds_json');
  });
});

/**
 * Ruling "TF_v1 version" (2026-10-16): a bout of TF_v1 1.0.0 is decided as it
 * was before 2026-10-11. The same story, both out of points: the board reads
 * 0 - 0 and the board decides.
 */
describe('ScoringService.recomputeMatchScore — both at zero in a bout of TF_v1 1.0.0', () => {
  it('ends a Pool bout as a draw, as before 2026-10-11', async () => {
    const bout = inPlay('pool', { match_rules: countdown(1, '1.0.0') });
    const { service, written } = setup(bout, STORY, RUNNING_EVENT);

    await service.recomputeMatchScore(BOUT);

    expect(written()?.row).toMatchObject({
      status: 'completed',
      winner_registration_id: null,
      end_reason: 'first_to_points',
    });
  });

  it('reads a bout whose copy holds "1" as 1.0.0 (ruling 3)', async () => {
    // An archive restore writes a copy as the archive held it, "1" included.
    // Unread as 1.0.0, "1" names no registered version, and the scorer refuses it.
    const bout = inPlay('pool', { match_rules: countdown(1, '1') });
    const { service, written } = setup(bout, STORY, RUNNING_EVENT);

    await service.recomputeMatchScore(BOUT);

    expect(written()?.row).toMatchObject({
      status: 'completed',
      winner_registration_id: null,
      end_reason: 'first_to_points',
    });
  });

  it('keeps a bracket bout open, as before 2026-10-11', async () => {
    const bout = inPlay('single_elim', { match_rules: countdown(1, '1.0.0') });
    const { service, written } = setup(bout, STORY, RUNNING_EVENT);

    await service.recomputeMatchScore(BOUT);

    expect(written()?.row).toMatchObject({ red_score: 0, blue_score: 0 });
    expect(written()?.row).not.toHaveProperty('status');
  });
});
