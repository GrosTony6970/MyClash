import {
  propagation,
  trace,
  TraceFlags,
  type Context,
  type TextMapPropagator,
  type TextMapSetter,
  type Tracer,
  type TracerProvider,
} from '@opentelemetry/api';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AnthropicAdapter } from './anthropic.adapter';
import { anthropicMessagesRoute, recordFetch, type WireRecorder } from './wire-recorder.fixtures';

// Anthropic's SDK traces by itself from 0.134 on: it takes the GLOBAL tracer provider when a
// client is built, starts a span per call and injects trace headers through the global
// propagator. Ruling 193 keeps it silent. This file registers a provider and a propagator that
// would see both, and asserts neither is used. Its own file, so its globals touch no other test.
//
// `@opentelemetry/api` is a devDependency at ~1.9.1: the 2.10.0 OpenTelemetry SDK packages
// Sentry and Mistral resolve against cap their peer below 1.10.0, and a second copy of the API
// would hold its own globals, so the SDK would never see what this file registers.

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

const answer = {
  id: 'msg_trace_1',
  type: 'message',
  role: 'assistant',
  model: 'claude-opus-4-8',
  content: [{ type: 'text', text: 'ok' }],
  stop_reason: 'end_turn',
  stop_sequence: null,
  usage: { input_tokens: 1, output_tokens: 1 },
};

const startedSpans: string[] = [];

const tracer = {
  startSpan: (name: string) => {
    startedSpans.push(name);
    return trace.wrapSpanContext({
      traceId: '0af7651916cd43dd8448eb211c80319c',
      spanId: 'b7ad6b7169203331',
      traceFlags: TraceFlags.SAMPLED,
    });
  },
} as unknown as Tracer;

const provider: TracerProvider = { getTracer: () => tracer };

const propagator: TextMapPropagator = {
  inject: (_context: Context, carrier: unknown, setter: TextMapSetter) => {
    setter.set(carrier, 'traceparent', 'wire-probe');
  },
  extract: (context: Context) => context,
  fields: () => ['traceparent'],
};

let wire: WireRecorder;

beforeEach(() => {
  for (const name of SDK_ENV) vi.stubEnv(name, undefined);
  startedSpans.length = 0;
  expect(trace.setGlobalTracerProvider(provider)).toBe(true);
  expect(propagation.setGlobalPropagator(propagator)).toBe(true);
  wire = recordFetch({ 'POST /v1/messages': anthropicMessagesRoute(answer) });
  vi.stubGlobal('fetch', wire.fetch);
});

afterEach(() => {
  trace.disable();
  propagation.disable();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

it('starts no span and sends no trace header, even with a global tracer registered', async () => {
  await new AnthropicAdapter().generate('key-wire-marker', {
    system: 's',
    user: 'u',
    model: 'claude-opus-4-8',
    maxTokens: 10,
    temperature: 0,
  });

  expect(wire.unrouted).toEqual([]);
  expect(wire.requests).toHaveLength(1);
  const headers = wire.requests[0]?.headers ?? {};
  // A capture that recorded no header at all would pass the two checks below.
  expect(headers['anthropic-version']).toBeDefined();
  expect(headers['traceparent']).toBeUndefined();
  expect(headers['baggage']).toBeUndefined();
  expect(startedSpans).toEqual([]);
});
