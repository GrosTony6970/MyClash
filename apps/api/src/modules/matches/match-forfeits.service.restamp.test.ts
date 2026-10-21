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
import { rulesOf, withStampedRules } from '../phases/match-rules.fixtures';
import { fighterStatusDouble } from './fighter-status.fixtures';

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
/** The copy of now, and the earlier copies forgotten: a bout not started was fought under none. */
const STAMP_NOW = {
  match_rules_id: rulesOf('t-1'),
  earlier_rules_ids: [],
};
/** The three columns a bout no longer has: its copy holds its engine pair and hash (0232). */
const PAIR = ['ruleset_code', 'ruleset_version', 'ruleset_content_hash'];

type Seed = Record<string, unknown>;

const bout = (id: string, over: Seed = {}): Seed => ({
  id,
  red_registration_id: 'red',
  blue_registration_id: 'blue',
  locked_at: null,
  phases: { type: 'pool', tournament_id: 't-1', tournaments: TOURNAMENT_NOW },
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
  resulting_match_state: RESULT,
  ...over,
});

function seeded(bouts: Seed[], records: Seed[]) {
  return mockSupabase(
    ...withStampedRules({
      matches: { rows: bouts },
      match_forfeits: { rows: records },
      exchanges: { rows: [] },
      match_penalties: { rows: [] },
    }),
  );
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
    fighterStatusDouble(),
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
    // started" under the old ruleset. The copy's id only: its engine pair stays in the copy.
    for (const column of PAIR) expect(restoreOf(db, 'm1')?.row).not.toHaveProperty(column);
    expect(restoreOf(db, 'm1')?.row).toMatchObject({ status: 'scheduled', ...STAMP_NOW });
  });

  it('a bout the forfeit found started keeps the ruleset it was started under', async () => {
    const db = seeded([bout('m1')], [record('forfeit-1', 'm1', RUNNING)]);

    await forfeitsOver(db).voidForfeit('forfeit-1');

    const restore = restoreOf(db, 'm1');
    expect(restore?.row).toMatchObject({ status: 'running' });
    for (const column of [...Object.keys(STAMP_NOW), ...PAIR]) {
      expect(restore?.row).not.toHaveProperty(column);
    }
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

  it('a bout the forfeit found started asks for no ruleset: its read cannot stop the take-back', async () => {
    const db = seeded([bout('m1', NO_TOURNAMENT)], [record('forfeit-1', 'm1', RUNNING)]);

    await expect(forfeitsOver(db).voidForfeit('forfeit-1')).resolves.toBeDefined();
  });

  it('stamps the Tournament once before its write and once after it', async () => {
    // Each stamp is a write. After the write: a change of the rules between the read and the
    // write left the bout put back on the older copy (R3). The bouts her return brings back are
    // the reconcile's (`fighter-reconcile.restamp.test.ts`).
    const db = seeded([bout('m1')], [record('forfeit-1', 'm1', NOT_STARTED)]);
    const stamp = db.rpc.getMockImplementation()!;
    const boutWritesAtStamp: number[] = [];
    db.rpc.mockImplementation((name, args) => {
      boutWritesAtStamp.push(writesTo(db, 'matches').length);
      return stamp(name, args);
    });

    await forfeitsOver(db).voidForfeit('forfeit-1');

    expect(boutWritesAtStamp).toEqual([0, 1]);
    expect(db.rpc.mock.calls.map(([, args]) => args)).toEqual([
      { p_tournament_id: 't-1' },
      { p_tournament_id: 't-1' },
    ]);
  });

  it('stamps nothing when no bout goes back to not started', async () => {
    const db = seeded([bout('m1')], [record('forfeit-1', 'm1', RUNNING)]);

    await forfeitsOver(db).voidForfeit('forfeit-1');

    expect(db.rpc).not.toHaveBeenCalled();
  });
});
