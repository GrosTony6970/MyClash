import { refusal } from './upload-store.mjs';

/**
 * The HTTP side of the chunked upload (`upload-chunks.mjs`), out of server.mjs so a test can run
 * it on a real socket (server.mjs listens and awaits at the top level).
 *
 *   POST   /upload-sessions                 { filename, sizeBytes, fingerprint } → 201
 *   GET    /upload-sessions/:id             → 200
 *   PUT    /upload-sessions/:id/chunks?offset=N   raw body → 200 { receivedBytes }
 *   POST   /upload-sessions/:id/complete    → 202
 *   DELETE /upload-sessions/:id             → 200
 *
 * A chunk refused before its body is read is answered with no special header: Node reads and
 * drops the rest of the body itself, and the client reads the answer. Probed 2026-10-30 with
 * undici's fetch and a 16 MiB body, 50 times: `connection: close` lost the answer 49 times in 50
 * on Windows (ECONNRESET); Node's own handling delivered it every time on Windows and Linux.
 */
const JSON_BODY_MAX_BYTES = 64 * 1024;
const ROUTE = /^\/upload-sessions(?:\/(?<id>[^/]+)(?<action>\/chunks|\/complete)?)?$/u;

/** @returns {Promise<boolean>} whether the request was an upload-session route (answered). */
export async function handleUploadSessions(req, res, url, sessions) {
  const match = ROUTE.exec(url.pathname);
  if (!match) return false;
  const { id, action } = match.groups;
  const route = `${req.method} ${id ? ':id' : ''}${action ?? ''}`;
  if (route === 'POST ') {
    sendJson(res, 201, await sessions.create(await readJsonBody(req)));
  } else if (route === 'GET :id') {
    sendJson(res, 200, await sessions.status(id));
  } else if (route === 'PUT :id/chunks') {
    const received = await sessions.receive(
      id,
      url.searchParams.get('offset') ?? '',
      contentLength(req),
      () => readRawBody(req),
    );
    sendJson(res, 200, received);
  } else if (route === 'POST :id/complete') {
    sendJson(res, 202, await sessions.complete(id));
  } else if (route === 'DELETE :id') {
    sendJson(res, 200, await sessions.cancel(id));
  } else {
    return false;
  }
  return true;
}

/** The declared length; none (a `Transfer-Encoding: chunked` body) or a malformed one is none. */
function contentLength(req) {
  const header = req.headers['content-length'];
  return typeof header === 'string' && /^\d+$/u.test(header) ? Number(header) : undefined;
}

/**
 * The body, at most its declared `Content-Length` (Node's parser never delivers more). A client
 * that goes away rejects the read; one that sends less is refused by the caller (nothing written).
 */
export async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}

/** Every JSON body the runner reads (a schedule, a restore, a start): small, or refused 413. */
export async function readJsonBody(req) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > JSON_BODY_MAX_BYTES) throw refusal(413, 'Request body too large.');
  }
  try {
    return body ? JSON.parse(body) : {};
  } catch {
    throw refusal(400, 'Invalid JSON body.');
  }
}

export function sendJson(res, statusCode, value) {
  res.writeHead(statusCode, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(`${JSON.stringify(value)}\n`);
}

/**
 * Every failure of the runner, as the API reads it: `{ error, code?, details? }`. A refusal's code
 * and details ride along for the screen; Node's own codes (ENOENT…) are no refusal and stay out.
 */
export function sendError(res, error) {
  const refused = Boolean(error?.statusCode);
  sendJson(res, error?.statusCode ?? 500, {
    error: error instanceof Error ? error.message : 'Unknown operation error.',
    ...(refused && typeof error.code === 'string' ? { code: error.code } : {}),
    ...(refused && error.details ? { details: error.details } : {}),
  });
}
