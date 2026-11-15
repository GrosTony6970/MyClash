import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { GoogleAdapter } from './google.adapter';
import {
  recordFetch,
  type CannedResponse,
  type RecordedRequest,
  type WireRecorder,
} from './wire-recorder.fixtures';

// The REAL Gemini SDK (@google/genai) runs here, with `fetch` replaced by a recorder: these tests
// pin the request the SDK puts on the wire and the answer it parses, so an SDK bump that changes
// either reds here (operator ruling 785, 2026-11-15: a wire test before the bump). A plain,
// low-entropy key marker (the secret scan reads test files too).
const KEY = 'key-wire-marker';
const HOST = 'https://generativelanguage.googleapis.com';

// Every variable the SDK's main client (GoogleGenAI, the one the adapter builds) reads that could
// move the host, the API version or the credentials, or switch it to Vertex AI, so a developer's
// shell cannot change what these tests see: 2.32.0's eight, and GOOGLE_GENAI_API_VERSION, which
// 3.3.0's main client also reads. Both versions read GOOGLE_GENAI_API_KEY, _ACCESS_TOKEN,
// _USER_PROJECT and _API_VERSION in their generated agents and interactions clients too; the
// adapter never builds those.
const SDK_ENV = [
  'GOOGLE_GENAI_USE_VERTEXAI',
  'GOOGLE_GENAI_USE_ENTERPRISE',
  'GOOGLE_GENAI_API_VERSION',
  'GOOGLE_GEMINI_BASE_URL',
  'GOOGLE_VERTEX_BASE_URL',
  'GOOGLE_CLOUD_PROJECT',
  'GOOGLE_CLOUD_LOCATION',
  'GOOGLE_API_KEY',
  'GEMINI_API_KEY',
];

const answer = (parts: Record<string, unknown>[], finishReason: string): CannedResponse => ({
  body: {
    candidates: [{ content: { role: 'model', parts }, finishReason, index: 0 }],
    usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 7, totalTokenCount: 19 },
    modelVersion: 'gemini-3.8-flash',
  },
});

/** The adapter builds its client at two sites; each must reach the Gemini API's v1beta door. */
function expectGeminiDoor(request: RecordedRequest | undefined, path: string): void {
  const url = new URL(request?.url ?? 'missing:');
  expect(url.origin).toBe(HOST);
  expect(url.pathname).toBe(`/v1beta/${path}`);
  expect(request?.headers['x-goog-api-key']).toBe(KEY);
}

let wire: WireRecorder;

function useWire(routes: Parameters<typeof recordFetch>[0]): void {
  wire = recordFetch(routes);
  vi.stubGlobal('fetch', wire.fetch);
}

// The adapter imports the ESM-only SDK on its first call; it loads once here, not inside a
// test's time limit.
beforeAll(async () => {
  await import('@google/genai');
}, 60_000);

beforeEach(() => {
  for (const name of SDK_ENV) vi.stubEnv(name, undefined);
});

afterEach(() => {
  expect(wire.unrouted).toEqual([]);
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('GoogleAdapter on the wire', () => {
  it('sends a single-turn request and parses the answer', async () => {
    useWire({
      'POST /v1beta/models/gemini-3.8-flash:generateContent': () =>
        answer([{ text: 'Pool A has four fighters.' }], 'STOP'),
    });

    const result = await new GoogleAdapter().generate(KEY, {
      system: 'You answer questions about one tournament.',
      user: 'How many fighters are in Pool A?',
      model: 'gemini-3.8-flash',
      maxTokens: 256,
      temperature: 0.1,
    });

    expect(wire.requests).toHaveLength(1);
    const [request] = wire.requests;
    expect(request?.method).toBe('POST');
    expectGeminiDoor(request, 'models/gemini-3.8-flash:generateContent');
    expect(request?.body).toEqual({
      contents: [{ role: 'user', parts: [{ text: 'How many fighters are in Pool A?' }] }],
      systemInstruction: {
        role: 'user',
        parts: [{ text: 'You answer questions about one tournament.' }],
      },
      generationConfig: { maxOutputTokens: 256, temperature: 0.1 },
    });
    expect(result.text).toBe('Pool A has four fighters.');
    expect(result.stopReason).toBe('end_turn');
    expect([result.inputTokens, result.outputTokens]).toEqual([12, 7]);
  });

  it('sends no temperature for a model the registry says takes none', async () => {
    useWire({
      'POST /v1beta/models/gemini-4-carbon:generateContent': () =>
        answer([{ text: 'ok' }], 'MAX_TOKENS'),
    });

    const result = await new GoogleAdapter().generate(KEY, {
      system: 's',
      user: 'u',
      model: 'gemini-4-carbon',
      maxTokens: 10,
      temperature: 0.4,
    });

    expect((wire.requests[0]?.body as { generationConfig: unknown }).generationConfig).toEqual({
      maxOutputTokens: 10,
    });
    expect(result.stopReason).toBe('max_tokens');
  });

  it('sends a multi-turn transcript with tools and parses every tool call', async () => {
    useWire({
      'POST /v1beta/models/gemini-3.8-flash:generateContent': () =>
        answer(
          [
            { text: 'Looking it up.' },
            { functionCall: { name: 'list_pools', args: { tournamentId: 't1' } } },
            { functionCall: { name: 'list_referees', args: {} } },
          ],
          'STOP',
        ),
    });

    const result = await new GoogleAdapter().generate(KEY, {
      system: 'sys',
      model: 'gemini-3.8-flash',
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
      contents: [
        { role: 'user', parts: [{ text: 'set up pools' }] },
        { role: 'model', parts: [{ functionCall: { name: 'list_tournaments', args: {} } }] },
        {
          role: 'user',
          parts: [{ functionResponse: { name: 'list_tournaments', response: { result: [] } } }],
        },
      ],
      systemInstruction: { role: 'user', parts: [{ text: 'sys' }] },
      generationConfig: { maxOutputTokens: 100, temperature: 0.5 },
      tools: [
        {
          functionDeclarations: [
            {
              name: 'list_pools',
              description: 'List the pools',
              // The SDK, not the adapter, rewrites JSON Schema types into Gemini's enum.
              parameters: { type: 'OBJECT', properties: { tournamentId: { type: 'STRING' } } },
            },
          ],
        },
      ],
      toolConfig: { functionCallingConfig: { mode: 'ANY' } },
    });
    expect(result).toMatchObject({
      text: 'Looking it up.',
      toolCall: { name: 'list_pools', arguments: { tournamentId: 't1' } },
      toolCalls: [
        { id: 'call_0', name: 'list_pools', arguments: { tournamentId: 't1' } },
        { id: 'call_1', name: 'list_referees', arguments: {} },
      ],
      stopReason: 'tool_use',
      inputTokens: 12,
      outputTokens: 7,
    });
  });

  it('lists the models', async () => {
    useWire({
      'GET /v1beta/models': () => ({
        body: {
          models: [{ name: 'models/gemini-3.8-flash' }, { name: 'models/gemini-4-carbon' }],
        },
      }),
    });

    const ids = await new GoogleAdapter().listModels(KEY);

    expect(ids).toEqual(['gemini-3.8-flash', 'gemini-4-carbon']);
    expect(wire.requests).toHaveLength(1);
    expect(wire.requests[0]?.method).toBe('GET');
    expectGeminiDoor(wire.requests[0], 'models');
  });

  // A pin on the SDK, not on the adapter: Sentry receives this error's message, so a future SDK
  // that put the key in it, or retried a refused key, reds here.
  it('rejects a refused key once, without the key in the message', async () => {
    useWire({
      'POST /v1beta/models/gemini-3.8-flash:generateContent': () => ({
        status: 401,
        body: { error: { code: 401, message: 'API key not valid.', status: 'UNAUTHENTICATED' } },
      }),
    });

    const error = await new GoogleAdapter()
      .generate(KEY, {
        system: 's',
        user: 'u',
        model: 'gemini-3.8-flash',
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
