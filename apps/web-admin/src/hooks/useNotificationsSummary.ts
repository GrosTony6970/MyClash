'use client';

import { useEffect, useState } from 'react';

export interface NotificationsSummary {
  reviewQueue: number;
  broadcastFailures: number;
  aiFindings: number;
  aiScanCrashes: number;
  total: number;
}

const POLL_INTERVAL_MS = 60_000;

/**
 * Polls /api/v1/admin/notifications/summary every 60 s. Drives the
 * Review-Queue sidebar badge and the header notification bell.
 *
 * `enabled` is the super-admin gate — the SuperAdminShell already
 * confirms admin status against /me, so consumers can pass true once
 * they're inside the shell. When false, no fetches run and the hook
 * returns null.
 *
 * The hook fetches once on mount + at every interval; consumers
 * default count to 0 while `null` so zero-state pills don't flash.
 */
export function useNotificationsSummary(
  apiUrl: string,
  enabled: boolean,
): NotificationsSummary | null {
  const [summary, setSummary] = useState<NotificationsSummary | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;

    async function tick() {
      try {
        const res = await fetch(`${apiUrl}/api/v1/admin/notifications/summary`, {
          credentials: 'include',
        });
        if (!cancelled && res.ok) {
          setSummary((await res.json()) as NotificationsSummary);
        }
      } catch {
        // Best-effort — the bell is informational, not transactional.
        // A transient network hiccup shouldn't reset the displayed
        // count, so swallow the error and let the next interval try.
      }
    }

    void tick();
    const interval = setInterval(() => void tick(), POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [apiUrl, enabled]);

  return summary;
}
