import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import type { ArgumentsHost } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiExceptionFilter, type ApiErrorResponse } from './api-exception.filter';

function makeHost(overrides: { method?: string; url?: string; requestId?: string } = {}) {
  const send = vi.fn();
  const status = vi.fn(() => ({ send }));
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

  return { host, status, send };
}

describe('ApiExceptionFilter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-12T21:30:00.000Z'));
  });

  it('formats standard HTTP exceptions using the shared envelope', () => {
    const { host, status, send } = makeHost({ requestId: 'req-1' });

    new ApiExceptionFilter().catch(new NotFoundException('Person not found'), host);

    expect(status).toHaveBeenCalledWith(404);
    expect(send).toHaveBeenCalledWith({
      statusCode: 404,
      code: 'NOT_FOUND',
      message: 'Person not found',
      path: '/api/v1/test',
      method: 'GET',
      timestamp: '2026-05-12T21:30:00.000Z',
      requestId: 'req-1',
    } satisfies ApiErrorResponse);
  });

  it('keeps validation details for BadRequestException arrays', () => {
    const { host, send } = makeHost();
    const exception = new BadRequestException(['email must be an email']);

    new ApiExceptionFilter().catch(exception, host);

    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 400,
        code: 'BAD_REQUEST',
        message: 'email must be an email',
        details: { validationErrors: ['email must be an email'] },
      }),
    );
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

    new ApiExceptionFilter().catch(new Error('database exploded'), host);

    expect(send).toHaveBeenCalledWith({
      statusCode: 500,
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Internal server error',
      path: '/api/v1/test',
      method: 'GET',
      timestamp: '2026-05-12T21:30:00.000Z',
    } satisfies ApiErrorResponse);
  });

  it('does not expose raw 5xx HTTP exception messages', () => {
    const { host, send } = makeHost();

    new ApiExceptionFilter().catch(new InternalServerErrorException('supabase raw error'), host);

    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 500,
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Internal server error',
      }),
    );
    expect(send.mock.calls[0]?.[0]).not.toHaveProperty('details');
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
        statusCode: 402,
        code: 'SPEND_CAP_EXCEEDED',
        message: 'Event has reached its AI spend cap',
      }),
    );
  });
});
