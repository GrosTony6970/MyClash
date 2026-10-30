import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { readFileSync } from 'node:fs';
import type { IncomingMessage, Server } from 'node:http';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { FILE_TOO_LARGE_CODE } from './read-upload';
import {
  ALLOWED_ORIGIN,
  buildEdgeApp,
  EDGE_CEILING_UPLOAD,
  EDGE_LARGE_UPLOAD,
  EDGE_REFUSED_NAME,
  EDGE_UPLOAD,
  rawRequest,
} from './testing/http-edge-app';

/**
 * How the API answers at its edge: broken and oversized bodies, unknown routes, the prefix and
 * its one exclusion, CORS, the request id, an unexpected failure, uploads.
 *
 * Built by `configureHttpApp` and `applyRequestLogging`, the functions production runs, so a
 * framework update that changes any of these answers turns this file red before it ships. The
 * guards, cookies and the read-only switch are in `http-edge.auth.http.test.ts`.
 *
 * The "case N" names number the edge answers across both files, so a commit that changes one can
 * name it. Case 11 is the one upload reader (`read-upload.ts`) on the real multipart plugin.
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

/** A multipart form: each entry a text field (string) or a file of that many bytes (number). */
function form(entries: Array<[string, string | number]>, filename = 'probe-marker.bin'): FormData {
  const body = new FormData();
  for (const [name, value] of entries) {
    if (typeof value === 'string') body.append(name, value);
    else body.append(name, new Blob([Buffer.alloc(value, 'x')]), filename);
  }
  return body;
}

function upload(bytes: number, route = 'upload'): Promise<Response> {
  return fetch(`${base}/api/v1/edge/${route}`, { method: 'POST', body: form([['file', bytes]]) });
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

  it('case 11: an upload over its route’s limit is that route’s 413, unreported; one under it arrives whole', async () => {
    const over = await upload(512);
    expect(over.status).toBe(413);
    expect(await over.json()).toMatchObject({
      code: FILE_TOO_LARGE_CODE,
      detail: EDGE_UPLOAD.tooLarge,
      details: { maxBytes: 256 },
    });
    expect(reporter).not.toHaveBeenCalled();
    const under = await upload(128);
    expect(under.status).toBe(200);
    expect(await under.json()).toEqual({ bytes: 128 });
  });

  it('case 11, ceiling: a route limit above the plugin’s ceiling stops at the ceiling', async () => {
    const over = await upload(2048, 'upload-ceiling');
    expect(over.status).toBe(413);
    expect(await over.json()).toMatchObject({
      code: FILE_TOO_LARGE_CODE,
      detail: EDGE_CEILING_UPLOAD.tooLarge,
      details: { maxBytes: 1024 },
    });
  });

  it('case 11, parts: twenty text fields before the file are a 413 in the plugin’s words', async () => {
    const fields = Array.from({ length: 20 }, (_, i): [string, string] => [`f${i}`, 'x']);
    const res = await fetch(`${base}/api/v1/edge/upload`, {
      method: 'POST',
      body: form([...fields, ['file', 16]]),
    });
    expect(res.status).toBe(413);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ code: 'FST_PARTS_LIMIT', detail: 'reach parts limit' });
    expect(body).not.toHaveProperty('details');
    expect(reporter).not.toHaveBeenCalled();
  });

  it('case 11, not multipart: a JSON body is no file, not a fault', async () => {
    const res = await postJson('/api/v1/edge/upload', '{"marker":"probe-marker-json"}');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ bytes: 0 });
    const parts = await postJson('/api/v1/edge/upload-parts', '{"marker":"probe-marker-json"}');
    expect(await parts.json()).toEqual({ bytes: null, fields: {} });
    expect(reporter).not.toHaveBeenCalled();
  });

  it('case 11, parts reader: the file and the text fields after it are read', async () => {
    const res = await fetch(`${base}/api/v1/edge/upload-parts`, {
      method: 'POST',
      body: form([
        ['file', 64],
        ['decisions', 'probe-marker-decisions'],
      ]),
    });
    expect(await res.json()).toEqual({
      bytes: 64,
      fields: { decisions: 'probe-marker-decisions' },
    });
  });

  it('case 11, parts reader: a second file is a 413; a file of another name is drained', async () => {
    const two = await fetch(`${base}/api/v1/edge/upload-parts`, {
      method: 'POST',
      body: form([
        ['file', 16],
        ['file', 16],
      ]),
    });
    expect(two.status).toBe(413);
    expect(await two.json()).toMatchObject({ code: 'FST_FILES_LIMIT' });
    // Left unread, the other file held the request open; the signal turns a hang into a red.
    const other = await fetch(`${base}/api/v1/edge/upload-parts`, {
      method: 'POST',
      body: form([
        ['other', 64],
        ['decisions', 'probe-marker-decisions'],
      ]),
      signal: AbortSignal.timeout(2000),
    });
    expect(await other.json()).toEqual({
      bytes: null,
      fields: { decisions: 'probe-marker-decisions' },
    });
  });

  it('case 11, accept: a file refused by its name is refused before it is read, and drained', async () => {
    // Its own app and ceiling, above the 2 MiB file: under every limit, only the drain empties it
    // (a file over its limit is cut and emptied by the plugin itself).
    const ceiling = process.env['MULTIPART_MAX_BYTES'];
    vi.stubEnv('MULTIPART_MAX_BYTES', String(EDGE_LARGE_UPLOAD.maxBytes));
    const own = await buildEdgeApp({ authMode: 'shadow' });
    const server = own.app.getHttpServer() as Server;
    // Drained = the request body read to its end. The 400 can leave before that: on Linux the
    // client is still sending when it lands, so the test waits for the end, not for close().
    const drained = new Promise((resolve) => {
      server.once('request', (req: IncomingMessage) => req.once('end', () => resolve('drained')));
    });
    try {
      const res = await fetch(`${own.base}/api/v1/edge/upload-json-only`, {
        method: 'POST',
        body: form([['file', 2 * 1024 * 1024]], 'probe-marker.exe'),
      });
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ detail: EDGE_REFUSED_NAME });
      const outcome = await Promise.race([
        drained,
        new Promise((resolve) => setTimeout(() => resolve('never read to its end'), 2000)),
      ]);
      expect(outcome).toBe('drained');
    } finally {
      vi.stubEnv('MULTIPART_MAX_BYTES', ceiling);
      server.closeAllConnections();
      await own.app.close();
    }
  });

  it('case 11, accept: a file part with no name is refused by its name, not a fault', async () => {
    // busboy takes an `application/octet-stream` part for a file even with no filename.
    const boundary = 'probe-marker-boundary';
    const res = await fetch(`${base}/api/v1/edge/upload-json-only`, {
      method: 'POST',
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      body:
        `--${boundary}\r\nContent-Disposition: form-data; name="file"\r\n` +
        `Content-Type: application/octet-stream\r\n\r\nprobe-marker\r\n--${boundary}--\r\n`,
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ detail: EDGE_REFUSED_NAME });
    expect(reporter).not.toHaveBeenCalled();
  });

  it('case 11, parts reader: a file over the limit is the route’s 413', async () => {
    const res = await fetch(`${base}/api/v1/edge/upload-parts`, {
      method: 'POST',
      body: form([
        ['file', 512],
        ['decisions', 'probe-marker-decisions'],
      ]),
    });
    expect(res.status).toBe(413);
    expect(await res.json()).toMatchObject({
      code: FILE_TOO_LARGE_CODE,
      detail: EDGE_UPLOAD.tooLarge,
      details: { maxBytes: 256 },
    });
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
    // The edge app registers both switches in this order (`testing/http-edge-app.ts`).
    expect(appModule).toMatch(
      /provide: APP_INTERCEPTOR,\s*useClass: LockdownInterceptor,\s*\},\s*\{\s*provide: APP_INTERCEPTOR,\s*useClass: ReadOnlyInterceptor,/,
    );
  });
});
