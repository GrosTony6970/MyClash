'use client';

import { useI18n } from '@myclash/next-i18n/client';
import { signAccountOut } from '../lib/account-sign-out';
import { getApiUrl } from '../lib/api-url';
import {
  needsOperator,
  offersAccountSignOut,
  syncBarLabel,
  syncBarTone,
  syncPhaseOf,
  type SyncPhase,
} from '../lib/sync-bar';
import type { SyncEngine, SyncState } from '../offline/sync';

const SOLID =
  'rounded bg-danger px-2 py-0.5 text-danger-foreground transition-colors hover:bg-danger-hover';
const OUTLINE =
  'rounded border border-danger px-2 py-0.5 text-danger transition-colors hover:bg-danger/10';

interface Actions {
  phase: SyncPhase;
  rejected: number;
  syncEngine: SyncEngine;
  onReview: () => void;
}

/** The ways out of a red bar: Retry, the account's sign-out (ruling 244a), the inbox. */
function SyncBarActions({ phase, rejected, syncEngine, onReview }: Actions) {
  const { t } = useI18n();
  // Refused exchanges are no longer in the outbox, so a plain drain would not
  // touch them: `retryRejected` re-queues them first, then drains. In any other
  // red state a held hit stays held: it would only meet the same answer.
  const retry = () =>
    void (rejected > 0 && phase === 'error' ? syncEngine.retryRejected() : syncEngine.drain());

  return (
    <>
      {needsOperator(phase) && (
        <button type="button" onClick={retry} className={SOLID}>
          {t('scoring.lice.retry')}
        </button>
      )}
      {offersAccountSignOut(phase) && (
        <button
          type="button"
          data-testid="sign-account-out"
          onClick={() => void signAccountOut(getApiUrl(), syncEngine)}
          className={OUTLINE}
        >
          {t('scoring.lice.signAccountOut')}
        </button>
      )}
      {/* Retry-everything is a guess; this is the way to find out WHAT was
          refused and why before deciding. Only offered when something is
          actually held — an empty inbox would be a dead end. */}
      {rejected > 0 && (
        <button type="button" data-testid="review-refused" onClick={onReview} className={OUTLINE}>
          {t('scoring.lice.reviewRefused')}
        </button>
      )}
    </>
  );
}

/**
 * The bout screen's sync bar: what the queue is doing, and the way out when it
 * needs the operator. Every decision is in `lib/sync-bar.ts`; this draws them.
 */
export function SyncBar({
  networkStatus,
  syncState,
  syncEngine,
  onReview,
}: {
  networkStatus: 'online' | 'offline';
  syncState: SyncState | null;
  syncEngine: SyncEngine;
  onReview: () => void;
}) {
  const { t } = useI18n();
  const pending = syncState?.pendingCount ?? 0;
  const rejected = syncState?.rejectedCount ?? 0;
  const phase = syncPhaseOf(networkStatus, syncState?.status);

  return (
    <div
      data-testid="network-bar"
      data-network={networkStatus}
      data-sync={phase}
      data-pending={pending}
      data-rejected={rejected}
      className={`flex items-center justify-center gap-2 px-4 py-1 text-xs font-bold text-center ${syncBarTone(phase)}`}
    >
      <span>
        {syncBarLabel(phase, rejected, t)}
        {pending > 0 ? ` (${pending})` : ''}
      </span>
      <SyncBarActions
        phase={phase}
        rejected={rejected}
        syncEngine={syncEngine}
        onReview={onReview}
      />
    </div>
  );
}
