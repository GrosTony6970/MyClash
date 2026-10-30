import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ALLOWED_ORIGIN, buildEdgeApp, rawRequest } from './testing/http-edge-app';

/**
 * How the API answers at its edge: broken and oversized bodies, unknown routes, the prefix and
 * its one exclusion, CORS, the request id, an unexpected failure, uploads.
 *
 * Built by `configureHttpApp` and `applyRequestLogging`, the functions production runs, so a
 * framework update that changes any of these answers turns this file red before it ships. The
 * guards, cookies and the read-only switch are in `http-edge.auth.http.test.ts`.
 *
 * The "case N" names number the edge answers across both files, so a commit that changes one can
 * name it. Case 11 pins today's answer, not a wanted one: an upload over the limit is a 500 that
 * reaches Sentry, where a 413 would be right.
 */

const PROBLEM_JSON = 'application/problem+json; charset=utf-8';
const reporter = vi.fn();
let app: NestFastifyApplication;
let base: string;
let port: number;

beforeAll(async () => {
  // Read when configureHttpApp registers the plugin: 1 KiB, far under multipart's own 1 MiB.
  vi.stubEnv('MULTIPART_MAX_BYTES', '1024');
  // The CORS allowlist is built from DOMAIN when configureHttpApp runs; ALLOWED_ORIGIN assumes this.
  vi.stubEnv('DOMAIN', 'myclash.localhost');
  ({ app, base, port } = await buildEdgeApp({ authMode: 'shadow', reportException: reporter }));
});

afterAll(async () => {
  await app?.close();
  vi.unstubAllEnvs();
});

beforeEach(() => {
  reporter.mockClear();
});

function postJson(path: string, body: string, contentType = 'application/json'): Promise<Response> {
  return fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': contentType },
    body,
  });
}

function upload(bytes: number): Promise<Response> {
  const form = new FormData();
  form.append('file', new Blob([Buffer.alloc(bytes, 'x')]), 'probe-marker.bin');
  return fetch(`${base}/api/v1/edge/upload`, { method: 'POST', body: form });
}

describe('the API edge, as configureHttpApp builds it', () => {
  it('case 1: a body that is not JSON is a 400 problem, in Fastify’s words', async () => {
    const res = await postJson('/api/v1/edge/echo', '{"marker":');
    expect(res.status).toBe(400);
    expect(res.headers.get('content-type')).toBe(PROBLEM_JSON);
    expect(await res.json()).toMatchObject({
      code: 'BAD_REQUEST',
      detail: "Body is not valid JSON but content-type is set to 'application/json'",
    });
  });

  it('case 2: a body over the 1 MiB default is a 413 problem', async () => {
    const res = await postJson(
      '/api/v1/edge/echo',
      JSON.stringify({ marker: 'x'.repeat(1_100_000) }),
    );
    expect(res.status).toBe(413);
    expect(res.headers.get('content-type')).toBe(PROBLEM_JSON);
    expect(await res.json()).toMatchObject({ code: 'HTTP_413' });
  });

  it.each([
    ['an empty object', '{}', 'application/json'],
    ['an array', '[]', 'application/json'],
    ['a bare number', '42', 'application/json'],
    ['plain text', 'probe-marker-text', 'text/plain'],
  ])('case 3: %s for a checked form is a 400 problem', async (_name, body, type) => {
    const res = await postJson('/api/v1/edge/echo', body, type);
    expect(res.status).toBe(400);
    expect(res.headers.get('content-type')).toBe(PROBLEM_JSON);
    expect(await res.json()).toMatchObject({ code: 'BAD_REQUEST', detail: 'Validation failed' });
  });

  it('case 3, twin: a valid form passes the check and reaches the route', async () => {
    const res = await postJson(
      '/api/v1/edge/echo',
      JSON.stringify({ marker: 'probe-marker-echo' }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ marker: 'probe-marker-echo' });
  });

  it('case 4: an unknown route is a 404 problem', async () => {
    const res = await fetch(`${base}/api/v1/probe-marker-missing`);
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toBe(PROBLEM_JSON);
    expect(await res.json()).toMatchObject({
      code: 'NOT_FOUND',
      detail: 'Cannot GET /api/v1/probe-marker-missing',
    });
  });

  it('case 5: /health answers without the prefix, and only in that spelling', async () => {
    const health = await fetch(`${base}/health`);
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ status: 'probe-marker-health' });
    for (const path of ['/api/v1/health', '/health/', '/HEALTH']) {
      expect((await fetch(`${base}${path}`)).status, path).toBe(404);
    }
  });

  it('case 6: a CORS preflight from an app is allowed; one from elsewhere is not', async () => {
    const preflight = (origin: string) =>
      fetch(`${base}/api/v1/edge/echo`, {
        method: 'OPTIONS',
        headers: {
          origin,
          'access-control-request-method': 'POST',
          'access-control-request-headers': 'content-type',
        },
      });
    const allowed = await preflight(ALLOWED_ORIGIN);
    expect(allowed.status).toBe(204);
    expect(allowed.headers.get('access-control-allow-origin')).toBe(ALLOWED_ORIGIN);
    expect(allowed.headers.get('access-control-allow-credentials')).toBe('true');
    // Since NestJS 12.3 (#18217, "run cors before nest middleware") the CORS plugin answers a
    // preflight before the request log runs, so the answer has no request id and the log no line.
    expect(allowed.headers.get('x-request-id')).toBeNull();
    const foreign = await preflight('https://probe-marker.example');
    expect(foreign.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('case 7: a request id sent is echoed, and one is made when none is sent', async () => {
    const sent = await fetch(`${base}/api/v1/edge/public`, {
      headers: { 'x-request-id': 'probe-marker-request-id' },
    });
    expect(sent.headers.get('x-request-id')).toBe('probe-marker-request-id');
    const made = await fetch(`${base}/api/v1/edge/public`);
    expect(made.headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('case 8: an unexpected failure is a 500 that says nothing, reported once', async () => {
    const res = await fetch(`${base}/api/v1/edge/boom`);
    expect(res.status).toBe(500);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ code: 'INTERNAL_SERVER_ERROR', detail: 'Internal server error' });
    expect(JSON.stringify(body)).not.toContain('probe-marker-boom');
    expect(reporter).toHaveBeenCalledTimes(1);
    expect(reporter.mock.calls[0]?.[1]).toMatchObject({ statusCode: 500 });
  });

  it('case 11: an upload over our limit is refused by that limit; one under it arrives whole', async () => {
    const over = await upload(4096);
    expect(over.status).toBe(500);
    expect(reporter).toHaveBeenCalledTimes(1);
    expect(reporter.mock.calls[0]?.[0]).toMatchObject({ code: 'FST_REQ_FILE_TOO_LARGE' });
    const under = await upload(512);
    expect(under.status).toBe(200);
    expect(await under.json()).toEqual({ bytes: 512 });
  });

  it('case 12: a URIError thrown by a route is an unexplained 500', async () => {
    const res = await fetch(`${base}/api/v1/edge/uri-error`);
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ code: 'INTERNAL_SERVER_ERROR' });
  });

  it('case 12: an address with a broken percent escape is refused by Fastify itself', async () => {
    const res = await rawRequest(port, 'GET', '/api/v1/edge/%E0%A4%A');
    expect(res.status).toBe(400);
    // NestJS 12's adapter sends Fastify's router errors through its frameworkErrors handler,
    // which adds the charset; status, code and message are Fastify's as before.
    expect(res.headers['content-type']).toBe('application/json; charset=utf-8');
    expect(JSON.parse(res.body)).toMatchObject({
      statusCode: 400,
      code: 'FST_ERR_BAD_URL',
      message: "'/api/v1/edge/%E0%A4%A' is not a valid url component",
    });
  });

  it('case 14: main.ts and AppModule call the functions this file runs', () => {
    const main = readFileSync(join(__dirname, '..', 'main.ts'), 'utf8');
    expect(main).toContain(
      'await configureHttpApp(app, { reportException: captureApiException });',
    );
    const appModule = readFileSync(join(__dirname, '..', 'app.module.ts'), 'utf8');
    expect(appModule).toContain('applyRequestLogging(consumer);');
  });
});
