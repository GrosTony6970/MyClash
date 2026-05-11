import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { AIUsageController } from './ai-usage.controller';

function makeSupabase(userId: string | null, eventResult: unknown) {
  const eventChain = {
    select: vi.fn(),
    eq: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue(eventResult),
  };
  eventChain.select.mockReturnValue(eventChain);
  eventChain.eq.mockReturnValue(eventChain);

  return {
    anon: {
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: userId ? { id: userId } : null } }),
      },
    },
    service: {
      from: vi.fn().mockReturnValue(eventChain),
    },
  };
}

function makeRequest(token?: string) {
  return { headers: {}, cookies: token ? { 'sb-access-token': token } : {} };
}

describe('AIUsageController authorization', () => {
  it('requires org admin role before returning event AI usage', async () => {
    const service = { getUsageSummary: vi.fn() };
    const orgs = {
      assertOrgRole: vi.fn().mockRejectedValue(new ForbiddenException('Requires admin')),
    };
    const supabase = makeSupabase('user-1', {
      data: { organization_id: 'org-1' },
      error: null,
    });
    const controller = new AIUsageController(service as never, supabase as never, orgs as never);

    await expect(controller.getUsage('event-1', makeRequest('token') as never)).rejects.toThrow(
      ForbiddenException,
    );

    expect(supabase.service.from).toHaveBeenCalledWith('events');
    expect(orgs.assertOrgRole).toHaveBeenCalledWith('org-1', 'user-1', 'admin');
    expect(service.getUsageSummary).not.toHaveBeenCalled();
  });

  it('allows org admins to read event AI usage', async () => {
    const summary = { totalSpendEur: 1.25, cap: 5, remainingEur: 3.75, callCount: 2 };
    const service = { getUsageSummary: vi.fn().mockResolvedValue(summary) };
    const orgs = { assertOrgRole: vi.fn().mockResolvedValue(undefined) };
    const supabase = makeSupabase('admin-1', {
      data: { organization_id: 'org-1' },
      error: null,
    });
    const controller = new AIUsageController(service as never, supabase as never, orgs as never);

    await expect(controller.getUsage('event-1', makeRequest('token') as never)).resolves.toEqual(
      summary,
    );

    expect(orgs.assertOrgRole).toHaveBeenCalledWith('org-1', 'admin-1', 'admin');
    expect(service.getUsageSummary).toHaveBeenCalledWith('event-1');
  });

  it('rejects usage reads when event cannot be resolved to an organization', async () => {
    const service = { getUsageSummary: vi.fn() };
    const orgs = { assertOrgRole: vi.fn() };
    const supabase = makeSupabase('admin-1', { data: null, error: null });
    const controller = new AIUsageController(service as never, supabase as never, orgs as never);

    await expect(controller.getUsage('event-1', makeRequest('token') as never)).rejects.toThrow(
      NotFoundException,
    );

    expect(orgs.assertOrgRole).not.toHaveBeenCalled();
    expect(service.getUsageSummary).not.toHaveBeenCalled();
  });
});
