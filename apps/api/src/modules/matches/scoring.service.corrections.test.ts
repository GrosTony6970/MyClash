import { describe, expect, it, vi } from 'vitest';
import { mockSupabase, scopedTo, selectsFor, writesTo } from '../../common/testing/supabase-chain';
import { ScoringService } from './scoring.service';

/**
 * Rulings 225 to 230: a correction on a FINISHED bout moves its result with its
 * score. The rule itself is `correction-outcome.test.ts`; what is pinned here is
 * that the recompute reads what the rule needs, writes what it answers, and
 * tells the bracket after the row is written.
 */
const BOUT = 'm1';

/** A clean hit, as the `exchanges` table holds it. */
function hit(seq: number, color: 'red' | 'blue', value: number) {
  return {
    id: `e${seq}`,
    match_id: BOUT,
    sequence: seq,
    type: 'clean',
    occurred_at: '2026-01-01T00:00:00Z',
    first_striker_color: color,
    first_strike_value: value,
    afterblow_value: null,
    no_exchange_reason: null,
    round_number: 1,
    voided: false,
  };
}

/** A Pool that may end level, a bracket that may not; first to 7. */
const phase = (type: 'pool' | 'single_elim') => ({
  type,
  tournaments: {
    ruleset_config: {
      matchFormat: {
        pointCap: 7,
        bestOf: { pool: 1, bracket: 1, finals: 1 },
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

/** Red won 5-4 when the time ran out. The sheet below says what it reads NOW. */
function storedBout(over: Record<string, unknown> = {}) {
  return {
    id: BOUT,
    red_registration_id: 'red',
    blue_registration_id: 'blue',
    ruleset_code: 'TF_v1',
    ruleset_version: '1.0.0',
    status: 'completed',
    winner_registration_id: 'red',
    end_reason: 'time_limit',
    red_score: 5,
    blue_score: 4,
    match_number_label: 'P1M1',
    current_round: 1,
    rounds_json: null,
    phases: phase('pool'),
    ...over,
  };
}

const OVER_EVENT = { eventOver: true, staysFinished: true, laterBoutFought: false };
const RUNNING_EVENT = { eventOver: false, staysFinished: false, laterBoutFought: false };

function setup(
  bout: Record<string, unknown>,
  sheet: Array<Record<string, unknown>>,
  context: Record<string, boolean> = OVER_EVENT,
) {
  const db = mockSupabase({
    // A second bout: unscoped, the reads and the write would take it too.
    matches: { rows: [bout, storedBout({ id: 'm2' })] },
    exchanges: { rows: [...sheet, { ...hit(9, 'red', 3), match_id: 'm2' }] },
    match_penalties: { rows: [] },
  });
  const writesWhenToldTheBracket: number[] = [];
  const matchCompletion = {
    onMatchCompleted: vi.fn().mockResolvedValue(undefined),
    onMatchUncompleted: vi.fn().mockResolvedValue(undefined),
    resultChangeContext: vi.fn().mockResolvedValue(context),
    onResultChanged: vi.fn(async () => {
      writesWhenToldTheBracket.push(writesTo(db, 'matches').length);
    }),
  };
  const clock = { getClockState: vi.fn().mockResolvedValue({ levelResolutionSteps: 0 }) };
  const service = new ScoringService(
    db as never,
    { resolve: vi.fn().mockResolvedValue(null) } as never,
    clock as never,
    matchCompletion as never,
  );
  const written = () => writesTo(db, 'matches')[0];
  return { db, clock, matchCompletion, service, written, writesWhenToldTheBracket };
}

const SHEET_3_4 = [hit(1, 'red', 3), hit(2, 'blue', 2), hit(3, 'blue', 2)];
const SHEET_5_3 = [hit(1, 'red', 3), hit(2, 'red', 2), hit(3, 'blue', 3)];
const SHEET_4_4 = [hit(1, 'red', 2), hit(2, 'red', 2), hit(3, 'blue', 2), hit(4, 'blue', 2)];

describe('ScoringService.recomputeMatchScore — a correction on a finished bout', () => {
  it('on an over Event the winner follows the score and the bout stays finished', async () => {
    const { service, written, matchCompletion, writesWhenToldTheBracket } = setup(
      storedBout(),
      SHEET_3_4,
    );

    await service.recomputeMatchScore(BOUT);

    expect(written()?.row).toMatchObject({
      red_score: 3,
      blue_score: 4,
      winner_registration_id: 'blue',
      end_reason: 'time_limit',
    });
    expect(written()?.row).not.toHaveProperty('status');
    expect(written()?.row).not.toHaveProperty('ended_at');
    expect(scopedTo(written(), 'id')).toBe(BOUT);
    expect(matchCompletion.onMatchUncompleted).not.toHaveBeenCalled();
    // The bracket reads the winner off the row: told once, after the write.
    expect(matchCompletion.onResultChanged).toHaveBeenCalledWith(BOUT, true);
    expect(writesWhenToldTheBracket).toEqual([1]);
  });

  it('a correction that keeps the leader moves only the score', async () => {
    const { service, written, matchCompletion } = setup(storedBout(), SHEET_5_3);

    await service.recomputeMatchScore(BOUT);

    expect(written()?.row).toMatchObject({ red_score: 5, blue_score: 3 });
    expect(written()?.row).not.toHaveProperty('winner_registration_id');
    expect(written()?.row).not.toHaveProperty('end_reason');
    expect(matchCompletion.onResultChanged).not.toHaveBeenCalled();
    expect(matchCompletion.onMatchUncompleted).not.toHaveBeenCalled();
  });

  it('a bout ended by a forfeit keeps its winner', async () => {
    const { service, written, matchCompletion } = setup(
      storedBout({ end_reason: 'forfeit' }),
      SHEET_3_4,
    );

    await service.recomputeMatchScore(BOUT);

    expect(written()?.row).not.toHaveProperty('winner_registration_id');
    expect(matchCompletion.onResultChanged).not.toHaveBeenCalled();
  });

  it('a level board is a draw where the phase may end level (ruling 227)', async () => {
    const { service, written, clock } = setup(storedBout(), SHEET_4_4);

    await service.recomputeMatchScore(BOUT);

    expect(written()?.row).toMatchObject({
      winner_registration_id: null,
      end_reason: 'time_limit',
    });
    expect(clock.getClockState).toHaveBeenCalledWith(BOUT);
  });

  it('a level board where the phase asks for a remedy keeps the result, and says so', async () => {
    // Reached only through a door with no check of its own: the doors that can
    // refuse ask before they write.
    const { service, written, matchCompletion } = setup(
      storedBout({ phases: phase('single_elim'), match_number_label: 'QF1' }),
      SHEET_4_4,
    );

    await service.recomputeMatchScore(BOUT);

    expect(written()?.row).toMatchObject({ red_score: 4, blue_score: 4 });
    expect(written()?.row).not.toHaveProperty('winner_registration_id');
    expect(matchCompletion.onResultChanged).not.toHaveBeenCalled();
  });

  it('a later bout fought from the result keeps the result too', async () => {
    const { service, written, matchCompletion } = setup(storedBout(), SHEET_3_4, {
      ...OVER_EVENT,
      laterBoutFought: true,
    });

    await service.recomputeMatchScore(BOUT);

    expect(written()?.row).not.toHaveProperty('winner_registration_id');
    expect(matchCompletion.onResultChanged).not.toHaveBeenCalled();
  });

  it('a running Event hands the bout back to the referee, as before', async () => {
    const { service, written, matchCompletion } = setup(storedBout(), SHEET_3_4, RUNNING_EVENT);

    await service.recomputeMatchScore(BOUT);

    expect(matchCompletion.onMatchUncompleted).toHaveBeenCalledWith(
      BOUT,
      expect.objectContaining({ discardDependents: false }),
    );
    expect(written()?.row).toMatchObject({ status: 'paused', winner_registration_id: null });
    expect(matchCompletion.onResultChanged).not.toHaveBeenCalled();
  });

  it('a Swiss bout with a later round drawn cannot reopen: its winner follows (228)', async () => {
    const { service, written, matchCompletion } = setup(storedBout(), SHEET_3_4, {
      eventOver: false,
      staysFinished: true,
      laterBoutFought: false,
    });

    await service.recomputeMatchScore(BOUT);

    expect(written()?.row).toMatchObject({ winner_registration_id: 'blue' });
    expect(written()?.row).not.toHaveProperty('status');
    expect(matchCompletion.onMatchUncompleted).not.toHaveBeenCalled();
    expect(matchCompletion.onResultChanged).toHaveBeenCalledWith(BOUT, false);
  });

  it('a running Event’s bout still over by the cap names its other winner (229)', async () => {
    const { service, written, matchCompletion } = setup(
      storedBout({ end_reason: 'first_to_points', red_score: 7, blue_score: 5 }),
      [hit(1, 'red', 3), hit(2, 'red', 2), hit(3, 'blue', 3), hit(4, 'blue', 2), hit(5, 'blue', 2)],
      RUNNING_EVENT,
    );

    await service.recomputeMatchScore(BOUT);

    expect(written()?.row).toMatchObject({
      red_score: 5,
      blue_score: 7,
      winner_registration_id: 'blue',
      end_reason: 'first_to_points',
    });
    expect(written()?.row).not.toHaveProperty('status');
    expect(matchCompletion.onMatchUncompleted).not.toHaveBeenCalled();
    expect(matchCompletion.onResultChanged).toHaveBeenCalledWith(BOUT, false);
  });

  it('asks nothing about the Event while the bout is still being fought', async () => {
    const { service, matchCompletion } = setup(storedBout({ status: 'running' }), SHEET_3_4);

    await service.recomputeMatchScore(BOUT);

    expect(matchCompletion.resultChangeContext).not.toHaveBeenCalled();
  });

  it('a context that cannot be read fails the recompute, and writes nothing', async () => {
    const { db, service, matchCompletion } = setup(storedBout(), SHEET_3_4);
    matchCompletion.resultChangeContext.mockRejectedValueOnce(new Error('read failed'));

    await expect(service.recomputeMatchScore(BOUT)).rejects.toThrow('read failed');
    expect(db.writes).toEqual([]);
  });

  it('reads the stored result and each card’s id', async () => {
    const { db, service } = setup(storedBout(), SHEET_3_4);

    await service.recomputeMatchScore(BOUT);

    expect(selectsFor(db.from, 'matches')).toEqual([
      'id, red_registration_id, blue_registration_id, ruleset_code, ruleset_version, status, winner_registration_id, end_reason, red_score, blue_score, match_number_label, current_round, rounds_json, red_round_wins, blue_round_wins, awaiting_round_advance, phases(type, tournaments(ruleset_config, scoring_config_json))',
    ]);
    expect(selectsFor(db.from, 'match_penalties')).toEqual([
      'id, score_delta, registration_id, round_number',
    ]);
  });
});
