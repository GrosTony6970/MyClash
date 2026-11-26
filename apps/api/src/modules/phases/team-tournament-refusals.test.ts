import { ConflictException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { mockSupabase, queriedTables, selectsFor } from '../../common/testing/supabase-chain';
import type { FighterStatusService } from '../matches/fighter-status.service';
import type { SwissPairingService } from '../swiss/swiss-pairing.service';
import type { SwissSeedingService } from '../swiss/swiss-seeding.service';
import type { GenerateSwissDto } from '../swiss/dto/swiss.dto';
import { SwissService } from '../swiss/swiss.service';
import { PhasesService } from './phases.service';

/**
 * Team Longsword runs its Pools and a single elimination bracket. Double elimination and Swiss have
 * no team path (ADR-022, call 2 of slice 1c-1). Asking for either is a 409 the screen can name,
 * before any phase is read or written, whoever asks: the organiser, the assistant, or the 'system'
 * default. A bracket seeded by rating or by Swiss rank is refused at generation too, because the
 * fill after the last Pool bout runs as 'system' and only logs its refusal. Open Longsword, an
 * individual Tournament, goes on as before.
 */

const tournament = (kind: 'team' | 'individual') => ({
  id: 't-1',
  entrant_kind: kind,
  events: { organization_id: 'org-1' },
});

async function refusal(attempt: Promise<unknown>) {
  const error = await attempt.catch((e: unknown) => e);
  expect(error).toBeInstanceOf(ConflictException);
  return (error as ConflictException).getResponse();
}

describe('generateBracket — a team Tournament', () => {
  const makeService = (kind: 'team' | 'individual') => {
    const supabase = mockSupabase({ tournaments: { rows: [tournament(kind)] } });
    const orgs = { assertOrgRole: vi.fn().mockResolvedValue(undefined) };
    const placement = { placeMatches: vi.fn() };
    const service = new PhasesService(
      supabase as never,
      placement as never,
      undefined,
      orgs as never,
    );
    return { service, supabase, orgs };
  };

  const DOUBLE = { phaseType: 'double_elim' } as const;
  const TOURNAMENT_READ = 'id, entrant_kind, events!inner(organization_id)';

  it('refuses double elimination with a 409 after the admin check, before any phase is read', async () => {
    const { service, supabase, orgs } = makeService('team');

    expect(await refusal(service.generateBracket('t-1', DOUBLE, true, 'user-1'))).toMatchObject({
      reason: 'team_tournament_not_supported',
      message: 'A team Tournament takes no double elimination and no Swiss phase yet.',
    });
    expect(orgs.assertOrgRole).toHaveBeenCalledWith('org-1', 'user-1', 'admin');
    expect(queriedTables(supabase.from)).toEqual(['tournaments']);
    expect(selectsFor(supabase.from, 'tournaments')).toEqual([TOURNAMENT_READ]);
    expect(supabase.writes).toEqual([]);
  });

  it("refuses double elimination for the 'system' default too: no caller skips the check", async () => {
    const { service, supabase, orgs } = makeService('team');

    expect(await refusal(service.generateBracket('t-1', DOUBLE, true, 'system'))).toMatchObject({
      reason: 'team_tournament_not_supported',
    });
    expect(orgs.assertOrgRole).not.toHaveBeenCalled();
    expect(queriedTables(supabase.from)).toEqual(['tournaments']);
    expect(selectsFor(supabase.from, 'tournaments')).toEqual([TOURNAMENT_READ]);
    expect(supabase.writes).toEqual([]);
  });

  it.each([
    ['by-rating', 'rating_needs_named_members'],
    ['by-swiss-rank', 'team_tournament_not_supported'],
  ] as const)(
    'refuses a single elimination seeded %s with the named 409 %s, before any phase is read',
    async (seedingStrategy, reason) => {
      for (const actor of ['user-1', 'system']) {
        const { service, supabase } = makeService('team');

        expect(
          await refusal(service.generateBracket('t-1', { seedingStrategy }, false, actor)),
        ).toMatchObject({ reason });
        expect(queriedTables(supabase.from)).toEqual(['tournaments']);
        expect(supabase.writes).toEqual([]);
      }
    },
  );

  it('lets a single elimination of teams on to its phases, the Tournament read once', async () => {
    const { service, supabase } = makeService('team');

    // `phases` is not seeded: reaching it is the proof the kind did not refuse.
    await expect(service.generateBracket('t-1', {}, false, 'user-1')).rejects.toThrow(
      'unconfigured table "phases"',
    );
    expect(queriedTables(supabase.from)).toEqual(['tournaments', 'phases']);
  });

  it('lets an individual Tournament on to its phases, double elimination and rating included', async () => {
    const { service, supabase } = makeService('individual');

    await expect(
      service.generateBracket('t-1', { ...DOUBLE, seedingStrategy: 'by-rating' }, false, 'user-1'),
    ).rejects.toThrow('unconfigured table "phases"');
    expect(queriedTables(supabase.from)).toEqual(['tournaments', 'phases']);
  });
});

describe('generateBracket — one team', () => {
  it('says it needs two teams, not two fighters', async () => {
    const supabase = mockSupabase({
      tournaments: { rows: [tournament('team')] },
      phases: { rows: [] },
      teams: {
        rows: [{ id: 'team-a', seed: 1, created_at: '2026-11-01T07:00:00Z', tournament_id: 't-1' }],
      },
    });
    const service = new PhasesService(supabase as never, {} as never, undefined, undefined);

    await expect(service.generateBracket('t-1', {}, false, 'system')).rejects.toThrow(
      'Need at least 2 teams to generate a bracket',
    );
    // The kind came from the one Tournament read: the count does not read it again.
    expect(selectsFor(supabase.from, 'tournaments')).toEqual([
      'id, entrant_kind, events!inner(organization_id)',
    ]);
  });
});

describe('populateBracket and reseedBracketRoundOne — a team double elimination', () => {
  /** A double elimination bracket on Team Longsword: none can be generated, the doors refuse one. */
  const DOUBLE_PHASE = {
    id: 'bracket-1',
    type: 'double_elim',
    config_json: {},
    tournament_id: 't-1',
    tournaments: {
      event_id: 'event-1',
      entrant_kind: 'team',
      events: { organization_id: 'org-1' },
    },
  };
  const makeService = () => {
    const supabase = mockSupabase({ phases: { rows: [DOUBLE_PHASE] } });
    const orgs = { assertOrgRole: vi.fn().mockResolvedValue(undefined) };
    const service = new PhasesService(supabase as never, {} as never, undefined, orgs as never);
    return { service, supabase };
  };

  it('populate refuses it with a 409, for the system actor too, before any slot is read', async () => {
    const { service, supabase } = makeService();

    expect(await refusal(service.populateBracket('t-1', {}, 'system'))).toMatchObject({
      reason: 'team_tournament_not_supported',
    });
    expect(queriedTables(supabase.from)).toEqual(['phases']);
    expect(supabase.writes).toEqual([]);
  });

  it('reseed refuses it with a 409, before any slot is read', async () => {
    const { service, supabase } = makeService();

    expect(
      await refusal(service.reseedBracketRoundOne('bracket-1', 'user-1', { strategy: 'snake' })),
    ).toMatchObject({ reason: 'team_tournament_not_supported' });
    expect(queriedTables(supabase.from)).toEqual(['phases']);
    expect(supabase.writes).toEqual([]);
  });
});

describe('generateSwiss — a team Tournament', () => {
  const makeService = (kind: 'team' | 'individual') => {
    const supabase = mockSupabase({
      phases: { rows: [] },
      tournaments: { rows: [tournament(kind)] },
    });
    const service = new SwissService(
      supabase as never,
      {} as SwissPairingService,
      {} as SwissSeedingService,
      {} as FighterStatusService,
    );
    return { service, supabase };
  };

  it('is refused with a 409 first: before any phase is read, cleared or written', async () => {
    const { service, supabase } = makeService('team');

    expect(await refusal(service.generateSwiss('t-1', {} as GenerateSwissDto))).toMatchObject({
      reason: 'team_tournament_not_supported',
    });
    expect(queriedTables(supabase.from)).toEqual(['tournaments']);
    expect(selectsFor(supabase.from, 'tournaments')).toEqual(['entrant_kind']);
    expect(supabase.writes).toEqual([]);
  });
});
