import { ConflictException, ForbiddenException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { LeaguesService } from './leagues.service';

type QueryResult = { data: unknown; error: { message: string } | null };

function chain(result: QueryResult) {
  const api = {
    select: vi.fn(() => api),
    eq: vi.fn(() => api),
    in: vi.fn(() => api),
    is: vi.fn(() => api),
    order: vi.fn(() => api),
    maybeSingle: vi.fn(() => Promise.resolve(result)),
    single: vi.fn(() => Promise.resolve(result)),
  };
  return api;
}

function makeService(options: {
  superAdmin?: boolean;
  leagueInsert?: QueryResult;
  assertOrgRole?: ReturnType<typeof vi.fn>;
}) {
  const insertPayloads: unknown[] = [];
  const upsertPayloads: Record<string, unknown[]> = {};
  const platformRoles = chain({
    data: options.superAdmin ? { role: 'super_admin' } : null,
    error: null,
  });
  const leagueInsertResult = options.leagueInsert ?? {
    data: { id: 'league-1', slug: 'french-national-league' },
    error: null,
  };
  const leaguesTable = {
    insert: vi.fn((payload: unknown) => {
      insertPayloads.push(payload);
      return chain(leagueInsertResult);
    }),
  };
  const serviceRole = {
    from: vi.fn((table: string) => {
      if (table === 'platform_roles') return platformRoles;
      if (table === 'leagues') return leaguesTable;
      return {
        upsert: vi.fn((payload: unknown) => {
          upsertPayloads[table] = [...(upsertPayloads[table] ?? []), payload];
          return Promise.resolve({ data: payload, error: null });
        }),
      };
    }),
  };
  const assertOrgRole = options.assertOrgRole ?? vi.fn().mockResolvedValue(undefined);
  const service = new LeaguesService(
    { service: serviceRole } as never,
    { assertOrgRole } as never,
    {} as never,
  );

  return { service, serviceRole, insertPayloads, upsertPayloads, assertOrgRole };
}

describe('LeaguesService create authorization', () => {
  it('rejects anonymous league creation before writing created_by_user_id', async () => {
    const { service, serviceRole } = makeService({ superAdmin: false });

    await expect(
      service.create(
        { name: 'French National League', slug: 'french-national-league', seasonYear: 2026 },
        'anonymous',
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(serviceRole.from).not.toHaveBeenCalledWith('leagues');
  });

  it('allows super admins to create global leagues and records the authenticated creator', async () => {
    const { service, insertPayloads, upsertPayloads } = makeService({ superAdmin: true });

    await service.create(
      { name: 'French National League', slug: 'french-national-league', seasonYear: 2026 },
      '11111111-1111-4111-8111-111111111111',
    );

    expect(insertPayloads).toEqual([
      expect.objectContaining({
        slug: 'french-national-league',
        created_by_user_id: '11111111-1111-4111-8111-111111111111',
      }),
    ]);
    expect(upsertPayloads['league_user_roles']).toEqual([
      expect.objectContaining({
        league_id: 'league-1',
        user_id: '11111111-1111-4111-8111-111111111111',
        role: 'owner',
      }),
    ]);
  });

  it('rejects global league creation by authenticated non-super-admin users', async () => {
    const { service, serviceRole } = makeService({ superAdmin: false });

    await expect(
      service.create(
        { name: 'French National League', slug: 'french-national-league', seasonYear: 2026 },
        '11111111-1111-4111-8111-111111111111',
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(serviceRole.from).not.toHaveBeenCalledWith('leagues');
  });

  it('preserves organization-admin league creation when an owner organization is provided', async () => {
    const assertOrgRole = vi.fn().mockResolvedValue(undefined);
    const {
      service,
      assertOrgRole: orgRole,
      upsertPayloads,
    } = makeService({
      superAdmin: false,
      assertOrgRole,
    });

    await service.create(
      {
        name: 'Regional League',
        slug: 'regional-league',
        seasonYear: 2026,
        ownerOrganizationId: '22222222-2222-4222-8222-222222222222',
      },
      '11111111-1111-4111-8111-111111111111',
    );

    expect(orgRole).toHaveBeenCalledWith(
      '22222222-2222-4222-8222-222222222222',
      '11111111-1111-4111-8111-111111111111',
      'admin',
    );
    expect(upsertPayloads['league_organization_roles']).toEqual([
      expect.objectContaining({
        organization_id: '22222222-2222-4222-8222-222222222222',
        role: 'owner',
      }),
    ]);
  });

  it('returns a conflict for duplicate league slugs', async () => {
    const { service } = makeService({
      superAdmin: true,
      leagueInsert: {
        data: null,
        error: { message: 'duplicate key value violates unique constraint' },
      },
    });

    await expect(
      service.create(
        { name: 'French National League', slug: 'french-national-league', seasonYear: 2026 },
        '11111111-1111-4111-8111-111111111111',
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
