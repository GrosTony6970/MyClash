import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { MistralAdapter } from './mistral.adapter';
import {
  recordFetch,
  unauthorizedRoute,
  type CannedResponse,
  type WireRecorder,
} from './wire-recorder.fixtures';

// The REAL Mistral SDK runs here, with `fetch` replaced by a recorder: these tests pin the
// request the SDK puts on the wire and the answer it parses. A plain, low-entropy key marker
// (the secret scan reads test files too).
const KEY = 'key-wire-marker';
const CHAT_URL = 'https://api.mistral.ai/v1/chat/completions';

// Every variable the SDK reads that could change the credentials or start its own telemetry
// exporter, so a developer's shell cannot change what these tests see.
const SDK_ENV = [
  'MISTRAL_API_KEY',
  'MISTRAL_DEBUG',
  'MISTRAL_SDK_TELEMETRY',
  'MISTRAL_OTLP_TRACES_ENDPOINT',
  'MISTRAL_SA_TOKEN_PATH',
];

const completion = (message: Record<string, unknown>, finishReason: string): CannedResponse => ({
  body: {
    id: 'cmpl_wire_1',
    object: 'chat.completion',
    model: 'mistral-medium-3.5',
    created: 1767225600,
    usage: { prompt_tokens: 12, completion_tokens: 7, total_tokens: 19 },
    choices: [
      { index: 0, message: { role: 'assistant', ...message }, finish_reason: finishReason },
    ],
  },
});

let wire: WireRecorder;

function useWire(routes: Parameters<typeof recordFetch>[0]): void {
  wire = recordFetch(routes);
  vi.stubGlobal('fetch', wire.fetch);
}

// The adapter imports the ESM-only SDK on its first call. Mistral 3 is ~1,600 modules (~2.3 s
// alone, past 5 s under the full suite's load), so it loads once here, not inside a test's limit.
beforeAll(async () => {
  await import('@mistralai/mistralai');
}, 60_000);

beforeEach(() => {
  for (const name of SDK_ENV) vi.stubEnv(name, undefined);
});

afterEach(() => {
  expect(wire.unrouted).toEqual([]);
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('MistralAdapter on the wire', () => {
  it('sends a single-turn request and parses the answer', async () => {
    useWire({
      'POST /v1/chat/completions': () =>
        completion({ content: 'Pool A has four fighters.' }, 'stop'),
    });

    const result = await new MistralAdapter().generate(KEY, {
      system: 'You answer questions about one tournament.',
      user: 'How many fighters are in Pool A?',
      model: 'mistral-medium-3.5',
      maxTokens: 256,
      temperature: 0.1,
    });

    expect(wire.requests).toHaveLength(1);
    const [request] = wire.requests;
    expect(request?.method).toBe('POST');
    expect(request?.url).toBe(CHAT_URL);
    expect(request?.headers['authorization']).toBe(`Bearer ${KEY}`);
    expect(request?.headers['user-agent']).toMatch(/^mistral-client-typescript\//);
    expect(request?.body).toEqual({
      model: 'mistral-medium-3.5',
      max_tokens: 256,
      temperature: 0.1,
      // `stream`, `prefix` and `index` are the SDK's own schema defaults, not ours.
      stream: false,
      messages: [
        { role: 'system', content: 'You answer questions about one tournament.' },
        { role: 'user', content: 'How many fighters are in Pool A?' },
      ],
    });
    expect(result.text).toBe('Pool A has four fighters.');
    expect(result.stopReason).toBe('end_turn');
    expect([result.inputTokens, result.outputTokens]).toEqual([12, 7]);
  });

  it('sends a multi-turn transcript with tools and parses every tool call', async () => {
    useWire({
      'POST /v1/chat/completions': () =>
        completion(
          {
            content: 'Looking it up.',
            tool_calls: [
              {
                id: 'call_1',
                type: 'function',
                function: { name: 'list_pools', arguments: '{"tournamentId":"t1"}' },
              },
              {
                id: 'call_2',
                type: 'function',
                function: { name: 'list_referees', arguments: '{}' },
              },
            ],
          },
          'tool_calls',
        ),
    });

    const result = await new MistralAdapter().generate(KEY, {
      system: 'sys',
      model: 'mistral-medium-3.5',
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
        {
          role: 'assistant',
          toolCalls: [{ id: 'call_0', name: 'list_tournaments', arguments: {} }],
        },
        { role: 'tool', toolResults: [{ toolCallId: 'call_0', content: '[]' }] },
      ],
    });

    expect(wire.requests[0]?.body).toEqual({
      model: 'mistral-medium-3.5',
      max_tokens: 100,
      temperature: 0.5,
      stream: false,
      messages: [
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'set up pools' },
        {
          role: 'assistant',
          content: '',
          prefix: false,
          tool_calls: [
            {
              id: 'call_0',
              type: 'function',
              function: { name: 'list_tournaments', arguments: '{}' },
              index: 0,
            },
          ],
        },
        { role: 'tool', tool_call_id: 'call_0', content: '[]' },
      ],
      tools: [
        {
          type: 'function',
          function: {
            name: 'list_pools',
            description: 'List the pools',
            parameters: { type: 'object', properties: { tournamentId: { type: 'string' } } },
          },
        },
      ],
      tool_choice: 'required',
    });
    expect(result).toMatchObject({
      text: 'Looking it up.',
      toolCall: { name: 'list_pools', arguments: { tournamentId: 't1' } },
      toolCalls: [
        { id: 'call_1', name: 'list_pools', arguments: { tournamentId: 't1' } },
        { id: 'call_2', name: 'list_referees', arguments: {} },
      ],
      stopReason: 'tool_use',
      inputTokens: 12,
      outputTokens: 7,
    });
  });

  it('lists the models', async () => {
    useWire({
      'GET /v1/models': () => ({
        body: {
          object: 'list',
          data: [
            { id: 'mistral-medium-3.5', type: 'base', capabilities: {} },
            { id: 'mistral-small-4', type: 'base', capabilities: {} },
          ],
        },
      }),
    });

    const ids = await new MistralAdapter().listModels(KEY);

    expect(ids).toEqual(['mistral-medium-3.5', 'mistral-small-4']);
    expect(wire.requests).toHaveLength(1);
    expect(wire.requests[0]?.headers['authorization']).toBe(`Bearer ${KEY}`);
  });

  // A pin on the SDK, not on the adapter: Sentry receives this error's message, so a future
  // SDK that put the key in it, or retried a refused key, reds here.
  it('rejects a refused key once, without the key in the message', async () => {
    useWire({ 'POST /v1/chat/completions': unauthorizedRoute });

    const error = await new MistralAdapter()
      .generate(KEY, {
        system: 's',
        user: 'u',
        model: 'mistral-medium-3.5',
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
