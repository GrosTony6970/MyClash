import { describe, expect, it, vi } from 'vitest';
import { FFAMHE_FORFEIT_RULES } from '@myclash/types/forfeit-rules';
import { mockSupabase, scopedTo, writesTo } from '../../common/testing/supabase-chain';
import { fighterStatusOver, settleRpc, type SettleCall } from '../matches/fighter-status.fixtures';
import { RegistrationsService } from './registrations.service';

/**
 * Ruling 110: an organiser who withdraws Ana by hand forfeits her remaining Pool bouts as a
 * voluntary forfeit, and can undo it. Through the real `RegistrationsService` over the real
 * `FighterStatusService`: the door changes her hand, the settle answers, and her bouts follow.
 *
 * The double applies no write, so Ana's row holds the hand the door READS (`entry_status`) and the
 * status the settle LEAVES (`status`, `out_since`): what the database derives from her hand is
 * probe check 16's.
 */

const OUT_SINCE = '2026-10-21T10:00:00.000Z';

/** The built-in penalty ruleset, which her Tournament plays under. */
const BUILT_IN = {
  id: 'built-in',
  built_in: true,
  owner_organization_id: null,
  first_black_card_forfeit: 'match',
  second_black_card_forfeit: 'tournament',
  forfeit_rules: FFAMHE_FORFEIT_RULES,
};

/** Her next Pool bout, against Bob: forfeited already when she has a forfeit on record. */
const nextBout = (forfeited: boolean) => ({
  id: 'm-next',
  phase_id: 'pool-1',
  red_registration_id: 'reg-ana',
  blue_registration_id: 'reg-bob',
  red_score: 0,
  blue_score: 0,
  status: forfeited ? 'completed' : 'scheduled',
  winner_registration_id: null,
  ended_at: null,
  end_reason: null,
});

function anaWith(row: Record<string, unknown>, forfeits: Record<string, unknown>[] = []) {
  const calls: SettleCall[] = [];
  const db = mockSupabase(
    {
      registrations: {
        rows: [{ id: 'reg-ana', tournament_id: 't1', waitlist_position: null, ...row }],
      },
      tournaments: {
        rows: [{ id: 't1', event_id: 'e1', penalty_ruleset_id: null, max_participants: null }],
      },
      events: { rows: [{ id: 'e1', penalty_ruleset_id: null }] },
      penalty_rulesets: { rows: [BUILT_IN] },
      phases: { rows: [{ id: 'pool-1', tournament_id: 't1', type: 'pool' }] },
      matches: { rows: [nextBout(forfeits.length > 0)] },
      match_forfeits: { rows: forfeits, returning: { id: 'new-1' } },
      // In no Swiss phase.
      swiss_entrants: { rows: [] },
    },
    settleRpc(calls, () => db.writes),
  );
  const guard = { assertTournamentResultsOpen: vi.fn(async () => undefined) };
  const status = fighterStatusOver(db);
  const service = new RegistrationsService(db as never, {} as never, status, guard as never);
  return { db, service };
}

describe('a withdrawal by hand and its undo: her Pool bouts follow (ruling 110)', () => {
  it('Withdraw forfeits her next Pool bout as a voluntary forfeit, signed by the organiser', async () => {
    const { db, service } = anaWith({
      entry_status: 'checked_in',
      status: 'withdrawn',
      out_since: OUT_SINCE,
    });

    await service.updateStatus('reg-ana', 'withdrawn', 'org-1');

    const inserts = writesTo(db, 'match_forfeits').filter((write) => write.op === 'insert');
    expect(inserts.map((write) => write.row)).toEqual([
      expect.objectContaining({
        match_id: 'm-next',
        reason: 'voluntary',
        auto_created: true,
        parent_forfeit_id: null,
        by_user_id: 'org-1',
      }),
    ]);
    expect(writesTo(db, 'matches').map((write) => scopedTo(write, 'id'))).toEqual(['m-next']);
  });

  it('Undo withdrawal voids it and puts the bout back', async () => {
    const forfeited = {
      id: 'f-auto',
      match_id: 'm-next',
      tournament_id: 't1',
      forfeiting_registration_id: 'reg-ana',
      reason: 'voluntary',
      fighter_outcome: null,
      parent_forfeit_id: null,
      auto_created: true,
      voided_at: null,
      previous_match_state: { status: 'paused', red_score: 1, blue_score: 0 },
      resulting_match_state: {},
      created_at: OUT_SINCE,
    };
    const { db, service } = anaWith(
      { entry_status: 'withdrawn', status: 'registered', out_since: null },
      [forfeited],
    );

    await service.updateStatus('reg-ana', 'registered', 'org-1');

    const stamp = writesTo(db, 'match_forfeits').find((write) => write.op === 'update');
    expect(scopedTo(stamp, 'id')).toBe('f-auto');
    expect(stamp?.row).toMatchObject({ voided_by_return: true, voided_by_user_id: 'org-1' });
    expect(writesTo(db, 'matches')[0]?.row).toMatchObject({ status: 'paused', red_score: 1 });
  });
});
