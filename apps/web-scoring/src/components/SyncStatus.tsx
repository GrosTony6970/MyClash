'use client';

/**
 * SyncStatus.tsx — T-505
 *
 * Prominent network/sync indicator for every scoring screen.
 *
 * Four explicit states:
 *   online      — connected, outbox empty
 *   syncing     — draining outbox to server
 *   offline     — no network
 *   sync_error  — network present but sync failed
 *
 * Sync error shows actionable message (retry button + contact admin).
 */

import { useCallback, useEffect, useState } from 'react';
import { useI18n } from '../i18n/I18nProvider';
import type { SyncState, SyncStatus } from '../offline/sync';

type TranslateFn = ReturnType<typeof useI18n>['t'];

export interface SyncStatusProps {
  /** Current sync state from SyncEngine.subscribe(). */
  syncState: SyncState | null;
  /** Called when user taps Retry. */
  onRetry?: () => void;
  /** Compact mode — single line, no expanded error. */
  compact?: boolean;
}

// ── Status config ─────────────────────────────────────────────────────────────

interface StatusConfig {
  label: string;
  sublabel?: string;
  dot: string;
  bar: string;
  pulse: boolean;
}

function getConfig(status: SyncStatus, pendingCount: number, t: TranslateFn): StatusConfig {
  switch (status) {
    case 'idle':
      return {
        label: t('scoring.sync.online'),
        sublabel:
          pendingCount > 0 ? t('scoring.sync.syncedCount', { count: pendingCount }) : undefined,
        dot: 'bg-success',
        bar: 'bg-success/25',
        pulse: false,
      };
    case 'syncing':
      return {
        label: t('scoring.sync.syncing'),
        sublabel: t('scoring.sync.pendingCount', { count: pendingCount }),
        dot: 'bg-warning',
        bar: 'bg-warning/25',
        pulse: true,
      };
    case 'offline':
      return {
        label: t('scoring.sync.offline'),
        sublabel:
          pendingCount > 0
            ? t('scoring.sync.queuedCount', { count: pendingCount })
            : t('scoring.sync.noConnection'),
        dot: 'bg-danger',
        bar: 'bg-danger/25',
        pulse: true,
      };
    case 'error':
      // Raw orange ON PURPOSE: 4-state categorical set (green/yellow/red/orange);
      // mapping to warning would collide with the syncing state.
      return {
        label: t('scoring.sync.error'),
        sublabel:
          pendingCount > 0 ? t('scoring.sync.notSyncedCount', { count: pendingCount }) : undefined,
        dot: 'bg-orange-400',
        bar: 'bg-orange-950',
        pulse: false,
      };
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

export function SyncStatus({ syncState, onRetry, compact = false }: SyncStatusProps) {
  const { t } = useI18n();
  // Track network online/offline independently of sync state
  const [networkOnline, setNetworkOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true,
  );

  useEffect(() => {
    const handleOnline = () => setNetworkOnline(true);
    const handleOffline = () => setNetworkOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Derive effective status
  const effectiveStatus: SyncStatus = !networkOnline ? 'offline' : (syncState?.status ?? 'idle');

  const pendingCount = syncState?.pendingCount ?? 0;
  const config = getConfig(effectiveStatus, pendingCount, t);
  const isError = effectiveStatus === 'error';
  const isOffline = effectiveStatus === 'offline';

  if (compact) {
    return (
      <div
        className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs font-bold ${config.bar}`}
        role="status"
        aria-live="polite"
      >
        <span
          className={`w-2 h-2 rounded-full ${config.dot} ${config.pulse ? 'animate-pulse' : ''}`}
        />
        <span className="text-foreground">{config.label}</span>
        {pendingCount > 0 && <span className="text-foreground/70 font-normal">{pendingCount}</span>}
      </div>
    );
  }

  return (
    <div
      className={`w-full px-4 py-2 ${config.bar} text-foreground`}
      role="status"
      aria-live="polite"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span
            className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${config.dot} ${
              config.pulse ? 'animate-pulse' : ''
            }`}
          />
          <div>
            <span className="text-sm font-bold">{config.label}</span>
            {config.sublabel && (
              <span className="ml-2 text-xs text-foreground/70">{config.sublabel}</span>
            )}
          </div>
        </div>

        {/* Retry button for error/offline states */}
        {(isError || isOffline) && onRetry && networkOnline && (
          <button
            onClick={onRetry}
            className="text-xs font-bold underline text-foreground/90 hover:text-foreground ml-4"
          >
            {t('scoring.sync.retry')}
          </button>
        )}
      </div>

      {/* Expanded error message */}
      {isError && syncState?.lastError && (
        <p className="text-xs text-foreground/70 mt-1 pl-4">
          {t('scoring.sync.contactAdmin', { error: syncState.lastError })}
        </p>
      )}
    </div>
  );
}

// ── Hook: wire SyncEngine to component state ──────────────────────────────────

/**
 * useSyncState — subscribe to a SyncEngine and return current SyncState.
 * Use this in any scoring screen to feed SyncStatus.
 */
export function useSyncState(
  engine: { subscribe: (l: (s: SyncState) => void) => () => void } | null,
): SyncState | null {
  const [state, setState] = useState<SyncState | null>(null);

  const stableSetState = useCallback((s: SyncState) => setState(s), []);

  useEffect(() => {
    if (!engine) return;
    const unsub = engine.subscribe(stableSetState);
    return unsub;
  }, [engine, stableSetState]);

  return state;
}
