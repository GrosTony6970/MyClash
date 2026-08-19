/**
 * `apiRequest` — the one owner of a fetch against the MyClash API.
 *
 * The three web apps hold ~867 hand-rolled fetch calls, and the hand-rolling is
 * where the variance lives: nineteen spellings of "was this an abort?", 177
 * inline `res.json().catch(...)` copies, and 138 sites that read the
 * problem+json `message` extension while ignoring the `detail` member RFC 9457
 * actually specifies.
 *
 * It NEVER throws. That is the whole point — the `catch` block is where those
 * three families of copy live, so a caller that has no `catch` cannot grow one.
 * Every failure comes back as a value the compiler makes you read.
 *
 * It carries no user-facing text (hard rule 6: every string ships in `en` and
 * `fr`). The failure is structured; each app maps it to `t(...)` with its own
 * keys.
 *
 * The base URL is a PARAMETER and stays one. The three apps have three
 * genuinely different policies — browser-only, server/browser split, and
 * same-origin `''` — and Next inlines only a literal `process.env['X']`, so a
 * shared resolver reading by computed name would read `undefined` in the
 * browser every time.
 */

/** Why a request did not produce data. `aborted` is a caller's own doing. */
export type ApiFailure =
  | { kind: 'aborted' }
  | { kind: 'unauthenticated'; status: 401 | 403 }
  | { kind: 'http'; status: number; detail: string | null }
  | { kind: 'network' };

export type ApiResult<T> = { ok: true; data: T } | ({ ok: false } & ApiFailure);

/** 204s and empty bodies resolve to undefined instead of a JSON parse error. */
export async function parseBody<T>(res: Response): Promise<T> {
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

/**
 * The one abort classification. Exported so the ~19 spellings have one target.
 *
 * Covers `DOMException` and plain `Error` alike — both carry `.name` — and both
 * of the names an abort arrives under: `AbortError` from `controller.abort()`,
 * and `TimeoutError` from `AbortSignal.timeout(...)`. Five sites use the timeout
 * form and only two of them guard for its name.
 */
export function isAbortLike(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const name = (err as { name?: unknown }).name;
  return name === 'AbortError' || name === 'TimeoutError';
}

/**
 * Read the reason the API gave: the RFC 9457 standard member first, the
 * backward-compatible extension second. Today the exception filter emits both
 * carrying the same string, so the order is a statement of which one is the
 * contract rather than a behaviour change.
 *
 * A blank `detail` is treated as no detail and falls through to `message`: a
 * screen that renders whitespace has told the operator nothing, and its own
 * fallback sentence is better than an empty error box.
 */
export function readDetail(body: unknown): string | null {
  if (typeof body !== 'object' || body === null) return null;
  const { detail, message } = body as { detail?: unknown; message?: unknown };
  if (typeof detail === 'string' && detail.trim()) return detail;
  if (typeof message === 'string' && message.trim()) return message;
  return null;
}

/**
 * A body fetch can send as-is. Anything else is JSON — but `JSON.stringify` on
 * a `FormData` yields `"{}"` and drops the upload in silence, so the pass-through
 * cases are named rather than guessed at.
 */
function isRawBody(body: unknown): body is BodyInit {
  return (
    typeof body === 'string' ||
    body instanceof ArrayBuffer ||
    ArrayBuffer.isView(body) ||
    (typeof FormData !== 'undefined' && body instanceof FormData) ||
    (typeof Blob !== 'undefined' && body instanceof Blob) ||
    (typeof URLSearchParams !== 'undefined' && body instanceof URLSearchParams) ||
    (typeof ReadableStream !== 'undefined' && body instanceof ReadableStream)
  );
}

/**
 * The init this seam actually sends. `Omit` and not an intersection on the
 * caller's side: `RequestInit & { body?: unknown }` narrows to `BodyInit`
 * rather than widening it, so `body: { name }` would not compile.
 */
function requestInit(init: Omit<RequestInit, 'body'> & { body?: unknown }): RequestInit {
  const { body, headers, ...rest } = init;
  const sendsJson = body !== undefined && !isRawBody(body);
  // Through `Headers` and not a spread: `headers` is also allowed to be a
  // `Headers` instance or an array of pairs, and spreading either produces
  // nonsense — `{}` for the first, so every caller header would vanish without
  // a word. The caller still wins on a collision, which is why the content type
  // is only set when nothing already claims it.
  const merged = new Headers(headers);
  if (sendsJson && !merged.has('Content-Type')) merged.set('Content-Type', 'application/json');
  return {
    // The session is an httpOnly cookie, so this is the default rather than the
    // exception: 790 of the 867 existing sites pass it by hand.
    credentials: 'include',
    ...rest,
    ...(body === undefined ? {} : { body: sendsJson ? JSON.stringify(body) : (body as BodyInit) }),
    headers: merged,
  };
}

export async function apiRequest<T>(
  baseUrl: string,
  path: string,
  init: Omit<RequestInit, 'body'> & { body?: unknown } = {},
): Promise<ApiResult<T>> {
  let res: Response;
  try {
    res = await fetch(`${baseUrl}${path}`, requestInit(init));
  } catch (err) {
    return isAbortLike(err) ? { ok: false, kind: 'aborted' } : { ok: false, kind: 'network' };
  }

  const status = res.status;
  if (status === 401 || status === 403) {
    // Both mean "this screen is not yours". Ten web-admin sites already branch
    // on the pair together; `status` rides along for the caller that has to
    // tell a login from a permission.
    return { ok: false, kind: 'unauthenticated', status };
  }

  let parsed: unknown;
  try {
    parsed = await parseBody<unknown>(res);
  } catch (err) {
    // The signal can fire between the headers and the body.
    if (isAbortLike(err)) return { ok: false, kind: 'aborted' };
    // Otherwise the body was not JSON: an edge proxy served its own 502/504
    // HTML page where the API promised problem+json. On a failed response that
    // only costs us the reason; on a successful one the payload never arrived,
    // which is the same event as the socket dying.
    return res.ok
      ? { ok: false, kind: 'network' }
      : { ok: false, kind: 'http', status, detail: null };
  }

  if (!res.ok) return { ok: false, kind: 'http', status, detail: readDetail(parsed) };
  return { ok: true, data: parsed as T };
}
