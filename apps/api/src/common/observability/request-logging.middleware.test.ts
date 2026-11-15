import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { RequestLoggingMiddleware, type RequestLogEvent } from './request-logging.middleware';
import { REDACTED } from './redaction';

class FakeResponse extends EventEmitter {
  statusCode = 200;
  headers = new Map<string, string>();

  setHeader(name: string, value: string): void {
    this.headers.set(name, value);
  }
}

describe('RequestLoggingMiddleware', () => {
  it('emits route, request id, status, duration, and redacted headers', () => {
    const events: RequestLogEvent[] = [];
    const response = new FakeResponse();
    const middleware = new RequestLoggingMiddleware((event) => events.push(event));

    middleware.use(
      {
        method: 'GET',
        url: '/api/v1/events/e1',
        headers: {
          authorization: 'Bearer secret',
          'x-request-id': 'req-1',
        },
        identity: { kind: 'claimed', userId: 'user-1', email: null },
      },
      response,
      vi.fn(),
    );
    response.emit('finish');

    expect(response.headers.get('x-request-id')).toBe('req-1');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      level: 'info',
      service: 'myclash-api',
      event: 'http_request',
      requestId: 'req-1',
      method: 'GET',
      path: '/api/v1/events/e1',
      statusCode: 200,
      actorId: 'claimed:user-1',
      sensitiveRoute: false,
      headers: {
        authorization: REDACTED,
        'x-request-id': 'req-1',
      },
    });
    expect(events[0]?.durationMs).toEqual(expect.any(Number));
  });

  it('does not log headers or request bodies for sensitive routes', () => {
    const events: RequestLogEvent[] = [];
    const response = new FakeResponse();
    const middleware = new RequestLoggingMiddleware((event) => events.push(event));

    middleware.use(
      {
        method: 'POST',
        url: '/api/v1/tournaments/t1/query',
        headers: { cookie: 'sb-access-token=secret' },
      },
      response,
      vi.fn(),
    );
    response.emit('finish');

    expect(events[0]).toMatchObject({
      path: '/api/v1/tournaments/t1/query',
      sensitiveRoute: true,
    });
    expect(events[0]).not.toHaveProperty('headers');
    expect(events[0]).not.toHaveProperty('body');
  });
});

describe('a photo sent from the QR code (ruling 476)', () => {
  const EVENT = '11111111-1111-4111-8111-111111111111';
  const PHOTO = '22222222-2222-4222-8222-222222222222';

  /** One request by a signed-in phone, with the address a proxy adds. */
  function logOf(method: string, url: string): RequestLogEvent | undefined {
    const events: RequestLogEvent[] = [];
    const response = new FakeResponse();
    new RequestLoggingMiddleware((event) => events.push(event)).use(
      {
        method,
        url,
        headers: { 'x-forwarded-for': '203.0.113.7', 'user-agent': 'phone' },
        identity: { kind: 'claimed', userId: 'user-1', email: null },
      },
      response,
      vi.fn(),
    );
    response.emit('finish');
    return events[0];
  }

  it.each([
    `/api/v1/events/${EVENT}/photos`,
    `/api/v1/events/${EVENT}/photos?x=1`,
    `/api/v1/events/${EVENT}/photos/${PHOTO}/report`,
    `/api/v1/events/${EVENT}/photos/${PHOTO}/report?x=1`,
  ])('POST %s logs no account and no headers', (url) => {
    const event = logOf('POST', url);
    // The query never reaches the log (rulings 801-802).
    expect(event).toMatchObject({ method: 'POST', path: url.split('?')[0], statusCode: 200 });
    expect(event).not.toHaveProperty('actorId');
    expect(event).not.toHaveProperty('headers');
  });

  it.each([
    ['POST', `/api/v1/me/events/${EVENT}/photos`],
    ['GET', `/api/v1/events/${EVENT}/photos/public`],
    ['GET', `/api/v1/events/${EVENT}/photos`],
    ['DELETE', `/api/v1/events/${EVENT}/photos/${PHOTO}`],
    ['POST', `/api/v1/events/${EVENT}/photos/${PHOTO}/approve`],
  ])('%s %s still logs who and the headers', (method, url) => {
    const event = logOf(method, url);
    expect(event).toMatchObject({
      actorId: 'claimed:user-1',
      headers: { 'x-forwarded-for': '203.0.113.7' },
    });
  });

  // The router decodes the path before it matches, so a spelling the anchored pattern misses
  // still reaches the photo handler; so does the absolute form, which the route pattern names.
  it.each([
    [`/api/v1/events/${EVENT}/ph%6Ftos`, undefined],
    [`/api/v1/%65vents/${EVENT}/photos`, undefined],
    [`http://h/api/v1/events/${EVENT}/photos`, '/api/v1/events/:eventId/photos'],
    ['/api/v1/events/%E0%A4%A/photos', undefined],
  ])('POST %s logs no account and no headers either', (url, route) => {
    const events: RequestLogEvent[] = [];
    const response = new FakeResponse();
    new RequestLoggingMiddleware((event) => events.push(event)).use(
      {
        method: 'POST',
        url,
        headers: { 'x-forwarded-for': '203.0.113.7' },
        identity: { kind: 'claimed', userId: 'user-1', email: null },
      },
      response,
      vi.fn(),
      route,
    );
    response.emit('finish');
    expect(events[0]).not.toHaveProperty('actorId');
    expect(events[0]).not.toHaveProperty('headers');
  });
});

/** One GET with a proxy's address and the given headers; its line. */
function lineOf(
  url: string,
  headers: Record<string, string> = {},
  route?: string,
): RequestLogEvent | undefined {
  const events: RequestLogEvent[] = [];
  const response = new FakeResponse();
  new RequestLoggingMiddleware((event) => events.push(event)).use(
    { method: 'GET', url, headers: { 'x-forwarded-for': '203.0.113.7', ...headers } },
    response,
    vi.fn(),
    route,
  );
  response.emit('finish');
  return events[0];
}

describe('a secret in an address (rulings 801-805)', () => {
  it.each([
    [
      '/api/v1/persons/me/email-change/confirm?token=SECRET',
      '/api/v1/persons/me/email-change/confirm',
    ],
    ['/api/v1/auth/callback?type=login&token_hash=SECRET', '/api/v1/auth/callback'],
    ['/api/v1/events/e1#SECRET', '/api/v1/events/e1'],
    ['/api/v1/event-passes/SECRET', '/api/v1/event-passes/[token]'],
    ['/api/v1/event%2Dpasses/SECRET', '/api/v1/[encoded]'],
    ['/api/v1/%2565vent-passes/SECRET', '/api/v1/[encoded]'],
    ['/api/v1/event-passes%2FSECRET', '/api/v1/[encoded]'],
  ])('%s is logged as %s', (url, path) => {
    const line = lineOf(url);
    expect(line?.path).toBe(path);
    expect(JSON.stringify(line)).not.toContain('SECRET');
  });

  it("a page's address sent as the Referer is logged without its query", () => {
    const line = lineOf('/api/v1/me/claim-confirm', {
      referer: 'https://app.myclash.localhost/me/claim-confirm?token=SECRET#SECRET',
    });
    expect(line?.headers?.['referer']).toBe('https://app.myclash.localhost/me/claim-confirm');
    expect(JSON.stringify(line)).not.toContain('SECRET');
  });

  it.each([
    ['/api/v1/%61uth/callback', undefined],
    ['/api/v1/%2561uth/callback', undefined],
    ['/api/v1/x/%E0%A4%A', undefined],
    ['/api/v1/me/x', '/api/v1/auth/:anything'],
  ])('%s counts as a sensitive route: no headers', (url, route) => {
    const line = lineOf(url, {}, route);
    expect(line).toMatchObject({ sensitiveRoute: true });
    expect(line).not.toHaveProperty('headers');
  });

  it('a route parameter holding a sensitive word stays sensitive, as before', () => {
    expect(lineOf('/api/v1/events/authentic-cup', {}, '/api/v1/events/:slug')).toMatchObject({
      sensitiveRoute: true,
    });
  });
});
