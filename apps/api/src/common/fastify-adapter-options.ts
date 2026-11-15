import {
  LogController,
  type FastifyReply,
  type FastifyRequest,
  type FastifyServerOptions,
} from 'fastify';
import { logSafePath } from './observability/redaction';
import { trustOneLocalProxy } from './trust-proxy';

/** A write target for Fastify's own log lines; a test hands one in to read them. */
export interface LogStream {
  write(line: string): void;
}

/**
 * The options of the API's Fastify server. One owner: `main.ts` builds the server with them and the
 * edge tests (`testing/http-edge-app.ts`) build theirs with them too, so what they pin is what
 * production runs.
 *
 * `logger`: Fastify's own line per request, on in production. `stream` sends it somewhere else
 * than stdout.
 */
export function fastifyAdapterOptions({
  logger,
  stream,
}: {
  logger: boolean;
  stream?: LogStream;
}): FastifyServerOptions {
  return {
    logger: logger ? { serializers: { req: requestLine }, ...(stream ? { stream } : {}) } : false,
    logController: new LogSafeLogController(),
    // Traefik is the only proxy in front of us: `req.ip` is the address it saw
    // (common/trust-proxy.ts). Not `true`, and not a hop count.
    trustProxy: trustOneLocalProxy,
  };
}

/**
 * Fastify's own request fields, with the path a log may write: a link's token rides in the query
 * (`logSafePath`). The client's address stays: for a sensitive route this line is the one place
 * that records it (privacy policy §2.7).
 */
function requestLine(request: FastifyRequest): Record<string, unknown> {
  return {
    method: request.method,
    url: logSafePath(request.url),
    version: request.headers['accept-version'],
    host: request.host,
    remoteAddress: request.ip,
    remotePort: request.socket?.remotePort,
  };
}

/**
 * The router's refusals of an address (a broken percent escape, an over-long parameter) quote the
 * whole address, query included, in their message, and Fastify writes that message as the log
 * line's text and in its error. These two formats are fixed (fastify lib/errors.js).
 */
const ADDRESS_REFUSALS: Record<string, string> = {
  FST_ERR_BAD_URL: "' is not a valid url component",
  FST_ERR_MAX_PARAM_LENGTH: "' is exceeding the max param length",
};

/**
 * Fastify's log lines, except that a refused address is written as a log may. (Fastify's own 404
 * line quotes the address too, but never runs: Nest answers a 404 with a handler of its own.)
 */
class LogSafeLogController extends LogController {
  override defaultErrorLog(
    error: Error,
    request: FastifyRequest,
    reply: FastifyReply,
    metadata?: Record<string, unknown>,
  ): void {
    super.defaultErrorLog(logSafeError(error), request, reply, metadata);
  }
}

/**
 * The error as the log writes it. A copy: the error itself still answers the caller with the
 * address they sent.
 */
export function logSafeError(error: Error & { code?: string }): Error {
  const tail = error?.code ? ADDRESS_REFUSALS[error.code] : undefined;
  if (!tail || !error.message.startsWith("'") || !error.message.endsWith(tail)) return error;
  const address = error.message.slice(1, error.message.length - tail.length);
  const message = `'${logSafePath(address)}${tail}`;
  const safe: Error & { code?: string; statusCode?: number } = new Error(message);
  // Fastify's own error class, so the logged `err.type` stays `FastifyError`.
  Object.setPrototypeOf(safe, Object.getPrototypeOf(error));
  safe.name = error.name;
  safe.code = error.code;
  safe.statusCode = (error as { statusCode?: number }).statusCode;
  const frames = error.stack?.indexOf('\n') ?? -1;
  safe.stack = `${error.name}: ${message}${frames === -1 ? '' : (error.stack?.slice(frames) ?? '')}`;
  return safe;
}
