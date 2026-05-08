import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AIProvidersService } from './ai-providers.service';

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

// ── Supabase mock ──────────────────────────────────────────────────────────
const fromMock = vi.fn();
const mockSupabase = { service: { from: fromMock } };

function makeChain(result: unknown) {
  const chain = {
    select: vi.fn(),
    eq: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    upsert: vi.fn(),
    delete: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue(result),
    single: vi.fn().mockResolvedValue(result),
  };
  chain.select.mockReturnValue(chain);
  chain.eq.mockReturnValue(chain);
  chain.insert.mockReturnValue(chain);
  chain.update.mockReturnValue(chain);
  chain.upsert.mockReturnValue(chain);
  chain.delete.mockReturnValue(chain);
  return chain;
}

const AI_KEY_SECRET = 'a'.repeat(64); // 32-byte hex (64 hex chars)

describe('AIProvidersService', () => {
  let service: AIProvidersService;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env['AI_KEY_SECRET'] = AI_KEY_SECRET;
    fromMock.mockReturnValue(makeChain({ data: null, error: null }));
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

  it('saveKey encrypts and upserts', async () => {
    const chain = makeChain({ data: { id: 'row-1' }, error: null });
    fromMock.mockReturnValue(chain);
    await service.saveKey('org-1', 'anthropic', 'sk-test-key');
    expect(chain.upsert).toHaveBeenCalledOnce();
    const upsertArg = (
      (chain.upsert as ReturnType<typeof vi.fn>).mock.calls[0] as unknown[]
    )[0] as Record<string, unknown>;
    expect(upsertArg['organization_id']).toBe('org-1');
    expect(upsertArg['provider']).toBe('anthropic');
    // Ciphertext must not contain the raw key
    expect(upsertArg['api_key_enc']).not.toContain('sk-test-key');
    // IV must be present
    expect(typeof upsertArg['api_key_iv']).toBe('string');
    expect((upsertArg['api_key_iv'] as string).length).toBeGreaterThan(0);
  });

  it('getProviderConfig returns null when no row', async () => {
    fromMock.mockReturnValue(makeChain({ data: null, error: null }));
    const result = await service.getProviderConfig('org-1');
    expect(result).toBeNull();
  });

  it('getProviderConfig returns { provider, hasKey } when row exists', async () => {
    fromMock.mockReturnValue(
      makeChain({
        data: { provider: 'openai', updated_at: '2026-01-01T00:00:00Z' },
        error: null,
      }),
    );
    const result = await service.getProviderConfig('org-1');
    expect(result).toEqual({ provider: 'openai', hasKey: true, updatedAt: '2026-01-01T00:00:00Z' });
  });

  it('deleteKey deletes the row', async () => {
    const chain = makeChain({ data: null, error: null });
    fromMock.mockReturnValue(chain);
    await service.deleteKey('org-1');
    expect(chain.delete).toHaveBeenCalled();
    expect(chain.eq).toHaveBeenCalledWith('organization_id', 'org-1');
  });

  it('generate decrypts key and calls adapter', async () => {
    const originalKey = 'sk-anthropic-secret-key';
    // First: save the key to get encrypted values
    let savedRow: Record<string, unknown> = {};
    const saveChain = makeChain({ data: { id: 'row-1' }, error: null });
    saveChain.upsert.mockImplementation((row: unknown) => {
      savedRow = row as Record<string, unknown>;
      return saveChain;
    });
    fromMock.mockReturnValue(saveChain);
    await service.saveKey('org-1', 'anthropic', originalKey);

    // Then: generate using the saved encrypted values
    const generateChain = makeChain({
      data: {
        provider: 'anthropic',
        api_key_enc: savedRow['api_key_enc'],
        api_key_iv: savedRow['api_key_iv'],
      },
      error: null,
    });
    fromMock.mockReturnValue(generateChain);
    mockGenerate.mockResolvedValue({ text: 'ok', inputTokens: 1, outputTokens: 1, costEur: 0.001 });

    const result = await service.generate('org-1', {
      system: 's',
      user: 'u',
      model: 'claude-3-5-sonnet-20241022',
      maxTokens: 10,
      temperature: 0,
    });
    expect(result.text).toBe('ok');
    // Verify generate was called with the original decrypted key
    expect(mockGenerate).toHaveBeenCalledWith(originalKey, expect.objectContaining({ user: 'u' }));
  });
});
