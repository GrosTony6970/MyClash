/**
 * Whether to show the "Reconnecting…" banner. A finished match (completed /
 * voided) is static — there's nothing to stream — so the banner is suppressed
 * even while the realtime channel is down. Only a live (non-final) match that
 * lost its connection shows it.
 *
 * Pure: no React, no I/O.
 */
export function showReconnecting(connected: boolean, status: string): boolean {
  if (connected) return false;
  return status !== 'completed' && status !== 'voided';
}
