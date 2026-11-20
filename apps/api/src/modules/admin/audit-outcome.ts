/**
 * The Result an audit row shows (ruling 914): one rule, on the server.
 *
 * Only system actions record how they ended: a restart, a prune or a certificate renewal stores
 * `ok`, its exit code and `timedOut` (`system-actions.service.ts`; a renewal also `scheduled`); a
 * backup stores the status the ops runner gave when it started (`backups.service.ts`). Every other row is written after its
 * change succeeded and records no outcome, so it has none here: the console shows a dash.
 */
export type AuditOutcome = 'succeeded' | 'failed' | 'started';

export function auditOutcome(action: string, payload: unknown): AuditOutcome | null {
  if (!action.startsWith('system.')) return null;
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const { ok, timedOut, status, scheduled } = payload as Record<string, unknown>;
  if (ok === false || timedOut === true || status === 'failed') return 'failed';
  // A renewal: the runner answers before it restarts Traefik, so nothing has renewed yet.
  if (scheduled === true || status === 'running') return 'started';
  if (ok === true) return 'succeeded';
  return null;
}
