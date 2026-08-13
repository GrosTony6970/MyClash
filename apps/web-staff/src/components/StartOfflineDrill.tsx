'use client';

import { useEffect, useState } from 'react';
import { useI18n } from '@myclash/next-i18n/client';
import { canStartDrill, startOfflineDrill, useOfflineDrillEndsAt } from '../offline/drill';
import { rejectedCount, totalPendingCount } from '../offline/outbox';

/**
 * Where a drill is started: the piste list, before anyone picks a match.
 *
 * Deliberately NOT on the scoring pad. The crew should walk into the offline
 * experience on purpose and then go score, rather than discover mid-bout that
 * a tap they half-remember has stopped their hits leaving.
 */
export function StartOfflineDrill() {
  const { t } = useI18n();
  const endsAt = useOfflineDrillEndsAt();
  const blocked = useOutboxBlocked();

  if (endsAt) return null;

  return (
    <div className="mt-6 rounded-lg border border-dashed border-border p-3">
      <p className="text-xs text-muted">{t('scoring.drill.explain')}</p>
      <button
        type="button"
        onClick={() => startOfflineDrill()}
        disabled={blocked}
        data-testid="start-offline-drill"
        className="mt-2 min-h-[44px] rounded-lg border border-border px-4 text-sm font-semibold disabled:opacity-50"
      >
        {t('scoring.drill.start')}
      </button>
      {blocked && <p className="mt-2 text-xs text-warning">{t('scoring.drill.blocked')}</p>}
    </div>
  );
}

/**
 * State-free at module scope so the effect below holds no setState call —
 * `react-hooks/set-state-in-effect` is an error in this app.
 */
function readOutboxBusy(): Promise<boolean> {
  return (
    Promise.all([totalPendingCount(), rejectedCount()])
      .then(([pending, rejected]) => !canStartDrill(pending, rejected))
      // A Dexie read that fails must not lock the button out: the drill is a
      // training aid, and refusing to start one because IndexedDB hiccuped would
      // be a worse failure than allowing it.
      .catch(() => false)
  );
}

/**
 * Whether a drill is currently refused.
 *
 * Re-checked on a slow interval rather than once: the outbox drains while this
 * page is open, so a button disabled on mount because two hits were still in
 * flight must enable itself when they land — otherwise the crew concludes the
 * drill is broken.
 */
function useOutboxBlocked(): boolean {
  const [blocked, setBlocked] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const check = () => {
      void readOutboxBusy().then((busy) => {
        if (!cancelled) setBlocked(busy);
      });
    };
    check();
    const id = setInterval(check, 3_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  return blocked;
}
