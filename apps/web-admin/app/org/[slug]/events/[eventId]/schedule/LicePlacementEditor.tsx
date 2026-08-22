'use client';

/**
 * LicePlacementEditor — says where a piste physically stands.
 *
 * Until this existed nothing in the admin could write `lices.venue_id` after
 * the event wizard ran: the grid's "Add lice" form sends a name and a colour,
 * and `PATCH /lices/:id` had no caller at all. So every piste added to a
 * running event was unplaced, and the public display picker had nothing to
 * group by — which matters the moment a tournament spreads across two halls.
 *
 * Lives in its own file rather than inside grid.tsx, which is already ~2 600
 * lines and sitting on the complexity baseline.
 */

import { useEffect, useState } from 'react';
import { Modal } from '@myclash/ui';
import { apiRequest, failureMessage } from '@myclash/api-client';
import { getPublicApiUrl } from '@/lib/api-url';
import { useI18n } from '@myclash/next-i18n/client';
import { mutateSchedule, ScheduleMutationError } from './schedule-mutations';

interface VenueArea {
  id: string;
  name: string;
  sort_order: number;
}

interface EventVenue {
  id: string;
  name: string;
  venue_areas: VenueArea[] | null;
}

export interface EditableLice {
  id: string;
  name: string;
  venues?: { id: string; name: string } | null;
  venue_areas?: { id: string; name: string } | null;
}

interface Props {
  eventId: string;
  lice: EditableLice;
  onClose: () => void;
  /** Called after a successful PATCH so the caller can refetch its lice list. */
  onSaved: () => void | Promise<void>;
}

export function LicePlacementEditor({ eventId, lice, onClose, onSaved }: Props) {
  const { t } = useI18n();
  const apiUrl = getPublicApiUrl();

  const [venues, setVenues] = useState<EventVenue[]>([]);
  const [venueId, setVenueId] = useState(lice.venues?.id ?? '');
  const [areaId, setAreaId] = useState(lice.venue_areas?.id ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // One call covers both selects: the endpoint already embeds each venue's
    // areas, so picking a hall never costs a second round-trip.
    const controller = new AbortController();
    void apiRequest<EventVenue[]>(apiUrl, `/api/v1/events/${eventId}/venues`, {
      signal: controller.signal,
    }).then((r) => {
      // A refused read used to fall through silently, leaving an empty hall
      // dropdown indistinguishable from "this event has no venues".
      if (!r.ok) {
        // No message is this dialog closing mid-read.
        const message = failureMessage(r, t, t('organizer.schedulePage.placement.loadFailed'));
        if (message) setError(message);
        return;
      }
      setVenues(r.data);
    });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId]);

  const areas = venues.find((v) => v.id === venueId)?.venue_areas ?? [];

  function pickVenue(next: string): void {
    setVenueId(next);
    // The area belonged to the old hall; carrying it over would be a piste
    // claiming to stand in a room of a building it just left. The API
    // refuses it anyway — clearing here just avoids the pointless 400.
    setAreaId('');
  }

  async function save(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await mutateSchedule(`${apiUrl}/api/v1/lices/${lice.id}`, {
        method: 'PATCH',
        body: { venueId: venueId || null, areaId: areaId || null },
      });
      await onSaved();
      onClose();
    } catch (err) {
      // The API refuses a piste placed in a room of a building it does not
      // stand in, and it says which. That reason used to survive only because
      // the transport happened to put it on `Error.message`; it is structured
      // now, and read as such.
      const message =
        err instanceof ScheduleMutationError
          ? failureMessage(err.failure, t, t('organizer.schedulePage.placement.saveFailed'))
          : t('organizer.schedulePage.placement.saveFailed');
      if (message) setError(message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      busy={busy}
      size="md"
      title={t('organizer.schedulePage.placement.title', { lice: lice.name })}
      description={t('organizer.schedulePage.placement.help')}
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="text-sm text-muted hover:text-foreground disabled:opacity-50"
          >
            {t('actions.cancel')}
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={busy}
            className="rounded-md bg-accent px-4 py-2 text-sm font-bold text-accent-foreground transition hover:bg-accent-hover disabled:opacity-50"
          >
            {t('actions.save')}
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-semibold">{t('organizer.schedulePage.placement.venue')}</span>
          <select
            value={venueId}
            onChange={(e) => pickVenue(e.target.value)}
            disabled={busy}
            className="rounded-md border border-border bg-surface px-3 py-2 text-sm"
          >
            <option value="">{t('organizer.schedulePage.placement.noVenue')}</option>
            {venues.map((venue) => (
              <option key={venue.id} value={venue.id}>
                {venue.name}
              </option>
            ))}
          </select>
        </label>

        {/* 0088's rule: a venue with no named areas means the lice links to
            the venue directly, so there is nothing to choose. */}
        {areas.length > 0 && (
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-semibold">{t('organizer.schedulePage.placement.area')}</span>
            <select
              value={areaId}
              onChange={(e) => setAreaId(e.target.value)}
              disabled={busy}
              className="rounded-md border border-border bg-surface px-3 py-2 text-sm"
            >
              <option value="">{t('organizer.schedulePage.placement.noArea')}</option>
              {[...areas]
                .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name))
                .map((area) => (
                  <option key={area.id} value={area.id}>
                    {area.name}
                  </option>
                ))}
            </select>
          </label>
        )}

        {error && <p className="text-sm text-danger">{error}</p>}
      </div>
    </Modal>
  );
}
