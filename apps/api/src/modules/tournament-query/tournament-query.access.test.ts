import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { assertQueryAccess } from './tournament-query.access';
import type { TournamentContext } from './tournament-query.types';

const eventId = '00000000-0000-4000-8000-000000000002';
const orgId = '00000000-0000-4000-8000-000000000003';
const userId = '00000000-0000-4000-8000-000000000004';
const globalId = '00000000-0000-4000-8000-000000000005';

const tournament = { tournamentId: 't1', eventId, organizationId: orgId } as TournamentContext;

type Reader = 'admin' | 'referee' | 'roster' | 'stranger';
type Reply = { data: unknown; error: { message: string } | null };

function setup(reader: Reader, overrides: Record<string, Reply> = {}) {
  const calls: Array<{ table: string; select: string; eq: Array<[string, unknown]> }> = [];
  const replies: Record<string, Reply> = {
    global_persons: {
      data: reader === 'referee' ? { id: globalId } : null,
      error: null,
    },
    event_referees: {
      data: reader === 'referee' ? { person_id: globalId } : null,
      error: null,
    },
    persons: { data: reader === 'roster' ? { id: 'p1' } : null, error: null },
    ...overrides,
  };
  const from = vi.fn((table: string) => {
    const call = { table, select: '', eq: [] as Array<[string, unknown]> };
    calls.push(call);
    const chain = {
      select: vi.fn((columns: string) => {
        call.select = columns;
        return chain;
      }),
      eq: vi.fn((column: string, value: unknown) => {
        call.eq.push([column, value]);
        return chain;
      }),
      maybeSingle: vi.fn(async () => replies[table]),
    };
    return chain;
  });
  const assertOrgRole = vi.fn(async () => {
    if (reader !== 'admin') throw new ForbiddenException('not an admin');
  });
  return {
    calls,
    assertOrgRole,
    deps: { supabase: { service: { from } }, organizations: { assertOrgRole } } as never,
  };
}

const expected: Record<string, Record<Reader, boolean>> = {
  organizers_only: { admin: true, referee: false, roster: false, stranger: false },
  organizers_head_judges: { admin: true, referee: true, roster: false, stranger: false },
  anyone_with_tournament_access: { admin: true, referee: true, roster: true, stranger: false },
};

describe('assertQueryAccess', () => {
  for (const [policy, readers] of Object.entries(expected)) {
    for (const [reader, allowed] of Object.entries(readers) as Array<[Reader, boolean]>) {
      it(`${policy}: ${reader} is ${allowed ? 'in' : 'out'}`, async () => {
        const { deps, assertOrgRole } = setup(reader);
        const run = assertQueryAccess(deps, tournament, userId, { accessPolicy: policy });
        if (allowed) await expect(run).resolves.toBeUndefined();
        else await expect(run).rejects.toBeInstanceOf(ForbiddenException);
        expect(assertOrgRole).toHaveBeenCalledWith(orgId, userId, 'admin');
      });
    }
  }

  it.each(['anonymous', ''])('refuses the id %j as Unauthorized', async (id) => {
    const { deps } = setup('admin');
    await expect(
      assertQueryAccess(deps, tournament, id, { accessPolicy: 'organizers_only' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('refuses an unknown policy value, even for an admin', async () => {
    const { deps } = setup('admin');
    await expect(
      assertQueryAccess(deps, tournament, userId, {
        accessPolicy: 'organizers_head_judges_coaches',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('reads the referee list and the roster with the exact selects and keys', async () => {
    const { deps, calls } = setup('stranger');
    await expect(
      assertQueryAccess(deps, tournament, userId, {
        accessPolicy: 'anyone_with_tournament_access',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(calls).toEqual([
      { table: 'global_persons', select: 'id', eq: [['claimed_by_user_id', userId]] },
      {
        table: 'persons',
        select: 'id',
        eq: [
          ['event_id', eventId],
          ['claimed_by_user_id', userId],
        ],
      },
    ]);
  });

  it('looks the claimed global person up on the Event referee list', async () => {
    const { deps, calls } = setup('referee');
    await assertQueryAccess(deps, tournament, userId, { accessPolicy: 'organizers_head_judges' });
    expect(calls).toEqual([
      { table: 'global_persons', select: 'id', eq: [['claimed_by_user_id', userId]] },
      {
        table: 'event_referees',
        select: 'person_id',
        eq: [
          ['event_id', eventId],
          ['person_id', globalId],
        ],
      },
    ]);
  });

  it('lets a failed membership read propagate, not read as a refusal', async () => {
    // A referee would get in on the next branch: the failed read must stop it first.
    const { deps, assertOrgRole } = setup('referee');
    const failure = new Error('membership read failed');
    assertOrgRole.mockRejectedValueOnce(failure);
    await expect(
      assertQueryAccess(deps, tournament, userId, { accessPolicy: 'organizers_head_judges' }),
    ).rejects.toBe(failure);
  });

  it.each([
    ['global_persons', 'organizers_head_judges', 'referee'],
    ['event_referees', 'organizers_head_judges', 'referee'],
    ['persons', 'anyone_with_tournament_access', 'stranger'],
  ] as const)(
    'a failed %s read throws a plain Error, not a refusal',
    async (table, policy, who) => {
      const { deps } = setup(who, {
        [table]: { data: null, error: { message: `${table} down` } },
      });
      const run = assertQueryAccess(deps, tournament, userId, { accessPolicy: policy });
      await expect(run).rejects.toThrow(`${table} down`);
      await expect(run).rejects.not.toBeInstanceOf(ForbiddenException);
    },
  );
});
