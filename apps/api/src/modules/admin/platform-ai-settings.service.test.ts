import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PlatformAISettingsService } from './platform-ai-settings.service';

const fromMock = vi.fn();

const mockSupabase = {
  service: { from: fromMock },
};

const mockFlags = {
  isEnabled: vi.fn().mockResolvedValue(false),
};

describe('PlatformAISettingsService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env['AI_KEY_SECRET'] =
      '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  });

  it('stores the shared super-admin key encrypted and never writes the raw key', async () => {
    const upsert = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({ data: { id: 'platform' }, error: null }),
      }),
    });
    fromMock.mockReturnValue({ upsert });
    const service = new PlatformAISettingsService(mockSupabase as never, mockFlags as never);
    service.onModuleInit();

    await service.saveKey('openai', 'sk-super-admin-secret', 'actor-1');

    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        setting_key: 'super_admin',
        provider: 'openai',
        updated_by_user_id: 'actor-1',
      }),
      { onConflict: 'setting_key' },
    );
    const saved = upsert.mock.calls[0]?.[0] as { api_key_enc: string; api_key_iv: string };
    expect(saved.api_key_enc).not.toContain('sk-super-admin-secret');
    expect(saved.api_key_iv).toBeTruthy();
  });

  it('returns metadata without exposing the raw key', async () => {
    fromMock.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: { provider: 'mistral', updated_at: '2026-05-11T00:00:00Z' },
        error: null,
      }),
    });
    const service = new PlatformAISettingsService(mockSupabase as never, mockFlags as never);
    service.onModuleInit();

    await expect(service.getProviderConfig()).resolves.toEqual({
      provider: 'mistral',
      hasKey: true,
      model: null,
      monthlyBudgetEur: null,
      updatedAt: '2026-05-11T00:00:00Z',
    });
  });
});
