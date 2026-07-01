import { describe, it, expect, vi } from 'vitest';
import { ModelSyncService } from './model-sync.service';
import { getModels } from '../ai-providers/model-registry';

describe('ModelSyncService', () => {
  it('diffs the registry against the live model list (new + retired)', async () => {
    const registered = getModels('anthropic').map((m) => m.id);
    // Provider drops the first registered model (retired) and offers one new one.
    const live = [...registered.slice(1), 'claude-brand-new'];
    const settings = {
      listLiveModels: vi.fn().mockResolvedValue({ provider: 'anthropic', live }),
    };
    const service = new ModelSyncService(settings as never);

    const report = await service.diff({});

    expect(report.provider).toBe('anthropic');
    expect(report.registered).toEqual(registered);
    expect(report.live).toEqual(live);
    expect(report.newAtProvider).toEqual(['claude-brand-new']);
    expect(report.missingAtProvider).toEqual([registered[0]]);
    // No overrides → uses the active platform key.
    expect(settings.listLiveModels).toHaveBeenCalledWith({});
  });

  it('reports no drift when the provider serves exactly the registry', async () => {
    const registered = getModels('google').map((m) => m.id);
    const settings = {
      listLiveModels: vi.fn().mockResolvedValue({ provider: 'google', live: [...registered] }),
    };
    const service = new ModelSyncService(settings as never);

    const report = await service.diff({});

    expect(report.newAtProvider).toEqual([]);
    expect(report.missingAtProvider).toEqual([]);
  });

  it('forwards provider + apiKey overrides to listLiveModels', async () => {
    const settings = {
      listLiveModels: vi.fn().mockResolvedValue({ provider: 'google', live: ['gemini-3.5-flash'] }),
    };
    const service = new ModelSyncService(settings as never);

    await service.diff({ providerOverride: 'google', apiKeyOverride: 'ai-key-123456' });

    expect(settings.listLiveModels).toHaveBeenCalledWith({
      providerOverride: 'google',
      apiKeyOverride: 'ai-key-123456',
    });
  });
});
