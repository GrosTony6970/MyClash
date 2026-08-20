'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiRequest } from '@myclash/api-client';

import { identityRetryDelayMs } from '../components/identity-retry';

/**
 * The `/api/v1/me` read both admin shells open with, and the retry the operator
 * needed when it fails for a reason that is not "you are signed out".
 *
 * ── Why one hook and not one copy per shell ─────────────────────────────────
 * `OrganizerAdminShell` and `SuperAdminShell` carried this effect BYTE FOR BYTE
 * — same fetch, same `!res.ok → /login`, same
 * `err instanceof DOMException && err.name === 'AbortError'`. Adding a retry
 * budget and a banner to each would have been the moment the two copies started
 * to drift, which is the failure CLAUDE.md names. What differs between the two
 * shells is what they DO with the payload, and that stays in the shells:
 * the organizer one runs `resolveAuthDecision`, the platform one demands a
 * `platformRole`.
 *
 * ── The four answers ────────────────────────────────────────────────────────
 * `resolved` carries the body and says nothing about whether it is a session —
 * being signed out is a 200 with `type: 'anonymous'` and the shells read that
 * themselves. `denied` is a 401/403, abnormal on a `@Public()` route but still
 * an answer. `unreachable` is the outage: the retry budget is spent and the
 * operator has NOT been signed out, so the shell says so instead of bouncing
 * them to /login and losing whatever they had open.
 *
 * The retry policy lives in `identity-retry.ts` so it can be unit-tested; hooks
 * cannot be, here (no @testing-library, no `@/` alias in the app vitest config).
 */
export type IdentityState<T> =
  | { status: 'checking' }
  | { status: 'resolved'; me: T }
  | { status: 'denied' }
  | { status: 'unreachable' };

export interface IdentityGate<T> {
  state: IdentityState<T>;
  /** Restarts the whole budget. Wired to the banner's button. */
  retry: () => void;
}

export function useIdentityGate<T>(apiUrl: string): IdentityGate<T> {
  const [state, setState] = useState<IdentityState<T>>({ status: 'checking' });
  // Bumping this re-runs the effect from a clean attempt count. A boolean would
  // only work once.
  const [attemptId, setAttemptId] = useState(0);
  const retry = useCallback(() => {
    setState({ status: 'checking' });
    setAttemptId((n) => n + 1);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let timer: number | undefined;
    let failedAttempts = 0;
    // The abort fires the effect's own cleanup, but a timer already queued has
    // no signal to observe — this is what stops it landing after unmount.
    let cancelled = false;

    const ask = async () => {
      const result = await apiRequest<T>(apiUrl, '/api/v1/me', { signal: controller.signal });
      if (cancelled) return;
      if (result.ok) {
        setState({ status: 'resolved', me: result.data });
        return;
      }
      failedAttempts += 1;
      const delay = identityRetryDelayMs(result, failedAttempts);
      if (delay === null) {
        // An abort is the unmount or a newer attempt; it owns the state now.
        if (result.kind === 'aborted') return;
        setState(
          result.kind === 'unauthenticated' ? { status: 'denied' } : { status: 'unreachable' },
        );
        return;
      }
      timer = window.setTimeout(() => void ask(), delay);
    };

    void ask();

    return () => {
      cancelled = true;
      controller.abort();
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [apiUrl, attemptId]);

  return { state, retry };
}
