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
 * Team Longsword runs its Pools in slice 1b-1, and nothing else: a bracket of teams lands in 1c,
 * and Swiss has no team path (ADR-022). Asking for either is a 409 the screen can name, before
 * any phase is read or written. Open Longsword, an individual Tournament, goes on as before.
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

  it('is refused with a 409 after the admin check, before any phase is read', async () => {
    const { service, supabase, orgs } = makeService('team');

    expect(await refusal(service.generateBracket('t-1', {}, true, 'user-1'))).toMatchObject({
      reason: 'team_tournament_not_supported',
    });
    expect(orgs.assertOrgRole).toHaveBeenCalledWith('org-1', 'user-1', 'admin');
    expect(queriedTables(supabase.from)).toEqual(['tournaments']);
    expect(selectsFor(supabase.from, 'tournaments')).toEqual([
      'id, entrant_kind, events!inner(organization_id)',
    ]);
    expect(supabase.writes).toEqual([]);
  });

  it('lets an individual Tournament on to its phases', async () => {
    const { service, supabase } = makeService('individual');

    // `phases` is not seeded: reaching it is the proof the kind did not refuse.
    await expect(service.generateBracket('t-1', {}, false, 'user-1')).rejects.toThrow(
      'unconfigured table "phases"',
    );
    expect(queriedTables(supabase.from)).toEqual(['tournaments', 'phases']);
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
