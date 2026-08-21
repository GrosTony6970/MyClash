import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import { OperationalUnavailableException } from './operational-exception';

/**
 * RFC 9457 (Problem Details for HTTP APIs) error envelope.
 *
 * The first five members are the RFC 9457 standard fields, and responses are
 * sent with `Content-Type: application/problem+json`. The remaining fields are
 * extension members retained for backward compatibility with existing clients
 * (which read `message`, `code`, `statusCode`, and structured `details`).
 */
export interface ApiErrorResponse {
  // ── RFC 9457 standard members ──
  type: string;
  title: string;
  status: number;
  detail: string;
  instance: string;
  // ── Extension members (backward compatibility + extra context) ──
  code: string;
  message: string;
  statusCode: number;
  details?: unknown;
  path: string;
  method: string;
  timestamp: string;
  requestId?: string;
}

export const PROBLEM_JSON_CONTENT_TYPE = 'application/problem+json; charset=utf-8';

interface RequestLike {
  method?: string;
  url?: string;
  headers?: Record<string, string | string[] | undefined>;
}

interface ReplyLike {
  status: (statusCode: number) => ReplyLike;
  header: (name: string, value: string) => ReplyLike;
  send: (body: ApiErrorResponse) => void;
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

    const body: ApiErrorResponse = {
      // RFC 9457 standard members. `type` stays "about:blank" because the
      // status code + `code` extension fully describe the problem; `title` is
      // therefore the HTTP status phrase (per RFC 9457 §4.2.1).
      type: 'about:blank',
      title: httpStatusCodeToTitle(statusCode),
      status: statusCode,
      detail: normalized.message,
      instance: path,
      // Extension members (backward compatibility with existing clients).
      code: normalized.code,
      message: normalized.message,
      statusCode,
      ...(normalized.details === undefined ? {} : { details: normalized.details }),
      path,
      method,
      timestamp: new Date().toISOString(),
      ...(requestId ? { requestId } : {}),
    };

    response.status(statusCode).header('content-type', PROBLEM_JSON_CONTENT_TYPE).send(body);
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
  // A >=500 message can carry a stack, a query or a connection string, so it is
  // scrubbed by default. `OperationalUnavailableException` is the one opt-out:
  // its message is authored for the operator and safe to render. Keeping the
  // exemption tied to a marker class — rather than to the 503 status — means
  // new code throwing a generic 5xx cannot start leaking by accident.
  if (statusCode >= 500 && !(exception instanceof OperationalUnavailableException)) {
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
  const code = normalizeCode(body['code'], error, statusCode);
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

/**
 * The one machine-readable name for what went wrong.
 *
 * Two shapes reach here, and until 2026-08-21 they landed in two different
 * members. `throw new BadRequestException({ error: 'InstructorSelfEnrollment' })`
 * became the top-level `code`; `throw new BadRequestException({ code:
 * 'already_pending' })` became `details.code` and left `code` reading
 * 'BAD_REQUEST'. So a browser had to know which convention its endpoint used,
 * and the personal space matched an English sentence instead because the code it
 * was looking for was one level down.
 *
 * An explicit `code` wins, verbatim: it is what the thrower chose, and the
 * clients that match on it match the literal. `error` stays the fallback, still
 * uppercased, because those six throw sites and their readers already agree.
 */
function normalizeCode(rawCode: unknown, error: string | undefined, statusCode: number): string {
  if (typeof rawCode === 'string' && rawCode.trim()) return rawCode;
  return error ? labelToCode(error) : httpStatusCodeToCode(statusCode);
}

function buildDetails(body: Record<string, unknown>, rawMessage: unknown): unknown {
  const details = Object.fromEntries(
    // `code` comes out with them: it is a top-level member now, and leaving a
    // copy behind is how a reader ends up depending on the nested one again.
    Object.entries(body).filter(
      ([key]) => !['statusCode', 'error', 'message', 'code'].includes(key),
    ),
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

/** RFC 9457 `title`: the HTTP status reason phrase for an `about:blank` problem. */
function httpStatusCodeToTitle(statusCode: number): string {
  switch (statusCode) {
    case HttpStatus.BAD_REQUEST:
      return 'Bad Request';
    case HttpStatus.UNAUTHORIZED:
      return 'Unauthorized';
    case HttpStatus.PAYMENT_REQUIRED:
      return 'Payment Required';
    case HttpStatus.FORBIDDEN:
      return 'Forbidden';
    case HttpStatus.NOT_FOUND:
      return 'Not Found';
    case HttpStatus.CONFLICT:
      return 'Conflict';
    default:
      return statusCode >= 500 ? 'Internal Server Error' : 'Request Failed';
  }
}

function firstHeaderValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
