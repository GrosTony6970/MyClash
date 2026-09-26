/**
 * `PhasesService.setPoolRefereeRoleAssignment` — the Pools page's Pool strip: one referee
 * for one role on every bout of a Pool, asked what every referee write door asks
 * (ADR-016, W1.2).
 *
 * The board's judge is stubbed and its CALL asserted; what it answers on a real Pool (the
 * person's own bouts left out, the own-Pool confirm) is `assignment-board.judge-write.test.ts`'s.
 * The double has no `.rpc` and could not run a function body, so the payload is asserted
 * whole and its keys against the function's declared parameters; the rollback is the
 * Postgres replay's to prove.
 */
import { BadRequestException, ConflictException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { lastFunctionParams } from '../../common/testing/migration-function';
import { mockSupabase, writesTo, type SupabaseRow } from '../../common/testing/supabase-chain';
import { PhasesService } from './phases.service';

const POOLS: SupabaseRow[] = [
  {
    id: 'pool-1',
    name: 'A',
    phase_id: 'phase-1',
    sort_order: 0,
    phases: {
      id: 'phase-1',
      tournament_id: 'tournament-1',
      tournaments: {
        event_id: 'event-1',
        weapon: 'longsword',
        tournament_id: 'tournament-1',
        events: { organization_id: 'org-1' },
      },
    },
  },
];

/** Three bouts in the pool, one outside it. */
const MATCHES: SupabaseRow[] = [
  { id: 'm-1', pool_id: 'pool-1', status: 'scheduled', lice_id: 'lice-1' },
  { id: 'm-2', pool_id: 'pool-1', status: 'scheduled', lice_id: null },
  { id: 'm-3', pool_id: 'pool-1', status: 'scheduled', lice_id: 'lice-2' },
  { id: 'm-9', pool_id: 'pool-9', status: 'scheduled', lice_id: 'lice-9' },
];

const CONFIRMED_OVER = [{ code: 'own_pool', label: 'Longsword · Pool A' }];

/** A refusal, or a loud failure when the call went through. */
const unexpected = (): never => {
  throw new Error('expected a refusal');
};

function makeService(
  options: { locked?: boolean; rpcError?: { message: string }; noBoard?: boolean } = {},
) {
  const supabase = mockSupabase({
    pools: { rows: POOLS },
    matches: { rows: MATCHES },
    // Seeded so a write of the service's own is RECORDED, not thrown; also the lock read.
    referee_assignments: {
      rows: options.locked
        ? [{ id: 'ra-1', event_id: 'event-1', status: 'confirmed', scope_type: 'pool' }]
        : [],
    },
  });
  const rpc = vi.fn().mockResolvedValue({ data: null, error: options.rpcError ?? null });
  Object.assign(supabase.service, { rpc });
  const judgeWrite = vi.fn().mockResolvedValue({
    stored: CONFIRMED_OVER,
    matchIds: ['m-2'],
    skippedMatchIds: ['m-1', 'm-3'],
  });
  const orgs = { assertOrgRole: vi.fn().mockResolvedValue(undefined) };
  const service = new PhasesService(
    supabase as never,
    { placeMatches: vi.fn() } as never,
    undefined,
    orgs as never,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    options.noBoard ? undefined : ({ judgeWrite } as never),
  );
  return { service, supabase, rpc, judgeWrite };
}

describe('the per-Pool referee door (ADR-016)', () => {
  it('asks the checker for every bout, leaving out her own, and writes the rest in one call', async () => {
    const { service, supabase, rpc, judgeWrite } = makeService();

    const result = await service.setPoolRefereeRoleAssignment(
      'pool-1',
      'arbitre_declarant',
      'person-7',
      'user-1',
      true,
    );

    // m-9 is another pool's bout: the pool filter on the read is load-bearing.
    expect(judgeWrite).toHaveBeenCalledWith('event-1', {
      matchIds: ['m-1', 'm-2', 'm-3'],
      role: 'arbitre_declarant',
      personId: 'person-7',
      confirm: true,
      skipOwnBouts: true,
    });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('replace_match_referee_role', {
      p_event_id: 'event-1',
      p_role: 'arbitre_declarant',
      p_person_id: 'person-7',
      p_match_ids: ['m-2'],
      p_conflicts: CONFIRMED_OVER,
    });
    expect(writesTo(supabase, 'referee_assignments')).toEqual([]);
    expect(result).toEqual({
      poolId: 'pool-1',
      role: 'arbitre_declarant',
      refereeId: 'person-7',
      skippedMatchIds: ['m-1', 'm-3'],
    });
  });

  it('does not confirm unless the request did', async () => {
    const { service, judgeWrite } = makeService();
    await service.setPoolRefereeRoleAssignment('pool-1', 'arbitre_declarant', 'person-7', 'user-1');
    expect(judgeWrite).toHaveBeenCalledWith('event-1', expect.objectContaining({ confirm: false }));
  });

  it('sends exactly the parameters the function declares', async () => {
    const { service, rpc } = makeService();
    await service.setPoolRefereeRoleAssignment('pool-1', 'arbitre_declarant', 'person-7', 'user-1');
    const payload = rpc.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(Object.keys(payload).sort()).toEqual(
      lastFunctionParams('replace_match_referee_role').sort(),
    );
  });

  it('clears the role on every bout through the same call, asking the checker nothing', async () => {
    const { service, rpc, judgeWrite } = makeService();

    await service.setPoolRefereeRoleAssignment('pool-1', 'arbitre_assesseur', null, 'user-1');

    expect(judgeWrite).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith('replace_match_referee_role', {
      p_event_id: 'event-1',
      p_role: 'arbitre_assesseur',
      p_person_id: null,
      p_match_ids: ['m-1', 'm-2', 'm-3'],
      p_conflicts: [],
    });
  });

  it('writes nothing when every bout is one she fights', async () => {
    const { service, rpc, judgeWrite } = makeService();
    judgeWrite.mockResolvedValue({ stored: [], matchIds: [], skippedMatchIds: ['m-1'] });

    const result = await service.setPoolRefereeRoleAssignment(
      'pool-1',
      'arbitre_declarant',
      'person-7',
      'user-1',
    );

    expect(rpc).not.toHaveBeenCalled();
    expect(result.skippedMatchIds).toEqual(['m-1']);
  });

  it("a checker refusal writes nothing and reaches the caller as the checker's 409", async () => {
    const { service, rpc, judgeWrite } = makeService();
    const refusal = new ConflictException({ code: 'referee_needs_confirmation' });
    judgeWrite.mockRejectedValue(refusal);

    await expect(
      service.setPoolRefereeRoleAssignment('pool-1', 'arbitre_declarant', 'person-7', 'user-1'),
    ).rejects.toBe(refusal);
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each([
    ['an assign', 'person-7'],
    ['a clear', null],
  ])(
    '%s on a locked board is 409 referee_board_locked, and nothing is judged or written',
    async (_l, who) => {
      const { service, rpc, judgeWrite } = makeService({ locked: true });

      const error = await service
        .setPoolRefereeRoleAssignment('pool-1', 'arbitre_declarant', who, 'user-1')
        .then(unexpected, (e: unknown) => e as ConflictException);

      expect(error).toBeInstanceOf(ConflictException);
      expect(error.getResponse()).toMatchObject({ code: 'referee_board_locked' });
      expect(judgeWrite).not.toHaveBeenCalled();
      expect(rpc).not.toHaveBeenCalled();
    },
  );

  it('a failed replace is a 400, and the service writes nothing of its own', async () => {
    const { service, supabase } = makeService({
      rpcError: { message: 'violates foreign key constraint' },
    });
    await expect(
      service.setPoolRefereeRoleAssignment('pool-1', 'arbitre_declarant', 'person-7', 'user-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(writesTo(supabase, 'referee_assignments')).toEqual([]);
  });

  it('without the checker wired in, an assign is a plain Error and writes nothing', async () => {
    const { service, rpc } = makeService({ noBoard: true });
    const failure = service.setPoolRefereeRoleAssignment(
      'pool-1',
      'arbitre_declarant',
      'person-7',
      'user-1',
    );
    await expect(failure).rejects.toThrow('PhasesService has no referee checker wired in');
    await expect(failure).rejects.not.toHaveProperty('status');
    expect(rpc).not.toHaveBeenCalled();
  });
});
