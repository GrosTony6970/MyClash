import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Anthropic mock ─────────────────────────────────────────────────────────
const mockCreate = vi.fn();
vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation(() => ({
    messages: { create: mockCreate },
  })),
}));

// ── OpenAI mock ────────────────────────────────────────────────────────────
const mockOpenAICreate = vi.fn();
vi.mock('openai', () => ({
  default: vi.fn().mockImplementation(() => ({
    chat: { completions: { create: mockOpenAICreate } },
  })),
}));

// ── Mistral mock ───────────────────────────────────────────────────────────
const mockMistralComplete = vi.fn();
vi.mock('@mistralai/mistralai', () => ({
  Mistral: vi.fn().mockImplementation(() => ({
    chat: { complete: mockMistralComplete },
  })),
}));

import { AnthropicAdapter } from './anthropic.adapter';
import { OpenAIAdapter } from './openai.adapter';
import { MistralAdapter } from './mistral.adapter';
import type { GenerationRequest } from './provider-adapter.interface';

const baseRequest: GenerationRequest = {
  system: 'You are helpful.',
  user: 'Hello',
  model: 'test-model',
  maxTokens: 100,
  temperature: 0.5,
};

// ── AnthropicAdapter ───────────────────────────────────────────────────────
describe('AnthropicAdapter', () => {
  let adapter: AnthropicAdapter;
  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new AnthropicAdapter();
  });

  it('returns text and token counts from a text response', async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: 'text', text: 'Hello back' }],
      usage: { input_tokens: 10, output_tokens: 5 },
      stop_reason: 'end_turn',
    });
    const result = await adapter.generate('key-123', baseRequest);
    expect(result.text).toBe('Hello back');
    expect(result.inputTokens).toBe(10);
    expect(result.outputTokens).toBe(5);
    expect(result.toolCall).toBeUndefined();
    expect(result.costEur).toBeGreaterThan(0);
  });

  it('extracts tool_use block as toolCall', async () => {
    mockCreate.mockResolvedValue({
      content: [
        { type: 'text', text: '' },
        { type: 'tool_use', name: 'search', input: { q: 'hello' } },
      ],
      usage: { input_tokens: 20, output_tokens: 8 },
      stop_reason: 'tool_use',
    });
    const result = await adapter.generate('key-123', {
      ...baseRequest,
      tools: [
        {
          name: 'search',
          description: 'Search',
          parameters: { type: 'object', properties: { q: { type: 'string' } } },
        },
      ],
      toolChoice: 'required',
    });
    expect(result.toolCall).toEqual({ name: 'search', arguments: { q: 'hello' } });
  });

  it('omits temperature for models that reject it (Opus 4.8)', async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: 'text', text: 'ok' }],
      usage: { input_tokens: 1, output_tokens: 1 },
      stop_reason: 'end_turn',
    });
    await adapter.generate('key-123', { ...baseRequest, model: 'claude-opus-4-8' });
    const arg = (mockCreate.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
    expect(arg).not.toHaveProperty('temperature');
    expect(arg['model']).toBe('claude-opus-4-8');
  });

  it('includes temperature for models that support it (Sonnet 4.6)', async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: 'text', text: 'ok' }],
      usage: { input_tokens: 1, output_tokens: 1 },
      stop_reason: 'end_turn',
    });
    await adapter.generate('key-123', {
      ...baseRequest,
      model: 'claude-sonnet-4-6',
      temperature: 0.3,
    });
    const arg = (mockCreate.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
    expect(arg['temperature']).toBe(0.3);
  });

  it('maps a multi-turn transcript and returns all tool calls + stopReason', async () => {
    mockCreate.mockResolvedValue({
      content: [
        { type: 'text', text: 'working' },
        { type: 'tool_use', id: 'tu_1', name: 'list_pools', input: { tournamentId: 't1' } },
        { type: 'tool_use', id: 'tu_2', name: 'list_referees', input: {} },
      ],
      usage: { input_tokens: 30, output_tokens: 12 },
      stop_reason: 'tool_use',
    });
    const result = await adapter.generate('key-123', {
      system: 'sys',
      model: 'claude-sonnet-4-6',
      maxTokens: 100,
      temperature: 0.5,
      tools: [{ name: 'list_pools', description: 'x', parameters: {} }],
      messages: [
        { role: 'user', content: 'set up pools' },
        { role: 'assistant', toolCalls: [{ id: 'tu_0', name: 'list_tournaments', arguments: {} }] },
        { role: 'tool', toolResults: [{ toolCallId: 'tu_0', content: '[]' }] },
      ],
    });
    expect(result.toolCalls).toHaveLength(2);
    expect(result.toolCalls?.[0]).toEqual({
      id: 'tu_1',
      name: 'list_pools',
      arguments: { tournamentId: 't1' },
    });
    expect(result.toolCall).toEqual({ name: 'list_pools', arguments: { tournamentId: 't1' } });
    expect(result.stopReason).toBe('tool_use');
    // The stored transcript was mapped (3 turns), not the single-turn user path.
    const arg = (mockCreate.mock.calls[0] as unknown[])[0] as { messages: unknown[] };
    expect(arg.messages).toHaveLength(3);
  });
});

// ── OpenAIAdapter ──────────────────────────────────────────────────────────
describe('OpenAIAdapter', () => {
  let adapter: OpenAIAdapter;
  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new OpenAIAdapter();
  });

  it('returns text and token counts from a text response', async () => {
    mockOpenAICreate.mockResolvedValue({
      choices: [{ message: { content: 'OpenAI reply', tool_calls: null }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 15, completion_tokens: 7 },
    });
    const result = await adapter.generate('key-oai', baseRequest);
    expect(result.text).toBe('OpenAI reply');
    expect(result.inputTokens).toBe(15);
    expect(result.outputTokens).toBe(7);
    expect(result.costEur).toBeGreaterThan(0);
  });

  it('extracts tool_calls as toolCall', async () => {
    mockOpenAICreate.mockResolvedValue({
      choices: [
        {
          message: {
            content: null,
            tool_calls: [{ function: { name: 'lookup', arguments: '{"id":"42"}' } }],
          },
          finish_reason: 'tool_calls',
        },
      ],
      usage: { prompt_tokens: 12, completion_tokens: 6 },
    });
    const result = await adapter.generate('key-oai', {
      ...baseRequest,
      tools: [{ name: 'lookup', description: 'Look up', parameters: {} }],
      toolChoice: 'required',
    });
    expect(result.toolCall).toEqual({ name: 'lookup', arguments: { id: '42' } });
  });
});

// ── MistralAdapter ─────────────────────────────────────────────────────────
describe('MistralAdapter', () => {
  let adapter: MistralAdapter;
  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new MistralAdapter();
  });

  it('returns text and token counts from a text response', async () => {
    mockMistralComplete.mockResolvedValue({
      choices: [{ message: { content: 'Mistral reply', toolCalls: null }, finishReason: 'stop' }],
      usage: { promptTokens: 11, completionTokens: 4 },
    });
    const result = await adapter.generate('key-mist', baseRequest);
    expect(result.text).toBe('Mistral reply');
    expect(result.inputTokens).toBe(11);
    expect(result.outputTokens).toBe(4);
    expect(result.costEur).toBeGreaterThan(0);
  });

  it('extracts toolCalls as toolCall', async () => {
    mockMistralComplete.mockResolvedValue({
      choices: [
        {
          message: {
            content: '',
            toolCalls: [{ function: { name: 'rank', arguments: '{"n":3}' } }],
          },
          finishReason: 'tool_calls',
        },
      ],
      usage: { promptTokens: 9, completionTokens: 5 },
    });
    const result = await adapter.generate('key-mist', {
      ...baseRequest,
      tools: [{ name: 'rank', description: 'Rank', parameters: {} }],
      toolChoice: 'auto',
    });
    expect(result.toolCall).toEqual({ name: 'rank', arguments: { n: 3 } });
  });
});
