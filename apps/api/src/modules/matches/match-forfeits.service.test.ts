import { BadRequestException, ConflictException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { CLUB_START_FORFEIT_RULES, type ForfeitRules } from '@myclash/types/forfeit-rules';
import { MatchForfeitsService } from './match-forfeits.service';
import {
  mockSupabase,
  scopedTo,
  writesTo,
  type RecordedWrite,
  type SupabaseRow,
} from '../../common/testing/supabase-chain';
import type * as MatchRuleset from '../phases/match-ruleset';
import { fighterStatusDouble, forfeitsOver } from './fighter-status.fixtures';

// A bout put back to "not started" reads its Tournament's ruleset. That read
// has its own tests (`match-forfeits.service.restamp.test.ts`); the bouts of
// this file carry no Tournament, so it answers a fixed one here.
vi.mock('../phases/match-ruleset', async (original) => ({
  ...(await original<typeof MatchRuleset>()),
  tournamentOfBout: vi.fn(() => Promise.resolve('t-1')),
  matchRulesetForTournament: vi.fn(() => Promise.resolve({ match_rules_id: 'rules-t-1' })),
  restampAfterInsert: vi.fn(() => Promise.resolve()),
}));

/**
 * Views over the shared double's write log.
 *
 * The log is one list per table in call order, every verb together — so the
 * kind has to be named. `createForfeit` inserts a record and then UPDATES it as
 * the cascade resolves, and a reader that took every write to `match_forfeits`
 * as an insert would see three phantom rows with no `match_id`.
 *
 * `idsWritten` is the one that matters most: an update or a delete names its
 * row only through the filters that scoped it. The double is a fixture, not a
 * database, so the written row alone cannot tell a restore of the two bouts one
 * record closed from a restore of every bout in the event.
 */
type Writes = { writes: RecordedWrite[] };

const writesOf = (supabase: Writes, table: string, op: RecordedWrite['op']): RecordedWrite[] =>
  writesTo(supabase, table).filter((write) => write.op === op);

const rowsOf = (supabase: Writes, table: string, op: RecordedWrite['op']): SupabaseRow[] =>
  writesOf(supabase, table, op).map((write) => write.row as SupabaseRow);

const idsWritten = (
  supabase: Writes,
  table: string,
  op: RecordedWrite['op'] = 'update',
): unknown[] => writesOf(supabase, table, op).map((write) => scopedTo(write, 'id'));

/**
 * "Disqualify after N forfeits" counts this fighter's own live forfeits in
 * this Tournament, and four filters decide which rows those are. A hardcoded
 * `count` asserted the threshold while proving nothing about whose forfeits
 * were counted, or whether a voided one still counted.
 *
 * The history below is one real prior forfeit and four rows that must not
 * count: another fighter's, another Tournament's, one this fighter had voided,
 * and an organiser's score correction, which shares the table but is not a
 * forfeit at all. Seeded, so the count is a fact about rows — and the forfeit being
 * recorded now needs its stored id, which only `returning` can supply.
 */
const forfeitHistory = (mine: Record<string, unknown>[]) => ({
  rows: [
    {
      id: 'ff-mine',
      tournament_id: 'tournament-1',
      forfeiting_registration_id: 'reg-red',
      reason: 'voluntary',
      voided_at: null,
      match_id: 'match-8',
    },
    {
      id: 'ff-other-fighter',
      tournament_id: 'tournament-1',
      forfeiting_registration_id: 'reg-blue',
      reason: 'voluntary',
      voided_at: null,
      match_id: 'match-7',
    },
    {
      id: 'ff-other-tournament',
      tournament_id: 'tournament-2',
      forfeiting_registration_id: 'reg-red',
      reason: 'voluntary',
      voided_at: null,
      match_id: 'match-6',
    },
    {
      id: 'ff-override',
      tournament_id: 'tournament-1',
      forfeiting_registration_id: 'reg-red',
      // An organiser correcting a score. It shares this table but nobody
      // forfeited, so it must not push anyone toward a disqualification.
      reason: 'admin_correction',
      voided_at: null,
      match_id: 'match-4',
    },
    {
      id: 'ff-voided',
      tournament_id: 'tournament-1',
      forfeiting_registration_id: 'reg-red',
      reason: 'voluntary',
      voided_at: '2026-01-01T00:00:00Z',
      match_id: 'match-5',
    },
    ...mine,
    // The column default the double cannot apply (0241).
  ].map((row): Record<string, unknown> => ({ under_hand_withdrawal: false, ...row })),
  returning: { id: 'forfeit-new' },
});

/**
 * The Tournament's penalty ruleset of now, which every forfeit reads its rules from (rulings
 * 63-76): a new club ruleset's, with `over` on top. An override reads none.
 */
const forfeitRules = (over: Partial<ForfeitRules> = {}) => ({
  tournaments: { rows: [{ id: 'tournament-1', event_id: 'event-1', penalty_ruleset_id: 'pr-1' }] },
  penalty_rulesets: {
    rows: [
      {
        id: 'pr-1',
        first_black_card_forfeit: 'match',
        second_black_card_forfeit: 'tournament',
        forfeit_rules: { ...CLUB_START_FORFEIT_RULES, ...over },
      },
    ],
  },
});

describe('MatchForfeitsService', () => {
  it('records a voluntary forfeit as a 0-6 match loss and asks continuation through canContinue', async () => {
    // No `registrations`: the record keeps no status of its Fighter since 0241 (the status is
    // the settle's), so a read of that table here would throw.
    const supabase = mockSupabase({
      matches: { rows: [matchRow({ phaseType: 'pool', status: 'running' })] },
      match_forfeits: { rows: [], returning: { id: 'forfeit-1' } },
      ...forfeitRules(),
    });
    const service = new MatchForfeitsService(
      supabase as never,
      undefined as never,
      undefined,
      undefined,
      undefined,
      undefined,
      fighterStatusDouble(),
    );

    await service.createForfeit('match-1', {
      forfeitingRegistrationId: 'reg-red',
      reason: 'voluntary',
      canContinue: true,
    });

    expect(rowsOf(supabase, 'match_forfeits', 'insert')[0]).not.toHaveProperty(
      'previous_registration_state',
    );
    expect(rowsOf(supabase, 'match_forfeits', 'insert')[0]).toMatchObject({
      match_id: 'match-1',
      forfeiting_registration_id: 'reg-red',
      winner_registration_id: 'reg-blue',
      reason: 'voluntary',
      score_policy: 'fixed_loss',
      forfeiting_score: 0,
      opponent_score: 6,
      can_continue: true,
    });
    expect(rowsOf(supabase, 'matches', 'update')[0]).toMatchObject({
      status: 'completed',
      winner_registration_id: 'reg-blue',
      red_score: 0,
      blue_score: 6,
    });
  });

  it('a withdrawal forfeits its own bout; her other bouts are the settle’s, after it', async () => {
    // Her later bout of the Pool is seeded: the door must leave it to the reconcile, which
    // forfeits it once the settle has her out (`fighter-reconcile.out.test.ts`).
    const supabase = mockSupabase({
      matches: {
        rows: [
          matchRow({ phaseType: 'pool', status: 'running' }),
          {
            id: 'later-1',
            pool_id: 'pool-1',
            red_registration_id: 'reg-red',
            blue_registration_id: 'reg-green',
            status: 'scheduled',
          },
        ],
      },
      match_forfeits: {
        rows: [],
        returning: (row: SupabaseRow) => ({ id: `ff-${String(row['match_id'])}` }),
      },
      // Her row, for a door that would read it: this one does not (0241).
      registrations: { rows: [{ id: 'reg-red', status: 'checked_in' }] },
      ...forfeitRules(),
    });
    const status = fighterStatusDouble(undefined, () => supabase.writes);
    const service = new MatchForfeitsService(
      supabase as never,
      undefined as never,
      undefined,
      undefined,
      undefined,
      undefined,
      status,
    );

    await service.createForfeit(
      'match-1',
      { forfeitingRegistrationId: 'reg-red', reason: 'injury', canContinue: false },
      { userId: 'user-org' },
    );

    expect(rowsOf(supabase, 'match_forfeits', 'insert').map((row) => row['match_id'])).toEqual([
      'match-1',
    ]);
    expect(idsWritten(supabase, 'matches')).toEqual(['match-1']);
    // The withdrawal is stored with the forfeit that made it; the status is the settle's.
    expect(rowsOf(supabase, 'match_forfeits', 'insert')[0]).toMatchObject({
      fighter_outcome: 'withdrawn',
    });
    expect(idsWritten(supabase, 'registrations')).toEqual([]);
    // Settled once its bout is completed, for her, with the Pool bout it completed (109).
    expect(status.calls).toHaveLength(1);
    expect(status.calls[0]!.input).toMatchObject({
      registrationId: 'reg-red',
      actor: { userId: 'user-org' },
      completedPoolBout: { matchId: 'match-1', phaseId: 'phase-1' },
    });
    expect(status.calls[0]!.writesBefore.map((write) => write.table)).toContain('matches');
  });

  it('rejects void when a downstream dependent match has started', async () => {
    const supabase = mockSupabase({
      match_forfeits: {
        rows: [
          {
            id: 'forfeit-1',
            match_id: 'match-1',
            downstream_match_ids: ['downstream-1'],
            voided_at: null,
          },
        ],
      },
      matches: { rows: [{ id: 'downstream-1', status: 'running' }] },
    });
    const service = new MatchForfeitsService(
      supabase as never,
      undefined as never,
      undefined,
      undefined,
      undefined,
      undefined,
      fighterStatusDouble(),
    );

    await expect(service.voidForfeit('forfeit-1')).rejects.toThrow(BadRequestException);
  });

  /**
   * "Forfeit before 1st match → auto-DQ" counts the fighter's OTHER completed
   * bouts, and three filters decide that count: completed only, this bout
   * excluded, and either corner of the bout being theirs. A hardcoded `count`
   * asserted the policy while proving nothing about who was counted — seed
   * `matches` instead and the count is a fact about the rows.
   *
   * The history below is the same in both tests. Only whether the fighter is in
   * it changes, which is the whole question the policy asks.
   */
  const DQ_MATCH = matchRow({ phaseType: 'pool', status: 'running' });

  const otherBouts = (mine: Record<string, unknown>[]) => ({
    matches: {
      rows: [
        DQ_MATCH,
        // Completed, but somebody else's bout entirely.
        {
          id: 'other-1',
          status: 'completed',
          red_registration_id: 'reg-x',
          blue_registration_id: 'reg-y',
        },
        // Theirs, but not finished — a scheduled bout is not one they fought.
        {
          id: 'later-1',
          status: 'scheduled',
          red_registration_id: 'reg-red',
          blue_registration_id: 'reg-z',
        },
        ...mine,
      ],
    },
    match_forfeits: { rows: [], returning: { id: 'forfeit-1' } },
    registrations: { rows: [{ id: 'reg-red', status: 'checked_in' }] },
    ...forfeitRules({ disqualifyBeforeFirstBout: true }),
  });

  it("auto-disqualifies a forfeit before the fighter's first match when the rule is on", async () => {
    // Nothing conditioned on match count before this; the per-reason
    // tournamentState ('voluntary' -> 'ask') cannot express it.
    const supabase = mockSupabase(otherBouts([]));
    const service = new MatchForfeitsService(
      supabase as never,
      undefined as never,
      undefined,
      undefined,
      undefined,
      undefined,
      fighterStatusDouble(),
    );

    await service.createForfeit('match-1', {
      forfeitingRegistrationId: 'reg-red',
      reason: 'voluntary',
      canContinue: true,
    });

    // Stored with the forfeit, as what it did to them; the status is the settle's.
    expect(rowsOf(supabase, 'match_forfeits', 'insert')[0]).toMatchObject({
      forfeiting_registration_id: 'reg-red',
      fighter_outcome: 'disqualified',
    });
    expect(idsWritten(supabase, 'registrations')).toEqual([]);
  });

  it('does not auto-disqualify when the fighter has already completed a match', async () => {
    // The only row added is one they actually fought and finished — in the BLUE
    // corner, so a count that only looks at red would still disqualify them.
    const supabase = mockSupabase(
      otherBouts([
        {
          id: 'done-1',
          status: 'completed',
          red_registration_id: 'reg-w',
          blue_registration_id: 'reg-red',
        },
      ]),
    );
    const service = new MatchForfeitsService(
      supabase as never,
      undefined as never,
      undefined,
      undefined,
      undefined,
      undefined,
      fighterStatusDouble(),
    );

    await service.createForfeit('match-1', {
      forfeitingRegistrationId: 'reg-red',
      reason: 'voluntary',
      canContinue: true,
    });

    expect(writesOf(supabase, 'registrations', 'update')).toEqual([]);
  });

  it('disqualifies on the Nth forfeit per the forfeit rules', async () => {
    // "Disqualify after N forfeits" counts FORFEITS, not black cards. The
    // per-reason state and the penalty ruleset's black-card ordinal both key off
    // something else, so nothing in the codebase counted these.
    const supabase = mockSupabase({
      matches: { rows: [matchRow({ phaseType: 'pool', status: 'running' })] },
      // One live forfeit of their own already; this one makes two.
      match_forfeits: forfeitHistory([]),
      registrations: { rows: [{ id: 'reg-red', status: 'checked_in' }] },
      ...forfeitRules({ disqualifyAfter: 2 }),
    });
    const service = new MatchForfeitsService(
      supabase as never,
      undefined as never,
      undefined,
      undefined,
      undefined,
      undefined,
      fighterStatusDouble(),
    );

    await service.createForfeit('match-1', {
      forfeitingRegistrationId: 'reg-red',
      reason: 'voluntary',
      canContinue: true,
    });

    // The N-th is stored as nothing of its own: the settle counts the live forfeits (ruling 80).
    // Until the bouts follow the status (B2), the count still takes it out of the Pool.
    expect(rowsOf(supabase, 'match_forfeits', 'insert')[0]).toMatchObject({
      can_continue: false,
      fighter_outcome: null,
    });
  });

  it('does not reach the threshold on rows that are not this fighter’s live forfeits', async () => {
    // The same history with the fighter's one real prior forfeit removed. Four
    // rows still match on some column each, and none of them should count — so
    // a threshold of 2 is not reached and nobody is disqualified.
    const history = forfeitHistory([]);
    const supabase = mockSupabase({
      matches: { rows: [matchRow({ phaseType: 'pool', status: 'running' })] },
      match_forfeits: {
        ...history,
        rows: history.rows.filter((row) => row['id'] !== 'ff-mine'),
      },
      registrations: { rows: [{ id: 'reg-red', status: 'checked_in' }] },
      ...forfeitRules({ disqualifyAfter: 2 }),
    });
    const service = new MatchForfeitsService(
      supabase as never,
      undefined as never,
      undefined,
      undefined,
      undefined,
      undefined,
      fighterStatusDouble(),
    );

    await service.createForfeit('match-1', {
      forfeitingRegistrationId: 'reg-red',
      reason: 'voluntary',
      canContinue: true,
    });

    expect(writesOf(supabase, 'registrations', 'update')).toEqual([]);
  });

  it('leaves the per-reason state alone when neither escalation is on', async () => {
    // Both counts are facts about the rows now: the fighter has fought nothing
    // (this bout is the only match) and has no prior forfeit. With both rules
    // off neither number can reach a threshold anyway, which is the point.
    const supabase = mockSupabase({
      matches: { rows: [matchRow({ phaseType: 'pool', status: 'running' })] },
      match_forfeits: { rows: [], returning: { id: 'forfeit-1' } },
      registrations: { rows: [{ id: 'reg-red', status: 'checked_in' }] },
      ...forfeitRules(),
    });
    const service = new MatchForfeitsService(
      supabase as never,
      undefined as never,
      undefined,
      undefined,
      undefined,
      undefined,
      fighterStatusDouble(),
    );

    await service.createForfeit('match-1', {
      forfeitingRegistrationId: 'reg-red',
      reason: 'voluntary',
      canContinue: true,
    });

    expect(writesOf(supabase, 'registrations', 'update')).toEqual([]);
  });

  it('disqualifies nobody on a second forfeit when "disqualify after" is off', async () => {
    // The history of the case above that disqualifies at two, under rules where it is off: a
    // new club ruleset's start (ruling 67).
    const supabase = mockSupabase({
      matches: { rows: [matchRow({ phaseType: 'pool', status: 'running' })] },
      match_forfeits: forfeitHistory([]),
      registrations: { rows: [{ id: 'reg-red', status: 'checked_in' }] },
      ...forfeitRules({ disqualifyAfter: 'off' }),
    });
    const service = new MatchForfeitsService(
      supabase as never,
      undefined as never,
      undefined,
      undefined,
      undefined,
      undefined,
      fighterStatusDouble(),
    );

    await service.createForfeit('match-1', {
      forfeitingRegistrationId: 'reg-red',
      reason: 'voluntary',
      canContinue: true,
    });

    expect(writesOf(supabase, 'registrations', 'update')).toEqual([]);
  });
});

describe('MatchForfeitsService — result overrides', () => {
  it('overrides a COMPLETED match, which a forfeit may not touch', async () => {
    const supabase = mockSupabase({
      matches: { rows: [matchRow({ phaseType: 'pool', status: 'completed' })] },
      match_forfeits: { rows: [], returning: { id: 'override-1' } },
      registrations: { rows: [{ id: 'reg-red', status: 'checked_in' }] },
    });
    const service = new MatchForfeitsService(
      supabase as never,
      undefined as never,
      undefined,
      undefined,
      undefined,
      undefined,
      fighterStatusDouble(),
    );

    await service.createForfeit('match-1', {
      forfeitingRegistrationId: 'reg-red',
      reason: 'admin_correction',
      explicitScores: { forfeitingScore: 3, opponentScore: 5 },
    });

    expect(rowsOf(supabase, 'match_forfeits', 'insert')[0]).toMatchObject({
      reason: 'admin_correction',
      score_policy: 'explicit',
      forfeiting_score: 3,
      opponent_score: 5,
      winner_registration_id: 'reg-blue',
    });
    // The stated result, not one derived from the ruleset's per-reason policy.
    expect(rowsOf(supabase, 'matches', 'update')[0]).toMatchObject({
      status: 'completed',
      red_score: 3,
      blue_score: 5,
      winner_registration_id: 'reg-blue',
      // Never 'forfeit': nobody withdrew, and the pad and the hall screen
      // would announce one.
      end_reason: 'override',
    });
  });

  it('still refuses a FORFEIT on a completed match', async () => {
    const supabase = mockSupabase({
      matches: { rows: [matchRow({ phaseType: 'pool', status: 'completed' })] },
      // No record on it: a retry of a forfeit would find its own and settle first.
      match_forfeits: { rows: [] },
    });
    const service = new MatchForfeitsService(
      supabase as never,
      undefined as never,
      undefined,
      undefined,
      undefined,
      undefined,
      fighterStatusDouble(),
    );

    await expect(
      service.createForfeit('match-1', {
        forfeitingRegistrationId: 'reg-red',
        reason: 'injury',
        canContinue: true,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('does not count an override toward "disqualify after N forfeits"', async () => {
    // Exactly the shape that disqualifies on a forfeit, and BOTH counts are now
    // facts about rows rather than numbers the fixture asserted into being: one
    // live prior forfeit against a threshold of 1, and no other completed bout
    // against `disqualifyBeforeFirstBout`. Either rule fires on a forfeit. A
    // correction is not one, so nothing escalates.
    const supabase = mockSupabase({
      matches: { rows: [matchRow({ phaseType: 'pool', status: 'completed' })] },
      match_forfeits: forfeitHistory([]),
      registrations: { rows: [{ id: 'reg-red', status: 'checked_in' }] },
      ...forfeitRules({ disqualifyAfter: 1, disqualifyBeforeFirstBout: true }),
    });
    const service = new MatchForfeitsService(
      supabase as never,
      undefined as never,
      undefined,
      undefined,
      undefined,
      undefined,
      fighterStatusDouble(),
    );

    await service.createForfeit('match-1', {
      forfeitingRegistrationId: 'reg-red',
      reason: 'referee_decision',
      explicitScores: { forfeitingScore: 0, opponentScore: 1 },
    });

    expect(writesOf(supabase, 'registrations', 'update')).toEqual([]);
  });

  it('refuses an override once a dependent match has started', async () => {
    const supabase = mockSupabase({
      matches: {
        rows: [
          matchRow({ phaseType: 'single_elim', status: 'completed' }),
          { id: 'downstream-1', status: 'running' },
        ],
      },
      match_forfeits: { rows: [] },
    });
    const bracketAdvance = {
      findDownstreamMatchIds: vi.fn(async () => ['downstream-1']),
      clearDownstreamOf: vi.fn(async () => {}),
    };
    const service = new MatchForfeitsService(
      supabase as never,
      undefined as never,
      undefined as never,
      bracketAdvance as never,
      undefined,
      undefined,
      fighterStatusDouble(),
    );

    await expect(
      service.createForfeit('match-1', {
        forfeitingRegistrationId: 'reg-red',
        reason: 'referee_decision',
        explicitScores: { forfeitingScore: 0, opponentScore: 1 },
      }),
    ).rejects.toThrow('Cannot override a result after a dependent match has started');
    expect(writesOf(supabase, 'match_forfeits', 'insert')).toEqual([]);
  });

  it('clears the downstream slot before re-advancing an overridden bracket match', async () => {
    // Advancement only fills a side that is still null, so without the clear
    // the re-advance is a silent no-op and the bracket keeps the old winner.
    const supabase = mockSupabase({
      matches: {
        rows: [
          matchRow({ phaseType: 'single_elim', status: 'completed' }),
          // The dependent bout, still unfought — which is what lets the
          // override through rather than being refused.
          { id: 'downstream-1', status: 'scheduled' },
        ],
      },
      match_forfeits: { rows: [], returning: { id: 'override-1' } },
      bracket_slots: { rows: [] },
      registrations: { rows: [{ id: 'reg-red', status: 'checked_in' }] },
    });
    const bracketAdvance = {
      findDownstreamMatchIds: vi.fn(async () => ['downstream-1']),
      clearDownstreamOf: vi.fn(async () => {}),
    };
    const matchCompletion = { onMatchCompleted: vi.fn(async () => {}) };
    const service = new MatchForfeitsService(
      supabase as never,
      matchCompletion as never,
      undefined as never,
      bracketAdvance as never,
      undefined,
      undefined,
      fighterStatusDouble(),
    );

    await service.createForfeit('match-1', {
      forfeitingRegistrationId: 'reg-red',
      reason: 'technical_failure',
      explicitScores: { forfeitingScore: 1, opponentScore: 4 },
    });

    expect(bracketAdvance.clearDownstreamOf).toHaveBeenCalledWith('match-1');
    expect(matchCompletion.onMatchCompleted).toHaveBeenCalledWith('match-1');
    // Order is the whole point — clearing after the re-advance would undo it.
    expect(bracketAdvance.clearDownstreamOf.mock.invocationCallOrder[0]).toBeLessThan(
      matchCompletion.onMatchCompleted.mock.invocationCallOrder[0] as number,
    );
  });
});

/**
 * A match row as `loadMatch` reads it back.
 *
 * The phase rides along on the row, through the embed the select asks for. The
 * forfeit rules are the Tournament's penalty ruleset's (`forfeitRules`).
 */
function matchRow(input: { phaseType: string; status: string }) {
  return {
    id: 'match-1',
    phase_id: 'phase-1',
    pool_id: input.phaseType === 'pool' ? 'pool-1' : null,
    bracket_slot_id: input.phaseType === 'pool' ? null : 'slot-1',
    red_registration_id: 'reg-red',
    blue_registration_id: 'reg-blue',
    red_score: 2,
    blue_score: 3,
    status: input.status,
    phases: {
      id: 'phase-1',
      type: input.phaseType,
      tournament_id: 'tournament-1',
      config_json: {},
    },
  };
}

/**
 * Each test below pins a defect found by adversarial review of the override
 * slice and reproduced by execution before its fix. The assertion is not
 * "the code does X" but "this specific way of losing an organiser's
 * correction cannot recur".
 */
describe('MatchForfeitsService — override regressions', () => {
  it('refuses a second override with a conflict instead of silently discarding it', async () => {
    // Was: the early return handed back the existing row, the route answered
    // 201, and the admin page reported success while the score never moved.
    // Correcting a mistyped override — or a match closed by a real forfeit,
    // the case migration 0177 exists for — was impossible through any UI.
    const supabase = mockSupabase({
      matches: { rows: [matchRow({ phaseType: 'pool', status: 'completed' })] },
      match_forfeits: { rows: [{ id: 'forfeit-1', match_id: 'match-1', voided_at: null }] },
    });
    const service = new MatchForfeitsService(
      supabase as never,
      undefined as never,
      undefined,
      undefined,
      undefined,
      undefined,
      fighterStatusDouble(),
    );

    await expect(
      service.createForfeit('match-1', {
        forfeitingRegistrationId: 'reg-red',
        reason: 'admin_correction',
        explicitScores: { forfeitingScore: 2, opponentScore: 5 },
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(writesOf(supabase, 'match_forfeits', 'insert')).toEqual([]);
    expect(writesOf(supabase, 'matches', 'update')).toEqual([]);
  });

  it('keeps a repeated FORFEIT idempotent', async () => {
    // The other half of the same branch: a double-tap on the pad must still
    // return the existing row rather than erroring at the referee.
    const supabase = mockSupabase({
      matches: { rows: [matchRow({ phaseType: 'pool', status: 'running' })] },
      match_forfeits: { rows: [{ id: 'forfeit-1', match_id: 'match-1', voided_at: null }] },
    });
    const service = new MatchForfeitsService(
      supabase as never,
      undefined as never,
      undefined,
      undefined,
      undefined,
      undefined,
      fighterStatusDouble(),
    );

    const result = await service.createForfeit('match-1', {
      forfeitingRegistrationId: 'reg-red',
      reason: 'injury',
      canContinue: true,
    });

    expect(result).toMatchObject({ id: 'forfeit-1' });
    expect(writesOf(supabase, 'match_forfeits', 'insert')).toEqual([]);
  });

  /**
   * The bracket as it stands when a round-1 fighter does not show: their own
   * seeded slot, one more slot in the same round, and one in another phase.
   *
   * The reserve hunt reads every slot in THIS phase to learn who is already
   * placed, so the other phase's slot is what proves that scope: it places
   * `reg-spare`, and a lookup that reached it would decide the only reserve in
   * the event is already in the bracket.
   */
  const BRACKET_SLOTS = [
    {
      id: 'slot-1',
      phase_id: 'phase-1',
      round: 1,
      source_a_type: 'seed',
      source_b_type: 'seed',
      registration_a_id: 'reg-red',
      registration_b_id: 'reg-blue',
    },
    {
      id: 'slot-2',
      phase_id: 'phase-1',
      round: 1,
      source_a_type: 'seed',
      source_b_type: 'seed',
      registration_a_id: 'reg-x',
      registration_b_id: 'reg-y',
    },
    {
      id: 'slot-9',
      phase_id: 'phase-2',
      round: 1,
      source_a_type: 'seed',
      source_b_type: 'seed',
      registration_a_id: 'reg-spare',
      registration_b_id: 'reg-z',
    },
  ];

  /**
   * Who is entered, and who could take the empty side.
   *
   * `reg-spare` is the one eligible reserve. The three rows above it each look
   * like a better answer on one column and must not be taken: an unseeded
   * entrant sorts last, a withdrawn one is not available at all, and the
   * lowest seed in the list is entered in a different tournament.
   */
  const ENTRANTS = [
    { id: 'reg-unseeded', tournament_id: 'tournament-1', status: 'checked_in', seed: null },
    { id: 'reg-withdrawn', tournament_id: 'tournament-1', status: 'withdrawn', seed: 2 },
    { id: 'reg-elsewhere', tournament_id: 'tournament-2', status: 'checked_in', seed: 1 },
    { id: 'reg-spare', tournament_id: 'tournament-1', status: 'checked_in', seed: 9 },
    { id: 'reg-red', tournament_id: 'tournament-1', status: 'checked_in', seed: 3 },
    { id: 'reg-blue', tournament_id: 'tournament-1', status: 'checked_in', seed: 4 },
  ];

  it('does not swap a reserve into the bracket when overriding a scheduled match', async () => {
    // Was: applyBracketForfeit read the PRE-write row, so status was still
    // 'scheduled', tryReplaceMainRoundOneFighter fired, and it reset the match
    // to 0-0 with a different fighter — discarding the override just written.
    // Replacing a no-show is a forfeit remedy; an override states a result.
    const supabase = mockSupabase({
      matches: { rows: [matchRow({ phaseType: 'single_elim', status: 'scheduled' })] },
      match_forfeits: { rows: [], returning: { id: 'override-1' } },
      // A round-1 seeded slot AND an unused registration — everything
      // tryReplaceMainRoundOneFighter needs to find a reserve and fire. Without
      // both, this test passes vacuously on the unfixed code.
      bracket_slots: { rows: BRACKET_SLOTS },
      registrations: { rows: ENTRANTS },
    });
    const service = new MatchForfeitsService(
      supabase as never,
      undefined as never,
      undefined,
      undefined,
      undefined,
      undefined,
      fighterStatusDouble(),
    );

    await service.createForfeit('match-1', {
      forfeitingRegistrationId: 'reg-red',
      reason: 'technical_failure',
      explicitScores: { forfeitingScore: 0, opponentScore: 5 },
    });

    expect(writesOf(supabase, 'bracket_slots', 'update')).toEqual([]);
    // Exactly one write: the override. A second would be the revert to 0-0.
    expect(writesOf(supabase, 'matches', 'update')).toHaveLength(1);
    expect(rowsOf(supabase, 'matches', 'update')[0]).toMatchObject({
      status: 'completed',
      red_score: 0,
      blue_score: 5,
    });
  });

  it('never completes a bout it is about to hand to a reserve', async () => {
    // THE INVARIANT. The replacement used to be resolved AFTER `completeMatch`,
    // so the row went completed → scheduled/0-0 inside one request: an
    // un-completion that never reached `MatchCompletionService`. Self-inverting,
    // so never data loss, but the un-completion owner now assumes it is the only
    // thing that un-completes a bout, and this contradicted that.
    //
    // Deciding first means the bout is simply never completed, so the only write
    // is the fighter swap.
    const supabase = mockSupabase({
      matches: { rows: [matchRow({ phaseType: 'single_elim', status: 'scheduled' })] },
      match_forfeits: { rows: [], returning: { id: 'forfeit-1' } },
      // The registration ids matter here, unlike in the override test above
      // which returns before reading them: they are what decides WHICH side
      // the reserve replaces.
      bracket_slots: { rows: BRACKET_SLOTS },
      registrations: { rows: ENTRANTS },
      ...forfeitRules(),
    });
    const service = new MatchForfeitsService(
      supabase as never,
      undefined as never,
      undefined,
      undefined,
      undefined,
      undefined,
      fighterStatusDouble(),
    );

    await service.createForfeit('match-1', {
      forfeitingRegistrationId: 'reg-red',
      reason: 'injury',
    });

    // The reserve is in, on the slot and on the row.
    expect(rowsOf(supabase, 'bracket_slots', 'update')[0]).toMatchObject({
      registration_a_id: 'reg-spare',
    });
    expect(writesOf(supabase, 'matches', 'update')).toHaveLength(1);
    expect(rowsOf(supabase, 'matches', 'update')[0]).toMatchObject({
      red_registration_id: 'reg-spare',
    });
    // Onto the fighter's own slot and their own bout, and no others.
    expect(idsWritten(supabase, 'bracket_slots')).toEqual(['slot-1']);
    expect(idsWritten(supabase, 'matches')).toEqual(['match-1']);
    // The record is stamped twice on the way out — the reserve it named, then
    // the result the bout ended at — and both name the record just written.
    expect(idsWritten(supabase, 'match_forfeits')).toEqual(['forfeit-1', 'forfeit-1']);
    // And the bout was never completed on the way there — no status write at
    // all, in either direction.
    expect(rowsOf(supabase, 'matches', 'update').some((row) => 'status' in row)).toBe(false);
  });

  it('records the matches it FEEDS as dependents, never itself', async () => {
    // Was: applyBracketForfeit pushed the match's own id, so voidForfeit —
    // whose started-set includes 'completed' — fired on the very match being
    // voided. Every bracket forfeit and override was permanently unvoidable.
    const supabase = mockSupabase({
      matches: {
        rows: [
          matchRow({ phaseType: 'single_elim', status: 'completed' }),
          { id: 'downstream-9', status: 'scheduled' },
        ],
      },
      match_forfeits: { rows: [], returning: { id: 'override-1' } },
      bracket_slots: { rows: [] },
      registrations: { rows: [{ id: 'reg-red', status: 'checked_in' }] },
    });
    const bracketAdvance = {
      findDownstreamMatchIds: vi.fn(async () => ['downstream-9']),
      clearDownstreamOf: vi.fn(async () => {}),
    };
    const service = new MatchForfeitsService(
      supabase as never,
      { onMatchCompleted: vi.fn(async () => {}) } as never,
      undefined as never,
      bracketAdvance as never,
      undefined,
      undefined,
      fighterStatusDouble(),
    );

    const result = await service.createForfeit('match-1', {
      forfeitingRegistrationId: 'reg-red',
      reason: 'referee_decision',
      explicitScores: { forfeitingScore: 1, opponentScore: 3 },
    });

    expect(result.downstream_match_ids).toEqual(['downstream-9']);
    expect(result.downstream_match_ids).not.toContain('match-1');
    // Stored on the record just written, and on no other. The list is read by
    // one guard only — "has a dependent started" — so writing it to the wrong
    // record would refuse a void somewhere else in the bracket.
    expect(idsWritten(supabase, 'match_forfeits')).toEqual(['override-1', 'override-1']);
  });

  it('refuses to rewrite a locked match without the override-locked capability', async () => {
    const supabase = mockSupabase({
      matches: {
        rows: [
          {
            ...matchRow({ phaseType: 'pool', status: 'completed' }),
            locked_at: '2026-08-10T09:00:00.000Z',
          },
        ],
      },
      match_forfeits: { rows: [] },
    });
    const service = new MatchForfeitsService(
      supabase as never,
      undefined as never,
      undefined,
      undefined,
      undefined,
      undefined,
      fighterStatusDouble(),
    );

    await expect(
      service.createForfeit(
        'match-1',
        {
          forfeitingRegistrationId: 'reg-red',
          reason: 'admin_correction',
          explicitScores: { forfeitingScore: 1, opponentScore: 2 },
        },
        { staffAccountId: 'staff-1' },
      ),
    ).rejects.toThrow('Match is locked');
    expect(writesOf(supabase, 'match_forfeits', 'insert')).toEqual([]);
  });

  it('lets an actor holding canOverrideLocked through the lock', async () => {
    const supabase = mockSupabase({
      matches: {
        rows: [
          {
            ...matchRow({ phaseType: 'pool', status: 'completed' }),
            locked_at: '2026-08-10T09:00:00.000Z',
          },
        ],
      },
      match_forfeits: { rows: [], returning: { id: 'override-1' } },
      registrations: { rows: [{ id: 'reg-red', status: 'checked_in' }] },
    });
    const service = new MatchForfeitsService(
      supabase as never,
      undefined as never,
      undefined,
      undefined,
      undefined,
      undefined,
      fighterStatusDouble(),
    );

    await service.createForfeit(
      'match-1',
      {
        forfeitingRegistrationId: 'reg-red',
        reason: 'admin_correction',
        explicitScores: { forfeitingScore: 1, opponentScore: 2 },
      },
      { userId: 'user-1', canOverrideLocked: true },
    );

    expect(writesOf(supabase, 'match_forfeits', 'insert')).toHaveLength(1);
  });

  it('un-advances the bracket when a record is voided', async () => {
    // Void was unreachable until the self-id was removed from
    // downstream_match_ids, which exposed that it restored the match and left
    // the winner it had propagated sitting in the next round. Advancement
    // fills a side only while it is null, so the replayed bout could never
    // correct it — the bracket kept the loser of the replay, silently.
    const supabase = mockSupabase({
      match_forfeits: {
        rows: [
          {
            id: 'forfeit-1',
            match_id: 'match-1',
            parent_forfeit_id: null,
            downstream_match_ids: ['downstream-9'],
            voided_at: null,
            previous_match_state: { status: 'running', red_score: 2, blue_score: 3 },
          },
        ],
      },
      matches: {
        rows: [
          { id: 'match-1', status: 'completed', locked_at: null },
          { id: 'downstream-9', status: 'scheduled' },
          // A bout fought to a finish that this record does not feed. The
          // dependent check reads the ids it was handed and no others — a wider
          // read would refuse every void in a running event.
          { id: 'match-8', status: 'completed', started_at: '2026-08-12T08:00:00.000Z' },
        ],
      },
    });
    const bracketAdvance = {
      findDownstreamMatchIds: vi.fn(async () => ['downstream-9']),
      clearDownstreamOf: vi.fn(async () => {}),
    };
    const service = new MatchForfeitsService(
      supabase as never,
      undefined as never,
      undefined as never,
      bracketAdvance as never,
      undefined,
      undefined,
      fighterStatusDouble(),
    );

    await service.voidForfeit('forfeit-1');

    expect(bracketAdvance.clearDownstreamOf).toHaveBeenCalledWith('match-1');
    // Cleared BEFORE the restore: downstreamSlots resolves through the match
    // row, which the restore is about to rewrite.
    expect(bracketAdvance.clearDownstreamOf.mock.invocationCallOrder[0]).toBeLessThan(
      (
        supabase.service.from as unknown as { mock: { invocationCallOrder: number[] } }
      ).mock.invocationCallOrder.at(-1) as number,
    );
  });

  it('voids over a dependent bout that was itself voided', async () => {
    // The dependent check refuses over a bout that has been fought, and reads
    // "fought" partly off `started_at` — which a voided bout keeps from the run
    // it had before someone voided it. A voided bout holds no live result, so
    // it is not a reason to refuse; excluding it at the query is what makes the
    // predicate's stated precondition true.
    const supabase = mockSupabase({
      match_forfeits: {
        rows: [
          {
            id: 'forfeit-1',
            match_id: 'match-1',
            parent_forfeit_id: null,
            downstream_match_ids: ['downstream-7'],
            voided_at: null,
            previous_match_state: { status: 'running', red_score: 2, blue_score: 3 },
          },
        ],
      },
      matches: {
        rows: [
          { id: 'match-1', status: 'completed', locked_at: null },
          { id: 'downstream-7', status: 'voided', started_at: '2026-08-12T09:00:00.000Z' },
        ],
      },
    });
    const service = new MatchForfeitsService(
      supabase as never,
      undefined as never,
      undefined,
      undefined,
      undefined,
      undefined,
      fighterStatusDouble(),
    );

    await service.voidForfeit('forfeit-1');

    expect(rowsOf(supabase, 'matches', 'update')[0]).toMatchObject({ status: 'running' });
  });

  /**
   * The void that overwrites a real result.
   *
   * Every guard on this path asks whether the ACTOR may void. None asked whether
   * there is still the same thing to void. `liveMatchIds`' own comment names the
   * two routes that put a forfeited bout back in play with its record active —
   * reset and the clock's reopen — but a bout taken back through one
   * of them and then fought to a finish is `completed` again, so no status-shaped
   * check sees anything wrong. The restore then writes the pre-forfeit snapshot
   * over a played result and the scores are gone.
   */
  it('refuses to void a record whose match has been replayed since', async () => {
    const supabase = mockSupabase({
      match_forfeits: {
        rows: [
          {
            id: 'forfeit-1',
            match_id: 'match-1',
            voided_at: null,
            previous_match_state: { status: 'scheduled', red_score: 0, blue_score: 0 },
            // What the forfeit left: a 0–3 walkover to blue.
            resulting_match_state: {
              status: 'completed',
              red_score: 0,
              blue_score: 3,
              winner_registration_id: 'reg-blue',
              ended_at: '2026-08-12T09:00:00.000Z',
              end_reason: 'forfeit',
            },
          },
        ],
      },
      matches: {
        // What the bout says now: reset, re-fought, red won it 5–2 on points.
        rows: [
          {
            id: 'match-1',
            locked_at: null,
            status: 'completed',
            red_score: 5,
            blue_score: 2,
            winner_registration_id: 'reg-red',
            ended_at: '2026-08-12T11:00:00.000Z',
            end_reason: 'first_to_points',
          },
        ],
      },
    });
    const service = new MatchForfeitsService(
      supabase as never,
      undefined as never,
      undefined,
      undefined,
      undefined,
      undefined,
      fighterStatusDouble(),
    );

    await expect(service.voidForfeit('forfeit-1')).rejects.toThrow(BadRequestException);
    // And nothing was written on the way to the refusal.
    expect(writesOf(supabase, 'matches', 'update')).toEqual([]);
    expect(writesOf(supabase, 'match_forfeits', 'update')).toEqual([]);
  });

  it('still voids when the match holds exactly the result the record produced', async () => {
    // The normal case, and the reason the guard compares rather than refusing on
    // any completed row: a forfeited bout IS completed, by the forfeit.
    const result = {
      status: 'completed',
      red_score: 0,
      blue_score: 3,
      winner_registration_id: 'reg-blue',
      ended_at: '2026-08-12T09:00:00.000Z',
      end_reason: 'forfeit',
    };
    const supabase = mockSupabase({
      match_forfeits: {
        rows: [
          {
            id: 'forfeit-1',
            match_id: 'match-1',
            voided_at: null,
            previous_match_state: { status: 'scheduled', red_score: 0, blue_score: 0 },
            resulting_match_state: result,
          },
        ],
      },
      matches: { rows: [{ id: 'match-1', locked_at: null, ...result }] },
    });
    const service = new MatchForfeitsService(
      supabase as never,
      undefined as never,
      undefined,
      undefined,
      undefined,
      undefined,
      fighterStatusDouble(),
    );

    await service.voidForfeit('forfeit-1');

    expect(rowsOf(supabase, 'matches', 'update')).toContainEqual(
      expect.objectContaining({ status: 'scheduled' }),
    );
  });

  it('voids a record written before the post-state was captured', async () => {
    // Pre-0186 rows carry `{}`. Refusing on no evidence would make every
    // historical record permanently unvoidable, so the guard abstains and the
    // old status-shaped protection is what remains.
    const supabase = mockSupabase({
      match_forfeits: {
        rows: [
          {
            id: 'forfeit-1',
            match_id: 'match-1',
            voided_at: null,
            previous_match_state: { status: 'scheduled', red_score: 0, blue_score: 0 },
            resulting_match_state: {},
          },
        ],
      },
      matches: {
        rows: [
          {
            id: 'match-1',
            locked_at: null,
            status: 'completed',
            red_score: 5,
            blue_score: 2,
            winner_registration_id: 'reg-red',
            end_reason: 'first_to_points',
          },
        ],
      },
    });
    const service = new MatchForfeitsService(
      supabase as never,
      undefined as never,
      undefined,
      undefined,
      undefined,
      undefined,
      fighterStatusDouble(),
    );

    await service.voidForfeit('forfeit-1');

    expect(rowsOf(supabase, 'matches', 'update')).toContainEqual(
      expect.objectContaining({ status: 'scheduled' }),
    );
  });

  it('re-advances the bracket when the void restores a decided result', async () => {
    // Voiding an override on a match that had been completed BY PLAY restores a
    // finished result with a winner — and nothing re-advanced it. The clear had
    // already emptied the downstream side, and the usual "replay the bout, let
    // completion advance the real winner" flow never runs on this path, so the
    // bracket stalled on a result it already had.
    const supabase = mockSupabase({
      match_forfeits: {
        rows: [
          {
            id: 'override-1',
            match_id: 'match-1',
            downstream_match_ids: ['downstream-9'],
            voided_at: null,
            previous_match_state: {
              status: 'completed',
              red_score: 5,
              blue_score: 3,
              winner_registration_id: 'reg-red',
            },
          },
        ],
      },
      matches: {
        rows: [
          { id: 'match-1', locked_at: null },
          { id: 'downstream-9', status: 'scheduled' },
        ],
      },
    });
    const matchCompletion = { onMatchCompleted: vi.fn(async () => {}) };
    const service = new MatchForfeitsService(
      supabase as never,
      matchCompletion as never,
      undefined as never,
      {
        findDownstreamMatchIds: vi.fn(async () => []),
        clearDownstreamOf: vi.fn(async () => {}),
      } as never,
      undefined,
      undefined,
      fighterStatusDouble(),
    );

    await service.voidForfeit('override-1');

    expect(matchCompletion.onMatchCompleted).toHaveBeenCalledWith('match-1');
  });

  it('does not re-advance when the void restores an unfinished bout', async () => {
    // The normal case: the bout goes back to running and will advance its real
    // winner when it is replayed. Re-advancing here would propagate a winner
    // that the restored row no longer names.
    const supabase = mockSupabase({
      match_forfeits: {
        rows: [
          {
            id: 'forfeit-1',
            match_id: 'match-1',
            downstream_match_ids: [],
            voided_at: null,
            previous_match_state: { status: 'running', red_score: 2, blue_score: 3 },
          },
        ],
      },
      matches: { rows: [{ id: 'match-1', locked_at: null }] },
    });
    const matchCompletion = { onMatchCompleted: vi.fn(async () => {}) };
    const service = new MatchForfeitsService(
      supabase as never,
      matchCompletion as never,
      undefined,
      undefined,
      undefined,
      undefined,
      fighterStatusDouble(),
    );

    await service.voidForfeit('forfeit-1');

    expect(matchCompletion.onMatchCompleted).not.toHaveBeenCalled();
  });

  it('restores end_reason when a record is voided', async () => {
    const supabase = mockSupabase({
      match_forfeits: {
        rows: [
          {
            id: 'forfeit-1',
            match_id: 'match-1',
            downstream_match_ids: [],
            voided_at: null,
            previous_match_state: {
              status: 'completed',
              red_score: 0,
              blue_score: 0,
              end_reason: 'max_doubles',
            },
          },
        ],
      },
      matches: { rows: [{ id: 'match-1', locked_at: null }] },
    });
    const service = new MatchForfeitsService(
      supabase as never,
      undefined as never,
      undefined,
      undefined,
      undefined,
      undefined,
      fighterStatusDouble(),
    );

    await service.voidForfeit('forfeit-1');

    // Without this the bout keeps end_reason 'override' and is exported to
    // HEMA Ratings as a draw instead of a mutual loss.
    expect(rowsOf(supabase, 'matches', 'update')[0]).toMatchObject({ end_reason: 'max_doubles' });
  });

  it('refuses to void a result inside a frozen event', async () => {
    // Symmetry: a result an actor may not write is one they may not erase.
    const supabase = mockSupabase({
      match_forfeits: {
        rows: [{ id: 'forfeit-1', match_id: 'match-1', voided_at: null }],
      },
      matches: { rows: [{ id: 'match-1', locked_at: null }] },
    });
    const frozenResults = {
      assertResultMutationAllowed: vi.fn(async () => {
        throw new ConflictException('Event results are frozen');
      }),
    };
    const service = new MatchForfeitsService(
      supabase as never,
      undefined as never,
      undefined as never,
      undefined as never,
      frozenResults as never,
      undefined,
      fighterStatusDouble(),
    );

    await expect(service.voidForfeit('forfeit-1', { userId: 'user-1' })).rejects.toThrow(
      'Event results are frozen',
    );
    expect(writesOf(supabase, 'matches', 'update')).toEqual([]);
  });

  it('refuses to void a locked match without the override-locked capability', async () => {
    const supabase = mockSupabase({
      match_forfeits: {
        rows: [{ id: 'forfeit-1', match_id: 'match-1', voided_at: null }],
      },
      // Two bouts, one of them locked. The lock is a property of THIS bout, so
      // a read that cannot say which bout it looked at cannot enforce it.
      matches: {
        rows: [
          { id: 'match-1', status: 'completed', locked_at: '2026-08-10T09:00:00.000Z' },
          { id: 'match-2', status: 'completed', locked_at: null },
        ],
      },
    });
    const service = new MatchForfeitsService(
      supabase as never,
      undefined as never,
      undefined,
      undefined,
      undefined,
      undefined,
      fighterStatusDouble(),
    );

    await expect(service.voidForfeit('forfeit-1', { staffAccountId: 'staff-1' })).rejects.toThrow(
      'Match is locked',
    );
    expect(writesOf(supabase, 'matches', 'update')).toEqual([]);
  });

  it('asks the frozen-results guard before rewriting a result', async () => {
    // A completed event freezes its results; every sibling writer asks, and
    // this one did not — so an override could edit around the exchange-edit
    // review that exists to record exactly such a change.
    const supabase = mockSupabase({
      matches: { rows: [matchRow({ phaseType: 'pool', status: 'completed' })] },
      match_forfeits: { rows: [] },
    });
    const frozenResults = {
      assertResultMutationAllowed: vi.fn(async () => {
        throw new ConflictException('Event results are frozen');
      }),
    };
    const service = new MatchForfeitsService(
      supabase as never,
      undefined as never,
      undefined as never,
      undefined as never,
      frozenResults as never,
      undefined,
      fighterStatusDouble(),
    );

    await expect(
      service.createForfeit(
        'match-1',
        {
          forfeitingRegistrationId: 'reg-red',
          reason: 'admin_correction',
          explicitScores: { forfeitingScore: 1, opponentScore: 2 },
        },
        { userId: 'user-1' },
      ),
    ).rejects.toThrow('Event results are frozen');
    expect(frozenResults.assertResultMutationAllowed).toHaveBeenCalledWith('match-1', 'user-1');
    expect(writesOf(supabase, 'match_forfeits', 'insert')).toEqual([]);
  });
});

describe('MatchForfeitsService — the void of a withdrawal', () => {
  /** A withdrawal on a running Pool bout, and a bout it forfeited because she was out. */
  const PARENT_ROW = {
    id: 'forfeit-1',
    match_id: 'match-1',
    tournament_id: 'tournament-1',
    forfeiting_registration_id: 'reg-red',
    parent_forfeit_id: null,
    fighter_outcome: 'withdrawn',
    voided_at: null,
    downstream_match_ids: [],
    previous_match_state: { status: 'running', red_score: 2, blue_score: 3 },
  };
  const CHILD_ROW = {
    id: 'child-1',
    match_id: 'later-1',
    tournament_id: 'tournament-1',
    forfeiting_registration_id: 'reg-red',
    parent_forfeit_id: 'forfeit-1',
    auto_created: true,
    voided_at: null,
    previous_match_state: { status: 'scheduled', red_score: 0, blue_score: 0 },
  };

  const voidOf = (answer = 2) => {
    const supabase = mockSupabase({
      match_forfeits: { rows: [PARENT_ROW, CHILD_ROW] },
      matches: {
        rows: [
          { id: 'match-1', status: 'completed', locked_at: null },
          { id: 'later-1', status: 'completed' },
        ],
      },
    });
    const status = fighterStatusDouble(
      { before: 'withdrawn', after: 'checked_in', forfeited: 0, broughtBack: answer },
      () => supabase.writes,
    );
    const service = new MatchForfeitsService(
      supabase as never,
      undefined as never,
      undefined,
      undefined,
      undefined,
      undefined,
      status,
    );
    return { supabase, status, service };
  };

  it('puts back its own bout and voids itself: her other bouts are the settle’s', async () => {
    const { supabase, service } = voidOf();
    await service.voidForfeit('forfeit-1', { userId: 'user-org' });
    expect(idsWritten(supabase, 'matches')).toEqual(['match-1']);
    expect(idsWritten(supabase, 'match_forfeits')).toEqual(['forfeit-1']);
    // A person's void: a bout put back so stays back while she is out (ruling 105).
    expect(rowsOf(supabase, 'match_forfeits', 'update')[0]).not.toHaveProperty('voided_by_return');
    // No status the record found is written back: the settle reads what stays live.
    expect(writesTo(supabase, 'registrations')).toEqual([]);
  });

  it('settles her last, for the actor, and answers the bouts the settle brought back', async () => {
    const { supabase, status, service } = voidOf(3);
    const result = await service.voidForfeit('forfeit-1', { userId: 'user-org' });
    expect(status.calls).toHaveLength(1);
    expect(status.calls[0]!.input).toEqual({
      registrationId: 'reg-red',
      tournamentId: 'tournament-1',
      actor: { userId: 'user-org', staffAccountId: undefined },
      completedPoolBout: undefined,
      // The bout it put back: the other Fighter on it, when out, forfeits it (review B2, M1).
      boutsPutBack: ['match-1'],
    });
    expect(status.calls[0]!.writesBefore).toHaveLength(supabase.writes.length);
    expect(result.cascaded_forfeit_count).toBe(3);
  });

  it('a black card’s take-back leaves the settle to the card’s door', async () => {
    const { supabase, status, service } = voidOf();
    const result = await service.voidForfeit('forfeit-1', {}, { settledByCaller: true });
    expect(idsWritten(supabase, 'match_forfeits')).toEqual(['forfeit-1']);
    expect(status.calls).toHaveLength(0);
    expect(result.cascaded_forfeit_count).toBe(0);
  });

  it('a take-back sent again settles before its refusal, but not a black card’s', async () => {
    const voidedRow = { ...PARENT_ROW, voided_at: '2026-10-21T12:00:00Z' };
    const supabase = mockSupabase({ match_forfeits: { rows: [voidedRow] } });
    const status = fighterStatusDouble();
    const service = forfeitsOver(supabase, status);
    await expect(service.voidForfeit('forfeit-1', {}, { settledByCaller: true })).rejects.toThrow(
      'Forfeit is already voided',
    );
    expect(status.calls).toHaveLength(0);
    await expect(service.voidForfeit('forfeit-1')).rejects.toThrow('Forfeit is already voided');
    expect(status.calls).toHaveLength(1);
  });

  it('records a Pool forfeit’s bout as no dependent of it', async () => {
    // Was: the bouts a withdrawal forfeited went into `downstream_match_ids`, whose one reader is
    // a started-check whose set includes 'completed', so the record could never be undone.
    const supabase = mockSupabase({
      matches: { rows: [matchRow({ phaseType: 'pool', status: 'running' })] },
      match_forfeits: { rows: [], returning: { id: 'forfeit-1' } },
      // Her row, for a door that would read it: this one does not (0241).
      registrations: { rows: [{ id: 'reg-red', status: 'checked_in' }] },
      ...forfeitRules(),
    });
    const service = new MatchForfeitsService(
      supabase as never,
      undefined as never,
      undefined,
      undefined,
      undefined,
      undefined,
      fighterStatusDouble(),
    );
    const result = await service.createForfeit('match-1', {
      forfeitingRegistrationId: 'reg-red',
      reason: 'injury',
      canContinue: false,
    });
    expect(result.downstream_match_ids).toEqual([]);
    expect(
      rowsOf(supabase, 'match_forfeits', 'update').some(
        (row) => 'downstream_match_ids' in (row as Record<string, unknown>),
      ),
    ).toBe(false);
  });
});

/**
 * Voiding one bout forfeited under a withdrawal is already possible — there was never a lock.
 * What was missing is the THREAD: a fresh forfeit written on that reopened bout used to be a root
 * of its own, so voiding the withdrawal no longer brought it back (ruling 105), and the fighter
 * came back to the standings carrying an F that named a withdrawal nothing pointed at.
 *
 * Keyed on the BOUT (slice B, B2), not the Pool: a forfeit the Fighter chose later in the Pool,
 * on a bout the withdrawal never closed, is a forfeit of its own and counts toward "after N".
 */
describe('MatchForfeitsService — re-recorded forfeit under a live withdrawal', () => {
  /** The withdrawal this bout belongs under: hers, a person's, still on record, and out. */
  const LIVE_ROOT = {
    id: 'root-1',
    match_id: 'match-8',
    tournament_id: 'tournament-1',
    forfeiting_registration_id: 'reg-red',
    parent_forfeit_id: null,
    auto_created: false,
    under_hand_withdrawal: false,
    can_continue: false,
    voided_at: null,
    created_at: '2026-08-12T08:00:00.000Z',
  };

  /** This bout was forfeited because she was out, and the organiser voided that to put it back. */
  const PUT_BACK = {
    ...LIVE_ROOT,
    id: 'ff-put-back',
    match_id: 'match-1',
    parent_forfeit_id: 'root-1',
    auto_created: true,
    voided_at: '2026-08-12T08:30:00.000Z',
    created_at: '2026-08-12T08:00:01.000Z',
  };

  /**
   * One record per scope the root lookup applies, each a near miss on everything else. Every one
   * is NEWER than the withdrawal above, so a lost scope adopts it rather than failing quietly.
   */
  const NEAR_MISSES = [
    {
      ...LIVE_ROOT,
      id: 'ff-other-tournament',
      match_id: 'match-2',
      tournament_id: 'tournament-2',
      created_at: '2026-08-12T09:00:00.000Z',
    },
    {
      ...LIVE_ROOT,
      id: 'ff-other-fighter',
      match_id: 'match-3',
      forfeiting_registration_id: 'reg-blue',
      created_at: '2026-08-12T09:01:00.000Z',
    },
    // Recorded under the withdrawal: an effect of the root, not a root.
    {
      ...LIVE_ROOT,
      id: 'ff-child',
      match_id: 'match-4',
      parent_forfeit_id: 'root-1',
      created_at: '2026-08-12T09:02:00.000Z',
    },
    // A one-bout forfeit: she carried on, so it withdrew nobody.
    {
      ...LIVE_ROOT,
      id: 'ff-can-continue',
      match_id: 'match-5',
      can_continue: true,
      created_at: '2026-08-12T09:03:00.000Z',
    },
    // A withdrawal the organiser voided names a withdrawal that no longer exists.
    {
      ...LIVE_ROOT,
      id: 'ff-voided',
      match_id: 'match-6',
      voided_at: '2026-08-11T09:00:00.000Z',
      created_at: '2026-08-12T09:04:00.000Z',
    },
    // A forfeit recorded under the hand withdrawal: an effect of it, no root (ruling 118).
    {
      ...LIVE_ROOT,
      id: 'ff-under-hand',
      match_id: 'match-9',
      under_hand_withdrawal: true,
      created_at: '2026-08-12T09:06:00.000Z',
    },
    // A bout forfeited because she was out by a card or the hand: no parent, and no root either.
    {
      ...LIVE_ROOT,
      id: 'ff-auto',
      match_id: 'match-7',
      auto_created: true,
      created_at: '2026-08-12T09:05:00.000Z',
    },
  ];

  const recordOn = async (
    records: SupabaseRow[],
    reason: string,
    status = 'running',
    hand = 'checked_in',
    rules: Partial<ForfeitRules> = {},
  ) => {
    const supabase = mockSupabase({
      matches: { rows: [matchRow({ phaseType: 'pool', status })] },
      match_forfeits: {
        rows: records,
        returning: (row: SupabaseRow) => ({ id: `ff-${String(row['match_id'])}` }),
      },
      // Her row: the organiser's hand, read when no root covers the bout (ruling 118).
      registrations: { rows: [{ id: 'reg-red', status: 'checked_in', entry_status: hand }] },
      ...forfeitRules(rules),
    });
    const service = forfeitsOver(supabase);
    const isOverride = reason === 'admin_correction';
    await service.createForfeit('match-1', {
      forfeitingRegistrationId: 'reg-red',
      reason: reason as 'voluntary',
      ...(isOverride
        ? { explicitScores: { forfeitingScore: 3, opponentScore: 5 } }
        : { canContinue: true }),
    });
    return rowsOf(supabase, 'match_forfeits', 'insert')[0];
  };

  it('hangs a forfeit on a bout put back off the live root withdrawal', async () => {
    expect(await recordOn([LIVE_ROOT, PUT_BACK, ...NEAR_MISSES], 'voluntary')).toMatchObject({
      match_id: 'match-1',
      parent_forfeit_id: 'root-1',
      fighter_outcome: null,
    });
  });

  it('roots a forfeit on a bout the withdrawal never closed, live root in the Pool or not', async () => {
    expect(await recordOn([LIVE_ROOT, ...NEAR_MISSES], 'voluntary')).toMatchObject({
      parent_forfeit_id: null,
    });
  });

  it('still roots a forfeit on a bout put back when no live withdrawal covers her', async () => {
    expect(await recordOn([PUT_BACK, ...NEAR_MISSES], 'voluntary')).toMatchObject({
      parent_forfeit_id: null,
      under_hand_withdrawal: false,
    });
  });

  it('under the organiser’s hand withdrawal, with no root, it is that withdrawal’s (118)', async () => {
    expect(
      await recordOn([PUT_BACK, ...NEAR_MISSES], 'voluntary', 'running', 'withdrawn'),
    ).toMatchObject({
      parent_forfeit_id: null,
      under_hand_withdrawal: true,
      fighter_outcome: null,
      // Escalates nothing: it is no forfeit the Fighter chose.
      can_continue: true,
    });
  });

  it('one under the hand escalates nothing: no "forfeit before the 1st bout" (118)', async () => {
    const before = { disqualifyBeforeFirstBout: true };
    const put = [PUT_BACK, ...NEAR_MISSES];
    expect(await recordOn(put, 'voluntary', 'running', 'withdrawn', before)).toMatchObject({
      under_hand_withdrawal: true,
      fighter_outcome: null,
    });
    // Its twin, the hand checked in: a forfeit of her own, which that rule disqualifies.
    expect(await recordOn(put, 'voluntary', 'running', 'checked_in', before)).toMatchObject({
      under_hand_withdrawal: false,
      fighter_outcome: 'disqualified',
    });
  });

  it('one under the hand is not counted toward "disqualify after N" (118)', async () => {
    const underHand = {
      ...LIVE_ROOT,
      id: 'ff-hand',
      match_id: 'match-3',
      reason: 'voluntary',
      can_continue: true,
      under_hand_withdrawal: true,
    };
    const after2 = { disqualifyAfter: 2 as const };
    // Her first own forfeit: the one under the hand does not make it the 2nd.
    expect(await recordOn([underHand], 'voluntary', 'running', 'checked_in', after2)).toMatchObject(
      { can_continue: true },
    );
    const own = { ...underHand, under_hand_withdrawal: false };
    expect(await recordOn([own], 'voluntary', 'running', 'checked_in', after2)).toMatchObject({
      can_continue: false,
    });
  });

  it('a live root wins over the hand: the record hangs off it', async () => {
    expect(
      await recordOn([LIVE_ROOT, PUT_BACK], 'voluntary', 'running', 'withdrawn'),
    ).toMatchObject({ parent_forfeit_id: 'root-1', under_hand_withdrawal: false });
  });

  it('a forfeit on a bout never put back is no effect of the hand either', async () => {
    expect(await recordOn(NEAR_MISSES, 'voluntary', 'running', 'withdrawn')).toMatchObject({
      parent_forfeit_id: null,
      under_hand_withdrawal: false,
    });
  });

  it('never inherits for an OVERRIDE', async () => {
    // An override asserts the bout was fought and the result was X; voiding the withdrawal
    // must not erase a result an organiser stated.
    expect(await recordOn([LIVE_ROOT, PUT_BACK], 'admin_correction', 'completed')).toMatchObject({
      parent_forfeit_id: null,
    });
  });

  it('never inherits for a black card: the card is a cause of its own', async () => {
    // Under the withdrawal, voiding the injury would void the card's forfeit too, and erase
    // what the card did to her.
    expect(await recordOn([LIVE_ROOT, PUT_BACK], 'black_card_1')).toMatchObject({
      parent_forfeit_id: null,
    });
  });
});

/**
 * `getActiveForfeit` is what the organiser's confirm copy branches on, and none
 * of it can be derived on the frontend: the row says a parent EXISTS, never
 * whether that parent is still on record, and nothing on it counts the children
 * a void would carry down.
 */
describe('MatchForfeitsService — cascade context on the read', () => {
  /**
   * Every record one pool holds, seeded so the three reads this describe makes
   * are facts about rows rather than answers a fixture handed back.
   *
   * The reads are "the live record on this bout", "how many live children would
   * a void reopen" and "is the record that withdrew the fighter still standing".
   * Each decoy below exists for one of the scopes that separates them: a VOIDED
   * record on the same bout, a live record on another bout, and a child the
   * organiser had already voided.
   */
  const RECORDS = [
    // The withdrawal, on the bout where the fighter pulled out.
    { id: 'root-1', match_id: 'match-1', parent_forfeit_id: null, voided_at: null },
    // An earlier record on that same bout, voided — the live-record read must
    // not find it.
    {
      id: 'stale-1',
      match_id: 'match-1',
      parent_forfeit_id: null,
      voided_at: '2026-08-09T09:00:00.000Z',
    },
    // The three bouts the withdrawal closed.
    {
      id: 'child-1',
      match_id: 'match-9',
      parent_forfeit_id: 'root-1',
      auto_created: true,
      voided_at: null,
    },
    {
      id: 'child-2',
      match_id: 'match-10',
      parent_forfeit_id: 'root-1',
      auto_created: true,
      voided_at: null,
    },
    {
      id: 'child-3',
      match_id: 'match-11',
      parent_forfeit_id: 'root-1',
      auto_created: true,
      voided_at: null,
    },
    // A child the organiser already put back on the schedule. Off the record,
    // so it is not a bout this void would reopen.
    {
      id: 'child-voided',
      match_id: 'match-12',
      parent_forfeit_id: 'root-1',
      voided_at: '2026-08-10T09:00:00.000Z',
    },
    // Another voided record, on the bout child-1 covers.
    {
      id: 'stale-9',
      match_id: 'match-9',
      parent_forfeit_id: null,
      voided_at: '2026-08-09T09:00:00.000Z',
    },
    // A child still pointing at a withdrawal that was voided and re-recorded.
    // A re-recorded parent is a DIFFERENT row, so this one names a withdrawal
    // that no longer stands.
    { id: 'orphan-1', match_id: 'match-13', parent_forfeit_id: 'stale-9', voided_at: null },
    // A one-bout forfeit that closed nothing else.
    { id: 'solo-1', match_id: 'match-20', parent_forfeit_id: null, voided_at: null },
  ];

  const readState = () => ({ match_forfeits: { rows: RECORDS } });

  it('reports a child, and whether the record that withdrew the fighter still stands', async () => {
    const supabase = mockSupabase(readState());
    const service = new MatchForfeitsService(
      supabase as never,
      undefined as never,
      undefined,
      undefined,
      undefined,
      undefined,
      fighterStatusDouble(),
    );

    const active = await service.getActiveForfeit('match-9');

    expect(active).toMatchObject({
      id: 'child-1',
      cascade: { role: 'child', childCount: 0, parentActive: true },
    });
  });

  it('reports a child whose parent has already been voided', async () => {
    const supabase = mockSupabase(readState());
    const service = new MatchForfeitsService(
      supabase as never,
      undefined as never,
      undefined,
      undefined,
      undefined,
      undefined,
      fighterStatusDouble(),
    );

    const active = await service.getActiveForfeit('match-13');

    expect(active).toMatchObject({
      id: 'orphan-1',
      cascade: { role: 'child', parentActive: false },
    });
  });

  it('reports a root with the number of bouts its void would reopen', async () => {
    // Three live children and one the organiser already voided. The count is
    // what the confirm copy quotes, so a voided child counted here would
    // promise the organiser a bout back that is already back.
    const supabase = mockSupabase(readState());
    const service = new MatchForfeitsService(
      supabase as never,
      undefined as never,
      undefined,
      undefined,
      undefined,
      undefined,
      fighterStatusDouble(),
    );

    const active = await service.getActiveForfeit('match-1');

    expect(active).toMatchObject({
      id: 'root-1',
      cascade: { role: 'root', childCount: 3, parentActive: false },
    });
  });

  it('reports a standalone record when it closed nothing but its own bout', async () => {
    const supabase = mockSupabase(readState());
    const service = new MatchForfeitsService(
      supabase as never,
      undefined as never,
      undefined,
      undefined,
      undefined,
      undefined,
      fighterStatusDouble(),
    );

    const active = await service.getActiveForfeit('match-20');

    expect(active).toMatchObject({
      id: 'solo-1',
      cascade: { role: 'standalone', childCount: 0 },
    });
  });

  it('answers null for a bout whose record was voided, without the extra reads', async () => {
    // match-12 carries a record; it is simply not live. Answering with it would
    // render a void button for a bout that is already back on the schedule.
    const supabase = mockSupabase(readState());
    const service = new MatchForfeitsService(
      supabase as never,
      undefined as never,
      undefined,
      undefined,
      undefined,
      undefined,
      fighterStatusDouble(),
    );

    expect(await service.getActiveForfeit('match-12')).toBeNull();
    expect(supabase.service.from).toHaveBeenCalledTimes(1);
  });
});
