import { describe, expect, it, vi } from 'vitest';
import { CLUB_START_FORFEIT_RULES } from '@myclash/types/forfeit-rules';
import { selectsFor, type SupabaseRow } from '../../common/testing/supabase-chain';
import type * as MatchRuleset from '../phases/match-ruleset';
import {
  ANA_BOUTS,
  BEFORE_SPELL,
  DURING_SPELL,
  PHASES,
  anaRead,
  anasTournament,
  bout,
  forfeit,
  inserted,
  voided,
} from './fighter-reconcile.fixtures';

// A bout put back to "not started" reads its Tournament's ruleset: that read has its own tests
// (`match-forfeits.service.restamp.test.ts`), so it answers a fixed one here.
vi.mock('../phases/match-ruleset', async (original) => ({
  ...(await original<typeof MatchRuleset>()),
  tournamentOfBout: vi.fn(() => Promise.resolve('t1')),
  matchRulesetForTournament: vi.fn(() => Promise.resolve({ match_rules_id: 'rules-t1' })),
  restampAfterInsert: vi.fn(() => Promise.resolve()),
}));

/**
 * A Swiss Fighter's pairings and bouts follow their status (slice B-Swiss; rulings 77, 81, 109,
 * 123-126). Through the real `FighterStatusService.settle` on seeded tables; what the Swiss
 * functions decide under the phase lock is check 17 of the RLS probe
 * (`scripts/lib/swiss-status-probe.mjs`), canned here.
 */

const SWISS_PHASES = [...PHASES, { id: 'swiss-1', tournament_id: 't1', type: 'swiss' }];
/** Ana's paired Swiss bout of round 3, not started. */
const SWISS_BOUT = { ...bout('m-swiss', 'swiss-1', 'scheduled'), swiss_round_id: 'round-3' };
const IN_SWISS = (over: SupabaseRow = {}): SupabaseRow => ({
  phase_id: 'swiss-1',
  registration_id: 'reg-ana',
  withdrawn_at_round: null,
  withdrawn_by: null,
  ...over,
});

const swissOf = (seed: Parameters<typeof anasTournament>[0]) =>
  anasTournament({
    phases: SWISS_PHASES,
    bouts: [...ANA_BOUTS, SWISS_BOUT],
    swissEntrants: [IN_SWISS()],
    ...seed,
  });

const fns = (calls: Array<{ args: Record<string, unknown> }>) => calls.map((c) => c.args['fn']);

describe('a Swiss Fighter out (77, 123)', () => {
  it('is withdrawn from the pairings, then their paired bout is forfeited', async () => {
    const { db, swissCalls, settle } = swissOf({ statuses: ['withdrawn'] });
    await settle();

    const withdrawal = swissCalls.find((call) => call.args['fn'] === 'swiss_withdraw')!;
    expect(withdrawal.args).toEqual({
      fn: 'swiss_withdraw',
      p_phase: 'swiss-1',
      p_registration: 'reg-ana',
      p_by: 'status',
    });
    // Out of the pairings BEFORE any bout of hers is read or forfeited.
    expect(withdrawal.writesBefore).toEqual([]);
    expect(inserted(db).map((row) => row['match_id'])).toContain('m-swiss');
  });

  it('reads the columns it decides by (the double returns whole rows)', async () => {
    const { db, settle } = swissOf({ statuses: ['withdrawn'] });
    await settle();
    // The type finds the Swiss phases to ask "over?"; the round keys the hand-off; the phase is
    // what the withdraw is asked for.
    expect(selectsFor(db.from, 'phases')).toContain('id, type');
    const boutsRead = selectsFor(db.from, 'matches').find((s) => s.includes('end_reason'));
    expect(boutsRead?.split(', ')).toContain('swiss_round_id');
    expect(selectsFor(db.from, 'swiss_entrants')).toEqual(['phase_id']);
  });

  it('asks the withdraw for every Swiss entry, one reading "withdrawn" too', async () => {
    // A hand put-back not yet committed reads "withdrawn": the function decides, under its lock.
    const { swissCalls, settle } = swissOf({
      statuses: ['withdrawn'],
      swissEntrants: [IN_SWISS({ withdrawn_at_round: 2, withdrawn_by: 'hand' })],
    });
    await settle();
    expect(fns(swissCalls)).toContain('swiss_withdraw');
  });

  it('hands each Swiss round it completed a bout in to the completion owner (109)', async () => {
    // Two rounds paired ahead by hand: each is closed on its own.
    const ahead = { ...bout('m-swiss-4', 'swiss-1', 'scheduled'), swiss_round_id: 'round-4' };
    const { deps, settle } = swissOf({
      statuses: ['withdrawn'],
      bouts: [...ANA_BOUTS, SWISS_BOUT, ahead],
    });
    await settle();
    const asked = deps.matchCompletion.onMatchCompleted.mock.calls.map(([id]) => id);
    expect(asked).toEqual(expect.arrayContaining(['m-swiss', 'm-swiss-4']));
  });

  it('leaves a Swiss phase that is over alone (125)', async () => {
    const { db, settle } = swissOf({ statuses: ['withdrawn'], over: ['swiss-1'] });
    await settle();
    expect(inserted(db).map((row) => row['match_id'])).not.toContain('m-swiss');
  });
});

describe('a Swiss Fighter back in (77, 81, 124, 126)', () => {
  /** What the forfeit left on its bout, which the bout still holds (not fought again). */
  const RESULT = {
    status: 'completed',
    winner_registration_id: null,
    red_score: 0,
    blue_score: 0,
    end_reason: 'forfeit',
  };
  const AUTO = forfeit('a-swiss', {
    match_id: 'm-swiss',
    auto_created: true,
    resulting_match_state: RESULT,
  });
  const FORFEITED = { ...SWISS_BOUT, ...RESULT };

  it('the bout forfeited because they were out is back on, its round reopened, then the pairing', async () => {
    const { db, deps, swissCalls, settle } = swissOf({
      statuses: ['checked_in'],
      bouts: [FORFEITED],
      forfeits: [AUTO],
      swissEntrants: [IN_SWISS({ withdrawn_at_round: 4, withdrawn_by: 'status' })],
    });
    await settle();

    expect(voided(db)).toEqual([{ id: 'a-swiss', byReturn: true }]);
    expect(deps.matchCompletion.onBoutPutBack).toHaveBeenCalledWith('m-swiss');
    const putBack = swissCalls.find((call) => call.args['fn'] === 'swiss_put_back')!;
    expect(putBack.args).toEqual({
      fn: 'swiss_put_back',
      p_phase: 'swiss-1',
      p_registration: 'reg-ana',
      p_by: 'status',
    });
    // After the bouts came back: the function reads the rounds as they are then.
    expect(putBack.writesBefore.length).toBeGreaterThan(0);
    // The phase is what the put-back is asked for (the double returns whole rows).
    expect(selectsFor(db.from, 'swiss_entrants')).toEqual(['phase_id']);
  });

  it('leaves the forfeit on a Swiss phase that is over by then (126)', async () => {
    const { db, deps, settle } = swissOf({
      statuses: ['checked_in'],
      bouts: [FORFEITED],
      forfeits: [AUTO],
      over: ['swiss-1'],
    });
    await settle();
    expect(voided(db)).toEqual([]);
    expect(deps.matchCompletion.onBoutPutBack).not.toHaveBeenCalled();
    // The bouts' phases are read to find it: the select names the phase (a mock ignores it).
    expect(selectsFor(db.from, 'matches')).toContain('id, phase_id');
  });

  it('never asks to put back an entry the organiser withdrew by hand', async () => {
    const { swissCalls, settle } = swissOf({
      statuses: ['checked_in'],
      swissEntrants: [IN_SWISS({ withdrawn_at_round: 2, withdrawn_by: 'hand' })],
    });
    await settle();
    expect(fns(swissCalls)).not.toContain('swiss_put_back');
  });
});

describe('a Swiss phase reopened with two Fighters out on one bout (rulings 127, 131)', () => {
  /** The rules in force, read once by the reopen: a new club penalty ruleset's. */
  const RULES = {
    tournaments: { rows: [{ id: 't1', event_id: 'e1', penalty_ruleset_id: null }] },
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
  };
  // Ana (read first) went out at 10:00; Bob, her opponent on the round-3 bout, at 09:00.
  const reopened = () =>
    swissOf({
      statuses: ['withdrawn'],
      others: [
        { id: 'reg-bob', tournament_id: 't1', status: 'withdrawn', out_since: BEFORE_SPELL },
      ],
      swissEntrants: [IN_SWISS(), IN_SWISS({ registration_id: 'reg-bob' })],
      bouts: [SWISS_BOUT],
      extra: RULES,
    });

  it('has the first to leave forfeit the bout, whatever the order of the rows (131)', async () => {
    const { db, service } = reopened();
    await service.followReopenedSwissPhase('swiss-1', 't1', { userId: 'user-org' });
    expect(inserted(db)[0]).toMatchObject({
      match_id: 'm-swiss',
      forfeiting_registration_id: 'reg-bob',
    });
  });

  it('hands the round on once, after the last Fighter is settled', async () => {
    const { calls, deps, service } = reopened();
    const settledBefore: number[] = [];
    deps.matchCompletion.onMatchCompleted.mockImplementation(() => {
      settledBefore.push(calls.length);
      return Promise.resolve(undefined);
    });
    await service.followReopenedSwissPhase('swiss-1', 't1', { userId: 'user-org' });
    expect(settledBefore).toEqual([2]);
  });

  it('has the first to leave forfeit their bout before a Fighter back in is settled (131)', async () => {
    // Ana is back in, her round-3 bout against Bob forfeited while she was out. Round 4 pairs Bob
    // against Cy. Cy left at 09:00, Bob at 11:00. Ana's settle would bring her bout back and have
    // Bob, out, forfeit every bout of his at once, the round-4 one too.
    const forfeited = {
      ...SWISS_BOUT,
      status: 'completed',
      winner_registration_id: null,
      end_reason: 'forfeit',
    };
    const round4 = {
      ...bout('m-4', 'swiss-1', 'scheduled'),
      red_registration_id: 'reg-bob',
      blue_registration_id: 'reg-cy',
      swiss_round_id: 'round-4',
    };
    const out = (id: string, at: string) => ({
      id,
      tournament_id: 't1',
      status: 'withdrawn',
      out_since: at,
    });
    const { db, service } = swissOf({
      statuses: ['checked_in'],
      others: [out('reg-bob', DURING_SPELL), out('reg-cy', BEFORE_SPELL)],
      swissEntrants: [
        IN_SWISS({ withdrawn_at_round: 4, withdrawn_by: 'status' }),
        IN_SWISS({ registration_id: 'reg-bob' }),
        IN_SWISS({ registration_id: 'reg-cy' }),
      ],
      bouts: [forfeited, round4],
      forfeits: [forfeit('a-swiss', { match_id: 'm-swiss', auto_created: true })],
      extra: RULES,
    });
    await service.followReopenedSwissPhase('swiss-1', 't1', { userId: 'user-org' });
    expect(inserted(db)[0]).toMatchObject({
      match_id: 'm-4',
      forfeiting_registration_id: 'reg-cy',
    });
  });
});

describe('a bout a door put back', () => {
  it('reopens its round from the bouts as they are, before any completion', async () => {
    const { deps, settle } = swissOf({ statuses: ['checked_in'] });
    await settle({
      boutsPutBack: ['m-door'],
      completedBout: { matchId: 'm-swiss', unitId: 'round-3' },
    });
    const { onBoutPutBack, onMatchCompleted } = deps.matchCompletion;
    expect(onBoutPutBack).toHaveBeenCalledWith('m-door');
    expect(onMatchCompleted).toHaveBeenCalledWith('m-swiss');
    // Reopened first: the completion then reads the round as the bouts now leave it.
    expect(onBoutPutBack.mock.invocationCallOrder[0]).toBeLessThan(
      onMatchCompleted.mock.invocationCallOrder[0]!,
    );
  });

  it("reopens the round of a bout an out opponent's own follow put back", async () => {
    // Bob reads out beside the bout put back, then in when his own follow reads him: his loop
    // brings his forfeited Swiss bout back, and its round reopens too.
    const bob = (status: string) => ({
      data: [{ id: 'reg-bob', tournament_id: 't1', status, out_since: null }],
      error: null,
    });
    const BOBS = { ...bout('m-bob', 'swiss-1', 'completed'), swiss_round_id: 'round-3' };
    const { deps, settle } = swissOf({
      statuses: ['checked_in'],
      registrationsTable: [
        ...anaRead(['checked_in', 'checked_in']),
        bob('withdrawn'),
        bob('checked_in'),
        bob('checked_in'),
      ],
      bouts: [bout('m-scheduled', 'pool-1', 'scheduled'), BOBS],
      forfeits: [
        forfeit('a-bob', {
          forfeiting_registration_id: 'reg-bob',
          match_id: 'm-bob',
          auto_created: true,
        }),
      ],
    });
    await settle({ boutsPutBack: ['m-scheduled'] });
    expect(deps.matchCompletion.onBoutPutBack).toHaveBeenCalledWith('m-bob');
  });
});
