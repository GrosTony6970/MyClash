'use client';

import { useEffect, useState } from 'react';
import { useI18n } from '@myclash/next-i18n/client';
import { apiRequest, failureMessage } from '@myclash/api-client';

/**
 * The Event's join switch (ruling 516): its stored value, and a save that goes back on a refusal.
 * `on` is null until the Event is read, so the switch waits rather than show "off" for an Event
 * that is on.
 */
export function useSelfJoinSwitch(apiUrl: string, eventId: string) {
  const { t } = useI18n();
  const [on, setOn] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void apiRequest<{ workshop_self_join?: boolean }>(apiUrl, `/api/v1/events/${eventId}`, {
      signal: controller.signal,
    }).then((r) => {
      if (r.ok) setOn(r.data.workshop_self_join === true);
      else if (r.kind !== 'aborted')
        setError(failureMessage(r, t, t('organizer.selfJoin.loadError')));
    });
    return () => controller.abort();
  }, [apiUrl, eventId, t]);

  async function save(next: boolean) {
    setOn(next);
    setSaving(true);
    setError(null);
    try {
      const r = await apiRequest(apiUrl, `/api/v1/events/${eventId}`, {
        method: 'PATCH',
        body: { workshopSelfJoin: next },
      });
      if (r.ok) return;
      setOn(!next);
      setError(failureMessage(r, t, t('organizer.selfJoin.saveError')));
    } finally {
      setSaving(false);
    }
  }

  return { on, saving, error, save };
}
