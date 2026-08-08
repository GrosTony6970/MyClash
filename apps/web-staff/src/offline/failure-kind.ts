/**
 * What kind of failure just stopped an exchange from reaching the server?
 *
 * ── The bug this exists to fix ──────────────────────────────────────────────
 *
 * `SyncEngine.drain` had exactly one path that reported `offline`, and it sat
 * in the `catch` block — reachable only if `fetch` REJECTS. In production it
 * never does: the service worker intercepts every `/api/` request and turns a
 * dead network into a synthetic `503` carrying `{ error: 'offline' }`
 * (`public/sw.js`, `networkFirstApi`). A resolved Response is not a rejection,
 * so the catch was dead code and a genuinely offline tablet fell through to the
 * "server error" branch instead.
 *
 * What a referee saw in a hall with no wifi was therefore the RED bar —
 * "Too many consecutive failures — check connection" — rather than the neutral
 * grey "OFFLINE - exchanges queued locally" the design intends. Offline is the
 * expected state at a venue and the outbox is doing its job; red is reserved
 * for the one condition that actually needs them. Reporting the normal case as
 * an emergency is how an operator learns to ignore the bar.
 *
 * Pure: no fetch, no Dexie, no React. The classification is the part worth
 * testing, and it is a decision rather than plumbing.
 */

export type SyncFailureKind =
  /** The network is gone. Queue it and say so calmly. */
  | 'offline'
  /** The server answered and refused. This one needs the operator eventually. */
  | 'server';

/** The bit of a response body either kind might carry. */
export interface FailureBody {
  message?: string;
  error?: string;
}

/**
 * Classify a non-OK response.
 *
 * Three signals, any of which means "the network, not the server":
 *
 *   - `{ error: 'offline' }` — the service worker's own marker, the ONLY
 *     completely unambiguous one, since it is written by our code.
 *   - status 0 — a response that never had a status.
 *   - status 503 — a real one from the edge (Traefik with no API behind it,
 *     or the API restarting mid-deploy). Deliberately treated as offline even
 *     though a server is technically answering: from the referee's side the
 *     situation is identical — the hit is queued and will retry — and telling
 *     them to "check connection" is exactly the right advice anyway.
 *
 * Everything else is the server having an opinion, and is reported as such.
 */
export function classifySyncFailure(status: number, body: FailureBody | null): SyncFailureKind {
  if (body?.error === 'offline') return 'offline';
  if (status === 0 || status === 503) return 'offline';
  return 'server';
}

/**
 * The exact response the service worker gives an API call with no network.
 *
 * Kept beside the classifier that reads it, so the two can only ever be changed
 * together. The offline drill returns this rather than inventing its own
 * failure shape — a drill that produced a state the crew will never meet in a
 * hall would be worse than no drill.
 */
export function offlineResponse(): Response {
  return new Response(JSON.stringify({ error: 'offline', status: 503 }), {
    status: 503,
    headers: { 'Content-Type': 'application/json' },
  });
}
