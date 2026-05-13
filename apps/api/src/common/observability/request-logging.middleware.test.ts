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
        user: { id: 'user-1' },
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
      actorId: 'user-1',
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
