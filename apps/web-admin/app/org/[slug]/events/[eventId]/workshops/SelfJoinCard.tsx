'use client';

import { useEffect, useState } from 'react';
import { Switch } from '@myclash/ui';
import { useI18n } from '@myclash/next-i18n/client';
import { apiRequest, failureMessage } from '@myclash/api-client';

/**
 * "People may join this Event by themselves" (rulings 516, 568): with it on, a signed-in account
 * that is not on the list may put itself on it from a Workshop page and book. Every member sees it,
 * as the photo mode and the menu card; the server refuses a save by a non-admin, and the switch
 * then goes back with the refusal shown.
 */
export function SelfJoinCard({
  apiUrl,
  eventId,
  readOnly,
}: {
  apiUrl: string;
  eventId: string;
  readOnly: boolean;
}) {
  const { t } = useI18n();
  // Null until the Event is read: the switch waits rather than show "off" for an Event that is on.
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

  return (
    <section className="mb-6 rounded-lg border border-border bg-surface p-4 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <label htmlFor="workshopSelfJoin" className="text-sm font-semibold text-foreground">
            {t('organizer.selfJoin.title')}
          </label>
          <p className="mt-1 text-sm text-muted">{t('organizer.selfJoin.help')}</p>
        </div>
        <Switch
          id="workshopSelfJoin"
          checked={on === true}
          disabled={on === null || saving || readOnly}
          onChange={(next) => void save(next)}
        />
      </div>
      {error && (
        <p role="alert" className="mt-2 text-sm text-danger">
          {error}
        </p>
      )}
    </section>
  );
}
