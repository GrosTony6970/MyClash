/**
 * What the bout screen's sync bar says, and in which tone.
 *
 * Pure, out of the page: web-staff has no React test setup, so a decision that
 * lives inside a component is one nothing can assert.
 */

import type { SyncStatus } from '../offline/sync';

export type SyncPhase = 'online' | 'syncing' | 'offline' | 'error' | 'signed-out';

type Translate = (key: string, values?: Record<string, string | number>) => string;

/** Browser-offline always wins; otherwise the bar follows the engine's phase. */
export function syncPhaseOf(
  networkStatus: 'online' | 'offline',
  status: SyncStatus | undefined,
): SyncPhase {
  if (networkStatus === 'offline' || status === 'offline') return 'offline';
  if (status === 'syncing' || status === 'signed-out' || status === 'error') return status;
  return 'online';
}

/**
 * A state the operator must act on: a failed sync, or a session that has ended
 * (ruling 241). Both are red and both offer Retry.
 */
export function needsOperator(phase: SyncPhase): boolean {
  return phase === 'error' || phase === 'signed-out';
}

/**
 * Offline is neutral, not red: in a sports hall it is the expected state and
 * the outbox is doing its job. That frees danger for the states that need the
 * operator.
 */
export function syncBarTone(phase: SyncPhase): string {
  if (phase === 'online') return 'bg-success/25 text-success';
  if (phase === 'syncing') return 'bg-warning/25 text-warning animate-pulse';
  if (needsOperator(phase)) return 'bg-danger/25 text-danger';
  return 'bg-muted/25 text-muted animate-pulse';
}

/**
 * `rejected` only changes the WORDING of an error, and the wording is the
 * point: "sync error" reads as a connection problem the operator waits out, and
 * a refused hit never arrives unless they act.
 */
export function syncBarLabel(phase: SyncPhase, rejected: number, t: Translate): string {
  switch (phase) {
    case 'online':
      return `● ${t('scoring.lice.online')}`;
    case 'syncing':
      return `⟳ ${t('scoring.lice.syncing')}`;
    case 'signed-out':
      return `⚠ ${t('scoring.lice.sessionEnded')}`;
    case 'offline':
      return `● ${t('scoring.lice.offlineQueued')}`;
    case 'error':
      return rejected > 0
        ? `⚠ ${t('scoring.lice.hitsRefused', {
            count: String(rejected),
            plural: rejected === 1 ? '' : 'S',
          })}`
        : `⚠ ${t('scoring.lice.syncError')}`;
  }
}
