import { buildRecord, type QueryErrorRecorder } from './recorder';

/**
 * Wraps `fetch` so every failed PostgREST response is recorded, without changing
 * what the caller receives.
 *
 * This is the only viable hook: there are ~1,870 `.from()` chains across 194
 * services, and `createClient({ global: { fetch } })` is one line.
 *
 * ── THE CLONE IS NOT OPTIONAL ────────────────────────────────────────────────
 * `code` and `message` live only in the response BODY, and postgrest-js consumes
 * that same body itself (`PostgrestBuilder.ts:487` on success, `:545` on error)
 * — outside its own retry try/catch, which wraps "only the fetch call itself".
 * A body stream can be read once. Reading the returned Response here leaves it
 * disturbed, so postgrest-js's own `res.text()` throws, and EVERY errored query
 * comes back to its caller as `status 0, code '', message 'TypeError: Body is
 * unusable'` instead of the real error.
 *
 * That would silently break every `error.code === '23505'` branch in the repo —
 * bracket-match-sync, swiss-pairing, deletion-requests, weapons-admin and
 * directory-groups all switch on it, and their message-regex fallbacks fail too.
 * A diagnostic that breaks the paths it exists to observe is worse than none.
 *
 * So: clone first, read the clone, and only when the response is not ok.
 */

/**
 * `fetch`'s own first parameter type.
 *
 * Derived rather than written as `RequestInfo | URL`: this project's lib set
 * does not declare `RequestInfo`, and deriving it also keeps the wrapper exactly
 * as wide as whatever `fetch` this runtime provides.
 */
type FetchInput = Parameters<typeof fetch>[0];

/** Shape of a PostgREST error body. Every field is optional in practice. */
interface PostgrestErrorBody {
  code?: string | null;
  message?: string | null;
}

function methodOf(input: FetchInput, init?: RequestInit): string {
  if (init?.method) return init.method.toUpperCase();
  if (typeof Request !== 'undefined' && input instanceof Request) return input.method.toUpperCase();
  return 'GET';
}

function urlOf(input: FetchInput): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

/**
 * Read the error body off a CLONE.
 *
 * Returns null rather than throwing for a non-JSON body: a Traefik HTML 502 or
 * an empty 404 has no code, and that is still worth recording as an operational
 * event. Nothing in here may propagate — this runs beside every query.
 */
async function readErrorBody(response: Response): Promise<PostgrestErrorBody | null> {
  try {
    const body: unknown = await response.clone().json();
    if (!body || typeof body !== 'object') return null;
    const record = body as Record<string, unknown>;
    return {
      code: typeof record['code'] === 'string' ? record['code'] : null,
      message: typeof record['message'] === 'string' ? record['message'] : null,
    };
  } catch {
    return null;
  }
}

/**
 * Build a `fetch` that records PostgREST failures and is otherwise transparent.
 *
 * The returned Response is the untouched original — same object, same undisturbed
 * body — so postgrest-js behaves exactly as it would without this wrapper.
 */
export function createRecordingFetch(
  recorder: QueryErrorRecorder,
  fetchImpl: typeof fetch = fetch,
): typeof fetch {
  return async function recordingFetch(input: FetchInput, init?: RequestInit): Promise<Response> {
    const response = await fetchImpl(input, init);
    if (response.ok) return response;

    // Everything below is best-effort and must never affect the caller.
    try {
      const url = urlOf(input);
      const record = buildRecord(
        url,
        methodOf(input, init),
        response.status,
        await readErrorBody(response),
      );
      if (record) recorder.record(record);
    } catch {
      // A malformed input, an exotic Request subclass — never worth a failed query.
    }

    return response;
  };
}
