import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OpenAIAdapter } from './openai.adapter';
import {
  recordFetch,
  unauthorizedRoute,
  type CannedResponse,
  type WireRecorder,
} from './wire-recorder.fixtures';

// The REAL OpenAI SDK runs here, with `fetch` replaced by a recorder: these tests pin the request
// the SDK puts on the wire and the answer it parses, so an SDK bump that changes either reds here
// (operator ruling 785, 2026-11-15: a wire test before the bump). A plain, low-entropy key marker
// (the secret scan reads test files too).
const KEY = 'key-wire-marker';
const CHAT_URL = 'https://api.openai.com/v1/chat/completions';

// Every variable the SDK's client reads that could move the host, the credentials, the headers
// or the logging, so a developer's shell cannot change what these tests see.
const SDK_ENV = [
  'OPENAI_BASE_URL',
  'OPENAI_API_KEY',
  'OPENAI_ADMIN_KEY',
  'OPENAI_ORG_ID',
  'OPENAI_PROJECT_ID',
  'OPENAI_WEBHOOK_SECRET',
  'OPENAI_LOG',
  'OPENAI_CUSTOM_HEADERS',
];

const completion = (message: Record<string, unknown>, finishReason: string): CannedResponse => ({
  body: {
    id: 'chatcmpl_wire_1',
    object: 'chat.completion',
    model: 'gpt-6.1-sol',
    created: 1767225600,
    usage: { prompt_tokens: 12, completion_tokens: 7, total_tokens: 19 },
    choices: [
      {
        index: 0,
        message: { role: 'assistant', refusal: null, ...message },
        finish_reason: finishReason,
        logprobs: null,
      },
    ],
  },
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

describe('OpenAIAdapter on the wire', () => {
  it('sends a single-turn request and parses the answer', async () => {
    useWire({
      'POST /v1/chat/completions': () =>
        completion({ content: 'Pool A has four fighters.' }, 'stop'),
    });

    const result = await new OpenAIAdapter().generate(KEY, {
      system: 'You answer questions about one tournament.',
      user: 'How many fighters are in Pool A?',
      model: 'gpt-6.1-sol',
      maxTokens: 256,
      temperature: 0.1,
    });

    expect(wire.requests).toHaveLength(1);
    const [request] = wire.requests;
    expect(request?.method).toBe('POST');
    expect(request?.url).toBe(CHAT_URL);
    expect(request?.headers['authorization']).toBe(`Bearer ${KEY}`);
    expect(request?.headers['user-agent']).toMatch(/^OpenAI\/JS /);
    // The registry says gpt-6.1-sol takes no temperature, so none is sent.
    expect(request?.body).toEqual({
      model: 'gpt-6.1-sol',
      max_tokens: 256,
      messages: [
        { role: 'system', content: 'You answer questions about one tournament.' },
        { role: 'user', content: 'How many fighters are in Pool A?' },
      ],
    });
    expect(result.text).toBe('Pool A has four fighters.');
    expect(result.stopReason).toBe('end_turn');
    expect([result.inputTokens, result.outputTokens]).toEqual([12, 7]);
  });

  it('sends the temperature for a model the registry does not know', async () => {
    useWire({ 'POST /v1/chat/completions': () => completion({ content: 'ok' }, 'length') });

    const result = await new OpenAIAdapter().generate(KEY, {
      system: 's',
      user: 'u',
      model: 'gpt-wire-unknown',
      maxTokens: 10,
      temperature: 0.4,
    });

    expect(wire.requests[0]?.body).toMatchObject({ model: 'gpt-wire-unknown', temperature: 0.4 });
    expect(result.stopReason).toBe('max_tokens');
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

    const result = await new OpenAIAdapter().generate(KEY, {
      system: 'sys',
      model: 'gpt-6.1-sol',
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
      model: 'gpt-6.1-sol',
      max_tokens: 100,
      messages: [
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'set up pools' },
        {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: 'call_0',
              type: 'function',
              function: { name: 'list_tournaments', arguments: '{}' },
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
            { id: 'gpt-6.1-sol', object: 'model', created: 1767225600, owned_by: 'openai' },
            { id: 'gpt-6-luna', object: 'model', created: 1767225600, owned_by: 'openai' },
          ],
        },
      }),
    });

    const ids = await new OpenAIAdapter().listModels(KEY);

    expect(ids).toEqual(['gpt-6.1-sol', 'gpt-6-luna']);
    expect(wire.requests).toHaveLength(1);
    expect(wire.requests[0]?.url).toBe('https://api.openai.com/v1/models');
    expect(wire.requests[0]?.headers['authorization']).toBe(`Bearer ${KEY}`);
  });

  // A pin on the SDK, not on the adapter: Sentry receives this error's message, so a future SDK
  // that put the key in it, or retried a refused key, reds here.
  it('rejects a refused key once, without the key in the message', async () => {
    useWire({ 'POST /v1/chat/completions': unauthorizedRoute });

    const error = await new OpenAIAdapter()
      .generate(KEY, {
        system: 's',
        user: 'u',
        model: 'gpt-6.1-sol',
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
