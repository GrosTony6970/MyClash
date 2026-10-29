/**
 * The follow of an audited forfeit rules change through the REAL `FighterStatusService.settle` and
 * its reconcile (the audited settings change, plan §8 of revision 13; rulings 143, 144, 149): the
 * bouts change colour, every settle reads the rules now stored itself, and one settle that fails
 * leaves the others settled. Ana's Tournament is `fighter-reconcile.fixtures.ts`'s; the database's
 * list of the Fighters (`fighters_status_under`) is answered per read, loop 1 first. One Fighter
 * hands a unit on once with or without the held hand-off: that every settle shares ONE held
 * hand-off is `fighter-status.follow.test.ts`'s.
 */
import { CLUB_START_FORFEIT_RULES } from '@myclash/types/forfeit-rules';
import { describe, expect, it, vi } from 'vitest';
import type { ChainResult } from '../../common/testing/supabase-chain';
import type * as MatchRuleset from '../phases/match-ruleset';
import {
  anasTournament,
  bout,
  boutsWritten,
  forfeit,
  inserted,
  voided,
  type PoolSeed,
} from './fighter-reconcile.fixtures';
import type { RulesMove, StatusRow } from './follow-rules-change';

// A bout put back to "not started" reads its Tournament's ruleset: that read has its own tests
// (`match-forfeits.service.restamp.test.ts`), so it answers a fixed one here.
vi.mock('../phases/match-ruleset', async (original) => ({
  ...(await original<typeof MatchRuleset>()),
  tournamentOfBout: vi.fn(() => Promise.resolve('t1')),
  matchRulesetForTournament: vi.fn(() => Promise.resolve({ match_rules_id: 'rules-t1' })),
  restampAfterInsert: vi.fn(() => Promise.resolve()),
}));

/** The rules as the save stored them: the built-in card rules, the Tournament's own `disqualifyAfter`. */
const stored = (disqualifyAfter: number) => ({
  tournaments: {
    rows: [
      { id: 't1', event_id: 'e1', penalty_ruleset_id: null, forfeit_rules: { disqualifyAfter } },
    ],
  },
  events: { rows: [{ id: 'e1', penalty_ruleset_id: null }] },
  penalty_rulesets: {
    rows: [
      {
        id: 'built-in',
        built_in: true,
        owner_organization_id: null,
        first_black_card_forfeit: 'match',
        second_black_card_forfeit: 'tournament',
        forfeit_rules: CLUB_START_FORFEIT_RULES,
      },
    ],
  },
});

/**
 * What the follow is handed: NOT what the tables hold, so a settle that used it instead of reading
 * the rules itself would send `disqualifyAfter: 9`.
 */
const HANDED: RulesMove = {
  before: { disqualifyAfter: null },
  after: { disqualifyAfter: 9 },
  beforeUnparsable: false,
};

const row = (id: string, now: string, after: string, crossed: string | null): StatusRow => ({
  registration_id: id,
  status_now: now,
  status_before: now,
  status_after: after,
  crossed_at: crossed,
});

/** Ana's Tournament under `rules`, its list of the Fighters answered `reads[i]` on read `i`. */
function following(seed: PoolSeed, rules: number, reads: StatusRow[][], failing: string[] = []) {
  const world = anasTournament({ ...seed, extra: stored(rules) });
  const answer = world.db.rpc.getMockImplementation()!;
  let read = 0;
  world.db.rpc.mockImplementation(async (name, args): Promise<ChainResult> => {
    if (name === 'fighters_status_under') return { data: reads[read++] ?? [], error: null };
    if (name === 'settle_fighter_status' && failing.includes(args?.['p_registration'] as string)) {
      return { data: null, error: { message: 'deadlock detected' } };
    }
    return answer(name, args);
  });
  return world;
}

const rulesSent = (calls: ReturnType<typeof following>['calls']) =>
  calls.map(({ args }) => args['p_rules']);

describe('the follow of a rules change, through the real settle', () => {
  it('Off → 2: Ana is disqualified, her unfought Pool bout forfeited and handed on once', async () => {
    const { db, deps, calls, service } = following(
      {
        statuses: ['disqualified'],
        bouts: [bout('m-scheduled', 'pool-1', 'scheduled'), bout('m-done', 'pool-1', 'completed')],
      },
      2,
      [[row('reg-ana', 'registered', 'disqualified', '2026-10-21T10:00:00Z')]],
    );
    const answer = await service.followRulesChange('t1', HANDED, { userId: 'user-org' });

    expect(rulesSent(calls)).toEqual([
      expect.objectContaining({ disqualifyAfter: 2, firstCardOut: false, secondCardOut: true }),
    ]);
    expect(
      inserted(db).map((r) => [r['match_id'], r['forfeiting_registration_id'], r['by_user_id']]),
    ).toEqual([['m-scheduled', 'reg-ana', 'user-org']]);
    expect(deps.matchCompletion.onMatchCompleted.mock.calls).toEqual([['m-scheduled']]);
    expect(answer).toEqual({
      notSettled: [],
      inStep: [],
      followFailed: false,
      handOffFailed: false,
    });
  });

  it('2 → 3: Ana, disqualified, comes back and the bout forfeited because she was out is put back', async () => {
    const { db, deps, calls, service } = following(
      {
        statuses: ['checked_in'],
        bouts: [{ ...bout('m-1', 'pool-1', 'completed'), end_reason: 'forfeit' }],
        forfeits: [forfeit('a-1', { match_id: 'm-1', auto_created: true })],
      },
      3,
      [[row('reg-ana', 'disqualified', 'registered', null)]],
    );
    const answer = await service.followRulesChange('t1', HANDED, { userId: 'user-org' });

    expect(rulesSent(calls)).toEqual([expect.objectContaining({ disqualifyAfter: 3 })]);
    expect(voided(db)).toEqual([{ id: 'a-1', byReturn: true }]);
    expect(boutsWritten(db)).toEqual(['m-1']);
    expect(deps.matchCompletion.onBoutPutBack.mock.calls).toEqual([['m-1']]);
    expect(answer.notSettled).toEqual([]);
  });

  it('one settle that fails leaves the others settled, and answers its Fighter by id', async () => {
    // Bob crossed first and his settle fails; Ana shares no bout with him, so she is not held.
    const bob = row('reg-bob', 'registered', 'disqualified', '2026-10-21T09:00:00Z');
    const { db, service } = following(
      {
        statuses: ['disqualified'],
        bouts: [bout('m-scheduled', 'pool-1', 'scheduled', { other: 'reg-cy' })],
      },
      2,
      [[bob, row('reg-ana', 'registered', 'disqualified', '2026-10-21T10:00:00Z')], [bob]],
      ['reg-bob'],
    );
    const answer = await service.followRulesChange('t1', HANDED, { userId: 'user-org' });

    expect(inserted(db).map((r) => r['forfeiting_registration_id'])).toEqual(['reg-ana']);
    expect(answer).toMatchObject({ notSettled: ['reg-bob'], followFailed: false });
  });
});
