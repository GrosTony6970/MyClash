/**
 * The bouts a Fighter's return brings back take their Tournament's ruleset of now when they go
 * back to "not started", as a reset does (the take-back's own rule, `match-forfeits.service
 * .restamp.test.ts`). Through the real `FighterStatusService.settle` and the real ruleset reads.
 */
import { describe, expect, it } from 'vitest';
import { mockSupabase, scopedTo, writesTo } from '../../common/testing/supabase-chain';
import { rulesOf, withStampedRules } from '../phases/match-rules.fixtures';
import { anaRow, forfeit, rulesInForce } from './fighter-reconcile.fixtures';
import { fighterStatusOver, settleRpc, type SettleCall } from './fighter-status.fixtures';

const RESULT = {
  status: 'completed',
  red_score: 0,
  blue_score: 6,
  winner_registration_id: 'reg-bob',
  ended_at: '2026-01-01T00:05:00Z',
  end_reason: 'forfeit',
};
const NOT_STARTED = { status: 'scheduled', red_score: 0, blue_score: 0 };
const RUNNING = { status: 'running', red_score: 3, blue_score: 2 };
const TOURNAMENT_NOW = {
  ruleset_code: 'Generic_PointsCap',
  ruleset_version: '1',
  ruleset_content_hash: 'hash-of-the-new-rules',
};
const STAMP_NOW = { match_rules_id: rulesOf('t1'), earlier_rules_ids: [] };
const NO_TOURNAMENT = { phases: { type: 'pool', tournaments: null } };

type Seed = Record<string, unknown>;

const bout = (id: string, over: Seed = {}): Seed => ({
  id,
  red_registration_id: 'reg-ana',
  blue_registration_id: 'reg-bob',
  locked_at: null,
  phases: { type: 'pool', tournament_id: 't1', tournaments: TOURNAMENT_NOW },
  ...RESULT,
  ...over,
});

/** A bout forfeited because Ana was out, as it went. */
const auto = (id: string, matchId: string, previous: Seed) =>
  forfeit(id, {
    match_id: matchId,
    auto_created: true,
    previous_match_state: previous,
    resulting_match_state: RESULT,
  });

/** Ana back in, with these bouts forfeited because she was out. */
function returning(bouts: Seed[], records: Seed[]) {
  const calls: SettleCall[] = [];
  const [tables, functions] = withStampedRules({
    registrations: { rows: [anaRow('checked_in')] },
    matches: { rows: bouts },
    match_forfeits: { rows: records },
  });
  const db = mockSupabase(tables, {
    ...functions,
    ...settleRpc(calls, () => db.writes, {
      data: { before: 'withdrawn', after: 'checked_in' },
      error: null,
    }),
  });
  const settle = () =>
    fighterStatusOver(db).settle({
      registrationId: 'reg-ana',
      tournamentId: 't1',
      rules: rulesInForce(),
    });
  return { db, settle };
}

const restoreOf = (db: ReturnType<typeof returning>['db'], matchId: string) =>
  writesTo(db, 'matches').find((write) => scopedTo(write, 'id') === matchId);

describe('the bouts a return brings back: their ruleset', () => {
  it('each by the state it goes back to: not started takes the copy of now', async () => {
    const { db, settle } = returning(
      [bout('m2'), bout('m3')],
      [auto('a-2', 'm2', NOT_STARTED), auto('a-3', 'm3', RUNNING)],
    );
    await settle();
    expect(restoreOf(db, 'm2')?.row).toMatchObject({ status: 'scheduled', ...STAMP_NOW });
    expect(restoreOf(db, 'm3')?.row).toMatchObject({ status: 'running' });
    expect(restoreOf(db, 'm3')?.row).not.toHaveProperty('match_rules_id');
  });

  it('a read that fails for a later bout stops the return before its first write', async () => {
    const { db, settle } = returning(
      [bout('m1'), bout('m2'), bout('m3', NO_TOURNAMENT)],
      [
        auto('a-1', 'm1', NOT_STARTED),
        auto('a-2', 'm2', NOT_STARTED),
        auto('a-3', 'm3', NOT_STARTED),
      ],
    );
    await expect(settle()).rejects.toThrow('The ruleset of bout m3 was not read: no Tournament');
    expect(db.writes).toEqual([]);
  });

  it('stamps the Tournament once before its writes and once after them (R3)', async () => {
    const { db, settle } = returning(
      [bout('m1'), bout('m2')],
      [auto('a-1', 'm1', NOT_STARTED), auto('a-2', 'm2', NOT_STARTED)],
    );
    const answer = db.rpc.getMockImplementation()!;
    const boutWritesAtStamp: number[] = [];
    db.rpc.mockImplementation((name, args) => {
      if (name === 'stamp_match_rules') boutWritesAtStamp.push(writesTo(db, 'matches').length);
      return answer(name, args);
    });
    await settle();
    expect(boutWritesAtStamp).toEqual([0, 2]);
  });
});
