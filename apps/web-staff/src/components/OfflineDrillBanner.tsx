'use client';

import { useEffect, useState } from 'react';
import { useI18n } from '@myclash/next-i18n/client';
import {
  drillRemainingMs,
  endOfflineDrill,
  isDrillActiveAt,
  useOfflineDrillEndsAt,
} from '../offline/drill';
import { getApiUrl } from '../lib/api-url';
import { getSyncEngine } from '../offline/sync';

/**
 * The end of a drill: on "End drill", and when its time has passed (also on a
 * tablet that slept through it). The queue is sent then, with no tap
 * (operator, 2026-10-12): nothing else did, and a drill left the bar on
 * "OFFLINE" over entries until the next press. The race is a send that met
 * the drill and is still being filed: this waits it out, then sends
 * (`sendAfterReconnect`, what the `online` event asks).
 */
function endDrillAndSend(): void {
  endOfflineDrill();
  getSyncEngine(getApiUrl()).sendAfterReconnect();
}

/**
 * The drill's on-screen presence: unmistakable, and always abortable.
 *
 * Both properties are safety requirements rather than polish. A tablet that is
 * deliberately refusing to sync looks EXACTLY like one that has genuinely lost
 * the venue wifi — that is the point of the exercise, and it is also how a
 * drill turns into a real incident when someone walks up mid-match and starts
 * scoring for real. So the banner says DRILL in the largest words on the
 * screen, and the way out is in the banner itself rather than behind a menu.
 *
 * Mounted in the staff layout, so it follows the crew from the piste list into
 * a match and back — a drill they can navigate away from the reminder of is a
 * drill someone forgets is running.
 */
export function OfflineDrillBanner() {
  const { t } = useI18n();
  const endsAt = useOfflineDrillEndsAt();
  const remaining = useCountdown(endsAt);

  if (!endsAt) return null;

  return (
    <div
      data-testid="offline-drill-banner"
      role="status"
      className="flex items-center justify-between gap-3 bg-warning px-4 py-2 text-warning-foreground"
    >
      <span className="text-sm font-bold uppercase tracking-wide">
        {t('scoring.drill.banner', { seconds: String(Math.ceil(remaining / 1000)) })}
      </span>
      <button
        type="button"
        onClick={endDrillAndSend}
        className="min-h-[36px] shrink-0 rounded-lg border border-warning-foreground/40 px-3 text-xs font-bold uppercase"
      >
        {t('scoring.drill.end')}
      </button>
    </div>
  );
}

/**
 * A once-a-second tick, running only while a drill is set.
 *
 * The drill self-expires on read — `isDrillActive` compares timestamps and
 * needs no timer — but the COUNTDOWN has to re-render to move, and the banner
 * has to disappear when the window closes without anyone touching the screen.
 * The drill is ENDED on expiry rather than just hidden: that clears the stored
 * timestamp too, so the next mount does not resurrect a finished drill.
 */
function useCountdown(endsAt: number): number {
  const [now, setNow] = useState(0);

  useEffect(() => {
    if (!endsAt) return;
    const id = setInterval(() => {
      const tick = Date.now();
      setNow(tick);
      if (!isDrillActiveAt(endsAt, tick)) endDrillAndSend();
    }, 1_000);
    return () => clearInterval(id);
  }, [endsAt]);

  return drillRemainingMs(endsAt, now || endsAt);
}
