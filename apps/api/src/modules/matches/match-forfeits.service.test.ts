import { BadRequestException, ConflictException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { MatchForfeitsService } from './match-forfeits.service';

describe('MatchForfeitsService', () => {
  it('records a voluntary forfeit as a 0-6 match loss and asks continuation through canContinue', async () => {
    const supabase = fakeSupabase({
      matches: {
        maybeSingle: matchRow({ phaseType: 'pool', status: 'running' }),
        update: { id: 'match-1' },
      },
      match_forfeits: { maybeSingle: null, insert: { id: 'forfeit-1' } },
      phases: { maybeSingle: { id: 'phase-1', type: 'pool', tournament_id: 'tournament-1' } },
      tournaments: { maybeSingle: { id: 'tournament-1', ruleset_config: {} } },
    });
    const service = new MatchForfeitsService(supabase as never, undefined as never);

    await service.createForfeit('match-1', {
      forfeitingRegistrationId: 'reg-red',
      reason: 'voluntary',
      canContinue: true,
    });

    expect(supabase.inserted.match_forfeits?.[0]).toMatchObject({
      match_id: 'match-1',
      forfeiting_registration_id: 'reg-red',
      winner_registration_id: 'reg-blue',
      reason: 'voluntary',
      score_policy: 'fixed_loss',
      forfeiting_score: 0,
      opponent_score: 6,
      can_continue: true,
    });
    expect(supabase.updated.matches?.[0]).toMatchObject({
      status: 'completed',
      winner_registration_id: 'reg-blue',
      red_score: 0,
      blue_score: 6,
    });
  });

  it('auto-forfeits later unstarted pool matches when fighter cannot continue', async () => {
    const supabase = fakeSupabase({
      matches: {
        maybeSingle: matchRow({ phaseType: 'pool', status: 'running' }),
        update: { id: 'match-1' },
        select: [
          {
            id: 'later-1',
            red_registration_id: 'reg-red',
            blue_registration_id: 'reg-green',
            status: 'scheduled',
          },
        ],
      },
      match_forfeits: { maybeSingle: null, insert: { id: 'forfeit-1' } },
      phases: { maybeSingle: { id: 'phase-1', type: 'pool', tournament_id: 'tournament-1' } },
      tournaments: { maybeSingle: { id: 'tournament-1', ruleset_config: {} } },
    });
    const service = new MatchForfeitsService(supabase as never, undefined as never);

    await service.createForfeit('match-1', {
      forfeitingRegistrationId: 'reg-red',
      reason: 'injury',
      canContinue: false,
    });

    expect(supabase.inserted.match_forfeits).toHaveLength(2);
    expect(supabase.inserted.match_forfeits?.[1]).toMatchObject({
      match_id: 'later-1',
      forfeiting_registration_id: 'reg-red',
      winner_registration_id: 'reg-green',
      auto_created: true,
    });
  });

  it('rejects void when a downstream dependent match has started', async () => {
    const supabase = fakeSupabase({
      match_forfeits: {
        maybeSingle: {
          id: 'forfeit-1',
          match_id: 'match-1',
          downstream_match_ids: ['downstream-1'],
          voided_at: null,
        },
        update: { id: 'forfeit-1' },
      },
      matches: {
        select: [{ id: 'downstream-1', status: 'running' }],
      },
    });
    const service = new MatchForfeitsService(supabase as never, undefined as never);

    await expect(service.voidForfeit('forfeit-1')).rejects.toThrow(BadRequestException);
  });

  it("auto-disqualifies a forfeit before the fighter's first match when the policy is on", async () => {
    // tournamentPolicy.forfeitFighterBefore1stMatch - "Forfeit before 1st match
    // -> auto-DQ". Nothing conditioned on match count before this; the
    // per-reason tournamentState ('voluntary' -> 'ask') cannot express it.
    const supabase = fakeSupabase({
      matches: {
        maybeSingle: matchRow({
          phaseType: 'pool',
          status: 'running',
          tournamentPolicy: { forfeitFighterBefore1stMatch: true },
        }),
        update: { id: 'match-1' },
        count: 0, // no other completed match for this registration
      },
      match_forfeits: { maybeSingle: null, insert: { id: 'forfeit-1' } },
      phases: { maybeSingle: { id: 'phase-1', type: 'pool', tournament_id: 'tournament-1' } },
      registrations: { maybeSingle: { id: 'reg-red', status: 'checked_in' } },
    });
    const service = new MatchForfeitsService(supabase as never, undefined as never);

    await service.createForfeit('match-1', {
      forfeitingRegistrationId: 'reg-red',
      reason: 'voluntary',
      canContinue: true,
    });

    expect(supabase.updated.registrations?.[0]).toMatchObject({ status: 'disqualified' });
  });

  it('does not auto-disqualify when the fighter has already completed a match', async () => {
    const supabase = fakeSupabase({
      matches: {
        maybeSingle: matchRow({
          phaseType: 'pool',
          status: 'running',
          tournamentPolicy: { forfeitFighterBefore1stMatch: true },
        }),
        update: { id: 'match-1' },
        count: 2,
      },
      match_forfeits: { maybeSingle: null, insert: { id: 'forfeit-1' } },
      phases: { maybeSingle: { id: 'phase-1', type: 'pool', tournament_id: 'tournament-1' } },
      registrations: { maybeSingle: { id: 'reg-red', status: 'checked_in' } },
    });
    const service = new MatchForfeitsService(supabase as never, undefined as never);

    await service.createForfeit('match-1', {
      forfeitingRegistrationId: 'reg-red',
      reason: 'voluntary',
      canContinue: true,
    });

    expect(supabase.updated.registrations?.[0]).toBeUndefined();
  });

  it('disqualifies on the Nth forfeit per tournamentPolicy.disqualifyAfter', async () => {
    // "Disqualify after N forfeits" counts FORFEITS, not black cards. The
    // per-reason state and the penalty ruleset's black-card ordinal both key off
    // something else, so nothing in the codebase counted these.
    const supabase = fakeSupabase({
      matches: {
        maybeSingle: matchRow({
          phaseType: 'pool',
          status: 'running',
          tournamentPolicy: { disqualifyAfter: 2 },
        }),
        update: { id: 'match-1' },
      },
      // One prior non-voided forfeit; this one makes two.
      match_forfeits: { maybeSingle: null, insert: { id: 'forfeit-2' }, count: 1 },
      phases: { maybeSingle: { id: 'phase-1', type: 'pool', tournament_id: 'tournament-1' } },
      registrations: { maybeSingle: { id: 'reg-red', status: 'checked_in' } },
    });
    const service = new MatchForfeitsService(supabase as never, undefined as never);

    await service.createForfeit('match-1', {
      forfeitingRegistrationId: 'reg-red',
      reason: 'voluntary',
      canContinue: true,
    });

    expect(supabase.updated.registrations?.[0]).toMatchObject({ status: 'disqualified' });
  });

  it('leaves the per-reason state alone when no tournament policy is set', async () => {
    const supabase = fakeSupabase({
      matches: {
        maybeSingle: matchRow({ phaseType: 'pool', status: 'running' }),
        update: { id: 'match-1' },
        count: 0,
      },
      match_forfeits: { maybeSingle: null, insert: { id: 'forfeit-1' }, count: 5 },
      phases: { maybeSingle: { id: 'phase-1', type: 'pool', tournament_id: 'tournament-1' } },
      registrations: { maybeSingle: { id: 'reg-red', status: 'checked_in' } },
    });
    const service = new MatchForfeitsService(supabase as never, undefined as never);

    await service.createForfeit('match-1', {
      forfeitingRegistrationId: 'reg-red',
      reason: 'voluntary',
      canContinue: true,
    });

    expect(supabase.updated.registrations?.[0]).toBeUndefined();
  });
});

describe('MatchForfeitsService — result overrides', () => {
  it('overrides a COMPLETED match, which a forfeit may not touch', async () => {
    const supabase = fakeSupabase({
      matches: {
        maybeSingle: matchRow({ phaseType: 'pool', status: 'completed' }),
        update: { id: 'match-1' },
      },
      match_forfeits: { maybeSingle: null, insert: { id: 'override-1' } },
      phases: { maybeSingle: { id: 'phase-1', type: 'pool', tournament_id: 'tournament-1' } },
      tournaments: { maybeSingle: { id: 'tournament-1', ruleset_config: {} } },
    });
    const service = new MatchForfeitsService(supabase as never, undefined as never);

    await service.createForfeit('match-1', {
      forfeitingRegistrationId: 'reg-red',
      reason: 'admin_correction',
      explicitScores: { forfeitingScore: 3, opponentScore: 5 },
    });

    expect(supabase.inserted.match_forfeits?.[0]).toMatchObject({
      reason: 'admin_correction',
      score_policy: 'explicit',
      forfeiting_score: 3,
      opponent_score: 5,
      winner_registration_id: 'reg-blue',
    });
    // The stated result, not one derived from the ruleset's per-reason policy.
    expect(supabase.updated.matches?.[0]).toMatchObject({
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
    const supabase = fakeSupabase({
      matches: { maybeSingle: matchRow({ phaseType: 'pool', status: 'completed' }) },
    });
    const service = new MatchForfeitsService(supabase as never, undefined as never);

    await expect(
      service.createForfeit('match-1', {
        forfeitingRegistrationId: 'reg-red',
        reason: 'injury',
        canContinue: true,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('does not count an override toward tournamentPolicy.disqualifyAfter', async () => {
    // The same shape that disqualifies on a forfeit: a threshold of 1 and
    // five prior rows. A correction is not a forfeit, so nothing escalates.
    const supabase = fakeSupabase({
      matches: {
        maybeSingle: matchRow({
          phaseType: 'pool',
          status: 'completed',
          tournamentPolicy: { disqualifyAfter: 1, forfeitFighterBefore1stMatch: true },
        }),
        update: { id: 'match-1' },
        count: 0,
      },
      match_forfeits: { maybeSingle: null, insert: { id: 'override-1' }, count: 5 },
      phases: { maybeSingle: { id: 'phase-1', type: 'pool', tournament_id: 'tournament-1' } },
      registrations: { maybeSingle: { id: 'reg-red', status: 'checked_in' } },
    });
    const service = new MatchForfeitsService(supabase as never, undefined as never);

    await service.createForfeit('match-1', {
      forfeitingRegistrationId: 'reg-red',
      reason: 'referee_decision',
      explicitScores: { forfeitingScore: 0, opponentScore: 1 },
    });

    expect(supabase.updated.registrations?.[0]).toBeUndefined();
  });

  it('refuses an override once a dependent match has started', async () => {
    const supabase = fakeSupabase({
      matches: {
        maybeSingle: matchRow({ phaseType: 'single_elim', status: 'completed' }),
        select: [{ id: 'downstream-1', status: 'running' }],
      },
      phases: {
        maybeSingle: { id: 'phase-1', type: 'single_elim', tournament_id: 'tournament-1' },
      },
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
    );

    await expect(
      service.createForfeit('match-1', {
        forfeitingRegistrationId: 'reg-red',
        reason: 'referee_decision',
        explicitScores: { forfeitingScore: 0, opponentScore: 1 },
      }),
    ).rejects.toThrow('Cannot override a result after a dependent match has started');
    expect(supabase.inserted.match_forfeits).toBeUndefined();
  });

  it('clears the downstream slot before re-advancing an overridden bracket match', async () => {
    // Advancement only fills a side that is still null, so without the clear
    // the re-advance is a silent no-op and the bracket keeps the old winner.
    const supabase = fakeSupabase({
      matches: {
        maybeSingle: matchRow({ phaseType: 'single_elim', status: 'completed' }),
        update: { id: 'match-1' },
        select: [{ id: 'downstream-1', status: 'scheduled' }],
      },
      match_forfeits: { maybeSingle: null, insert: { id: 'override-1' } },
      phases: {
        maybeSingle: { id: 'phase-1', type: 'single_elim', tournament_id: 'tournament-1' },
      },
      bracket_slots: { maybeSingle: null },
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

function matchRow(input: {
  phaseType: string;
  status: string;
  tournamentPolicy?: Record<string, unknown>;
}) {
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
      tournaments: {
        id: 'tournament-1',
        ruleset_config: input.tournamentPolicy ? { tournamentPolicy: input.tournamentPolicy } : {},
      },
    },
  };
}

type TableState = Record<
  string,
  {
    maybeSingle?: unknown;
    select?: unknown[];
    insert?: unknown;
    update?: unknown;
    /** For `.select(col, { count: 'exact', head: true })` lookups. */
    count?: number;
  }
>;

function fakeSupabase(state: TableState) {
  const inserted: Record<string, unknown[]> = {};
  const updated: Record<string, unknown[]> = {};

  function chain(table: string) {
    const tableState = state[table] ?? {};
    const promise = Promise.resolve({
      data: tableState.select ?? [],
      count: tableState.count ?? 0,
      error: null,
    });
    // Supabase's fluent query builder is both thenable and chainable in the code under test.
    // The test double intentionally mirrors that hybrid shape.
    const api: any = Object.assign(promise, {
      select: vi.fn(() => api),
      eq: vi.fn(() => api),
      neq: vi.fn(() => api),
      is: vi.fn(() => api),
      or: vi.fn(() => api),
      in: vi.fn(() => api),
      not: vi.fn(() => api),
      order: vi.fn(() => api),
      maybeSingle: vi.fn(() =>
        Promise.resolve({ data: tableState.maybeSingle ?? null, error: null }),
      ),
      single: vi.fn(() =>
        Promise.resolve({ data: tableState.insert ?? tableState.update ?? null, error: null }),
      ),
      insert: vi.fn((row: unknown) => {
        inserted[table] = [...(inserted[table] ?? []), row];
        return api;
      }),
      update: vi.fn((row: unknown) => {
        updated[table] = [...(updated[table] ?? []), row];
        return api;
      }),
    });
    return api;
  }

  return {
    inserted,
    updated,
    service: {
      from: vi.fn((table: string) => chain(table)),
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
    const supabase = fakeSupabase({
      matches: { maybeSingle: matchRow({ phaseType: 'pool', status: 'completed' }) },
      match_forfeits: { maybeSingle: { id: 'forfeit-1', match_id: 'match-1', voided_at: null } },
      phases: { maybeSingle: { id: 'phase-1', type: 'pool', tournament_id: 'tournament-1' } },
    });
    const service = new MatchForfeitsService(supabase as never, undefined as never);

    await expect(
      service.createForfeit('match-1', {
        forfeitingRegistrationId: 'reg-red',
        reason: 'admin_correction',
        explicitScores: { forfeitingScore: 2, opponentScore: 5 },
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(supabase.inserted.match_forfeits).toBeUndefined();
    expect(supabase.updated.matches).toBeUndefined();
  });

  it('keeps a repeated FORFEIT idempotent', async () => {
    // The other half of the same branch: a double-tap on the pad must still
    // return the existing row rather than erroring at the referee.
    const supabase = fakeSupabase({
      matches: { maybeSingle: matchRow({ phaseType: 'pool', status: 'running' }) },
      match_forfeits: { maybeSingle: { id: 'forfeit-1', match_id: 'match-1', voided_at: null } },
      phases: { maybeSingle: { id: 'phase-1', type: 'pool', tournament_id: 'tournament-1' } },
    });
    const service = new MatchForfeitsService(supabase as never, undefined as never);

    const result = await service.createForfeit('match-1', {
      forfeitingRegistrationId: 'reg-red',
      reason: 'injury',
      canContinue: true,
    });

    expect(result).toMatchObject({ id: 'forfeit-1' });
    expect(supabase.inserted.match_forfeits).toBeUndefined();
  });

  it('does not swap a reserve into the bracket when overriding a scheduled match', async () => {
    // Was: applyBracketForfeit read the PRE-write row, so status was still
    // 'scheduled', tryReplaceMainRoundOneFighter fired, and it reset the match
    // to 0-0 with a different fighter — discarding the override just written.
    // Replacing a no-show is a forfeit remedy; an override states a result.
    const supabase = fakeSupabase({
      matches: {
        maybeSingle: matchRow({ phaseType: 'single_elim', status: 'scheduled' }),
        update: { id: 'match-1' },
      },
      match_forfeits: { maybeSingle: null, insert: { id: 'override-1' } },
      phases: {
        maybeSingle: { id: 'phase-1', type: 'single_elim', tournament_id: 'tournament-1' },
      },
      // A round-1 seeded slot AND an unused registration — everything
      // tryReplaceMainRoundOneFighter needs to find a reserve and fire. Without
      // both, this test passes vacuously on the unfixed code.
      bracket_slots: {
        maybeSingle: { id: 'slot-1', phase_id: 'phase-1', round: 1, source_a_type: 'seed' },
        select: [{ registration_a_id: 'reg-red', registration_b_id: 'reg-blue' }],
      },
      registrations: {
        maybeSingle: { id: 'reg-red', status: 'checked_in' },
        select: [{ id: 'reg-spare', status: 'checked_in', seed: 9 }],
      },
    });
    const service = new MatchForfeitsService(supabase as never, undefined as never);

    await service.createForfeit('match-1', {
      forfeitingRegistrationId: 'reg-red',
      reason: 'technical_failure',
      explicitScores: { forfeitingScore: 0, opponentScore: 5 },
    });

    expect(supabase.updated.bracket_slots).toBeUndefined();
    // Exactly one write: the override. A second would be the revert to 0-0.
    expect(supabase.updated.matches).toHaveLength(1);
    expect(supabase.updated.matches?.[0]).toMatchObject({
      status: 'completed',
      red_score: 0,
      blue_score: 5,
    });
  });

  it('records the matches it FEEDS as dependents, never itself', async () => {
    // Was: applyBracketForfeit pushed the match's own id, so voidForfeit —
    // whose started-set includes 'completed' — fired on the very match being
    // voided. Every bracket forfeit and override was permanently unvoidable.
    const supabase = fakeSupabase({
      matches: {
        maybeSingle: matchRow({ phaseType: 'single_elim', status: 'completed' }),
        update: { id: 'match-1' },
        select: [{ id: 'downstream-9', status: 'scheduled' }],
      },
      match_forfeits: { maybeSingle: null, insert: { id: 'override-1' } },
      phases: {
        maybeSingle: { id: 'phase-1', type: 'single_elim', tournament_id: 'tournament-1' },
      },
      bracket_slots: { maybeSingle: null },
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
    );

    const result = await service.createForfeit('match-1', {
      forfeitingRegistrationId: 'reg-red',
      reason: 'referee_decision',
      explicitScores: { forfeitingScore: 1, opponentScore: 3 },
    });

    expect(result.downstream_match_ids).toEqual(['downstream-9']);
    expect(result.downstream_match_ids).not.toContain('match-1');
  });

  it('refuses to rewrite a locked match without the override-locked capability', async () => {
    const supabase = fakeSupabase({
      matches: {
        maybeSingle: {
          ...matchRow({ phaseType: 'pool', status: 'completed' }),
          locked_at: '2026-08-10T09:00:00.000Z',
        },
      },
      match_forfeits: { maybeSingle: null },
      phases: { maybeSingle: { id: 'phase-1', type: 'pool', tournament_id: 'tournament-1' } },
    });
    const service = new MatchForfeitsService(supabase as never, undefined as never);

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
    expect(supabase.inserted.match_forfeits).toBeUndefined();
  });

  it('lets an actor holding canOverrideLocked through the lock', async () => {
    const supabase = fakeSupabase({
      matches: {
        maybeSingle: {
          ...matchRow({ phaseType: 'pool', status: 'completed' }),
          locked_at: '2026-08-10T09:00:00.000Z',
        },
        update: { id: 'match-1' },
      },
      match_forfeits: { maybeSingle: null, insert: { id: 'override-1' } },
      phases: { maybeSingle: { id: 'phase-1', type: 'pool', tournament_id: 'tournament-1' } },
    });
    const service = new MatchForfeitsService(supabase as never, undefined as never);

    await service.createForfeit(
      'match-1',
      {
        forfeitingRegistrationId: 'reg-red',
        reason: 'admin_correction',
        explicitScores: { forfeitingScore: 1, opponentScore: 2 },
      },
      { userId: 'user-1', canOverrideLocked: true },
    );

    expect(supabase.inserted.match_forfeits).toHaveLength(1);
  });

  it('asks the frozen-results guard before rewriting a result', async () => {
    // A completed event freezes its results; every sibling writer asks, and
    // this one did not — so an override could edit around the exchange-edit
    // review that exists to record exactly such a change.
    const supabase = fakeSupabase({
      matches: { maybeSingle: matchRow({ phaseType: 'pool', status: 'completed' }) },
      match_forfeits: { maybeSingle: null },
      phases: { maybeSingle: { id: 'phase-1', type: 'pool', tournament_id: 'tournament-1' } },
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
    expect(supabase.inserted.match_forfeits).toBeUndefined();
  });
});
