import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
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

// ── Event-side leagues views (slice A of the leagues UX overhaul) ────────────

function makeAwaitableChain(result: { data: unknown; error: { message: string } | null }) {
  const promise = Promise.resolve(result);
  const chain = Object.assign(promise, {
    select: vi.fn(),
    eq: vi.fn(),
    in: vi.fn(),
    neq: vi.fn(),
    is: vi.fn(),
    order: vi.fn(),
    update: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue(result),
    single: vi.fn().mockResolvedValue(result),
  });
  for (const key of ['select', 'eq', 'in', 'neq', 'is', 'order', 'update']) {
    (chain as unknown as Record<string, ReturnType<typeof vi.fn>>)[key] = vi
      .fn()
      .mockReturnValue(chain);
  }
  return chain;
}

describe('LeaguesService.listEventLeagueAttachments', () => {
  it("returns the event's non-removed league tournament links", async () => {
    const linksData = [
      {
        id: 'link-1',
        league_id: 'league-1',
        tournament_id: 'tournament-1',
        status: 'approved',
        group_id: 'group-1',
        leagues: { id: 'league-1', name: 'HEMA 2026', season_year: 2026 },
        league_groups: { id: 'group-1', name: 'Open' },
        tournaments: { id: 'tournament-1', name: 'Longsword Open', event_id: 'event-1' },
      },
    ];
    const eventChain = makeAwaitableChain({
      data: { id: 'event-1', organization_id: 'org-1' },
      error: null,
    });
    const linksChain = makeAwaitableChain({ data: linksData, error: null });
    const supabase = {
      service: {
        from: vi.fn((table: string) => {
          if (table === 'events') return eventChain;
          if (table === 'league_tournament_links') return linksChain;
          return makeAwaitableChain({ data: null, error: null });
        }),
      },
    };
    const assertOrgRole = vi.fn().mockResolvedValue(undefined);
    const service = new LeaguesService(supabase as never, { assertOrgRole } as never, {} as never);

    const result = await service.listEventLeagueAttachments('event-1', 'user-1');

    expect(result).toEqual(linksData);
    expect(assertOrgRole).toHaveBeenCalledWith('org-1', 'user-1', 'editor');
    // The query must filter on event + exclude removed rows.
    expect(linksChain.eq).toHaveBeenCalledWith('tournaments.event_id', 'event-1');
    expect(linksChain.neq).toHaveBeenCalledWith('status', 'removed');
  });

  it("throws ForbiddenException when the caller is not an editor of the event's org", async () => {
    const eventChain = makeAwaitableChain({
      data: { id: 'event-1', organization_id: 'org-1' },
      error: null,
    });
    const supabase = {
      service: {
        from: vi.fn(() => eventChain),
      },
    };
    const assertOrgRole = vi.fn().mockRejectedValue(new ForbiddenException('nope'));
    const service = new LeaguesService(supabase as never, { assertOrgRole } as never, {} as never);

    await expect(service.listEventLeagueAttachments('event-1', 'user-1')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});

describe('LeaguesService.selfDetachTournamentLink', () => {
  it('flips the link to status="removed" when the link belongs to an event in the caller\'s org', async () => {
    const linkRow = {
      id: 'link-1',
      league_id: 'league-1',
      tournament_id: 'tournament-1',
      tournaments: {
        id: 'tournament-1',
        event_id: 'event-1',
        events: { organization_id: 'org-1' },
      },
    };
    const updates: Array<Record<string, unknown>> = [];
    const linkChain = makeAwaitableChain({ data: linkRow, error: null });
    const updateChain = makeAwaitableChain({ data: null, error: null });
    updateChain.update = vi.fn((payload: Record<string, unknown>) => {
      updates.push(payload);
      return updateChain;
    });

    const supabase = {
      service: {
        from: vi.fn((table: string) => {
          if (table === 'league_tournament_links') {
            // First call: select (linkChain). Second call (after assert): update.
            // We return linkChain first then updateChain by tracking calls.
            const callCount = (supabase.service.from as ReturnType<typeof vi.fn>).mock.calls.filter(
              (c) => c[0] === 'league_tournament_links',
            ).length;
            return callCount === 1 ? linkChain : updateChain;
          }
          return makeAwaitableChain({ data: null, error: null });
        }),
      },
    };

    const assertOrgRole = vi.fn().mockResolvedValue(undefined);
    const service = new LeaguesService(supabase as never, { assertOrgRole } as never, {} as never);

    await service.selfDetachTournamentLink('event-1', 'link-1', 'user-1');

    expect(assertOrgRole).toHaveBeenCalledWith('org-1', 'user-1', 'editor');
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({ status: 'removed', reviewed_by_user_id: 'user-1' });
  });

  it("throws NotFoundException when the link's tournament does not belong to the given event", async () => {
    const linkRow = {
      id: 'link-1',
      tournaments: {
        id: 'tournament-1',
        event_id: 'event-OTHER',
        events: { organization_id: 'org-1' },
      },
    };
    const linkChain = makeAwaitableChain({ data: linkRow, error: null });
    const supabase = {
      service: {
        from: vi.fn(() => linkChain),
      },
    };
    const service = new LeaguesService(
      supabase as never,
      { assertOrgRole: vi.fn().mockResolvedValue(undefined) } as never,
      {} as never,
    );

    await expect(
      service.selfDetachTournamentLink('event-1', 'link-1', 'user-1'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('LeaguesService.listLeagueMemberEvents', () => {
  it('returns distinct events whose tournaments have an approved link to the league', async () => {
    const linksData = [
      {
        status: 'approved',
        tournaments: {
          event_id: 'event-A',
          events: {
            id: 'event-A',
            name: 'Spring Cup',
            slug: 'spring-cup',
            start_date: '2026-03-14',
            end_date: '2026-03-15',
            organizations: { id: 'org-A', name: 'HEMA Lyon' },
          },
        },
      },
      {
        // Second tournament from the same event — must dedupe to one event card.
        status: 'approved',
        tournaments: {
          event_id: 'event-A',
          events: {
            id: 'event-A',
            name: 'Spring Cup',
            slug: 'spring-cup',
            start_date: '2026-03-14',
            end_date: '2026-03-15',
            organizations: { id: 'org-A', name: 'HEMA Lyon' },
          },
        },
      },
      {
        status: 'approved',
        tournaments: {
          event_id: 'event-B',
          events: {
            id: 'event-B',
            name: 'Open Bordeaux',
            slug: 'open-bordeaux',
            start_date: '2026-04-18',
            end_date: '2026-04-19',
            organizations: { id: 'org-B', name: 'HEMA Bordeaux' },
          },
        },
      },
    ];
    const linksChain = makeAwaitableChain({ data: linksData, error: null });
    const supabase = { service: { from: vi.fn(() => linksChain) } };
    const service = new LeaguesService(
      supabase as never,
      { assertOrgRole: vi.fn() } as never,
      {} as never,
    );

    const result = await service.listLeagueMemberEvents('league-1');

    expect(result).toEqual([
      {
        id: 'event-A',
        name: 'Spring Cup',
        slug: 'spring-cup',
        startDate: '2026-03-14',
        endDate: '2026-03-15',
        organization: { id: 'org-A', name: 'HEMA Lyon' },
      },
      {
        id: 'event-B',
        name: 'Open Bordeaux',
        slug: 'open-bordeaux',
        startDate: '2026-04-18',
        endDate: '2026-04-19',
        organization: { id: 'org-B', name: 'HEMA Bordeaux' },
      },
    ]);
    expect(linksChain.eq).toHaveBeenCalledWith('league_id', 'league-1');
    expect(linksChain.eq).toHaveBeenCalledWith('status', 'approved');
  });
});
