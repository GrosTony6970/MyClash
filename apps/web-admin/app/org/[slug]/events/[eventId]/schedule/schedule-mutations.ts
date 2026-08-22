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
 * ── The transport is `apiRequest`, not `fetch` ──────────────────────────────
 * This module used to own its own request: `credentials: 'include'`, a
 * hand-rolled Content-Type, a `JSON.stringify`, a `try/catch` around the fetch
 * and a `messageFrom` that read `body.message` and nothing else. That is the
 * seam in `@myclash/api-client`, written a second time — and the copy was
 * already behind: it never read the RFC 9457 `detail` member, it never read
 * `details.validationErrors`, so a placement refused on four fields reported
 * one, and it turned an unparseable body into the invented status line
 * "502 Bad Gateway" — prose no operator asked for and no translator saw.
 *
 * What stays is the CONTRACT, which is this module's actual reason to exist: a
 * refusal throws. `apiRequest` never throws by design, so the throw is built
 * here, once, on top of it.
 *
 * Still pure: no React, no i18n. It carries the structured failure rather than
 * a sentence, because only the component has `t()` — see `useScheduleWrites`.
 */

import { apiRequest, failureDetail, type ApiFailure } from '@myclash/api-client';

export interface MutateInit {
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** Serialized as JSON with the matching Content-Type. Omit for a bodyless verb. */
  body?: unknown;
  signal?: AbortSignal;
}

/** Status used when the request never reached the server at all. */
export const NETWORK_FAILURE_STATUS = 0;

/** The HTTP status behind a failure, or zero when there was no response. */
function statusOf(failure: ApiFailure): number {
  return failure.kind === 'http' || failure.kind === 'unauthenticated'
    ? failure.status
    : NETWORK_FAILURE_STATUS;
}

export class ScheduleMutationError extends Error {
  /** HTTP status, or `NETWORK_FAILURE_STATUS` when there was no response. */
  readonly status: number;
  readonly url: string;
  /**
   * The refusal, structured. This is what a caller renders — `failureMessage`
   * turns it into the operator's language, picks every rejected field over the
   * first one, and knows a scrubbed 5xx has nothing worth showing. `message`
   * below is for a console and a Sentry title; it is not user-facing.
   */
  readonly failure: ApiFailure;

  constructor(message: string, url: string, failure: ApiFailure) {
    super(message);
    this.name = 'ScheduleMutationError';
    this.status = statusOf(failure);
    this.url = url;
    this.failure = failure;
  }
}

/**
 * A line for the console. The server's own reason when it sent one, otherwise
 * the shape of the failure — never a sentence dressed up as one an operator
 * should read, which is what the old `${status} ${statusText}` fallback was.
 */
function diagnosis(failure: ApiFailure): string {
  return failureDetail(failure) ?? `${failure.kind} ${statusOf(failure)}`;
}

/**
 * Issue one schedule write. Resolves with the parsed body (or null for an empty
 * one), throws `ScheduleMutationError` for any non-OK response and for a
 * network failure.
 *
 * Takes a FULL url rather than a path, so the base URL stays the caller's — the
 * board resolves it once and hands the same string to every write.
 */
export async function mutateSchedule<T = unknown>(
  url: string,
  init: MutateInit,
): Promise<T | null> {
  const r = await apiRequest<T>('', url, {
    method: init.method,
    ...(init.body === undefined ? {} : { body: init.body }),
    ...(init.signal ? { signal: init.signal } : {}),
  });
  if (!r.ok) throw new ScheduleMutationError(diagnosis(r), url, r);
  // A 204 and an empty body both parse to undefined; the callers that read a
  // result test for null.
  return r.data ?? null;
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
        : // Something threw before the request was ever made. It reached no
          // server, so it is classified as one that could not: the board is
          // told the write did not land, which is the only true part.
          new ScheduleMutationError(reason instanceof Error ? reason.message : String(reason), '', {
            kind: 'network',
          }),
    );
  }
  return { total: calls.length, failures };
}
