import { ConflictException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { mockSupabase, queriedTables } from '../../common/testing/supabase-chain';
import type { SupabaseService } from '../supabase/supabase.service';
import type { SwissPairingService } from './swiss-pairing.service';
import type { SwissSeedingService } from './swiss-seeding.service';
import type { GenerateSwissDto } from './dto/swiss.dto';
import { SwissService } from './swiss.service';

/**
 * The force-regenerate guard.
 *
 * `clearExistingPhase` is the first statement in `generateSwiss`, so these reach
 * it without configuring the rest of the generation path — the collaborators are
 * never touched before the refusal.
 */
const as = (supabase: { service: unknown }): SupabaseService =>
  supabase as unknown as SupabaseService;

const unusedCollaborators = () => [{} as SwissPairingService, {} as SwissSeedingService] as const;

const dto = {} as GenerateSwissDto;

const withExistingPhase = (matches: unknown[]) =>
  mockSupabase({
    phases: { data: { id: 'swiss-1' }, error: null },
    matches: { data: matches, error: null },
  });

describe('SwissService.generateSwiss — regenerating over an existing phase', () => {
  it('refuses without force even when nothing has been fought', async () => {
    const supabase = withExistingPhase([]);
    const service = new SwissService(as(supabase), ...unusedCollaborators());

    await expect(service.generateSwiss('t1', dto, false)).rejects.toBeInstanceOf(ConflictException);
    // Never asks about matches — the force check refuses first.
    expect(queriedTables(supabase.from)).toEqual(['phases']);
  });

  it('refuses with force when a bout is under way', async () => {
    const supabase = withExistingPhase([{ id: 'm1' }]);
    const service = new SwissService(as(supabase), ...unusedCollaborators());

    await expect(service.generateSwiss('t1', dto, true)).rejects.toThrow(/bout under way/);
    expect(queriedTables(supabase.from)).toEqual(['phases', 'matches']);
  });

  it('asks for fought statuses, so a voided bout no longer blocks regeneration', async () => {
    // `.neq('status','scheduled')` counted VOIDED as under way, so a phase whose
    // only activity had already been undone could not be regenerated at all —
    // voided is the one status that is neither scheduled nor in play.
    //
    // Asserted on the QUERY because the double returns canned rows without
    // applying filters, so the filter is the observable behaviour here. Same
    // approach as admin-dashboard-stats.service.test.ts.
    const supabase = withExistingPhase([]);
    const service = new SwissService(as(supabase), ...unusedCollaborators());

    await service.generateSwiss('t1', dto, true).catch(() => undefined);

    const matchesChain = supabase.from.mock.results[1]?.value as {
      in: { mock: { calls: unknown[][] } };
      neq: { mock: { calls: unknown[][] } };
    };
    expect(matchesChain.in.mock.calls).toContainEqual([
      'status',
      ['running', 'paused', 'completed'],
    ]);
    expect(matchesChain.neq.mock.calls).toEqual([]);
  });
});
