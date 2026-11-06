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
    expect(event).toMatchObject({ method: 'POST', path: url, statusCode: 200 });
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
});
