import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AnthropicAdapter } from './anthropic.adapter';
import {
  anthropicMessagesRoute,
  recordFetch,
  unauthorizedRoute,
  type WireRecorder,
} from './wire-recorder.fixtures';

// The REAL Anthropic SDK runs here, with `fetch` replaced by a recorder: these tests pin the
// request the SDK puts on the wire and the answer it parses. A plain, low-entropy key marker
// (the secret scan reads test files too).
const KEY = 'key-wire-marker';
const MESSAGES_URL = 'https://api.anthropic.com/v1/messages';

// Every variable either SDK version reads that could move the host, the headers or the
// tracing, so a developer's shell cannot change what these tests see.
const SDK_ENV = [
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_CUSTOM_HEADERS',
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_LOG',
  'ANTHROPIC_OPEN_TELEMETRY',
  'ANTHROPIC_OPEN_TELEMETRY_PROPAGATION',
  'ANTHROPIC_OPEN_TELEMETRY_TRACES_CONTENT_MODE',
  'ANTHROPIC_OPEN_TELEMETRY_TRACES_MAX_CONTENT_BYTES',
];

const textAnswer = {
  id: 'msg_wire_1',
  type: 'message',
  role: 'assistant',
  model: 'claude-haiku-4-5',
  content: [{ type: 'text', text: 'Pool A has four fighters.' }],
  stop_reason: 'end_turn',
  stop_sequence: null,
  usage: { input_tokens: 12, output_tokens: 7 },
};

const toolAnswer = {
  ...textAnswer,
  id: 'msg_wire_2',
  model: 'claude-sonnet-5',
  content: [
    { type: 'text', text: 'Looking it up.' },
    { type: 'tool_use', id: 'tu_1', name: 'list_pools', input: { tournamentId: 't1' } },
    { type: 'tool_use', id: 'tu_2', name: 'list_referees', input: {} },
  ],
  stop_reason: 'tool_use',
  usage: { input_tokens: 30, output_tokens: 12 },
};

const modelsPage = (ids: string[], hasMore: boolean) => ({
  data: ids.map((id) => ({
    type: 'model',
    id,
    display_name: id,
    created_at: '2026-01-01T00:00:00Z',
  })),
  has_more: hasMore,
  first_id: ids[0] ?? null,
  last_id: ids[ids.length - 1] ?? null,
});

let wire: WireRecorder;

function useWire(routes: Parameters<typeof recordFetch>[0]): void {
  wire = recordFetch(routes);
  vi.stubGlobal('fetch', wire.fetch);
}

beforeEach(() => {
  for (const name of SDK_ENV) vi.stubEnv(name, undefined);
});

afterEach(() => {
  expect(wire.unrouted).toEqual([]);
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('AnthropicAdapter on the wire', () => {
  it.each([
    ['Haiku 4.5, which took temperature before API 2026-10-21', 'claude-haiku-4-5'],
    ['a model id the registry does not know', 'claude-wire-unknown'],
  ])('sends a single-turn request for %s', async (_case, model) => {
    useWire({ 'POST /v1/messages': anthropicMessagesRoute(textAnswer) });

    const result = await new AnthropicAdapter().generate(KEY, {
      system: 'You answer questions about one tournament.',
      user: 'How many fighters are in Pool A?',
      model,
      maxTokens: 256,
      temperature: 0.1,
    });

    expect(wire.requests).toHaveLength(1);
    const [request] = wire.requests;
    expect(request?.method).toBe('POST');
    expect(request?.url).toBe(MESSAGES_URL);
    // SDK 1.x moved the key from `x-api-key` to a Bearer header and speaks API 2026-10-21,
    // which answers 400 to `temperature` on every model: none is sent, whatever
    // the caller asked for.
    expect(request?.headers['authorization']).toBe(`Bearer ${KEY}`);
    expect(request?.headers['x-api-key']).toBeUndefined();
    expect(request?.headers['anthropic-version']).toBe('2026-10-21');
    expect(request?.headers['x-stainless-package-version']).toMatch(/^1\./);
    expect(request?.body).toEqual({
      model,
      max_tokens: 256,
      system: 'You answer questions about one tournament.',
      messages: [{ role: 'user', content: 'How many fighters are in Pool A?' }],
    });
    expect(result.text).toBe('Pool A has four fighters.');
    expect(result.stopReason).toBe('end_turn');
    expect([result.inputTokens, result.outputTokens]).toEqual([12, 7]);
  });

  it('sends a multi-turn transcript with tools and parses every tool call', async () => {
    useWire({ 'POST /v1/messages': anthropicMessagesRoute(toolAnswer) });

    const result = await new AnthropicAdapter().generate(KEY, {
      system: 'sys',
      model: 'claude-sonnet-5',
      maxTokens: 100,
      temperature: 0.5,
      tools: [
        {
          name: 'list_pools',
          description: 'List the pools',
          parameters: { type: 'object', properties: { tournamentId: { type: 'string' } } },
        },
      ],
      toolChoice: 'required',
      messages: [
        { role: 'user', content: 'set up pools' },
        { role: 'assistant', toolCalls: [{ id: 'tu_0', name: 'list_tournaments', arguments: {} }] },
        { role: 'tool', toolResults: [{ toolCallId: 'tu_0', content: '[]', isError: true }] },
      ],
    });

    expect(wire.requests[0]?.body).toEqual({
      model: 'claude-sonnet-5',
      max_tokens: 100,
      system: 'sys',
      messages: [
        { role: 'user', content: 'set up pools' },
        {
          role: 'assistant',
          content: [{ type: 'tool_use', id: 'tu_0', name: 'list_tournaments', input: {} }],
        },
        {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: 'tu_0', content: '[]', is_error: true }],
        },
      ],
      tools: [
        {
          name: 'list_pools',
          description: 'List the pools',
          input_schema: { type: 'object', properties: { tournamentId: { type: 'string' } } },
        },
      ],
      tool_choice: { type: 'any' },
    });
    expect(result).toMatchObject({
      text: 'Looking it up.',
      toolCall: { name: 'list_pools', arguments: { tournamentId: 't1' } },
      toolCalls: [
        { id: 'tu_1', name: 'list_pools', arguments: { tournamentId: 't1' } },
        { id: 'tu_2', name: 'list_referees', arguments: {} },
      ],
      stopReason: 'tool_use',
      inputTokens: 30,
      outputTokens: 12,
    });
  });

  it('lists the models of every page', async () => {
    useWire({
      'GET /v1/models': (request) =>
        new URL(request.url).searchParams.get('after_id') === 'claude-b'
          ? { body: modelsPage(['claude-c'], false) }
          : { body: modelsPage(['claude-a', 'claude-b'], true) },
    });

    const ids = await new AnthropicAdapter().listModels(KEY);

    expect(ids).toEqual(['claude-a', 'claude-b', 'claude-c']);
    expect(wire.requests.map((r) => new URL(r.url).search)).toEqual(['', '?after_id=claude-b']);
    expect(wire.requests[0]?.headers['authorization']).toBe(`Bearer ${KEY}`);
    expect(wire.requests[0]?.headers['x-api-key']).toBeUndefined();
    expect(wire.requests[0]?.headers['anthropic-version']).toBe('2026-10-21');
    // A pin on the SDK, not on the adapter: 1.x newly sends its timeout on this request too.
    expect(wire.requests[0]?.headers['x-stainless-timeout']).toBeDefined();
  });

  // A pin on the SDK, not on the adapter: Sentry receives this error's message, so a future
  // SDK that put the key in it, or retried a refused key, reds here.
  it('rejects a refused key once, without the key in the message', async () => {
    useWire({ 'POST /v1/messages': unauthorizedRoute });

    const error = await new AnthropicAdapter()
      .generate(KEY, {
        system: 's',
        user: 'u',
        model: 'claude-opus-4-8',
        maxTokens: 10,
        temperature: 0,
      })
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('401');
    expect((error as Error).message).not.toContain(KEY);
    expect(wire.requests).toHaveLength(1);
  });
});
