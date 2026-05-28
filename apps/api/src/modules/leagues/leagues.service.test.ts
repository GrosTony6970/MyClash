import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
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

  describe('addOrganizationRole platform-org guard', () => {
    function buildAddOrgService(orgRow: { is_platform?: boolean; slug?: string } | null) {
      const upsertPayloads: unknown[] = [];
      const supabase = {
        service: {
          from: vi.fn((table: string) => {
            if (table === 'platform_roles') {
              return {
                select: vi.fn().mockReturnThis(),
                eq: vi.fn().mockReturnThis(),
                maybeSingle: vi.fn().mockResolvedValue({
                  data: { role: 'super_admin' },
                  error: null,
                }),
              };
            }
            if (table === 'organizations') {
              return {
                select: vi.fn().mockReturnThis(),
                eq: vi.fn().mockReturnThis(),
                maybeSingle: vi.fn().mockResolvedValue({ data: orgRow, error: null }),
              };
            }
            // league_organization_roles + anything else
            return {
              upsert: vi.fn((payload: unknown) => {
                upsertPayloads.push(payload);
                return {
                  select: vi.fn().mockReturnThis(),
                  single: vi.fn().mockResolvedValue({ data: payload, error: null }),
                };
              }),
            };
          }),
        },
      };
      const service = new LeaguesService(
        supabase as never,
        { assertOrgRole: vi.fn().mockResolvedValue(undefined) } as never,
        {} as never,
      );
      return { service, upsertPayloads };
    }

    it('rejects an organization flagged as is_platform=true', async () => {
      const { service, upsertPayloads } = buildAddOrgService({
        is_platform: true,
        slug: 'myclash-hq',
      });
      await expect(
        service.addOrganizationRole(
          'league-1',
          { organizationId: 'platform-org', role: 'member' as never },
          'super-admin-1',
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(upsertPayloads).toEqual([]);
    });

    it('rejects the well-known myclash-hq slug even when is_platform is false', async () => {
      // Defends against legacy rows where migration 0049's backfill missed.
      const { service, upsertPayloads } = buildAddOrgService({
        is_platform: false,
        slug: 'myclash-hq',
      });
      await expect(
        service.addOrganizationRole(
          'league-1',
          { organizationId: 'platform-org', role: 'member' as never },
          'super-admin-1',
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(upsertPayloads).toEqual([]);
    });

    it('accepts a non-platform organization', async () => {
      const { service, upsertPayloads } = buildAddOrgService({
        is_platform: false,
        slug: 'lyon-amhe',
      });
      await service.addOrganizationRole(
        'league-1',
        { organizationId: 'lyon-org', role: 'member' as never },
        'super-admin-1',
      );
      expect(upsertPayloads).toEqual([
        expect.objectContaining({
          league_id: 'league-1',
          organization_id: 'lyon-org',
          role: 'member',
        }),
      ]);
    });
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

/**
 * When a league owner accepts a tournament-add request, the requesting
 * tournament's organization should be auto-added to the league's
 * member roster as `role: 'member'`. The upsert uses
 * `ignoreDuplicates: true` so an org that's already a `member` /
 * `admin` / `owner` is NOT demoted — the existing row wins.
 *
 * Rejection (status='rejected') must NOT grant membership.
 */
describe('LeaguesService.reviewTournamentLink — auto-grant member role on approval', () => {
  type UpsertCapture = { payload: unknown; options: unknown };

  function buildReviewService(opts: {
    /** Resolves the tournament's org id via the events embed. */
    tournamentOrgId?: string | null;
  }) {
    const linkRow = {
      id: 'link-1',
      league_id: 'league-1',
      tournament_id: 't-1',
      status: 'requested',
    };
    const updatedLinkRow = (status: string) => ({
      ...linkRow,
      status,
      reviewed_by_user_id: 'reviewer-1',
    });

    const linksUpdates: unknown[] = [];
    const orgRoleUpserts: UpsertCapture[] = [];
    let lastUpdateStatus: string | null = null;

    const supabaseService = {
      from: vi.fn((table: string) => {
        // platform_roles is hit by isSuperAdmin() inside assertCanManageLeague —
        // return super_admin so the auth check passes without touching the rest.
        if (table === 'platform_roles') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: { role: 'super_admin' },
              error: null,
            }),
          };
        }

        // league_tournament_links: initial select returns the link row;
        // update returns the updated row.
        if (table === 'league_tournament_links') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: linkRow, error: null }),
            update: vi.fn((payload: Record<string, unknown>) => {
              linksUpdates.push(payload);
              lastUpdateStatus =
                typeof payload['status'] === 'string' ? (payload['status'] as string) : null;
              return {
                eq: vi.fn().mockReturnThis(),
                select: vi.fn().mockReturnThis(),
                single: vi.fn().mockResolvedValue({
                  data: updatedLinkRow(lastUpdateStatus ?? 'requested'),
                  error: null,
                }),
              };
            }),
          };
        }

        // tournaments: the new lookup that resolves the tournament's org.
        // Returns the embedded events row with the org id (or null if no org).
        if (table === 'tournaments') {
          const data =
            opts.tournamentOrgId === undefined
              ? null
              : { events: { organization_id: opts.tournamentOrgId } };
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data, error: null }),
          };
        }

        // league_organization_roles: capture upsert payload + options.
        if (table === 'league_organization_roles') {
          return {
            upsert: vi.fn((payload: unknown, options: unknown) => {
              orgRoleUpserts.push({ payload, options });
              return Promise.resolve({ data: payload, error: null });
            }),
          };
        }

        // Fallback — any other table returns an empty chain.
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          in: vi.fn().mockReturnThis(),
          is: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          single: vi.fn().mockResolvedValue({ data: null, error: null }),
        };
      }),
    };

    const service = new LeaguesService(
      { service: supabaseService } as never,
      { assertOrgRole: vi.fn().mockResolvedValue(undefined) } as never,
      {} as never,
    );

    return { service, linksUpdates, orgRoleUpserts };
  }

  it('upserts the tournament org into league_organization_roles as member on approval', async () => {
    const { service, linksUpdates, orgRoleUpserts } = buildReviewService({
      tournamentOrgId: 'org-x',
    });

    await service.reviewTournamentLink('link-1', { status: 'approved' }, 'reviewer-1');

    // Link row updated to approved
    expect(linksUpdates).toHaveLength(1);
    expect(linksUpdates[0]).toMatchObject({ status: 'approved' });

    // Org auto-granted as member with ignoreDuplicates
    expect(orgRoleUpserts).toHaveLength(1);
    expect(orgRoleUpserts[0]!.payload).toMatchObject({
      league_id: 'league-1',
      organization_id: 'org-x',
      role: 'member',
    });
    expect(orgRoleUpserts[0]!.options).toMatchObject({
      onConflict: 'league_id,organization_id',
      ignoreDuplicates: true,
    });
  });

  it('passes ignoreDuplicates: true so an existing admin/owner role is preserved', async () => {
    // The supabase mock can't reproduce the actual ON CONFLICT DO NOTHING
    // semantics, but we can lock the contract: every approval upsert must
    // include ignoreDuplicates: true. That flag is the load-bearing piece
    // that prevents demoting an existing admin/owner back to member.
    const { service, orgRoleUpserts } = buildReviewService({ tournamentOrgId: 'org-x' });

    await service.reviewTournamentLink('link-1', { status: 'approved' }, 'reviewer-1');

    expect(orgRoleUpserts[0]!.options).toMatchObject({ ignoreDuplicates: true });
  });

  it('does NOT grant membership when the request is rejected', async () => {
    const { service, linksUpdates, orgRoleUpserts } = buildReviewService({
      tournamentOrgId: 'org-x',
    });

    await service.reviewTournamentLink('link-1', { status: 'rejected' }, 'reviewer-1');

    // Link row updated to rejected
    expect(linksUpdates).toHaveLength(1);
    expect(linksUpdates[0]).toMatchObject({ status: 'rejected' });

    // No membership write fired
    expect(orgRoleUpserts).toHaveLength(0);
  });
});
