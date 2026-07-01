import { ForbiddenException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { AIProvidersController } from './ai-providers.controller';

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

describe('AIProvidersController authorization', () => {
  it('requires org admin role before reading AI settings', async () => {
    const service = { getProviderConfig: vi.fn() };
    const orgs = {
      assertOrgRole: vi.fn().mockRejectedValue(new ForbiddenException('Requires admin')),
    };
    const controller = new AIProvidersController(
      service as never,
      makeSupabase('user-1') as never,
      orgs as never,
    );

    await expect(controller.getSettings('org-1', makeRequest('token') as never)).rejects.toThrow(
      ForbiddenException,
    );

    expect(orgs.assertOrgRole).toHaveBeenCalledWith('org-1', 'user-1', 'admin');
    expect(service.getProviderConfig).not.toHaveBeenCalled();
  });

  it('allows org admins to list, create, and activate keys', async () => {
    const service = {
      listKeys: vi.fn().mockResolvedValue([]),
      createKey: vi.fn().mockResolvedValue({ id: 'k1', label: 'Prod' }),
      activateKey: vi.fn().mockResolvedValue(undefined),
    };
    const orgs = { assertOrgRole: vi.fn().mockResolvedValue(undefined) };
    const controller = new AIProvidersController(
      service as never,
      makeSupabase('admin-1') as never,
      orgs as never,
    );

    await expect(
      controller.createKey(
        'org-1',
        { label: 'Prod', provider: 'openai', apiKey: 'sk-test-key', model: 'gpt-5.5' },
        makeRequest('token') as never,
      ),
    ).resolves.toEqual({ id: 'k1', label: 'Prod' });

    await controller.activateKey('org-1', 'k1', makeRequest('token') as never);

    expect(orgs.assertOrgRole).toHaveBeenCalledWith('org-1', 'admin-1', 'admin');
    expect(service.createKey).toHaveBeenCalledWith(
      'org-1',
      { label: 'Prod', provider: 'openai', apiKey: 'sk-test-key', model: 'gpt-5.5' },
      'admin-1',
    );
    expect(service.activateKey).toHaveBeenCalledWith('org-1', 'k1');
  });

  it('treats anonymous AI key writes as unauthorized org access', async () => {
    const service = { createKey: vi.fn() };
    const orgs = {
      assertOrgRole: vi.fn().mockRejectedValue(new ForbiddenException('Not a member')),
    };
    const controller = new AIProvidersController(
      service as never,
      makeSupabase(null) as never,
      orgs as never,
    );

    await expect(
      controller.createKey(
        'org-1',
        { label: 'x', provider: 'anthropic', apiKey: 'sk-anthropic-test' },
        makeRequest() as never,
      ),
    ).rejects.toThrow(ForbiddenException);

    expect(orgs.assertOrgRole).toHaveBeenCalledWith('org-1', 'anonymous', 'admin');
    expect(service.createKey).not.toHaveBeenCalled();
  });
});
