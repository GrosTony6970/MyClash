import { describe, expect, it, vi } from 'vitest';
import { mockSupabase, scopedTo, writesTo } from '../../common/testing/supabase-chain';
import { MatchForfeitsService } from './match-forfeits.service';
import { ScoringService } from './scoring.service';
import { hit, phase } from './scoring.service.corrections.fixtures';

/**
 * Ruling 322: a forfeit holds its bout, and the bout reads its sheet again
 * once the record is taken back.
 *
 * Dupont got a second black card at 3-2. The bout ended 0-6, and a late hit
 * was then saved on its sheet. Before the ruling the recompute wrote 3-4 over
 * the 0-6, and the take-back refused a bout that "was replayed since".
 */
const BOUT = 'm1';
const RESULT = {
  status: 'completed',
  red_score: 0,
  blue_score: 6,
  winner_registration_id: 'blue',
  ended_at: '2026-01-01T00:05:00Z',
  end_reason: 'black_card',
};

type Seed = Record<string, unknown>;

function seeded(previous: Seed, others: { bouts: Seed[]; records: Seed[] } = NO_CASCADE) {
  return mockSupabase({
    matches: {
      rows: [
        {
          id: BOUT,
          red_registration_id: 'red',
          blue_registration_id: 'blue',
          ruleset_code: 'TF_v1',
          ruleset_version: '1.0.0',
          locked_at: null,
          match_number_label: 'P1M1',
          current_round: 1,
          rounds_json: null,
          phases: phase('pool'),
          ...RESULT,
        },
        ...others.bouts,
      ],
    },
    match_forfeits: {
      rows: [
        {
          id: 'forfeit-1',
          match_id: BOUT,
          parent_forfeit_id: null,
          forfeiting_registration_id: 'red',
          downstream_match_ids: [],
          voided_at: null,
          previous_match_state: previous,
          previous_registration_state: {},
          resulting_match_state: RESULT,
        },
        ...others.records,
      ],
    },
    // 3-4 now: the late hit is the third.
    exchanges: { rows: [hit(1, 'red', 3), hit(2, 'blue', 2), hit(3, 'blue', 2)] },
    match_penalties: { rows: [] },
  });
}

const RUNNING = { status: 'running', red_score: 3, blue_score: 2 };
const NO_CASCADE = { bouts: [], records: [] };
const PAUSED = { status: 'paused', red_score: 1, blue_score: 0 };

/** A Pool bout the withdrawal forfeited too, as its row reads `now`, and its record. */
function cascaded(bout: string, now: Seed) {
  return {
    bout: { id: bout, ...RESULT, ...now },
    record: {
      id: `forfeit-of-${bout}`,
      match_id: bout,
      parent_forfeit_id: 'forfeit-1',
      voided_at: null,
      previous_match_state: PAUSED,
      resulting_match_state: RESULT,
    },
  };
}

function forfeitsOver(db: ReturnType<typeof seeded>, scoring: unknown) {
  return new MatchForfeitsService(
    db as never,
    undefined as never,
    undefined as never,
    undefined as never,
    undefined as never,
    scoring as never,
  );
}

describe('MatchForfeitsService.voidForfeit — the sheet after a take-back (ruling 322)', () => {
  it('a late entry on the forfeited bout does not stop the take-back', async () => {
    const db = seeded(RUNNING);
    const scoring = new ScoringService(
      db as never,
      { resolve: vi.fn().mockResolvedValue(null) } as never,
      { getClockState: vi.fn() } as never,
    );

    await scoring.recomputeMatchScore(BOUT);
    expect(writesTo(db, 'matches')).toEqual([]);

    await expect(forfeitsOver(db, scoring).voidForfeit('forfeit-1')).resolves.toMatchObject({
      cascaded_forfeit_count: 0,
    });
    const restore = writesTo(db, 'matches')[0];
    expect(restore?.row).toMatchObject({ status: 'running', red_score: 3, blue_score: 2 });
    expect(scopedTo(restore, 'id')).toBe(BOUT);
  });

  it('a bout back in play reads its sheet again, after the record is voided', async () => {
    const db = seeded(RUNNING);
    const writtenWhenAsked: number[] = [];
    const scoring = {
      recomputeMatchScore: vi.fn(async (_matchId: string) => {
        writtenWhenAsked.push(
          writesTo(db, 'matches').length + writesTo(db, 'match_forfeits').length,
        );
      }),
    };

    await forfeitsOver(db, scoring).voidForfeit('forfeit-1');

    expect(scoring.recomputeMatchScore.mock.calls).toEqual([[BOUT]]);
    // The bout's restore and the record's void stamp are both in.
    expect(writtenWhenAsked).toEqual([2]);
  });

  it('a bout the restore leaves completed is not scored again', async () => {
    // An organiser's correction over a bout that was fought to its end: with
    // no correction asked, a recompute would hand it back to its referee.
    const db = seeded({
      status: 'completed',
      red_score: 5,
      blue_score: 4,
      winner_registration_id: 'red',
      end_reason: 'time_limit',
    });
    const scoring = { recomputeMatchScore: vi.fn() };

    await forfeitsOver(db, scoring).voidForfeit('forfeit-1');

    expect(scoring.recomputeMatchScore).not.toHaveBeenCalled();
  });

  it('a sheet that cannot be read does not undo the take-back', async () => {
    const db = seeded(RUNNING);
    const scoring = { recomputeMatchScore: vi.fn().mockRejectedValue(new Error('no sheet')) };

    await expect(forfeitsOver(db, scoring).voidForfeit('forfeit-1')).resolves.toMatchObject({
      cascaded_forfeit_count: 0,
    });
    expect(writesTo(db, 'match_forfeits')).toHaveLength(1);
  });
});

/**
 * Ruling 330: the Pool bouts a withdrawal forfeited read their sheet again too.
 *
 * Dupont's other Pool bout was paused at 1-0 when she was withdrawn. A late
 * card was saved on its sheet while it was forfeited. Before the ruling the
 * take-back wrote 1-0 back and the card waited for the next hit.
 */
describe('MatchForfeitsService.voidForfeit — the Pool bouts of a withdrawal (ruling 330)', () => {
  it('each bout put back in play reads its sheet again, after its own record is voided', async () => {
    const held = cascaded('m2', {});
    // Reopened and being fought again: its row is left alone, so is its score.
    const fought = cascaded('m3', { status: 'running', red_score: 2, blue_score: 2 });
    const db = seeded(RUNNING, {
      bouts: [held.bout, fought.bout],
      records: [held.record, fought.record],
    });
    const voidedWhenAsked: number[] = [];
    const scoring = {
      recomputeMatchScore: vi.fn(async (_matchId: string) => {
        voidedWhenAsked.push(writesTo(db, 'match_forfeits').length);
      }),
    };

    await expect(forfeitsOver(db, scoring).voidForfeit('forfeit-1')).resolves.toMatchObject({
      cascaded_forfeit_count: 2,
    });

    expect(scoring.recomputeMatchScore.mock.calls).toEqual([['m2'], [BOUT]]);
    // m2 after its own record's void; the withdrawal's bout after all three.
    expect(voidedWhenAsked).toEqual([1, 3]);
  });

  it('a sheet that cannot be read does not stop the rest of the take-back', async () => {
    const held = cascaded('m2', {});
    const db = seeded(RUNNING, { bouts: [held.bout], records: [held.record] });
    const scoring = { recomputeMatchScore: vi.fn().mockRejectedValue(new Error('no sheet')) };

    await forfeitsOver(db, scoring).voidForfeit('forfeit-1');

    expect(writesTo(db, 'match_forfeits')).toHaveLength(2);
  });
});
