/**
 * `MatchesService.setRefereeRoleAssignment` — the per-bout crew door (Pools page, bracket
 * override) asks what every referee write door asks (ADR-016, W1.2).
 *
 * The board's judge is stubbed here and its CALL asserted: which Event, which bout, which
 * person, whether confirmed. What the judge answers on a real Pool is
 * `assignment-board.judge-write.test.ts`'s. The Supabase double ignores an rpc payload, so
 * the payload is asserted whole and its keys against the function's declared parameters.
 */
import { BadRequestException, ConflictException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { lastFunctionParams } from '../../common/testing/migration-function';
import { mockSupabase, selectsFor, writesTo } from '../../common/testing/supabase-chain';
import { MatchesService } from './matches.service';

const CONFIRMED_OVER = [{ code: 'own_pool', label: 'Longsword · Pool A' }];

/** A refusal, or a loud failure when the call went through. */
const unexpected = (): never => {
  throw new Error('expected a refusal');
};

function makeService(options: { locked?: boolean; rpcError?: { message: string } } = {}) {
  const supabase = mockSupabase({
    matches: { rows: [{ id: 'match-1', phases: { tournaments: { event_id: 'event-1' } } }] },
    referee_assignments: {
      rows: options.locked
        ? [{ id: 'ra-1', event_id: 'event-1', status: 'confirmed', scope_type: 'match' }]
        : [],
    },
  });
  const rpc = vi.fn().mockResolvedValue({ data: null, error: options.rpcError ?? null });
  Object.assign(supabase.service, { rpc });
  const judgeWrite = vi
    .fn()
    .mockResolvedValue({ stored: CONFIRMED_OVER, matchIds: ['match-1'], skippedMatchIds: [] });
  const service = new MatchesService(
    supabase as never,
    {} as never,
    {} as never,
    {} as never,
    { judgeWrite } as never,
  );
  return { service, supabase, rpc, judgeWrite };
}

describe('the per-bout referee door (ADR-016)', () => {
  it('asks the checker, then replaces the role in one call with the reasons confirmed over', async () => {
    const { service, supabase, rpc, judgeWrite } = makeService();

    await expect(
      service.setRefereeRoleAssignment('match-1', 'arbitre_declarant', 'person-1', true),
    ).resolves.toEqual({ matchId: 'match-1', role: 'arbitre_declarant', refereeId: 'person-1' });

    expect(judgeWrite).toHaveBeenCalledWith('event-1', {
      matchIds: ['match-1'],
      role: 'arbitre_declarant',
      personId: 'person-1',
      confirm: true,
    });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('replace_match_referee_role', {
      p_event_id: 'event-1',
      p_role: 'arbitre_declarant',
      p_person_id: 'person-1',
      p_match_ids: ['match-1'],
      p_conflicts: CONFIRMED_OVER,
    });
    // One database call: a delete of our own before it is the two-call bug's shape.
    expect(writesTo(supabase, 'referee_assignments')).toEqual([]);
    expect(selectsFor(supabase.from, 'matches')).toEqual(['phases ( tournaments ( event_id ) )']);
  });

  it('sends exactly the parameters the function declares', async () => {
    const { service, rpc } = makeService();
    await service.setRefereeRoleAssignment('match-1', 'arbitre_declarant', 'person-1');
    const payload = rpc.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(Object.keys(payload).sort()).toEqual(
      lastFunctionParams('replace_match_referee_role').sort(),
    );
  });

  it('does not confirm unless the request did', async () => {
    const { service, judgeWrite } = makeService();
    await service.setRefereeRoleAssignment('match-1', 'arbitre_declarant', 'person-1');
    expect(judgeWrite).toHaveBeenCalledWith('event-1', expect.objectContaining({ confirm: false }));
  });

  it("a checker refusal writes nothing and reaches the caller as the checker's 409", async () => {
    const { service, rpc, judgeWrite } = makeService();
    const refusal = new ConflictException({ code: 'referee_impossible' });
    judgeWrite.mockRejectedValue(refusal);

    await expect(
      service.setRefereeRoleAssignment('match-1', 'arbitre_declarant', 'person-1'),
    ).rejects.toBe(refusal);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('clears the role through the same call, asking the checker nothing', async () => {
    const { service, rpc, judgeWrite } = makeService();

    await service.setRefereeRoleAssignment('match-1', 'arbitre_declarant', null);

    expect(judgeWrite).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith('replace_match_referee_role', {
      p_event_id: 'event-1',
      p_role: 'arbitre_declarant',
      p_person_id: null,
      p_match_ids: ['match-1'],
      p_conflicts: [],
    });
  });

  it.each([
    ['an assign', 'person-1'],
    ['a clear', null],
  ])(
    '%s on a locked board is 409 referee_board_locked, and nothing is judged or written',
    async (_l, who) => {
      const { service, rpc, judgeWrite } = makeService({ locked: true });

      const error = await service
        .setRefereeRoleAssignment('match-1', 'arbitre_declarant', who)
        .then(unexpected, (e: unknown) => e as ConflictException);

      expect(error).toBeInstanceOf(ConflictException);
      expect(error.getResponse()).toMatchObject({ code: 'referee_board_locked' });
      expect(judgeWrite).not.toHaveBeenCalled();
      expect(rpc).not.toHaveBeenCalled();
    },
  );

  it('a failed replace is a 400', async () => {
    const { service } = makeService({ rpcError: { message: 'violates foreign key constraint' } });
    await expect(
      service.setRefereeRoleAssignment('match-1', 'arbitre_declarant', 'person-1'),
    ).rejects.toThrow(new BadRequestException('violates foreign key constraint'));
  });
});
