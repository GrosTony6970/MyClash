import { BadRequestException } from '@nestjs/common';
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
