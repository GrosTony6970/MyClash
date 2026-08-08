import type { RosterEntry } from '../useDesk';

/**
 * What a scan turned into, as the overlay stacks it up.
 *
 * Failures are ROWS, not toasts and not a modal. The scanner stays live, so a
 * bad pass has to report itself without interrupting the queue behind it — a
 * dialog would stop the line for exactly the person who is already the problem.
 */
export type ScanOutcome =
  | { kind: 'ok'; id: number; person: RosterEntry }
  | { kind: 'error'; id: number; reason: ScanFailure };

export type ScanFailure =
  /** Not one of ours, or a pass for another event. Same answer on purpose. */
  | 'unknown'
  /** A pass from a finished event. */
  | 'expired'
  /** The desk's own session is not allowed here. */
  | 'forbidden'
  /** Venue wifi. The service worker turns a dead network into a 503. */
  | 'offline'
  | 'failed';

/** The API's problem+json body, as @myclash/api-client surfaces it. */
interface ApiFailure {
  status?: number;
  body?: { message?: string; detail?: string } | null;
}

/**
 * Map a failed redemption onto something the volunteer can act on.
 *
 * Keys on the API's own message rather than the status, because
 * `pass_not_recognized` and `pass_expired` are both 404s and the difference is
 * the entire content of the message shown: one means "type their name instead",
 * the other means "this is last month's pass".
 *
 * A 5xx is deliberately NOT read for a message — the exception filter flattens
 * every >=500 body to "Internal server error", so anything found there would be
 * a lie.
 */
export function classifyScanFailure(err: unknown): ScanFailure {
  const failure = err as ApiFailure | null;
  const status = failure?.status;

  if (status === 503 || status === 0 || status === undefined) return 'offline';
  if (status === 401 || status === 403) return 'forbidden';
  if (status >= 500) return 'failed';

  const message = failure?.body?.message ?? failure?.body?.detail ?? '';
  if (message.includes('pass_expired')) return 'expired';
  if (message.includes('pass_not_recognized')) return 'unknown';
  return 'failed';
}

/** i18n key for a failure row. Never built with a template literal — the key sweep reads these. */
export function scanFailureKey(reason: ScanFailure): string {
  switch (reason) {
    case 'unknown':
      return 'scoring.scan.errorUnknown';
    case 'expired':
      return 'scoring.scan.errorExpired';
    case 'forbidden':
      return 'scoring.scan.errorForbidden';
    case 'offline':
      return 'scoring.scan.errorOffline';
    case 'failed':
      return 'scoring.scan.errorFailed';
  }
}
