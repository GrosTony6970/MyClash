/**
 * The one way the schedule surface writes to the API.
 *
 * WHY THIS EXISTS: every write on this board used to be fire-and-forget.
 * `saveMatchPosition` awaited its PATCH, read neither `res.ok` nor threw, and
 * was called as a floating `void` from the drag, group-drop, run-clear,
 * undo/redo, lice-shift and sidebar-unschedule paths. A rejected write left the
 * optimistic UI showing a placement that did not exist, with no banner, no
 * rollback and no console trace — and it did NOT heal on the next tick: no
 * realtime event fires for a write that never happened, and the poll fallback
 * is stopped while the socket is SUBSCRIBED. Correction waited for an unrelated
 * change or a page reload. `clearActiveDay` was the worst shape: on a 401 the
 * operator saw the whole day emptied on screen while every match stayed
 * scheduled in the database, on the pad and on the public display.
 *
 * So: a non-OK response is an exception here, never a return value. Callers
 * cannot ignore it by forgetting to check a boolean.
 *
 * ROLLBACK IS A REFETCH, not a snapshot. Restoring a remembered previous state
 * at every call site drifts the moment one of them forgets a field; re-reading
 * the server cannot. The caller's recovery path is therefore always "refetch
 * from source of truth", which is also what makes the batch helper below safe.
 *
 * Pure: no React, no i18n, no `apiUrl` knowledge. It never invents user-facing
 * prose — a failure carries the server's own message, or a bare status line for
 * diagnosis. Turning either into something an operator should read is the
 * component's job, because only the component has `t()`.
 */

export interface MutateInit {
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** Serialized as JSON with the matching Content-Type. Omit for a bodyless verb. */
  body?: unknown;
  signal?: AbortSignal;
}

/** Status used when the request never reached the server at all. */
export const NETWORK_FAILURE_STATUS = 0;

export class ScheduleMutationError extends Error {
  /** HTTP status, or `NETWORK_FAILURE_STATUS` when there was no response. */
  readonly status: number;
  readonly url: string;

  constructor(message: string, status: number, url: string) {
    super(message);
    this.name = 'ScheduleMutationError';
    this.status = status;
    this.url = url;
  }
}

/**
 * The API's error body carries `message` as a string, always. A class-validator
 * array is collapsed to its first entry by `normalizeMessage` in
 * `api-exception.filter.ts` before it leaves the server, so an array shape
 * never reaches here; anything that is not a usable string falls back to the
 * status line.
 */
async function messageFrom(res: Response): Promise<string> {
  try {
    const body: unknown = await res.json();
    const message = (body as { message?: unknown } | null)?.message;
    if (typeof message === 'string' && message.length > 0) return message;
  } catch {
    // Not JSON, or an empty body — the status line below is all we have.
  }
  return `${res.status} ${res.statusText}`.trim();
}

/**
 * Issue one schedule write. Resolves with the parsed body (or null for an empty
 * one), throws `ScheduleMutationError` for any non-OK response and for a
 * network failure.
 */
export async function mutateSchedule<T = unknown>(
  url: string,
  init: MutateInit,
): Promise<T | null> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: init.method,
      credentials: 'include',
      ...(init.body === undefined
        ? {}
        : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(init.body) }),
      ...(init.signal ? { signal: init.signal } : {}),
    });
  } catch (err) {
    // No response at all: offline, DNS, TLS, or an aborted request. The browser
    // writes this message, not us — see the no-invented-prose note above.
    throw new ScheduleMutationError(
      err instanceof Error ? err.message : String(err),
      NETWORK_FAILURE_STATUS,
      url,
    );
  }
  if (!res.ok) throw new ScheduleMutationError(await messageFrom(res), res.status, url);
  if (res.status === 204) return null;
  return (await res.json().catch(() => null)) as T | null;
}

export interface MutationBatchResult {
  total: number;
  failures: ScheduleMutationError[];
}

/**
 * Run a fan-out of writes and report what failed.
 *
 * Deliberately NOT `Promise.all`: a drag that displaces neighbours issues one
 * PATCH per moved row, and rejecting on the first failure would leave the rest
 * in flight with the operator told nothing about them. Every call is attempted,
 * then the caller gets a count it can act on. It does not throw — a partial
 * failure is a real state that has to be reported, not an exception to unwind.
 */
export async function mutateAll(
  calls: ReadonlyArray<() => Promise<unknown>>,
): Promise<MutationBatchResult> {
  const settled = await Promise.allSettled(calls.map((call) => call()));
  const failures: ScheduleMutationError[] = [];
  for (const outcome of settled) {
    if (outcome.status !== 'rejected') continue;
    const reason: unknown = outcome.reason;
    failures.push(
      reason instanceof ScheduleMutationError
        ? reason
        : new ScheduleMutationError(
            reason instanceof Error ? reason.message : String(reason),
            NETWORK_FAILURE_STATUS,
            '',
          ),
    );
  }
  return { total: calls.length, failures };
}
