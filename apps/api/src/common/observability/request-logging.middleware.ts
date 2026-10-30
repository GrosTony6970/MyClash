import { Injectable, NestMiddleware, Optional } from '@nestjs/common';
import type { MiddlewareConsumer } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Identity } from '../auth/identity';
import { isSensitiveRoute, redactHeaders } from './redaction';

interface RequestLike {
  method?: string;
  url?: string;
  originalUrl?: string;
  headers?: Record<string, string | string[] | undefined>;
  /**
   * Written on `req.raw` by AuthGuard (`auth.guard.ts`, `attach`). None when it never ran: no route
   * matched, Fastify refused the body, or the rate limit (ThrottlerGuard, first) refused it.
   */
  identity?: Identity;
}

/**
 * Who made the request: the identity's kind, then its id. An anonymous caller is nobody.
 * `null`, not `undefined`, so a new kind of identity this switch does not name fails the build.
 */
function actorOf(identity: Identity | undefined): string | null {
  switch (identity?.kind) {
    case 'claimed':
      return `claimed:${identity.userId}`;
    case 'guest':
      return `guest:${identity.guestSessionId}`;
    case 'staff':
      return `staff:${identity.staffId}`;
    case 'anonymous':
    case undefined:
      return null;
  }
}

interface ResponseLike {
  statusCode?: number;
  setHeader?: (name: string, value: string) => void;
  on?: (event: 'finish' | 'close', listener: () => void) => void;
}

export interface RequestLogEvent {
  level: 'info';
  service: 'myclash-api';
  event: 'http_request';
  requestId: string;
  method: string;
  path: string;
  statusCode: number;
  durationMs: number;
  actorId?: string;
  headers?: Record<string, string | string[]>;
  sensitiveRoute: boolean;
}

type LogSink = (event: RequestLogEvent) => void;

export function writeJsonLog(event: RequestLogEvent): void {
  process.stdout.write(`${JSON.stringify(event)}\n`);
}

@Injectable()
export class RequestLoggingMiddleware implements NestMiddleware {
  constructor(@Optional() private readonly sink: LogSink = writeJsonLog) {}

  use(request: RequestLike, response: ResponseLike, next: () => void): void {
    const startedAt = process.hrtime.bigint();
    const path = request.originalUrl ?? request.url ?? '';
    const requestId = firstHeaderValue(request.headers?.['x-request-id']) ?? randomUUID();
    response.setHeader?.('x-request-id', requestId);

    let logged = false;
    const logOnce = (): void => {
      if (logged) return;
      logged = true;
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
      const sensitiveRoute = isSensitiveRoute(path);
      const actorId = actorOf(request.identity);
      this.sink({
        level: 'info',
        service: 'myclash-api',
        event: 'http_request',
        requestId,
        method: request.method ?? '',
        path,
        statusCode: response.statusCode ?? 0,
        durationMs: Math.round(durationMs),
        ...(actorId ? { actorId } : {}),
        ...(sensitiveRoute || !request.headers ? {} : { headers: redactHeaders(request.headers) }),
        sensitiveRoute,
      });
    };

    response.on?.('finish', logOnce);
    response.on?.('close', logOnce);
    next();
  }
}

/**
 * The one wiring of the request log: every route. `AppModule.configure` and the edge tests both
 * call it, so the tests run the routes production logs.
 */
export function applyRequestLogging(consumer: MiddlewareConsumer): void {
  consumer.apply(RequestLoggingMiddleware).forRoutes('*');
}

function firstHeaderValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
