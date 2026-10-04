/**
 * What the bout screen's sync bar says, and in which tone.
 *
 * Pure, out of the page: web-staff has no React test setup, so a decision that
 * lives inside a component is one nothing can assert.
 */

import type { CallerRefusal } from '../offline/caller-refusal';
import type { SyncStatus } from '../offline/sync';

export type SyncPhase = 'online' | 'syncing' | 'offline' | 'error' | 'signed-out' | CallerRefusal;

type Translate = (key: string, values?: Record<string, string | number>) => string;

/** Browser-offline always wins; otherwise the bar follows the engine's phase. */
export function syncPhaseOf(
  networkStatus: 'online' | 'offline',
  status: SyncStatus | undefined,
): SyncPhase {
  if (networkStatus === 'offline' || status === 'offline') return 'offline';
  if (status === undefined || status === 'idle') return 'online';
  return status;
}

/**
 * A state the operator must act on: a failed sync, a session that has ended
 * (ruling 241), or a person the server will not let score (rulings 244, 245).
 * All are red and all offer Retry.
 */
export function needsOperator(phase: SyncPhase): boolean {
  return phase !== 'online' && phase !== 'syncing' && phase !== 'offline';
}

/**
 * Ruling 244a: an account with no scoring role is signed in on this tablet,
 * and its login outranks the PIN. Signing it out is the way out, and the bout
 * screen has no other sign-out.
 */
export function offersAccountSignOut(phase: SyncPhase): boolean {
  return phase === 'account-refused';
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
    case 'account-refused':
      return `⚠ ${t('scoring.lice.accountCannotScore')}`;
    case 'pin-disabled':
      return `⚠ ${t('scoring.lice.pinDisabled')}`;
    case 'pin-role-refused':
      return `⚠ ${t('scoring.lice.pinRoleCannotScore')}`;
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
