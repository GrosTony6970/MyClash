import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';

export interface ApiErrorResponse {
  statusCode: number;
  code: string;
  message: string;
  details?: unknown;
  path: string;
  method: string;
  timestamp: string;
  requestId?: string;
}

interface RequestLike {
  method?: string;
  url?: string;
  headers?: Record<string, string | string[] | undefined>;
}

interface ReplyLike {
  status: (statusCode: number) => { send: (body: ApiErrorResponse) => void };
}

export type ApiExceptionReporter = (
  exception: unknown,
  context: { statusCode: number; path: string; method: string; requestId?: string },
) => void;

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  constructor(private readonly reportException?: ApiExceptionReporter) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<RequestLike>();
    const response = http.getResponse<ReplyLike>();
    const statusCode =
      exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const normalized = normalizeException(exception, statusCode);
    const requestId = firstHeaderValue(request.headers?.['x-request-id']);
    const path = request.url ?? '';
    const method = request.method ?? '';

    if (statusCode >= 500) {
      this.reportException?.(exception, {
        statusCode,
        path,
        method,
        ...(requestId ? { requestId } : {}),
      });
    }

    response.status(statusCode).send({
      statusCode,
      code: normalized.code,
      message: normalized.message,
      ...(normalized.details === undefined ? {} : { details: normalized.details }),
      path,
      method,
      timestamp: new Date().toISOString(),
      ...(requestId ? { requestId } : {}),
    });
  }
}

function normalizeException(
  exception: unknown,
  statusCode: number,
): { code: string; message: string; details?: unknown } {
  if (!(exception instanceof HttpException)) {
    return {
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Internal server error',
    };
  }

  const body = exception.getResponse();
  if (statusCode >= 500) {
    return {
      code: httpStatusCodeToCode(statusCode),
      message: 'Internal server error',
    };
  }

  if (typeof body === 'string') {
    return {
      code: httpStatusCodeToCode(statusCode),
      message: body,
    };
  }

  if (!isRecord(body)) {
    return {
      code: httpStatusCodeToCode(statusCode),
      message: exception.message || httpStatusCodeToMessage(statusCode),
    };
  }

  const rawMessage = body['message'];
  const error = typeof body['error'] === 'string' ? body['error'] : undefined;
  const message = normalizeMessage(rawMessage, exception.message || error, statusCode);
  const code = error ? labelToCode(error) : httpStatusCodeToCode(statusCode);
  const details = buildDetails(body, rawMessage);

  return details === undefined ? { code, message } : { code, message, details };
}

function normalizeMessage(
  rawMessage: unknown,
  fallback: string | undefined,
  statusCode: number,
): string {
  if (Array.isArray(rawMessage) && rawMessage.every((item) => typeof item === 'string')) {
    return rawMessage[0] ?? httpStatusCodeToMessage(statusCode);
  }
  if (typeof rawMessage === 'string') return rawMessage;
  if (fallback) return fallback;
  return httpStatusCodeToMessage(statusCode);
}

function buildDetails(body: Record<string, unknown>, rawMessage: unknown): unknown {
  const details = Object.fromEntries(
    Object.entries(body).filter(([key]) => !['statusCode', 'error', 'message'].includes(key)),
  );

  if (Array.isArray(rawMessage) && rawMessage.every((item) => typeof item === 'string')) {
    return { ...details, validationErrors: rawMessage };
  }

  return Object.keys(details).length > 0 ? details : undefined;
}

function labelToCode(label: string): string {
  return label
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toUpperCase();
}

function httpStatusCodeToCode(statusCode: number): string {
  switch (statusCode) {
    case HttpStatus.BAD_REQUEST:
      return 'BAD_REQUEST';
    case HttpStatus.UNAUTHORIZED:
      return 'UNAUTHORIZED';
    case HttpStatus.FORBIDDEN:
      return 'FORBIDDEN';
    case HttpStatus.NOT_FOUND:
      return 'NOT_FOUND';
    case HttpStatus.CONFLICT:
      return 'CONFLICT';
    case HttpStatus.PAYMENT_REQUIRED:
      return 'PAYMENT_REQUIRED';
    default:
      return statusCode >= 500 ? 'INTERNAL_SERVER_ERROR' : `HTTP_${statusCode}`;
  }
}

function httpStatusCodeToMessage(statusCode: number): string {
  switch (statusCode) {
    case HttpStatus.BAD_REQUEST:
      return 'Bad request';
    case HttpStatus.UNAUTHORIZED:
      return 'Unauthorized';
    case HttpStatus.FORBIDDEN:
      return 'Forbidden';
    case HttpStatus.NOT_FOUND:
      return 'Not found';
    case HttpStatus.CONFLICT:
      return 'Conflict';
    default:
      return statusCode >= 500 ? 'Internal server error' : 'Request failed';
  }
}

function firstHeaderValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
