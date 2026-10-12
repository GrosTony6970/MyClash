/**
 * A forfeit taken back gives a bout not started its Tournament's ruleset of now.
 *
 * A fighter is forfeited by mistake in a bout that has not started. While the
 * forfeit stands, the organiser changes the Tournament's ruleset: the bouts not
 * started take it, and this one does not (it is `completed`). The forfeit is
 * taken back, the bout is "not started" again, and it was fought under the old
 * ruleset. A reset and a bracket result taken back already took the new one.
 */
import { describe, expect, it, vi } from 'vitest';
import { mockSupabase, scopedTo, writesTo } from '../../common/testing/supabase-chain';
import { MatchForfeitsService } from './match-forfeits.service';

const RESULT = {
  status: 'completed',
  red_score: 0,
  blue_score: 6,
  winner_registration_id: 'blue',
  ended_at: '2026-01-01T00:05:00Z',
  end_reason: 'forfeit',
};
const NOT_STARTED = { status: 'scheduled', red_score: 0, blue_score: 0 };
const RUNNING = { status: 'running', red_score: 3, blue_score: 2 };

/** The Tournament's ruleset of now: changed since the bouts were made. */
const TOURNAMENT_NOW = {
  ruleset_code: 'Generic_PointsCap',
  ruleset_version: '1',
  ruleset_content_hash: 'hash-of-the-new-rules',
};
const STAMP_NOW = { ...TOURNAMENT_NOW, ruleset_version: '1.0.0' };

type Seed = Record<string, unknown>;

const bout = (id: string, over: Seed = {}): Seed => ({
  id,
  red_registration_id: 'red',
  blue_registration_id: 'blue',
  ruleset_code: 'TF_v1',
  ruleset_version: '1.0.0',
  ruleset_content_hash: 'hash-of-the-old-rules',
  locked_at: null,
  phases: { type: 'pool', tournaments: TOURNAMENT_NOW },
  ...RESULT,
  ...over,
});

const record = (id: string, matchId: string, previous: Seed, over: Seed = {}): Seed => ({
  id,
  match_id: matchId,
  parent_forfeit_id: null,
  forfeiting_registration_id: 'red',
  downstream_match_ids: [],
  voided_at: null,
  previous_match_state: previous,
  previous_registration_state: {},
  resulting_match_state: RESULT,
  ...over,
});

function seeded(bouts: Seed[], records: Seed[]) {
  return mockSupabase({
    matches: { rows: bouts },
    match_forfeits: { rows: records },
    exchanges: { rows: [] },
    match_penalties: { rows: [] },
  });
}

const clearDownstreamOf = vi.fn();

function forfeitsOver(db: ReturnType<typeof seeded>) {
  const none = undefined as never;
  const scoring = { recomputeMatchScore: vi.fn() };
  clearDownstreamOf.mockReset();
  return new MatchForfeitsService(
    db as never,
    none,
    none,
    { clearDownstreamOf } as never,
    none,
    scoring as never,
  );
}

const NO_TOURNAMENT = { phases: { type: 'pool', tournaments: null } };

const restoreOf = (db: ReturnType<typeof seeded>, matchId: string) =>
  writesTo(db, 'matches').find((write) => scopedTo(write, 'id') === matchId);

describe('MatchForfeitsService.voidForfeit: the ruleset of a bout put back', () => {
  it("a bout that goes back to not started takes its Tournament's ruleset of now", async () => {
    const db = seeded([bout('m1')], [record('forfeit-1', 'm1', NOT_STARTED)]);

    await forfeitsOver(db).voidForfeit('forfeit-1');

    // In the SAME write as the status: no moment where the bout is "not
    // started" under the old ruleset. The version is normalized, as on a new bout.
    expect(restoreOf(db, 'm1')?.row).toMatchObject({ status: 'scheduled', ...STAMP_NOW });
  });

  it('a bout the forfeit found started keeps the ruleset it was started under', async () => {
    const db = seeded([bout('m1')], [record('forfeit-1', 'm1', RUNNING)]);

    await forfeitsOver(db).voidForfeit('forfeit-1');

    const restore = restoreOf(db, 'm1');
    expect(restore?.row).toMatchObject({ status: 'running' });
    for (const column of Object.keys(STAMP_NOW)) expect(restore?.row).not.toHaveProperty(column);
  });

  it('a ruleset that cannot be read stops the take-back before the bout is written', async () => {
    // No Tournament on the read: the fallback would put the bout on TF_v1.
    const db = seeded([bout('m1', NO_TOURNAMENT)], [record('forfeit-1', 'm1', NOT_STARTED)]);

    await expect(forfeitsOver(db).voidForfeit('forfeit-1')).rejects.toThrow(
      'The ruleset of bout m1 was not read: no Tournament',
    );

    // Nothing at all: the bracket still names the forfeit's winner, the bout
    // still holds the forfeit's result, so a second try is a whole take-back.
    expect(db.writes).toEqual([]);
    expect(clearDownstreamOf).not.toHaveBeenCalled();
  });

  /**
   * A withdrawal forfeited three Pool bouts. Its take-back restored the first
   * bout and the Fighter's status, then a read for the second bout failed. The
   * next try was refused for good ("the match has been replayed"): the first
   * bout no longer held the forfeit's result. So every read comes first.
   */
  it('a read that fails for a LATER bout of a withdrawal stops it before its first write', async () => {
    const db = seeded(
      [bout('m1'), bout('m2'), bout('m3', NO_TOURNAMENT)],
      [
        record('forfeit-1', 'm1', NOT_STARTED),
        record('forfeit-2', 'm2', NOT_STARTED, { parent_forfeit_id: 'forfeit-1' }),
        record('forfeit-3', 'm3', NOT_STARTED, { parent_forfeit_id: 'forfeit-1' }),
      ],
    );

    await expect(forfeitsOver(db).voidForfeit('forfeit-1')).rejects.toThrow(
      'The ruleset of bout m3 was not read: no Tournament',
    );

    expect(db.writes).toEqual([]);
    expect(clearDownstreamOf).not.toHaveBeenCalled();
  });

  it('a bout the forfeit found started asks for no ruleset: its read cannot stop the take-back', async () => {
    const db = seeded([bout('m1', NO_TOURNAMENT)], [record('forfeit-1', 'm1', RUNNING)]);

    await expect(forfeitsOver(db).voidForfeit('forfeit-1')).resolves.toBeDefined();
  });

  it('the Pool bouts of a withdrawal: each one by the state it goes back to', async () => {
    const child = (id: string, matchId: string, previous: Seed) =>
      record(id, matchId, previous, { parent_forfeit_id: 'forfeit-1' });
    const db = seeded(
      [bout('m1'), bout('m2'), bout('m3')],
      [
        record('forfeit-1', 'm1', RUNNING),
        child('forfeit-2', 'm2', NOT_STARTED),
        child('forfeit-3', 'm3', RUNNING),
      ],
    );

    await forfeitsOver(db).voidForfeit('forfeit-1');

    expect(restoreOf(db, 'm2')?.row).toMatchObject({ status: 'scheduled', ...STAMP_NOW });
    expect(restoreOf(db, 'm3')?.row).toMatchObject({ status: 'running' });
    expect(restoreOf(db, 'm3')?.row).not.toHaveProperty('ruleset_code');
  });
});
