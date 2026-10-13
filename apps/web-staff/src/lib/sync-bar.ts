/**
 * What the bout screen's sync bar says, and in which tone.
 *
 * Pure, out of the page: web-staff has no React test setup, so a decision that
 * lives inside a component is one nothing can assert.
 */

import type { CallerRefusal } from '../offline/caller-refusal';
import type { SyncStatus } from '../offline/sync';

export type SyncPhase =
  'online' | 'syncing' | 'offline' | 'maintenance' | 'error' | 'signed-out' | CallerRefusal;

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
 * All are red; `offersRetry` says which offer Retry. Not maintenance (ruling
 * 335): like offline, the hits wait for something the operator cannot change.
 */
export function needsOperator(phase: SyncPhase): boolean {
  return (
    phase !== 'online' && phase !== 'syncing' && phase !== 'offline' && phase !== 'maintenance'
  );
}

/**
 * Retry is offered while it can do something (ruling 291). When all the tablet
 * holds are hits no new send can cure, Retry would send nothing: the inbox is
 * the way out, and the bar offers it alone.
 */
export function offersRetry(
  phase: SyncPhase,
  held: { rejected: number; sendable: number; pending: number },
): boolean {
  // Nothing tells the pad that read-only mode ended: Retry is how the hits go
  // once somebody says it has.
  if (phase === 'maintenance') return held.pending > 0;
  if (!needsOperator(phase)) return false;
  // A refusal about the caller with no hit waiting (a refused press, ruling
  // 311): Retry would send nothing, and a held hit would meet the same answer.
  if (phase !== 'error' && held.pending === 0) return false;
  const onlyIncurable = held.rejected > 0 && held.sendable === 0 && held.pending === 0;
  return !(phase === 'error' && onlyIncurable);
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
 * A refused entry in the inbox while the queue waits, for the network or for
 * the end of read-only mode (operator, 2026-10-13, both): it needs the
 * official whatever the queue waits for. The bar is red and says both. The
 * phase stays what it is, and so does its Retry: none with no network, and
 * the one of read-only mode while a hit waits.
 */
function refusedWhileWaiting(phase: SyncPhase, rejected: number): boolean {
  return (phase === 'offline' || phase === 'maintenance') && rejected > 0;
}

/**
 * Offline is neutral, not red: in a sports hall it is the expected state and
 * the outbox is doing its job. Read-only mode is neutral too. That frees
 * danger for the states that need the operator, and for a refused entry the
 * inbox holds (`refusedWhileWaiting`).
 */
export function syncBarTone(phase: SyncPhase, rejected: number): string {
  if (phase === 'online') return 'bg-success/25 text-success';
  if (phase === 'syncing') return 'bg-warning/25 text-warning animate-pulse';
  if (needsOperator(phase) || refusedWhileWaiting(phase, rejected)) {
    return 'bg-danger/25 text-danger';
  }
  return 'bg-muted/25 text-muted animate-pulse';
}

/** What the inbox holds, in the bar's words: a refused clock press is said first. */
function refusedWords(rejected: number, heldPresses: number, t: Translate): string {
  if (heldPresses > 0) return t('scoring.lice.pressRefused');
  return t('scoring.lice.hitsRefused', {
    count: String(rejected),
    plural: rejected === 1 ? '' : 'S',
  });
}

/**
 * `rejected` only changes the WORDING of an error, and the wording is the
 * point: "sync error" reads as a connection problem the operator waits out, and
 * a refused hit never arrives unless they act.
 *
 * `pending` only changes the wording of a refusal about the person: a press
 * sent at once turns the bar to it with no hit queued (ruling 311), and "hits
 * not sent" would be said of no hit.
 *
 * `heldPresses` rewords an error once more: a refused clock press stops the
 * rows of its bout behind it, so the bar says that first, whatever else is held.
 *
 * With no network a refused entry is still said, and "no connection" after it.
 * In read-only mode too, and "maintenance" after it.
 */
export function syncBarLabel(
  phase: SyncPhase,
  rejected: number,
  t: Translate,
  pending: number,
  heldPresses: number,
): string {
  const waits = pending > 0;
  switch (phase) {
    case 'online':
      return `● ${t('scoring.lice.online')}`;
    case 'syncing':
      return `⟳ ${t('scoring.lice.syncing')}`;
    case 'signed-out':
      return `⚠ ${t('scoring.lice.sessionEnded')}`;
    case 'account-refused':
      return `⚠ ${waits ? t('scoring.lice.accountCannotScore') : t('scoring.lice.accountCannotScoreNoHits')}`;
    case 'pin-disabled':
      return `⚠ ${waits ? t('scoring.lice.pinDisabled') : t('scoring.lice.pinDisabledNoHits')}`;
    case 'pin-role-refused':
      return `⚠ ${waits ? t('scoring.lice.pinRoleCannotScore') : t('scoring.lice.pinRoleCannotScoreNoHits')}`;
    case 'offline':
      return refusedWhileWaiting(phase, rejected)
        ? `⚠ ${refusedWords(rejected, heldPresses, t)} · ${t('scoring.lice.noConnectionToo')}`
        : `● ${t('scoring.lice.offlineQueued')}`;
    case 'maintenance':
      return refusedWhileWaiting(phase, rejected)
        ? `⚠ ${refusedWords(rejected, heldPresses, t)} · ${t('scoring.lice.maintenanceToo')}`
        : `● ${t('scoring.lice.maintenanceQueued')}`;
    case 'error':
      // A held press is one of the refused entries: `rejected` counts it.
      return rejected > 0
        ? `⚠ ${refusedWords(rejected, heldPresses, t)}`
        : `⚠ ${t('scoring.lice.syncError')}`;
  }
}
