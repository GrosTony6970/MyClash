import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AIProvidersService } from './ai-providers.service';
import { encryptAiKey } from './ai-key-crypto';

// ── Adapter mocks ──────────────────────────────────────────────────────────
const mockGenerate = vi.fn();
vi.mock('./adapters/anthropic.adapter', () => ({
  AnthropicAdapter: vi.fn().mockImplementation(() => ({ generate: mockGenerate })),
}));
vi.mock('./adapters/openai.adapter', () => ({
  OpenAIAdapter: vi.fn().mockImplementation(() => ({ generate: mockGenerate })),
}));
vi.mock('./adapters/mistral.adapter', () => ({
  MistralAdapter: vi.fn().mockImplementation(() => ({ generate: mockGenerate })),
}));
vi.mock('./adapters/google.adapter', () => ({
  GoogleAdapter: vi.fn().mockImplementation(() => ({ generate: mockGenerate })),
}));

// ── Supabase mock ──────────────────────────────────────────────────────────
const fromMock = vi.fn();
const mockSupabase = { service: { from: fromMock } };

/** Chainable + awaitable query mock resolving to `result`. */
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

const AI_KEY_SECRET = 'a'.repeat(64); // 32-byte hex (64 hex chars)
const SECRET_BUF = Buffer.from(AI_KEY_SECRET, 'hex');

function activeKeyRow(
  rawKey: string,
  opts: { id?: string; provider?: string; model?: string | null; budget?: number | null } = {},
) {
  const { ciphertext, iv } = encryptAiKey(SECRET_BUF, rawKey);
  return {
    id: opts.id ?? 'k1',
    provider: opts.provider ?? 'anthropic',
    model: opts.model ?? null,
    api_key_enc: ciphertext,
    api_key_iv: iv,
    monthly_budget_eur: opts.budget ?? null,
  };
}

describe('AIProvidersService', () => {
  let service: AIProvidersService;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env['AI_KEY_SECRET'] = AI_KEY_SECRET;
    fromMock.mockReturnValue(chain({ data: null, error: null }));
    service = new AIProvidersService(mockSupabase as never);
    service.onModuleInit();
  });

  it('throws if AI_KEY_SECRET is not set', () => {
    delete process.env['AI_KEY_SECRET'];
    const s = new AIProvidersService(mockSupabase as never);
    expect(() => s.onModuleInit()).toThrow('AI_KEY_SECRET env var is required');
  });

  it('throws if AI_KEY_SECRET is wrong length', () => {
    process.env['AI_KEY_SECRET'] = 'tooshort';
    const s = new AIProvidersService(mockSupabase as never);
    expect(() => s.onModuleInit()).toThrow();
  });

  it('generate resolves the active org key, decrypts it, and calls the adapter', async () => {
    const originalKey = 'sk-anthropic-secret-key';
    fromMock.mockImplementation((table: string) =>
      table === 'organization_ai_keys'
        ? chain({ data: activeKeyRow(originalKey), error: null })
        : chain({ data: null, error: null }),
    );
    mockGenerate.mockResolvedValue({ text: 'ok', inputTokens: 1, outputTokens: 1, costEur: 0.001 });

    const result = await service.generate('org-1', {
      system: 's',
      user: 'u',
      model: 'default',
      maxTokens: 10,
      temperature: 0,
    });

    expect(result.text).toBe('ok');
    expect(result.keyId).toBe('k1');
    expect(result.provider).toBe('anthropic');
    // decrypted key + provider default model (no stored model)
    expect(mockGenerate).toHaveBeenCalledWith(
      originalKey,
      expect.objectContaining({ model: 'claude-opus-4-8', user: 'u' }),
    );
  });

  it('generate honors the stored model for the "default" sentinel', async () => {
    fromMock.mockImplementation((table: string) =>
      table === 'organization_ai_keys'
        ? chain({ data: activeKeyRow('sk-key', { model: 'claude-sonnet-5' }), error: null })
        : chain({ data: null, error: null }),
    );
    mockGenerate.mockResolvedValue({ text: 'ok', inputTokens: 1, outputTokens: 1, costEur: 0 });

    await service.generate('org-1', {
      system: 's',
      user: 'u',
      model: 'default',
      maxTokens: 10,
      temperature: 0,
    });
    expect(mockGenerate).toHaveBeenCalledWith(
      'sk-key',
      expect.objectContaining({ model: 'claude-sonnet-5' }),
    );
  });

  it('generate throws when no active org key is configured', async () => {
    fromMock.mockReturnValue(chain({ data: null, error: null }));
    await expect(
      service.generate('org-1', {
        system: 's',
        user: 'u',
        model: 'default',
        maxTokens: 1,
        temperature: 0,
      }),
    ).rejects.toThrow(/No AI provider configured/);
  });

  it('generate blocks when the active key is over its per-key budget', async () => {
    fromMock.mockImplementation((table: string) => {
      if (table === 'organization_ai_keys')
        return chain({ data: activeKeyRow('sk-key', { budget: 5 }), error: null });
      if (table === 'ai_usage_log') return chain({ data: { sum: '10' }, error: null });
      return chain({ data: null, error: null });
    });
    await expect(
      service.generate('org-1', {
        system: 's',
        user: 'u',
        model: 'default',
        maxTokens: 1,
        temperature: 0,
      }),
    ).rejects.toMatchObject({ status: 402 });
    expect(mockGenerate).not.toHaveBeenCalled();
  });

  it('getProviderConfig returns null when no config row and no active key', async () => {
    fromMock.mockReturnValue(chain({ data: null, error: null }));
    expect(await service.getProviderConfig('org-1')).toBeNull();
  });

  it('getProviderConfig returns ceiling + flags + hasKey when configured', async () => {
    fromMock.mockImplementation((table: string) => {
      if (table === 'organization_ai_settings')
        return chain({
          data: {
            monthly_budget_eur: 12,
            ai_features_disabled: false,
            organizer_chat_disabled: true,
            updated_at: '2026-01-01T00:00:00Z',
          },
          error: null,
        });
      if (table === 'organization_ai_keys') return chain({ data: { id: 'k1' }, error: null });
      return chain({ data: null, error: null });
    });
    expect(await service.getProviderConfig('org-1')).toEqual({
      hasKey: true,
      monthlyBudgetEur: 12,
      aiFeaturesDisabled: false,
      organizerChatDisabled: true,
      updatedAt: '2026-01-01T00:00:00Z',
    });
  });

  it('generateForFighter runs on the fighter key and meters usage', async () => {
    const insertSpy = vi.fn(() => chain({ data: null, error: null }));
    fromMock.mockImplementation((table: string) => {
      if (table === 'fighter_ai_keys')
        return chain({ data: activeKeyRow('sk-fighter', { id: 'fk1' }), error: null });
      if (table === 'fighter_ai_usage_log') {
        const c = chain({ data: null, error: null });
        c['insert'] = insertSpy;
        return c;
      }
      return chain({ data: null, error: null });
    });
    mockGenerate.mockResolvedValue({
      text: 'insight',
      inputTokens: 2,
      outputTokens: 3,
      costEur: 0.02,
    });

    const result = await service.generateForFighter(
      'gp-1',
      { system: 's', user: 'u', model: 'default', maxTokens: 10, temperature: 0 },
      'fighter_insight',
    );

    expect(result.text).toBe('insight');
    expect(result.keyId).toBe('fk1');
    expect(insertSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        fighter_ai_key_id: 'fk1',
        global_person_id: 'gp-1',
        feature: 'fighter_insight',
        cost_eur: 0.02,
      }),
    );
  });
});
