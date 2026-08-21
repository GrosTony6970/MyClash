import { describe, expect, it, vi } from 'vitest';
import type { FastifyRequest } from 'fastify';
import { GearService } from './gear.service';
import { RecordGearCheckDto } from './dto';
import { mockSupabase, supabaseChain } from '../../common/testing/supabase-chain';

const REQ = {} as FastifyRequest;

function staffDouble(role: 'gear' | 'checkin' | 'scoring' = 'gear') {
  return {
    requireStaffWithRole: vi.fn((_req: FastifyRequest, roles: readonly string[]) => {
      if (!roles.includes(role)) throw new Error('Staff account role cannot use this surface');
      return Promise.resolve({ id: 'staff-1', event_id: 'event-1', role });
    }),
  };
}

/**
 * The conditional-needs-a-reason rule lives in TWO places on purpose: the Zod
 * schema here, and `event_gear_checks_conditional_needs_reason` in 0175. The
 * CHECK is what makes the rule true of the DATA; the schema is what turns a
 * violation into a 400 the volunteer can read rather than a 500 from Postgres.
 * Both are tested — the CHECK by replaying the migration on PG17, this by the
 * cases below.
 */
describe('RecordGearCheckDto', () => {
  const schema = RecordGearCheckDto.schema;

  it('refuses a conditional with no reason', () => {
    expect(schema.safeParse({ result: 'conditional' }).success).toBe(false);
  });

  it('refuses a conditional whose reason is only whitespace', () => {
    // A reason of spaces would satisfy a naive `.min(1)` and then be refused by
    // the table's btrim CHECK — turning a user error into a 500.
    expect(schema.safeParse({ result: 'conditional', reason: '   ' }).success).toBe(false);
  });

  it('accepts a conditional with a real reason', () => {
    expect(schema.safeParse({ result: 'conditional', reason: 'gorget too loose' }).success).toBe(
      true,
    );
  });

  it('accepts a fail with no reason — often self-evident, and the fighter is right there', () => {
    expect(schema.safeParse({ result: 'fail' }).success).toBe(true);
  });

  it('accepts a bare pass', () => {
    expect(schema.safeParse({ result: 'pass' }).success).toBe(true);
  });

  it('refuses a fourth result', () => {
    expect(schema.safeParse({ result: 'probably_fine' }).success).toBe(false);
  });
});

describe('GearService authorization', () => {
  it('gates the gear roster on the gear role', async () => {
    const staff = staffDouble('gear');
    const supabase = mockSupabase({ persons: { data: [], error: null } });
    const service = new GearService(supabase as never, staff as never);

    await service.listGearRoster(REQ);

    expect(staff.requireStaffWithRole).toHaveBeenCalledWith(REQ, ['gear']);
  });

  it('refuses a scoring account at the gear table', async () => {
    const staff = staffDouble('scoring');
    const supabase = mockSupabase({ persons: { data: [], error: null } });
    const service = new GearService(supabase as never, staff as never);

    await expect(service.listGearRoster(REQ)).rejects.toThrow(/cannot use this surface/i);
  });

  it('refuses a check-in account at the gear table', async () => {
    // The desk and the gear table are different jobs, not tiers of one.
    const staff = staffDouble('checkin');
    const supabase = mockSupabase({ persons: { data: [], error: null } });
    const service = new GearService(supabase as never, staff as never);

    await expect(service.listGearRoster(REQ)).rejects.toThrow(/cannot use this surface/i);
  });
});

describe('GearService.recordCheck', () => {
  it('INSERTS rather than upserting, so a re-check keeps the history', async () => {
    const staff = staffDouble('gear');
    const checks = supabaseChain({ data: { result: 'pass' }, error: null });
    const supabase = mockSupabase({ persons: { data: { id: 'p1' }, error: null } });
    supabase.from.mockImplementation((table: string) =>
      table === 'event_gear_checks' ? checks : supabaseChain({ data: { id: 'p1' }, error: null }),
    );
    const service = new GearService(supabase as never, staff as never);

    await service.recordCheck(REQ, 'p1', 'w1', { result: 'pass' } as never);

    // Overwriting would destroy the only record that a fighter was ever turned
    // away, which is the point of the fail and conditional states.
    expect(checks.upsert).not.toHaveBeenCalled();
    expect(checks.insert).toHaveBeenCalledWith(
      expect.objectContaining({ person_id: 'p1', weapon_id: 'w1', result: 'pass' }),
    );
  });

  it('normalizes a whitespace-only reason to null before it reaches the CHECK', async () => {
    const staff = staffDouble('gear');
    const checks = supabaseChain({ data: { result: 'fail' }, error: null });
    const supabase = mockSupabase({ persons: { data: { id: 'p1' }, error: null } });
    supabase.from.mockImplementation((table: string) =>
      table === 'event_gear_checks' ? checks : supabaseChain({ data: { id: 'p1' }, error: null }),
    );
    const service = new GearService(supabase as never, staff as never);

    await service.recordCheck(REQ, 'p1', 'w1', { result: 'fail', reason: '  ' } as never);

    expect(checks.insert).toHaveBeenCalledWith(expect.objectContaining({ reason: null }));
  });
});
