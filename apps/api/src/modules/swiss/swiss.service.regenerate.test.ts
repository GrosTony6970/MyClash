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

  /**
   * `.neq('status','scheduled')` counted VOIDED as under way, so a phase whose
   * only activity had already been undone could not be regenerated at all —
   * voided is the one status that is neither scheduled nor in play.
   *
   * Seeded as `rows` so the filter narrows the fixture and the refusal becomes
   * observable. `phases` stays canned: the query ends in `.maybeSingle()` and
   * the fixture is a bare object, which is not a row set.
   */
  const withFoughtStatuses = (matches: Record<string, unknown>[]) =>
    mockSupabase({
      phases: { data: { id: 'swiss-1' }, error: null },
      matches: { rows: matches },
    });

  it('still refuses when a voided bout sits beside a fought one', async () => {
    const supabase = withFoughtStatuses([
      { id: 'm1', phase_id: 'swiss-1', status: 'voided' },
      { id: 'm2', phase_id: 'swiss-1', status: 'completed' },
    ]);
    const service = new SwissService(as(supabase), ...unusedCollaborators());

    await expect(service.generateSwiss('t1', dto, true)).rejects.toThrow(/bout under way/);
  });

  it('lets the guard go when the only activity was voided', async () => {
    // Two halves, because a successful regeneration is out of reach here: past
    // the guard the run deletes and inserts across swiss_entrants and
    // swiss_rounds, and the collaborators are `{}` stubs — the file's own header
    // says these tests reach the refusal "without configuring the rest of the
    // generation path". So: the refusal is absent, AND the run carried on past
    // `matches`. Either alone proves little; together they say the guard let go.
    const supabase = withFoughtStatuses([{ id: 'm1', phase_id: 'swiss-1', status: 'voided' }]);
    const service = new SwissService(as(supabase), ...unusedCollaborators());

    const failure = await service.generateSwiss('t1', dto, true).catch((error: unknown) => error);

    expect(String((failure as Error)?.message)).not.toMatch(/bout under way/);
    expect(queriedTables(supabase.from).length).toBeGreaterThan(2);
  });
});
