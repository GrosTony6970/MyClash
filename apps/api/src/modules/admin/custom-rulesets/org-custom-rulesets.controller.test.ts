import { UnauthorizedException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { OrgCustomRulesetsController } from './org-custom-rulesets.controller';

function makeSupabase(userId: string | null) {
  return { getAuthUser: vi.fn().mockResolvedValue(userId ? { id: userId } : null) };
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
      // What the real check answers a signed-out caller (ruling 154).
      assertOrgRole: vi
        .fn()
        .mockRejectedValue(new UnauthorizedException('Authentication required')),
    };
    const supabase = makeSupabase(null);
    const controller = new OrgCustomRulesetsController(
      service as never,
      orgs as never,
      supabase as never,
    );

    await expect(controller.list('org-1', makeRequest() as never)).rejects.toThrow(
      UnauthorizedException,
    );

    expect(orgs.assertOrgRole).toHaveBeenCalledWith('org-1', 'anonymous', 'admin');
    expect(service.listForOrg).not.toHaveBeenCalled();
  });
});
