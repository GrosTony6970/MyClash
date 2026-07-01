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

  it('allows org admins to save and delete AI settings', async () => {
    const service = {
      saveKey: vi.fn().mockResolvedValue(undefined),
      getProviderConfig: vi.fn().mockResolvedValue({
        provider: 'openai',
        hasKey: true,
        updatedAt: '2026-05-11T00:00:00.000Z',
      }),
      deleteKey: vi.fn().mockResolvedValue(undefined),
    };
    const orgs = { assertOrgRole: vi.fn().mockResolvedValue(undefined) };
    const controller = new AIProvidersController(
      service as never,
      makeSupabase('admin-1') as never,
      orgs as never,
    );

    await expect(
      controller.saveSettings(
        'org-1',
        { provider: 'openai', apiKey: 'sk-test-key', model: 'gpt-4o' },
        makeRequest('token') as never,
      ),
    ).resolves.toEqual({
      provider: 'openai',
      hasKey: true,
      updatedAt: '2026-05-11T00:00:00.000Z',
    });
    await expect(controller.deleteSettings('org-1', makeRequest('token') as never)).resolves.toBe(
      undefined,
    );

    expect(orgs.assertOrgRole).toHaveBeenCalledTimes(2);
    expect(orgs.assertOrgRole).toHaveBeenNthCalledWith(1, 'org-1', 'admin-1', 'admin');
    expect(orgs.assertOrgRole).toHaveBeenNthCalledWith(2, 'org-1', 'admin-1', 'admin');
    expect(service.saveKey).toHaveBeenCalledWith('org-1', 'openai', 'sk-test-key', 'gpt-4o');
    expect(service.deleteKey).toHaveBeenCalledWith('org-1');
  });

  it('treats anonymous AI settings writes as unauthorized org access', async () => {
    const service = { saveKey: vi.fn(), getProviderConfig: vi.fn() };
    const orgs = {
      assertOrgRole: vi.fn().mockRejectedValue(new ForbiddenException('Not a member')),
    };
    const controller = new AIProvidersController(
      service as never,
      makeSupabase(null) as never,
      orgs as never,
    );

    await expect(
      controller.saveSettings(
        'org-1',
        { provider: 'anthropic', apiKey: 'sk-anthropic-test' },
        makeRequest() as never,
      ),
    ).rejects.toThrow(ForbiddenException);

    expect(orgs.assertOrgRole).toHaveBeenCalledWith('org-1', 'anonymous', 'admin');
    expect(service.saveKey).not.toHaveBeenCalled();
  });
});
