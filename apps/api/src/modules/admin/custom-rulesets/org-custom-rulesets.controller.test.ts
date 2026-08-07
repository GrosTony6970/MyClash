import { ForbiddenException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { OrgCustomRulesetsController } from './org-custom-rulesets.controller';

function makeSupabase(userId: string | null) {
  return {
    anon: {
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: userId ? { id: userId } : null } }),
      },
    },
  };
}

function makeRequest(token?: string) {
  return { headers: {}, cookies: token ? { 'sb-access-token': token } : {} };
}

describe('OrgCustomRulesetsController authorization', () => {
  // Regression lock: previously this controller read `req.actorUserId`
  // (a property only set by PlatformRoleGuard), which on this guard-less
  // organizer route was always undefined. That made every assertOrgRole
  // call check `user_id = 'unknown'`, so even real org admins got 403.
  // The fix resolves the user id from the JWT cookie/Bearer token.

  it('resolves the caller from the Supabase JWT before asserting org admin', async () => {
    const service = { listForOrg: vi.fn().mockResolvedValue(['ruleset-row']) };
    const orgs = { assertOrgRole: vi.fn().mockResolvedValue(undefined) };
    const supabase = makeSupabase('user-1');
    const controller = new OrgCustomRulesetsController(
      service as never,
      orgs as never,
      supabase as never,
    );

    const result = await controller.list('org-1', makeRequest('jwt-token') as never);

    expect(orgs.assertOrgRole).toHaveBeenCalledWith('org-1', 'user-1', 'admin');
    expect(service.listForOrg).toHaveBeenCalledWith('org-1', 'user-1');
    expect(result).toEqual(['ruleset-row']);
  });

  it('rejects requests with no JWT (resolved user id is anonymous)', async () => {
    const service = { listForOrg: vi.fn() };
    const orgs = {
      assertOrgRole: vi.fn().mockRejectedValue(new ForbiddenException('Not a member')),
    };
    const supabase = makeSupabase(null);
    const controller = new OrgCustomRulesetsController(
      service as never,
      orgs as never,
      supabase as never,
    );

    await expect(controller.list('org-1', makeRequest() as never)).rejects.toThrow(
      ForbiddenException,
    );

    expect(orgs.assertOrgRole).toHaveBeenCalledWith('org-1', 'anonymous', 'admin');
    expect(service.listForOrg).not.toHaveBeenCalled();
  });

  it('gates the fork route on org admin before creating anything', async () => {
    // Forking writes an org-owned row, so it must not be reachable by a
    // non-admin — the same bar as create/update on this controller.
    const service = { forkForOrg: vi.fn() };
    const orgs = {
      assertOrgRole: vi.fn().mockRejectedValue(new ForbiddenException('Not a member')),
    };
    const controller = new OrgCustomRulesetsController(
      service as never,
      orgs as never,
      makeSupabase(null) as never,
    );

    await expect(
      controller.fork('org-1', { baseCode: 'TF_v1', name: 'X' } as never, makeRequest() as never),
    ).rejects.toThrow(ForbiddenException);

    expect(service.forkForOrg).not.toHaveBeenCalled();
  });

  it('passes the resolved caller through to forkForOrg', async () => {
    const service = { forkForOrg: vi.fn().mockResolvedValue({ id: 'new-1' }) };
    const orgs = { assertOrgRole: vi.fn().mockResolvedValue(undefined) };
    const controller = new OrgCustomRulesetsController(
      service as never,
      orgs as never,
      makeSupabase('user-1') as never,
    );
    const dto = { baseCode: 'TF_v1', name: 'Our house rules' };

    const result = await controller.fork('org-1', dto as never, makeRequest('jwt') as never);

    expect(orgs.assertOrgRole).toHaveBeenCalledWith('org-1', 'user-1', 'admin');
    expect(service.forkForOrg).toHaveBeenCalledWith('org-1', dto, 'user-1');
    expect(result).toEqual({ id: 'new-1' });
  });
});
