import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { UpdateLeagueDto } from './dto/leagues.dto';
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

describe('LeaguesService.listPublic groups breakdown', () => {
  it('projects event_count, tournament_count, and per-group tournament counts on each public league row', async () => {
    // L1 has 2 groups (g1, g2); 3 approved tournament links — 2 in
    // group g1 (with overlapping event), 1 in g2; distinct event ids
    // → 2. L2 has 0 groups + 1 link → tournament_count 1, groups [].
    const supabaseService = {
      from: vi.fn((table: string) => {
        if (table === 'leagues') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            order: vi.fn().mockResolvedValue({
              data: [
                { id: 'L1', name: 'French Cup', slug: 'french-cup', season_year: 2026 },
                { id: 'L2', name: 'Regional', slug: 'regional', season_year: 2025 },
              ],
              error: null,
            }),
          };
        }
        if (table === 'league_groups') {
          return {
            select: vi.fn().mockReturnThis(),
            in: vi.fn().mockReturnThis(),
            order: vi.fn().mockResolvedValue({
              data: [
                { id: 'g1', league_id: 'L1', name: 'Group A' },
                { id: 'g2', league_id: 'L1', name: 'Group B' },
              ],
              error: null,
            }),
          };
        }
        if (table === 'league_tournament_links') {
          return {
            select: vi.fn().mockReturnThis(),
            in: vi.fn().mockReturnThis(),
            eq: vi.fn().mockResolvedValue({
              data: [
                {
                  league_id: 'L1',
                  group_id: 'g1',
                  tournaments: { event_id: 'E1' },
                },
                {
                  league_id: 'L1',
                  group_id: 'g1',
                  tournaments: { event_id: 'E1' }, // duplicate event
                },
                {
                  league_id: 'L1',
                  group_id: 'g2',
                  tournaments: { event_id: 'E2' },
                },
                {
                  league_id: 'L2',
                  group_id: null,
                  tournaments: { event_id: 'E3' },
                },
              ],
              error: null,
            }),
          };
        }
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        };
      }),
    };
    const service = new LeaguesService(
      { service: supabaseService } as never,
      { assertOrgRole: vi.fn() } as never,
      {} as never,
    );

    const result = (await service.listPublic()) as Array<Record<string, unknown>>;

    const l1 = result.find((r) => r['id'] === 'L1');
    const l2 = result.find((r) => r['id'] === 'L2');
    expect(l1).toMatchObject({
      event_count: 2,
      tournament_count: 3,
      groups: [
        { id: 'g1', name: 'Group A', tournament_count: 2 },
        { id: 'g2', name: 'Group B', tournament_count: 1 },
      ],
    });
    expect(l2).toMatchObject({
      event_count: 1,
      tournament_count: 1,
      groups: [],
    });
  });
});

describe('LeaguesService.listManageable count enrichment', () => {
  it('projects group/tournament/event/fighter counts onto each league row', async () => {
    // Super-admin path: leagues SELECT returns two rows, the enrichment
    // helper batches three follow-up SELECTs and aggregates the counts
    // in TS. Verifies distinct-event derivation across array + singular
    // embed shapes (PostgREST returns one or the other depending on FK
    // multiplicity).
    const supabaseService = {
      from: vi.fn((table: string) => {
        if (table === 'platform_roles') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: { role: 'super_admin' }, error: null }),
          };
        }
        if (table === 'leagues') {
          return {
            select: vi.fn().mockReturnThis(),
            order: vi.fn().mockResolvedValue({
              data: [
                { id: 'L1', name: 'A', season_year: 2026 },
                { id: 'L2', name: 'B', season_year: 2025 },
              ],
              error: null,
            }),
          };
        }
        if (table === 'league_groups') {
          return {
            select: vi.fn().mockReturnThis(),
            in: vi.fn().mockResolvedValue({
              data: [{ league_id: 'L1' }, { league_id: 'L1' }, { league_id: 'L2' }],
              error: null,
            }),
          };
        }
        if (table === 'league_tournament_links') {
          return {
            select: vi.fn().mockReturnThis(),
            in: vi.fn().mockReturnThis(),
            eq: vi.fn().mockResolvedValue({
              data: [
                { league_id: 'L1', tournaments: { event_id: 'E1' } },
                { league_id: 'L1', tournaments: { event_id: 'E1' } }, // duplicate event
                { league_id: 'L1', tournaments: { event_id: 'E2' } },
                { league_id: 'L2', tournaments: { event_id: 'E3' } },
              ],
              error: null,
            }),
          };
        }
        if (table === 'league_rankings') {
          return {
            select: vi.fn().mockReturnThis(),
            in: vi.fn().mockResolvedValue({
              data: [
                { league_id: 'L1', fighter_id: 'F1' },
                { league_id: 'L1', fighter_id: 'F2' },
                { league_id: 'L1', fighter_id: 'F1' }, // duplicate fighter
                { league_id: 'L2', fighter_id: 'F3' },
              ],
              error: null,
            }),
          };
        }
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        };
      }),
    };
    const service = new LeaguesService(
      { service: supabaseService } as never,
      { assertOrgRole: vi.fn() } as never,
      {} as never,
    );

    const result = (await service.listManageable('admin-user')) as Array<Record<string, unknown>>;

    const l1 = result.find((r) => r['id'] === 'L1');
    const l2 = result.find((r) => r['id'] === 'L2');
    expect(l1).toMatchObject({
      group_count: 2,
      tournament_count: 3,
      event_count: 2, // E1 + E2, deduped
      fighter_count: 2, // F1 + F2, deduped
    });
    expect(l2).toMatchObject({
      group_count: 1,
      tournament_count: 1,
      event_count: 1,
      fighter_count: 1,
    });
  });
});

describe('LeaguesService.addTournamentLink', () => {
  it('writes both requested_by_user_id and reviewed_by_user_id so the NOT NULL constraint passes', async () => {
    // Regression for the operator-hit 400:
    //   null value in column "requested_by_user_id" of relation
    //   "league_tournament_links" violates not-null constraint
    // The admin direct-link path must mirror the sibling
    // requestTournamentLink and set requested_by_user_id (= same admin).
    const upsertPayloads: unknown[] = [];

    const supabaseService = {
      from: vi.fn((table: string) => {
        if (table === 'platform_roles') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: { role: 'super_admin' }, error: null }),
          };
        }
        if (table === 'league_tournament_links') {
          return {
            upsert: vi.fn((payload: unknown) => {
              upsertPayloads.push(payload);
              return {
                select: vi.fn().mockReturnThis(),
                single: vi.fn().mockResolvedValue({
                  data: { id: 'link-new', status: 'approved' },
                  error: null,
                }),
              };
            }),
          };
        }
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        };
      }),
    };
    const service = new LeaguesService(
      { service: supabaseService } as never,
      { assertOrgRole: vi.fn() } as never,
      {} as never,
    );

    await service.addTournamentLink('league-1', 't-1', 'admin-user', null);

    expect(upsertPayloads).toHaveLength(1);
    expect(upsertPayloads[0]).toMatchObject({
      league_id: 'league-1',
      tournament_id: 't-1',
      status: 'approved',
      requested_by_user_id: 'admin-user',
      reviewed_by_user_id: 'admin-user',
    });
  });
});

describe('LeaguesService.listOrganizationMemberships', () => {
  function buildService(opts: {
    roles: unknown;
    leagues?: unknown;
    assertOrgRole?: ReturnType<typeof vi.fn>;
  }) {
    const rolesChain = makeAwaitableChain({ data: opts.roles, error: null });
    const leaguesChain = makeAwaitableChain({ data: opts.leagues ?? [], error: null });
    const supabase = {
      service: {
        from: vi.fn((table: string) => {
          if (table === 'league_organization_roles') return rolesChain;
          if (table === 'leagues') return leaguesChain;
          // league_groups / league_tournament_links / league_rankings enrichment
          return makeAwaitableChain({ data: [], error: null });
        }),
      },
    };
    const assertOrgRole = opts.assertOrgRole ?? vi.fn().mockResolvedValue(undefined);
    const service = new LeaguesService(supabase as never, { assertOrgRole } as never, {} as never);
    return { service, rolesChain, leaguesChain, assertOrgRole, supabase };
  }

  it('returns every league the org belongs to at any role — member rows included — with role + joined_at, and applies NO role filter', async () => {
    const { service, rolesChain, assertOrgRole } = buildService({
      roles: [
        { league_id: 'L1', role: 'member', created_at: '2026-01-01T00:00:00Z' },
        { league_id: 'L2', role: 'admin', created_at: '2026-02-02T00:00:00Z' },
      ],
      leagues: [
        { id: 'L1', name: 'Alpha', season_year: 2026 },
        { id: 'L2', name: 'Beta', season_year: 2025 },
      ],
    });

    const result = (await service.listOrganizationMemberships('org-1', 'user-1')) as Array<
      Record<string, unknown>
    >;

    expect(assertOrgRole).toHaveBeenCalledWith('org-1', 'user-1', 'admin');
    // The whole point of the fix: the org-roles query must NOT narrow by role,
    // so a member-role league is included (previously invisible in the hub).
    expect(rolesChain.in).not.toHaveBeenCalled();
    const byId = new Map(result.map((r) => [r['id'], r]));
    expect(byId.get('L1')).toMatchObject({ org_role: 'member', joined_at: '2026-01-01T00:00:00Z' });
    expect(byId.get('L2')).toMatchObject({ org_role: 'admin', joined_at: '2026-02-02T00:00:00Z' });
    expect(result).toHaveLength(2);
  });

  it('returns [] without querying the leagues table when the org has no memberships', async () => {
    const { service, supabase } = buildService({ roles: [] });
    const result = await service.listOrganizationMemberships('org-1', 'user-1');
    expect(result).toEqual([]);
    expect(supabase.service.from).not.toHaveBeenCalledWith('leagues');
  });

  it('propagates ForbiddenException from the org-admin gate before touching the database', async () => {
    const assertOrgRole = vi.fn().mockRejectedValue(new ForbiddenException('nope'));
    const { service, supabase } = buildService({ roles: [], assertOrgRole });
    await expect(service.listOrganizationMemberships('org-1', 'user-1')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(supabase.service.from).not.toHaveBeenCalled();
  });
});

describe('LeaguesService.listManageableByOrg role filter (regression guard)', () => {
  it('narrows the org-roles query to admin/owner so members never leak into the Manage tab', async () => {
    const rolesChain = makeAwaitableChain({
      data: [{ league_id: 'L2', role: 'admin' }],
      error: null,
    });
    const leaguesChain = makeAwaitableChain({
      data: [{ id: 'L2', name: 'Beta', season_year: 2025 }],
      error: null,
    });
    const supabase = {
      service: {
        from: vi.fn((table: string) => {
          if (table === 'league_organization_roles') return rolesChain;
          if (table === 'leagues') return leaguesChain;
          return makeAwaitableChain({ data: [], error: null });
        }),
      },
    };
    const service = new LeaguesService(
      supabase as never,
      { assertOrgRole: vi.fn().mockResolvedValue(undefined) } as never,
      {} as never,
    );

    await service.listManageableByOrg('org-1', 'user-1');

    expect(rolesChain.in).toHaveBeenCalledWith('role', ['admin', 'owner']);
  });
});

describe('LeaguesService.listOrganizationTournaments', () => {
  it('flattens the org tournaments with their event, gated on editor and filtered by org', async () => {
    const rows = [
      {
        id: 't1',
        name: 'Longsword Open',
        weapon: 'longsword',
        event_id: 'e1',
        events: { id: 'e1', name: 'Spring Cup', organization_id: 'org-1' },
      },
      {
        id: 't2',
        name: 'Rapier',
        weapon: null,
        event_id: 'e2',
        events: { id: 'e2', name: 'Autumn Clash', organization_id: 'org-1' },
      },
    ];
    const chainObj = makeAwaitableChain({ data: rows, error: null });
    const supabase = { service: { from: vi.fn(() => chainObj) } };
    const assertOrgRole = vi.fn().mockResolvedValue(undefined);
    const service = new LeaguesService(supabase as never, { assertOrgRole } as never, {} as never);

    const result = await service.listOrganizationTournaments('org-1', 'user-1');

    expect(assertOrgRole).toHaveBeenCalledWith('org-1', 'user-1', 'editor');
    expect(chainObj.eq).toHaveBeenCalledWith('events.organization_id', 'org-1');
    expect(result).toEqual([
      {
        id: 't1',
        name: 'Longsword Open',
        weapon: 'longsword',
        event_id: 'e1',
        event_name: 'Spring Cup',
      },
      { id: 't2', name: 'Rapier', weapon: null, event_id: 'e2', event_name: 'Autumn Clash' },
    ]);
  });

  it('throws ForbiddenException when the caller is not an editor of the org', async () => {
    const chainObj = makeAwaitableChain({ data: [], error: null });
    const supabase = { service: { from: vi.fn(() => chainObj) } };
    const assertOrgRole = vi.fn().mockRejectedValue(new ForbiddenException('nope'));
    const service = new LeaguesService(supabase as never, { assertOrgRole } as never, {} as never);

    await expect(service.listOrganizationTournaments('org-1', 'user-1')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});

describe('LeaguesService.listOrganizationLeagueAttachments', () => {
  it("returns the org's non-removed attachments, gated on editor and filtered by org", async () => {
    const links = [
      {
        id: 'link-1',
        status: 'approved',
        league_id: 'L1',
        tournaments: {
          id: 't1',
          event_id: 'e1',
          events: { id: 'e1', name: 'Spring', organization_id: 'org-1' },
        },
      },
    ];
    const chainObj = makeAwaitableChain({ data: links, error: null });
    const supabase = { service: { from: vi.fn(() => chainObj) } };
    const assertOrgRole = vi.fn().mockResolvedValue(undefined);
    const service = new LeaguesService(supabase as never, { assertOrgRole } as never, {} as never);

    const result = await service.listOrganizationLeagueAttachments('org-1', 'user-1');

    expect(assertOrgRole).toHaveBeenCalledWith('org-1', 'user-1', 'editor');
    expect(chainObj.eq).toHaveBeenCalledWith('tournaments.events.organization_id', 'org-1');
    expect(chainObj.neq).toHaveBeenCalledWith('status', 'removed');
    expect(result).toEqual(links);
  });

  it('narrows to a single league when leagueId is provided', async () => {
    const chainObj = makeAwaitableChain({ data: [], error: null });
    const supabase = { service: { from: vi.fn(() => chainObj) } };
    const service = new LeaguesService(
      supabase as never,
      { assertOrgRole: vi.fn().mockResolvedValue(undefined) } as never,
      {} as never,
    );

    await service.listOrganizationLeagueAttachments('org-1', 'user-1', 'L1');

    expect(chainObj.eq).toHaveBeenCalledWith('league_id', 'L1');
  });
});

describe('LeaguesService update status/visibility invariant', () => {
  // Public league reads AND-gate status='published' AND public_visibility=true.
  // The flag is derived from status server-side so no caller can desync the
  // pair — the /admin/leagues dropdown used to PATCH status alone, publishing
  // leagues that stayed invisible.
  function makeUpdateService() {
    const updates: Record<string, unknown>[] = [];
    const supabaseService = {
      from: vi.fn((table: string) => {
        // isSuperAdmin() inside assertCanManageLeague — pass the auth check.
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
        return {
          update: vi.fn((payload: Record<string, unknown>) => {
            updates.push(payload);
            return {
              eq: vi.fn().mockReturnThis(),
              select: vi.fn().mockReturnThis(),
              single: vi.fn().mockResolvedValue({ data: { id: 'league-1' }, error: null }),
            };
          }),
        };
      }),
    };
    const service = new LeaguesService(
      { service: supabaseService } as never,
      {} as never,
      {} as never,
    );
    return { service, updates };
  }

  it('publishes and makes public in one write when status becomes published', async () => {
    const { service, updates } = makeUpdateService();

    await service.update('league-1', { status: 'published' }, 'user-1');

    expect(updates[0]).toMatchObject({ status: 'published', public_visibility: true });
  });

  it.each(['draft', 'archived'] as const)(
    'clears public_visibility when status is %s',
    async (status) => {
      const { service, updates } = makeUpdateService();

      await service.update('league-1', { status }, 'user-1');

      expect(updates[0]).toMatchObject({ status, public_visibility: false });
    },
  );

  it('leaves public_visibility untouched when status is not part of the update', async () => {
    const { service, updates } = makeUpdateService();

    await service.update('league-1', { name: 'Renamed league' }, 'user-1');

    expect(updates[0]).toMatchObject({ name: 'Renamed league' });
    expect(updates[0]).not.toHaveProperty('public_visibility');
  });

  it('rejects a caller trying to set publicVisibility independently of status', () => {
    expect(() =>
      UpdateLeagueDto.schema.parse({ status: 'draft', publicVisibility: true }),
    ).toThrow();
  });
});

// ── Personal league workspace ───────────────────────────────────────────────
// The non-super-admin branch of listManageable, plus the guards that make the
// roles tab safe to expose outside the super-admin console. All of it was
// reachable only by super-admins before /leagues existed, so none of it had
// any coverage.

/**
 * A thenable query chain: awaiting it resolves to `result`, and every builder
 * method returns it, so one stub serves `.select().eq()`, `.in().in()`,
 * `.eq().in().neq().limit()` and `.maybeSingle()` alike.
 */
function chainOf(result: QueryResult) {
  const chain = Object.assign(Promise.resolve(result), {
    select: vi.fn(),
    eq: vi.fn(),
    in: vi.fn(),
    neq: vi.fn(),
    limit: vi.fn(),
    order: vi.fn(),
    delete: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue(result),
  });
  for (const method of ['select', 'eq', 'in', 'neq', 'limit', 'order', 'delete'] as const) {
    chain[method].mockReturnValue(chain);
  }
  return chain;
}

function buildLeaguesService(tables: Record<string, QueryResult>) {
  const chains = new Map<string, ReturnType<typeof chainOf>>();
  const from = vi.fn((table: string) => {
    if (!chains.has(table)) {
      chains.set(table, chainOf(tables[table] ?? { data: [], error: null }));
    }
    return chains.get(table);
  });
  const service = new LeaguesService(
    { service: { from } } as never,
    { assertOrgRole: vi.fn() } as never,
    {} as never,
  );
  return { service, from, chains };
}

describe('LeaguesService.listManageable direct grants', () => {
  it('lists a league granted directly via league_user_roles to a non-super-admin', async () => {
    const { service } = buildLeaguesService({
      platform_roles: { data: null, error: null },
      league_user_roles: { data: [{ league_id: 'L1', role: 'admin' }], error: null },
      organization_members: { data: [], error: null },
      leagues: { data: [{ id: 'L1', name: 'Coupe de France', season_year: 2026 }], error: null },
    });

    const result = (await service.listManageable('league-admin-1')) as Array<
      Record<string, unknown>
    >;

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ id: 'L1', name: 'Coupe de France' });
    expect(result[0]?.['access']).toEqual({
      direct_role: 'admin',
      organizations: [],
      super_admin: false,
    });
  });

  it('returns an empty list without querying leagues when the user holds no roles', async () => {
    const { service, from } = buildLeaguesService({
      platform_roles: { data: null, error: null },
      league_user_roles: { data: [], error: null },
      organization_members: { data: [], error: null },
    });

    expect(await service.listManageable('nobody')).toEqual([]);
    expect(from).not.toHaveBeenCalledWith('leagues');
  });

  it('badges an org-derived league with the organization name, never its id', async () => {
    const { service } = buildLeaguesService({
      platform_roles: { data: null, error: null },
      league_user_roles: { data: [], error: null },
      organization_members: { data: [{ organization_id: 'org-1', role: 'owner' }], error: null },
      league_organization_roles: {
        data: [{ league_id: 'L2', organization_id: 'org-1', role: 'admin' }],
        error: null,
      },
      organizations: { data: [{ id: 'org-1', name: 'Lyon AMHE' }], error: null },
      leagues: { data: [{ id: 'L2', name: 'Ligue Rhone', season_year: 2026 }], error: null },
    });

    const result = (await service.listManageable('org-owner-1')) as Array<Record<string, unknown>>;

    expect(result[0]?.['access']).toEqual({
      direct_role: null,
      organizations: [{ id: 'org-1', name: 'Lyon AMHE', role: 'admin' }],
      super_admin: false,
    });
  });

  it('marks every league as super-admin access for a platform admin', async () => {
    const { service } = buildLeaguesService({
      platform_roles: { data: { role: 'super_admin' }, error: null },
      leagues: { data: [{ id: 'L1', name: 'A', season_year: 2026 }], error: null },
    });

    const result = (await service.listManageable('super-1')) as Array<Record<string, unknown>>;

    expect(result[0]?.['access']).toEqual({
      direct_role: null,
      organizations: [],
      super_admin: true,
    });
  });
});

describe('LeaguesService.getManageable', () => {
  it('returns the league with counts for a direct league admin', async () => {
    const { service } = buildLeaguesService({
      platform_roles: { data: null, error: null },
      league_user_roles: { data: { role: 'admin' }, error: null },
      leagues: { data: { id: 'L1', name: 'Coupe de France' }, error: null },
    });

    const result = (await service.getManageable('L1', 'league-admin-1')) as Record<string, unknown>;

    expect(result).toMatchObject({ id: 'L1', name: 'Coupe de France', group_count: 0 });
  });

  it('refuses a user who does not manage the league', async () => {
    const { service } = buildLeaguesService({
      platform_roles: { data: null, error: null },
      league_user_roles: { data: null, error: null },
      organization_members: { data: [], error: null },
    });

    await expect(service.getManageable('L1', 'outsider')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('404s an unknown league id for a super-admin', async () => {
    const { service } = buildLeaguesService({
      platform_roles: { data: { role: 'super_admin' }, error: null },
      leagues: { data: null, error: null },
    });

    await expect(service.getManageable('missing', 'super-1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe('LeaguesService.removeUserRole lockout guards', () => {
  it('refuses to let a league admin remove their own access', async () => {
    // The roles tab has no "add admin" control, so this is unrecoverable.
    const { service } = buildLeaguesService({
      platform_roles: { data: null, error: null },
      league_user_roles: { data: { role: 'admin' }, error: null },
      organization_members: { data: [], error: null },
    });

    await expect(service.removeUserRole('L1', 'me', 'me')).rejects.toThrow(
      /cannot remove your own league access/i,
    );
  });

  it('allows self-removal when the caller still manages the league via their org', async () => {
    const { service, chains } = buildLeaguesService({
      platform_roles: { data: null, error: null },
      league_user_roles: { data: { role: 'admin' }, error: null },
      organization_members: { data: [{ organization_id: 'org-1', role: 'owner' }], error: null },
      league_organization_roles: { data: [{ id: 'role-1' }], error: null },
    });

    await service.removeUserRole('L1', 'me', 'me');

    expect(chains.get('league_user_roles')?.delete).toHaveBeenCalled();
  });

  it('refuses to drain the last manager off a league', async () => {
    const { service } = buildLeaguesService({
      platform_roles: { data: { role: 'super_admin' }, error: null },
      // No other individual admin, and no org holds a role either.
      league_user_roles: { data: [], error: null },
      league_organization_roles: { data: [], error: null },
    });

    await expect(service.removeUserRole('L1', 'last-admin', 'super-1')).rejects.toThrow(
      /at least one admin or owner/i,
    );
  });

  it('allows removing the last individual admin when an org still manages the league', async () => {
    const { service, chains } = buildLeaguesService({
      platform_roles: { data: { role: 'super_admin' }, error: null },
      league_user_roles: { data: [], error: null },
      league_organization_roles: { data: [{ id: 'role-1' }], error: null },
    });

    await service.removeUserRole('L1', 'redundant-admin', 'super-1');

    expect(chains.get('league_user_roles')?.delete).toHaveBeenCalled();
  });
});

describe('LeaguesService placement-driven contributions', () => {
  const config = {
    scoringSystem: 'ffamhe_tf_2026',
    rankingDimensions: 'weapon',
    tieBreakers: ['total_points'],
  };

  it('maps each registration to its authoritative placement and skips unplaced ones', () => {
    const service = new LeaguesService({} as never, {} as never, {} as never);
    const tournament = { id: 't1', event_id: 'e1', weapon: 'Longsword' };
    const registrations = [
      { id: 'reg-a', persons: { global_person_id: 'gp-a', given_name: 'Ann', family_name: 'A' } },
      { id: 'reg-b', persons: { global_person_id: 'gp-b', given_name: 'Bob', family_name: 'B' } },
      { id: 'reg-c', persons: { global_person_id: 'gp-c', given_name: 'Cy', family_name: 'C' } },
    ];
    const placements = {
      byRegistrationId: new Map<string, { place: number; resultKind: string }>([
        ['reg-a', { place: 1, resultKind: 'champion' }],
        ['reg-b', { place: 2, resultKind: 'runnerUp' }],
        // reg-c has NO placement → must be skipped.
      ]),
    };
    const doubleHits = new Map([['reg-a', 2]]);

    const inputs = (
      service as unknown as {
        toContributionInputs: (
          leagueId: string,
          tournament: unknown,
          groupName: string | null,
          registrations: unknown[],
          doubleHits: Map<string, number>,
          placements: unknown,
        ) => Array<Record<string, unknown>>;
      }
    ).toContributionInputs('L1', tournament, 'Open', registrations, doubleHits, placements);

    expect(inputs).toHaveLength(2);
    expect(inputs[0]).toMatchObject({
      fighterId: 'gp-a',
      fighterName: 'Ann A',
      finalRank: 1,
      resultKind: 'champion',
      weapon: 'Longsword',
      groupName: 'Open',
      doubleHits: 2,
    });
    expect(inputs[1]).toMatchObject({ fighterId: 'gp-b', finalRank: 2, resultKind: 'runnerUp' });
    expect(inputs.map((i) => i['fighterId'])).not.toContain('gp-c');
  });

  it('contributes nothing while the tournament is undecided (scoring engine untouched)', async () => {
    const tournamentsChain = chain({
      data: {
        id: 't1',
        event_id: 'e1',
        weapon: 'Longsword',
        events: { organization_id: 'org-1', is_test_event: false },
      },
      error: null,
    });
    const supabase = { service: { from: vi.fn(() => tournamentsChain) } };
    const placement = {
      getTournamentPlacements: vi
        .fn()
        .mockResolvedValue({ decided: false, byRegistrationId: new Map(), ordered: [] }),
    };
    const scoring = { toTournamentContributions: vi.fn() };
    const service = new LeaguesService(
      supabase as never,
      {} as never,
      scoring as never,
      placement as never,
    );

    const result = await (
      service as unknown as {
        computeTournamentContributions: (l: string, t: string, c: unknown) => Promise<unknown[]>;
      }
    ).computeTournamentContributions('L1', 't1', config);

    expect(result).toEqual([]);
    expect(placement.getTournamentPlacements).toHaveBeenCalledWith('t1');
    expect(scoring.toTournamentContributions).not.toHaveBeenCalled();
  });
});

// ── Season lifecycle: clone + finalize ──────────────────────────────────────

describe('LeaguesService.clone', () => {
  function build(opts: {
    source: Record<string, unknown>;
    existingSlugs?: string[];
    groups?: unknown[];
    orgRoles?: unknown[];
    userRoles?: unknown[];
  }) {
    const inserts: Record<string, unknown[]> = {};
    const leaguesInsert: Record<string, unknown>[] = [];
    const touched = new Set<string>();

    const childChain = (table: string, rows: unknown[]) => {
      const c: Record<string, ReturnType<typeof vi.fn>> = {};
      c['select'] = vi.fn(() => c);
      c['eq'] = vi.fn(() => Promise.resolve({ data: rows, error: null }));
      c['insert'] = vi.fn((payload: unknown) => {
        (inserts[table] ??= []).push(payload);
        return Promise.resolve({ data: payload, error: null });
      });
      return c;
    };

    const supabase = {
      service: {
        from: vi.fn((table: string) => {
          touched.add(table);
          if (table === 'platform_roles') {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              maybeSingle: vi
                .fn()
                .mockResolvedValue({ data: { role: 'super_admin' }, error: null }),
            };
          }
          if (table === 'leagues') {
            return {
              select: vi.fn((cols: string) => {
                if (cols === 'slug') {
                  return {
                    ilike: vi.fn().mockResolvedValue({
                      data: (opts.existingSlugs ?? []).map((s) => ({ slug: s })),
                      error: null,
                    }),
                  };
                }
                return {
                  eq: vi.fn().mockReturnThis(),
                  maybeSingle: vi.fn().mockResolvedValue({ data: opts.source, error: null }),
                };
              }),
              insert: vi.fn((payload: Record<string, unknown>) => {
                leaguesInsert.push(payload);
                return {
                  select: vi.fn().mockReturnThis(),
                  single: vi
                    .fn()
                    .mockResolvedValue({ data: { id: 'new-league', ...payload }, error: null }),
                };
              }),
            };
          }
          if (table === 'league_groups') return childChain(table, opts.groups ?? []);
          if (table === 'league_organization_roles') return childChain(table, opts.orgRoles ?? []);
          if (table === 'league_user_roles') return childChain(table, opts.userRoles ?? []);
          return childChain(table, []);
        }),
      },
    };
    const service = new LeaguesService(
      supabase as never,
      { assertOrgRole: vi.fn() } as never,
      {} as never,
    );
    return { service, inserts, leaguesInsert, touched };
  }

  it('copies config + groups + roles into a new season and never copies links, results or rankings', async () => {
    const { service, inserts, leaguesInsert, touched } = build({
      source: {
        id: 'L1',
        name: 'Coupe de France',
        slug: 'coupe-de-france',
        season_year: 2026,
        description: 'desc',
        logo_url: 'logo.png',
        scoring_system: 'ffamhe_tf_2026',
        scoring_config: {
          scoringSystem: 'ffamhe_tf_2026',
          rankingDimensions: 'weapon',
          tieBreakers: ['total_points'],
        },
      },
      existingSlugs: ['coupe-de-france'], // base taken → expect the season suffix
      groups: [
        { id: 'g1', name: 'Open', sort_order: 0 },
        { id: 'g2', name: 'Women', sort_order: 1 },
      ],
      orgRoles: [{ organization_id: 'org-1', role: 'owner' }],
      userRoles: [{ user_id: 'u-existing', role: 'admin' }],
    });

    await service.clone('L1', { seasonYear: 2027 }, 'cloner-1');

    expect(leaguesInsert).toHaveLength(1);
    expect(leaguesInsert[0]).toMatchObject({
      name: 'Coupe de France',
      slug: 'coupe-de-france-2027',
      season_year: 2027,
      description: 'desc',
      logo_url: 'logo.png',
      scoring_system: 'ffamhe_tf_2026',
      scoring_config: expect.objectContaining({ scoringSystem: 'ffamhe_tf_2026' }),
      created_by_user_id: 'cloner-1',
    });
    // Clone starts as a draft — never sets status/public_visibility.
    expect(leaguesInsert[0]).not.toHaveProperty('status');
    expect(leaguesInsert[0]).not.toHaveProperty('public_visibility');

    expect(inserts['league_groups']?.[0]).toEqual([
      { league_id: 'new-league', name: 'Open', sort_order: 0 },
      { league_id: 'new-league', name: 'Women', sort_order: 1 },
    ]);
    expect(inserts['league_organization_roles']?.[0]).toEqual([
      { league_id: 'new-league', organization_id: 'org-1', role: 'owner' },
    ]);
    // Existing user roles copied + cloner guaranteed an owner grant.
    expect(inserts['league_user_roles']?.[0]).toEqual([
      { league_id: 'new-league', user_id: 'u-existing', role: 'admin' },
      { league_id: 'new-league', user_id: 'cloner-1', role: 'owner' },
    ]);
    // Results / links / rankings are never read or written.
    expect(touched.has('league_tournament_links')).toBe(false);
    expect(touched.has('league_tournament_results')).toBe(false);
    expect(touched.has('league_rankings')).toBe(false);
  });

  it("preserves the cloner's existing role instead of forcing owner", async () => {
    const { service, inserts } = build({
      source: {
        id: 'L1',
        name: 'Ligue',
        slug: 'ligue',
        scoring_system: 'custom',
        scoring_config: {},
      },
      userRoles: [{ user_id: 'cloner-1', role: 'admin' }],
    });
    await service.clone('L1', { seasonYear: 2027 }, 'cloner-1');
    expect(inserts['league_user_roles']?.[0]).toEqual([
      { league_id: 'new-league', user_id: 'cloner-1', role: 'admin' },
    ]);
  });

  it('uses the bare toSlug when the base slug is free', async () => {
    const { service, leaguesInsert } = build({
      source: { id: 'L1', name: 'Nouvelle Ligue', scoring_system: 'custom', scoring_config: {} },
    });
    await service.clone('L1', { seasonYear: 2027 }, 'cloner-1');
    expect(leaguesInsert[0]).toMatchObject({ slug: 'nouvelle-ligue' });
  });
});

describe('LeaguesService.finalize / reopen', () => {
  function build() {
    const updates: Record<string, unknown>[] = [];
    const supabaseService = {
      from: vi.fn((table: string) => {
        if (table === 'platform_roles') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: { role: 'super_admin' }, error: null }),
          };
        }
        return {
          update: vi.fn((payload: Record<string, unknown>) => {
            updates.push(payload);
            return {
              eq: vi.fn().mockReturnThis(),
              select: vi.fn().mockReturnThis(),
              single: vi.fn().mockResolvedValue({ data: { id: 'L1' }, error: null }),
            };
          }),
        };
      }),
    };
    const service = new LeaguesService(
      { service: supabaseService } as never,
      {} as never,
      {} as never,
    );
    return { service, updates };
  }

  it('finalize stamps a finalized_at timestamp', async () => {
    const { service, updates } = build();
    await service.finalize('L1', 'user-1');
    expect(updates[0]!['finalized_at']).toEqual(expect.any(String));
  });

  it('reopen clears finalized_at', async () => {
    const { service, updates } = build();
    await service.reopen('L1', 'user-1');
    expect(updates[0]).toMatchObject({ finalized_at: null });
  });
});

describe('LeaguesService recompute freeze guard', () => {
  it('refuses to recompute a finalized league (manual recompute → 400)', async () => {
    const supabaseService = {
      from: vi.fn((table: string) => {
        if (table === 'leagues') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: { id: 'L1', finalized_at: '2026-07-24T00:00:00Z', scoring_config: {} },
              error: null,
            }),
          };
        }
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        };
      }),
    };
    const scoring = { resolveConfig: vi.fn() };
    const service = new LeaguesService(
      { service: supabaseService } as never,
      {} as never,
      scoring as never,
    );

    await expect(service.recomputeLeagueRankings('L1')).rejects.toBeInstanceOf(BadRequestException);
    // Guard trips before any scoring resolution.
    expect(scoring.resolveConfig).not.toHaveBeenCalled();
  });

  it('recomputeForEvent skips a finalized league without rewriting its results', async () => {
    const supabaseService = {
      from: vi.fn((table: string) => {
        if (table === 'tournaments') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockResolvedValue({ data: [{ id: 't1' }], error: null }),
          };
        }
        if (table === 'league_tournament_links') {
          return {
            select: vi.fn().mockReturnThis(),
            in: vi.fn().mockReturnThis(),
            eq: vi.fn().mockResolvedValue({
              data: [
                {
                  league_id: 'L1',
                  tournament_id: 't1',
                  leagues: { id: 'L1', finalized_at: '2026-07-24T00:00:00Z', scoring_config: {} },
                },
              ],
              error: null,
            }),
          };
        }
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        };
      }),
    };
    const scoring = { resolveConfig: vi.fn() };
    const service = new LeaguesService(
      { service: supabaseService } as never,
      {} as never,
      scoring as never,
    );

    const result = await service.recomputeForEvent('ev-1');
    expect(result).toEqual({ eventId: 'ev-1', recomputedLeagues: [] });
    expect(scoring.resolveConfig).not.toHaveBeenCalled();
  });
});
