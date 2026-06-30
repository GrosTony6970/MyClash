import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { LeagueMembershipRequestsService } from './league-membership-requests.service';

type Result = { data: unknown; error: { message: string } | null };

function buildSupabase(state: {
  org?: Result;
  league?: Result;
  existingRole?: Result;
  pendingRow?: Result;
  insertRow?: Result;
  systemById?: Result;
  updateRow?: Result;
  roleUpsertError?: { message: string } | null;
  platformRole?: Result;
  leagueUserRole?: Result;
  orgMembers?: Result;
}) {
  const inserted: unknown[] = [];
  const updates: unknown[] = [];
  const roleUpserts: unknown[] = [];

  const tableHandlers: Record<string, () => unknown> = {
    organizations: () => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue(state.org ?? { data: null, error: null }),
    }),
    leagues: () => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue(state.league ?? { data: null, error: null }),
    }),
    league_organization_roles: () => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue(state.existingRole ?? { data: null, error: null }),
      upsert: vi.fn((payload: unknown) => {
        roleUpserts.push(payload);
        return Promise.resolve({ data: payload, error: state.roleUpsertError ?? null });
      }),
    }),
    league_membership_requests: () => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      // submit() looks for an existing pending row; review() looks up by id.
      // Tests set either `pendingRow` or `systemById` — fall back to the
      // other so a single maybeSingle stub serves both paths.
      maybeSingle: vi
        .fn()
        .mockResolvedValue(state.systemById ?? state.pendingRow ?? { data: null, error: null }),
      insert: vi.fn((payload: unknown) => {
        inserted.push(payload);
        return {
          select: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue(
            state.insertRow ?? {
              data: { id: 'req-1', ...(payload as object) },
              error: null,
            },
          ),
        };
      }),
      update: vi.fn((payload: unknown) => {
        updates.push(payload);
        const chain = {
          eq: vi.fn().mockReturnThis(),
          select: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue(
            state.updateRow ?? {
              data: { id: 'req-1', ...(payload as object) },
              error: null,
            },
          ),
        };
        return chain;
      }),
    }),
    platform_roles: () => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue(state.platformRole ?? { data: null, error: null }),
    }),
    league_user_roles: () => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue(state.leagueUserRole ?? { data: null, error: null }),
    }),
    organization_members: () => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue(state.orgMembers ?? { data: [], error: null }),
    }),
  };

  const service = {
    from: vi.fn((table: string) => {
      const handler = tableHandlers[table];
      return handler ? handler() : ({} as never);
    }),
  };
  return { service: { service }, inserted, updates, roleUpserts };
}

function makeOrgsService(allowed: boolean) {
  return {
    assertOrgRole: vi.fn(() =>
      allowed ? Promise.resolve() : Promise.reject(new ForbiddenException('Not authorised')),
    ),
  };
}

describe('LeagueMembershipRequestsService.submit', () => {
  it('rejects callers who are not org admins', async () => {
    const { service } = buildSupabase({});
    const orgs = makeOrgsService(false);
    const svc = new LeagueMembershipRequestsService(service as never, orgs as never);
    await expect(svc.submit('org-1', { leagueId: 'league-1' }, 'user-1')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('rejects when the organization is the platform org', async () => {
    const { service } = buildSupabase({
      org: { data: { id: 'org-1', slug: 'myclash-hq', is_platform: true }, error: null },
    });
    const svc = new LeagueMembershipRequestsService(
      service as never,
      makeOrgsService(true) as never,
    );
    await expect(svc.submit('org-1', { leagueId: 'league-1' }, 'user-1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('rejects when the league does not exist', async () => {
    const { service } = buildSupabase({
      org: { data: { id: 'org-1', slug: 'club', is_platform: false }, error: null },
      league: { data: null, error: null },
    });
    const svc = new LeagueMembershipRequestsService(
      service as never,
      makeOrgsService(true) as never,
    );
    await expect(
      svc.submit('org-1', { leagueId: 'missing-league' }, 'user-1'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects when the org is already a member', async () => {
    const { service } = buildSupabase({
      org: { data: { id: 'org-1', slug: 'club', is_platform: false }, error: null },
      league: { data: { id: 'league-1', name: 'FFAMHE' }, error: null },
      existingRole: { data: { organization_id: 'org-1' }, error: null },
    });
    const svc = new LeagueMembershipRequestsService(
      service as never,
      makeOrgsService(true) as never,
    );
    await expect(svc.submit('org-1', { leagueId: 'league-1' }, 'user-1')).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('inserts a row with status=requested on the happy path', async () => {
    const { service, inserted } = buildSupabase({
      org: { data: { id: 'org-1', slug: 'club', is_platform: false }, error: null },
      league: { data: { id: 'league-1', name: 'FFAMHE' }, error: null },
      existingRole: { data: null, error: null },
      pendingRow: { data: null, error: null },
      insertRow: {
        data: { id: 'req-1', league_id: 'league-1', organization_id: 'org-1', status: 'requested' },
        error: null,
      },
    });
    const svc = new LeagueMembershipRequestsService(
      service as never,
      makeOrgsService(true) as never,
    );

    const row = await svc.submit(
      'org-1',
      { leagueId: 'league-1', message: '  please let us in  ' },
      'user-1',
    );
    expect(row.status).toBe('requested');
    expect(inserted).toEqual([
      expect.objectContaining({
        league_id: 'league-1',
        organization_id: 'org-1',
        status: 'requested',
        message: 'please let us in',
        requested_role: 'member',
        requested_by_user_id: 'user-1',
      }),
    ]);
  });
});

describe('LeagueMembershipRequestsService.review', () => {
  it('rejects if the row is already reviewed', async () => {
    const { service } = buildSupabase({
      systemById: {
        data: {
          id: 'req-1',
          league_id: 'league-1',
          organization_id: 'org-1',
          status: 'approved',
          requested_role: 'member',
        },
        error: null,
      },
    });
    const svc = new LeagueMembershipRequestsService(
      service as never,
      makeOrgsService(true) as never,
    );
    await expect(svc.review('req-1', { status: 'approved' }, 'user-1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('approval upserts league_organization_roles and flips status to approved', async () => {
    const { service, roleUpserts, updates } = buildSupabase({
      systemById: {
        data: {
          id: 'req-1',
          league_id: 'league-1',
          organization_id: 'org-1',
          status: 'requested',
          requested_role: 'admin',
        },
        error: null,
      },
      platformRole: { data: { role: 'super_admin' }, error: null },
    });
    const svc = new LeagueMembershipRequestsService(
      service as never,
      makeOrgsService(true) as never,
    );

    await svc.review('req-1', { status: 'approved', reviewNote: 'welcome' }, 'super-admin-1');

    expect(roleUpserts).toEqual([
      expect.objectContaining({
        league_id: 'league-1',
        organization_id: 'org-1',
        role: 'admin',
      }),
    ]);
    expect(updates[0]).toEqual(
      expect.objectContaining({
        status: 'approved',
        reviewed_by_user_id: 'super-admin-1',
        review_note: 'welcome',
      }),
    );
  });

  it('allows an org owner via the org-role path (not super-admin, no direct league role)', async () => {
    const { service, updates } = buildSupabase({
      systemById: {
        data: {
          id: 'req-1',
          league_id: 'league-1',
          organization_id: 'org-9',
          status: 'requested',
          requested_role: 'member',
        },
        error: null,
      },
      platformRole: { data: null, error: null }, // not a super-admin
      leagueUserRole: { data: null, error: null }, // no direct league_user_roles row
      orgMembers: { data: [{ organization_id: 'org-1', role: 'owner' }], error: null },
      existingRole: { data: { id: 'role-1' }, error: null }, // org-1 holds a role on league-1
    });
    const svc = new LeagueMembershipRequestsService(
      service as never,
      makeOrgsService(true) as never,
    );

    await svc.review('req-1', { status: 'approved' }, 'org-owner-1');

    expect(updates[0]).toEqual(
      expect.objectContaining({ status: 'approved', reviewed_by_user_id: 'org-owner-1' }),
    );
  });

  it('rejects a user with no platform, league, or org role', async () => {
    const { service } = buildSupabase({
      systemById: {
        data: {
          id: 'req-1',
          league_id: 'league-1',
          organization_id: 'org-9',
          status: 'requested',
          requested_role: 'member',
        },
        error: null,
      },
      platformRole: { data: null, error: null },
      leagueUserRole: { data: null, error: null },
      orgMembers: { data: [], error: null },
    });
    const svc = new LeagueMembershipRequestsService(
      service as never,
      makeOrgsService(true) as never,
    );

    await expect(svc.review('req-1', { status: 'approved' }, 'nobody-1')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('rejection does NOT upsert into league_organization_roles', async () => {
    const { service, roleUpserts, updates } = buildSupabase({
      systemById: {
        data: {
          id: 'req-1',
          league_id: 'league-1',
          organization_id: 'org-1',
          status: 'requested',
          requested_role: 'member',
        },
        error: null,
      },
      platformRole: { data: { role: 'super_admin' }, error: null },
    });
    const svc = new LeagueMembershipRequestsService(
      service as never,
      makeOrgsService(true) as never,
    );

    await svc.review('req-1', { status: 'rejected' }, 'super-admin-1');

    expect(roleUpserts).toEqual([]);
    expect(updates[0]).toEqual(expect.objectContaining({ status: 'rejected' }));
  });
});
