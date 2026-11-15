import type { LoggerService } from '@nestjs/common';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ALLOWED_ORIGIN, buildEdgeApp, rawRequest, type RawAnswer } from './testing/http-edge-app';

/**
 * What the API writes into its logs at its edge, on the app `configureHttpApp` builds: one
 * request-log line per request, '/' and paths outside /api/v1 included (ruling 797), none for a
 * CORS preflight or an address the router refuses (stated choices); no secret from an address
 * in any log line (rulings 801-805); no warning while it starts (ruling 779). The answers
 * themselves are pinned in `http-edge.http.test.ts`, whose case numbers these twins share.
 */

let app: NestFastifyApplication;
let base: string;
let port: number;

beforeAll(async () => {
  // As http-edge.http.test.ts: the multipart ceiling and the CORS allowlist are read when
  // configureHttpApp runs.
  vi.stubEnv('MULTIPART_MAX_BYTES', '1024');
  vi.stubEnv('DOMAIN', 'myclash.localhost');
  ({ app, base, port } = await buildEdgeApp({ authMode: 'shadow' }));
});

afterAll(async () => {
  await app?.close();
  vi.unstubAllEnvs();
});

function postJson(path: string, body: string): Promise<Response> {
  return fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
  });
}

/**
 * The request-log lines written while `send` runs, once at least `count` have arrived. A case that
 * expects no line for a request sends a control request after it and counts the control's line,
 * so "none" is read after the log had time to write.
 */
async function requestLogDuring(
  send: () => Promise<void>,
  count: number,
): Promise<Record<string, unknown>[]> {
  const lines: string[] = [];
  const write = vi
    .spyOn(process.stdout, 'write')
    .mockImplementation((chunk: string | Uint8Array) => {
      lines.push(String(chunk));
      return true;
    });
  const logged = () =>
    lines
      .filter((line) => line.includes('"http_request"'))
      .map((line) => JSON.parse(line) as Record<string, unknown>);
  try {
    await send();
    await vi.waitFor(() => expect(logged().length).toBeGreaterThanOrEqual(count));
  } finally {
    write.mockRestore();
  }
  return logged();
}

/** One GET line per target, in order, each under the status and id its answer carries. `paths`
 *  are the paths the lines name, when they differ from the targets sent. */
function oneLineEach(targets: string[], answers: RawAnswer[], paths = targets): unknown[] {
  return targets.map((_target, index) =>
    expect.objectContaining({
      method: 'GET',
      path: paths[index],
      statusCode: answers[index]?.status,
      requestId: answers[index]?.headers['x-request-id'],
    }),
  );
}

describe('the request log, as configureHttpApp writes it', () => {
  it('case 2, twin: an oversized body sent to "/" writes one request-log line, a 413', async () => {
    let res = new Response();
    const logged = await requestLogDuring(async () => {
      res = await postJson('/', JSON.stringify({ marker: 'x'.repeat(1_100_000) }));
      await res.text();
    }, 1);
    expect(res.status).toBe(413);
    expect(logged).toEqual([
      expect.objectContaining({
        method: 'POST',
        path: '/',
        statusCode: 413,
        requestId: res.headers.get('x-request-id'),
      }),
    ]);
  });

  // Each request below writes one line under the id it answers with: a 404 inside the prefix, a
  // percent-encoded letter the router decodes, and the bare prefix. No request id is sent, so a
  // second run of the log would show.
  it('case 4, twin: inside the prefix, each request writes one request-log line', async () => {
    const targets = ['/api/v1/probe-marker-missing', '/api/v1/edge/%70ublic', '/api/v1'];
    const answers: RawAnswer[] = [];
    const logged = await requestLogDuring(async () => {
      for (const target of targets) answers.push(await rawRequest(port, 'GET', target));
    }, targets.length);
    expect(answers.map((answer) => answer.status)).toEqual([404, 200, 404]);
    // A percent-encoded segment is logged as a marker: it can spell anything (rulings 801-805).
    const paths = ['/api/v1/probe-marker-missing', '/api/v1/edge/[encoded]', '/api/v1'];
    expect(logged).toEqual(oneLineEach(targets, answers, paths));
  });

  // The request log runs once per request, from one Fastify hook. A second run (a Nest middleware
  // mounted beside it, as the log was until 2026-11-15) would write a second line and overwrite
  // the answer's id with a new one. The probe sends no request id, so either would show.
  it('case 5, twin: /health writes one request-log line, under the id it answers with', async () => {
    let get = new Response();
    let post = new Response();
    const logged = await requestLogDuring(async () => {
      get = await fetch(`${base}/health`);
      await get.text();
      post = await fetch(`${base}/health`, { method: 'POST' });
      await post.text();
    }, 2);
    expect(post.status).toBe(404);
    expect(logged).toEqual([
      expect.objectContaining({
        method: 'GET',
        path: '/health',
        statusCode: 200,
        requestId: get.headers.get('x-request-id'),
      }),
      expect.objectContaining({
        method: 'POST',
        path: '/health',
        statusCode: 404,
        requestId: post.headers.get('x-request-id'),
      }),
    ]);
  });

  // Outside the prefix too: '/', a scanner's guess, another API version, a prefix look-alike and
  // a double slash. A Nest middleware could only mount under the prefix, so none of these had a
  // line before 2026-11-15.
  it('case 5b: outside the prefix, each request writes one request-log line', async () => {
    const targets = [
      '/',
      '/wp-login.php',
      '/api/v2/probe-marker',
      '/api/v1x',
      '//api/v1/edge/public',
    ];
    const answers: RawAnswer[] = [];
    const logged = await requestLogDuring(async () => {
      for (const target of targets) answers.push(await rawRequest(port, 'GET', target));
    }, targets.length);
    expect(answers.map((answer) => answer.status)).toEqual([404, 404, 404, 404, 404]);
    expect(logged).toEqual(oneLineEach(targets, answers));
  });

  // A stated choice (operator, 2026-11-15): a CORS preflight stays out of the request log.
  // Fastify's own log line records it.
  it('case 6, twin: a CORS preflight writes no request-log line', async () => {
    const logged = await requestLogDuring(async () => {
      await fetch(`${base}/api/v1/edge/echo`, {
        method: 'OPTIONS',
        headers: { origin: ALLOWED_ORIGIN, 'access-control-request-method': 'POST' },
      });
      await (await fetch(`${base}/api/v1/edge/public`)).text();
    }, 1);
    expect(logged).toEqual([expect.objectContaining({ path: '/api/v1/edge/public' })]);
  });

  // The router refuses the address before any hook runs, so the request log never sees it.
  // Fastify's own log line records it.
  it('case 12, twin: an address the router refuses writes no request-log line', async () => {
    const logged = await requestLogDuring(async () => {
      await rawRequest(port, 'GET', '/api/v1/edge/%E0%A4%A');
      await (await fetch(`${base}/api/v1/edge/public`)).text();
    }, 1);
    expect(logged).toEqual([expect.objectContaining({ path: '/api/v1/edge/public' })]);
  });
});

/** Nest's logger for one app: keeps every line, by level. */
function capturingLogger(): LoggerService & { lines: { level: string; text: string }[] } {
  const lines: { level: string; text: string }[] = [];
  const keep =
    (level: string) =>
    (message: unknown, ...rest: unknown[]): void => {
      lines.push({ level, text: [message, ...rest].map(String).join(' ') });
    };
  return {
    lines,
    log: keep('log'),
    error: keep('error'),
    warn: keep('warn'),
    debug: keep('debug'),
    verbose: keep('verbose'),
    fatal: keep('fatal'),
  };
}

describe('the logs, as main.ts writes them (rulings 801-805)', () => {
  // Fastify's own line goes through pino straight to fd 1, past a process.stdout.write spy, so the
  // app here hands Fastify a stream of its own; the request log is read off stdout.
  it('no secret from an address reaches a log line, whatever the spelling', async () => {
    const fastifyLines: string[] = [];
    const edge = await buildEdgeApp({
      authMode: 'shadow',
      fastifyLog: { write: (line) => void fastifyLines.push(line) },
    });
    const targets = [
      '/api/v1/edge/public?token=SECRETMARK',
      '/api/v1/event-passes/CODEMARK',
      '/api/v1/event%2Dpasses/CODEMARK',
      '/api/v1/%2565vent-passes/CODEMARK',
      '/api/v1/event-passes%2FCODEMARK',
      '/api/v1/%FF?token=SECRETMARK',
      '/api/v1/event-passes/CODEMARK%C0%AF?token=SECRETMARK',
      '/api/v1/event%2Dpasses/CODEMARK%FF?token=SECRETMARK',
      "/api/v1/a'b%FF?token=SECRETMARK",
    ];
    const requestLog = await requestLogDuring(async () => {
      for (const target of targets) await rawRequest(edge.port, 'GET', target);
      await rawRequest(edge.port, 'GET', '/api/v1/edge/public', {
        referer: 'https://app.myclash.localhost/me/claim-confirm?token=SECRETMARK',
      });
    }, 5).finally(() => edge.app.close());
    // Both logs were written: every request has Fastify's line, and the refused addresses
    // (four of the targets) have the error line that quotes them.
    const incoming = fastifyLines.filter((line) => line.includes('"incoming request"'));
    expect(incoming).toHaveLength(targets.length + 1);
    expect(fastifyLines.filter((line) => line.includes('FST_ERR_BAD_URL'))).toHaveLength(4);
    for (const line of [...fastifyLines, ...requestLog.map((entry) => JSON.stringify(entry))]) {
      expect(line).not.toContain('SECRETMARK');
      expect(line).not.toContain('CODEMARK');
    }
  });

  // Fastify routes an absolute-form target (`POST http://host/api/v1/…`) to the photo route, while
  // neither the target as sent nor its decoded form starts with /api/v1: only the route Fastify
  // matched names it (ruling 476: a QR photo's line names no one and carries no headers).
  it('a QR photo sent under any spelling is logged with no headers', async () => {
    let answer: RawAnswer | undefined;
    const logged = await requestLogDuring(async () => {
      answer = await rawRequest(port, 'POST', 'http://127.0.0.1/api/v1/events/e1/photos');
    }, 1);
    expect(answer?.status).toBe(200);
    expect(logged).toEqual([expect.objectContaining({ method: 'POST', statusCode: 200 })]);
    expect(logged[0]).not.toHaveProperty('headers');
  });
});

describe('the API start', () => {
  // A start-up warning is a change someone has to read; the CI start check fails on any. The
  // request log's old `forRoutes('*')` wrote one on every start (LegacyRouteConverter).
  it('case 18: a healthy start writes no warning and no error', async () => {
    const logger = capturingLogger();
    const started = await buildEdgeApp({ authMode: 'shadow', logger });
    await started.app.close();
    expect(logger.lines.length).toBeGreaterThan(0);
    expect(logger.lines.filter((line) => line.level !== 'log' && line.level !== 'debug')).toEqual(
      [],
    );
  });
});
