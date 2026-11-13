'use client';

import { useId, useState } from 'react';
import { useI18n } from '@myclash/next-i18n/client';
import { Switch } from '@myclash/ui';
import { writeFightBook } from '@/lib/fightbook/read-fightbook';
import { useInFlight } from './use-in-flight';
import { useNow } from './use-now';

/**
 * "Free to spar now" at one Event. On posts for an hour (the API answers the end, capped at the
 * end of the Event day); off withdraws. A DELETE answering 204 twice is fine, so a second tap
 * never errs. The end shows as a clock time in the reader's zone: `freeUntil` is an instant and
 * the Event block reads no zone for the Event, so the phone's zone is the one at hand (the same
 * zone the ask dialog sends for a free-date spar). The switch drops off on its own when the end
 * passes (`useNow`). Mount it keyed by the Event so the state never carries to another.
 */
function useFreeNow(apiUrl: string, eventId: string, freeUntil: string | null) {
  const [until, setUntil] = useState(freeUntil);
  const [failed, setFailed] = useState(false);
  const { inFlight, run } = useInFlight();
  const now = useNow(until ? [until] : []);
  const on = until !== null && Date.parse(until) > now;
  const change = async (next: boolean) => {
    setFailed(false);
    const res = await run(eventId, () =>
      next
        ? writeFightBook<{ until: string }>(
            apiUrl,
            `/api/v1/me/fightbook/events/${encodeURIComponent(eventId)}/free`,
            'PUT',
          )
        : writeFightBook<unknown>(
            apiUrl,
            `/api/v1/me/fightbook/events/${encodeURIComponent(eventId)}/free`,
            'DELETE',
          ),
    );
    if (!res.ok) return setFailed(true);
    setUntil(next ? (res.data as { until: string }).until : null);
  };
  return { until: on ? until : null, failed, busy: inFlight(eventId), change };
}

export function FreeNowSwitch(props: {
  apiUrl: string;
  eventId: string;
  freeUntil: string | null;
}) {
  const { t, locale } = useI18n();
  const id = useId();
  const { until, failed, busy, change } = useFreeNow(props.apiUrl, props.eventId, props.freeUntil);
  const on = until !== null;
  const time =
    until !== null
      ? new Intl.DateTimeFormat(locale, {
          hour: '2-digit',
          minute: '2-digit',
          hourCycle: 'h23',
        }).format(new Date(until))
      : '';
  return (
    <div className="flex flex-col gap-1 rounded-xl border border-border bg-surface p-4">
      <div className="flex items-center gap-3">
        <label htmlFor={id} className="flex-1 text-sm font-semibold text-foreground">
          {t('publicApp.fightBook.floor.freeNow')}
        </label>
        <Switch id={id} checked={on} disabled={busy} onChange={(next) => void change(next)} />
      </div>
      <p className="text-xs text-muted">
        {on
          ? t('publicApp.fightBook.floor.freeUntil', { time })
          : t('publicApp.fightBook.floor.freeNowHint')}
      </p>
      {failed ? (
        <p role="alert" className="text-sm text-danger">
          {t('publicApp.fightBook.floor.freeFailed')}
        </p>
      ) : null}
    </div>
  );
}
