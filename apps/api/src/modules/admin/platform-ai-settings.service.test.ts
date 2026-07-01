import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PlatformAISettingsService } from './platform-ai-settings.service';
import { encryptAiKey } from '../ai-providers/ai-key-crypto';

// Adapters are constructed in onModuleInit — mock them so generate() never hits
// a real provider.
const mockGenerate = vi.fn();
vi.mock('../ai-providers/adapters/anthropic.adapter', () => ({
  AnthropicAdapter: vi.fn().mockImplementation(() => ({ generate: mockGenerate })),
}));
vi.mock('../ai-providers/adapters/openai.adapter', () => ({
  OpenAIAdapter: vi.fn().mockImplementation(() => ({ generate: mockGenerate })),
}));
vi.mock('../ai-providers/adapters/mistral.adapter', () => ({
  MistralAdapter: vi.fn().mockImplementation(() => ({ generate: mockGenerate })),
}));
vi.mock('../ai-providers/adapters/google.adapter', () => ({
  GoogleAdapter: vi.fn().mockImplementation(() => ({ generate: mockGenerate })),
}));

const fromMock = vi.fn();
const mockSupabase = { service: { from: fromMock } };
const mockFlags = { isEnabled: vi.fn().mockResolvedValue(false) };

const AI_KEY_SECRET = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const SECRET_BUF = Buffer.from(AI_KEY_SECRET, 'hex');

function chain(result: unknown) {
  const c: Record<string, unknown> = {};
  for (const m of [
    'select',
    'eq',
    'in',
    'gte',
    'order',
    'limit',
    'insert',
    'update',
    'upsert',
    'delete',
  ]) {
    c[m] = vi.fn(() => c);
  }
  c['single'] = vi.fn().mockResolvedValue(result);
  c['maybeSingle'] = vi.fn().mockResolvedValue(result);
  c['then'] = (resolve: (v: unknown) => unknown) => resolve(result);
  return c;
}

function activeKeyRow(rawKey: string, budget: number | null = null) {
  const { ciphertext, iv } = encryptAiKey(SECRET_BUF, rawKey);
  return {
    id: 'p1',
    provider: 'openai',
    model: null,
    api_key_enc: ciphertext,
    api_key_iv: iv,
    monthly_budget_eur: budget,
  };
}

function makeService() {
  const service = new PlatformAISettingsService(mockSupabase as never, mockFlags as never);
  service.onModuleInit();
  return service;
}

describe('PlatformAISettingsService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFlags.isEnabled.mockResolvedValue(false);
    process.env['AI_KEY_SECRET'] = AI_KEY_SECRET;
  });

  it('getConfig returns the global ceiling', async () => {
    fromMock.mockReturnValue(
      chain({ data: { monthly_budget_eur: 10, updated_at: '2026-05-11T00:00:00Z' }, error: null }),
    );
    await expect(makeService().getConfig()).resolves.toEqual({
      monthlyBudgetEur: 10,
      updatedAt: '2026-05-11T00:00:00Z',
    });
  });

  it('updateBudget upserts the config row', async () => {
    const upsert = vi.fn(() => chain({ data: null, error: null }));
    fromMock.mockReturnValue({ upsert });
    await makeService().updateBudget(25);
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ setting_key: 'super_admin', monthly_budget_eur: 25 }),
      { onConflict: 'setting_key' },
    );
  });

  it('getActiveKeyInfo returns the active key id + provider', async () => {
    fromMock.mockReturnValue(chain({ data: { id: 'p1', provider: 'anthropic' }, error: null }));
    await expect(makeService().getActiveKeyInfo()).resolves.toEqual({
      id: 'p1',
      provider: 'anthropic',
    });
  });

  it('generate resolves the active platform key and returns its keyId', async () => {
    fromMock.mockImplementation((table: string) =>
      table === 'platform_ai_keys'
        ? chain({ data: activeKeyRow('sk-super-admin'), error: null })
        : chain({ data: null, error: null }),
    );
    mockGenerate.mockResolvedValue({ text: 'ok', inputTokens: 1, outputTokens: 1, costEur: 0.01 });

    const result = await makeService().generate({
      system: 's',
      user: 'u',
      model: 'default',
      maxTokens: 10,
      temperature: 0,
    });
    expect(result.text).toBe('ok');
    expect(result.keyId).toBe('p1');
    expect(mockGenerate).toHaveBeenCalledWith(
      'sk-super-admin',
      expect.objectContaining({ user: 'u' }),
    );
  });

  it('generate blocks when the active key is over its per-key budget', async () => {
    fromMock.mockImplementation((table: string) => {
      if (table === 'platform_ai_keys')
        return chain({ data: activeKeyRow('sk-super-admin', 5), error: null });
      if (table === 'platform_ai_usage_log') return chain({ data: { sum: '9' }, error: null });
      return chain({ data: null, error: null });
    });
    await expect(
      makeService().generate({
        system: 's',
        user: 'u',
        model: 'default',
        maxTokens: 1,
        temperature: 0,
      }),
    ).rejects.toMatchObject({ status: 402 });
    expect(mockGenerate).not.toHaveBeenCalled();
  });
});
