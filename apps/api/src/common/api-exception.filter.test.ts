import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  InternalServerErrorException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { OperationalUnavailableException } from './operational-exception';
import type { ArgumentsHost } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ApiExceptionFilter,
  PROBLEM_JSON_CONTENT_TYPE,
  type ApiErrorResponse,
} from './api-exception.filter';

function makeHost(overrides: { method?: string; url?: string; requestId?: string } = {}) {
  const send = vi.fn();
  const header = vi.fn(() => ({ send }));
  const status = vi.fn(() => ({ header, send }));
  const request = {
    method: overrides.method ?? 'GET',
    url: overrides.url ?? '/api/v1/test',
    headers: overrides.requestId ? { 'x-request-id': overrides.requestId } : {},
  };

  const host = {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => ({ status }),
    }),
  } as unknown as ArgumentsHost;

  return { host, status, header, send };
}

describe('ApiExceptionFilter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-12T21:30:00.000Z'));
  });

  it('formats standard HTTP exceptions using the RFC 9457 envelope', () => {
    const { host, status, header, send } = makeHost({ requestId: 'req-1' });

    new ApiExceptionFilter().catch(new NotFoundException('Person not found'), host);

    expect(status).toHaveBeenCalledWith(404);
    expect(header).toHaveBeenCalledWith('content-type', PROBLEM_JSON_CONTENT_TYPE);
    expect(send).toHaveBeenCalledWith({
      // RFC 9457 standard members
      type: 'about:blank',
      title: 'Not Found',
      status: 404,
      detail: 'Person not found',
      instance: '/api/v1/test',
      // extension members
      code: 'NOT_FOUND',
      message: 'Person not found',
      statusCode: 404,
      path: '/api/v1/test',
      method: 'GET',
      timestamp: '2026-05-12T21:30:00.000Z',
      requestId: 'req-1',
    } satisfies ApiErrorResponse);
  });

  it('emits application/problem+json content type', () => {
    const { host, header } = makeHost();

    new ApiExceptionFilter().catch(new BadRequestException('bad'), host);

    expect(header).toHaveBeenCalledWith('content-type', 'application/problem+json; charset=utf-8');
  });

  it('keeps validation details for BadRequestException arrays', () => {
    const { host, send } = makeHost();
    const exception = new BadRequestException(['email must be an email']);

    new ApiExceptionFilter().catch(exception, host);

    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'about:blank',
        title: 'Bad Request',
        status: 400,
        detail: 'email must be an email',
        statusCode: 400,
        code: 'BAD_REQUEST',
        message: 'email must be an email',
        details: { validationErrors: ['email must be an email'] },
      }),
    );
  });

  it('sends the FIRST validation error as the reason, never the whole array', () => {
    // The case above uses a one-element array, where "the first element" and
    // "the whole array" are the same string — so it cannot see the collapse at
    // `normalizeMessage`. Six web-admin screens carried an
    // `Array.isArray(body.message)` branch that joined the list, and none of
    // them ever fired, because neither `detail` nor `message` leaves here as an
    // array. Those branches are gone; this is what says they can stay gone.
    const { host, send } = makeHost();
    const exception = new BadRequestException([
      'email must be an email',
      'name should not be empty',
    ]);

    new ApiExceptionFilter().catch(exception, host);

    const body = send.mock.calls[0]?.[0] as ApiErrorResponse;
    expect(body.detail).toBe('email must be an email');
    expect(body.message).toBe('email must be an email');
    // The rest is not lost, only moved. Nothing in any app reads this yet, so
    // an operator who submits four bad fields is still told about one.
    expect(body.details).toEqual({
      validationErrors: ['email must be an email', 'name should not be empty'],
    });
  });

  it('preserves structured conflict payloads under details', () => {
    const { host, send } = makeHost();
    const exception = new ConflictException({
      requiresConfirmation: true,
      startedMatchCount: 1,
      completedMatchCount: 2,
    });

    new ApiExceptionFilter().catch(exception, host);

    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 409,
        statusCode: 409,
        code: 'CONFLICT',
        message: 'Conflict Exception',
        details: {
          requiresConfirmation: true,
          startedMatchCount: 1,
          completedMatchCount: 2,
        },
      }),
    );
  });

  it('does not expose stack traces for unknown production errors', () => {
    const { host, send } = makeHost();
    const report = vi.fn();
    const error = new Error('database exploded');

    new ApiExceptionFilter(report).catch(error, host);

    expect(send).toHaveBeenCalledWith({
      type: 'about:blank',
      title: 'Internal Server Error',
      status: 500,
      detail: 'Internal server error',
      instance: '/api/v1/test',
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Internal server error',
      statusCode: 500,
      path: '/api/v1/test',
      method: 'GET',
      timestamp: '2026-05-12T21:30:00.000Z',
    } satisfies ApiErrorResponse);
    expect(report).toHaveBeenCalledWith(error, {
      statusCode: 500,
      path: '/api/v1/test',
      method: 'GET',
    });
  });

  it('does not expose raw 5xx HTTP exception messages', () => {
    const { host, send } = makeHost({ requestId: 'req-500' });
    const report = vi.fn();
    const exception = new InternalServerErrorException('supabase raw error');

    new ApiExceptionFilter(report).catch(exception, host);

    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 500,
        statusCode: 500,
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Internal server error',
        detail: 'Internal server error',
      }),
    );
    expect(send.mock.calls[0]?.[0]).not.toHaveProperty('details');
    expect(report).toHaveBeenCalledWith(exception, {
      statusCode: 500,
      path: '/api/v1/test',
      method: 'GET',
      requestId: 'req-500',
    });
  });

  it('keeps the message of a deliberately operator-facing 5xx', () => {
    // The blanket 5xx scrub also ate the messages we author on purpose, which
    // is how "Could not delete backups." became the only thing the admin UI
    // could ever say about a failed ops-runner call.
    const { host, send } = makeHost();
    const report = vi.fn();
    const exception = new OperationalUnavailableException(
      'The ops runner did not respond within 15s.',
    );

    new ApiExceptionFilter(report).catch(exception, host);

    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 503,
        statusCode: 503,
        message: 'The ops runner did not respond within 15s.',
        detail: 'The ops runner did not respond within 15s.',
      }),
    );
    // Still worth a Sentry report — surfacing it to the operator does not make
    // it expected.
    expect(report).toHaveBeenCalledWith(exception, expect.objectContaining({ statusCode: 503 }));
  });

  it('still scrubs a plain 503, so the exemption cannot widen by accident', () => {
    // The opt-in is the marker class, NOT the 503 status: new code throwing a
    // generic ServiceUnavailableException must not start leaking its message.
    const { host, send } = makeHost();

    new ApiExceptionFilter().catch(
      new ServiceUnavailableException('postgres://user:pw@db:5432 unreachable'),
      host,
    );

    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 503,
        message: 'Internal server error',
        detail: 'Internal server error',
      }),
    );
  });

  it('maps spend-cap style error labels to stable codes', () => {
    const { host, send } = makeHost();
    const exception = new HttpException(
      {
        statusCode: HttpStatus.PAYMENT_REQUIRED,
        error: 'Spend cap exceeded',
        message: 'Event has reached its AI spend cap',
      },
      HttpStatus.PAYMENT_REQUIRED,
    );

    new ApiExceptionFilter().catch(exception, host);

    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 402,
        statusCode: 402,
        title: 'Payment Required',
        code: 'SPEND_CAP_EXCEEDED',
        message: 'Event has reached its AI spend cap',
        detail: 'Event has reached its AI spend cap',
      }),
    );
  });
});
