'use client';

import { useEffect, useState } from 'react';
import { t } from '@myclash/i18n';
import { useToast } from '@myclash/ui';

const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';

interface VenueOption {
  id: string;
  name: string;
}

/**
 * Per-phase venue picker for a tournament: assign which venue the Pools and the
 * Bracket run at. Used both in the create wizard (Step 4) and the tournament
 * settings (Venues tab). Stores intent via PUT /tournaments/:id/phase-venues —
 * existing matches are not moved here (that's the schedule board's "Move now").
 */
export function TournamentVenuesEditor({
  tournamentId,
  eventId,
}: {
  tournamentId: string;
  eventId: string;
}) {
  const toast = useToast();
  const [venues, setVenues] = useState<VenueOption[]>([]);
  const [poolVenueId, setPoolVenueId] = useState<string>('');
  const [bracketVenueId, setBracketVenueId] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch(`${apiUrl}/api/v1/events/${eventId}/venues`, { credentials: 'include' }).then((r) =>
        r.ok ? r.json() : [],
      ),
      fetch(`${apiUrl}/api/v1/tournaments/${tournamentId}/phase-venues`, {
        credentials: 'include',
      }).then((r) => (r.ok ? r.json() : { pool: null, bracket: null })),
    ])
      .then(([venueRows, phaseVenues]) => {
        if (cancelled) return;
        const opts = (Array.isArray(venueRows) ? venueRows : [])
          .filter((v: Record<string, unknown>) => v['hosts_tournament'] !== false)
          .map((v: Record<string, unknown>) => ({ id: String(v['id']), name: String(v['name']) }));
        setVenues(opts);
        setPoolVenueId(phaseVenues?.pool?.id ?? '');
        setBracketVenueId(phaseVenues?.bracket?.id ?? '');
      })
      .catch(() => {
        if (!cancelled) toast.error(t('organizer.tournaments.venuesEditor.loadError'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tournamentId, eventId]);

  async function save() {
    setSaving(true);
    try {
      const res = await fetch(`${apiUrl}/api/v1/tournaments/${tournamentId}/phase-venues`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pool: poolVenueId || null, bracket: bracketVenueId || null }),
      });
      if (!res.ok) throw new Error(t('organizer.tournaments.venuesEditor.saveError'));
      toast.success(t('organizer.tournaments.venuesEditor.saved'));
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : t('organizer.tournaments.venuesEditor.saveError'),
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-display text-xl text-slate-900">
          {t('organizer.tournaments.venuesEditor.title')}
        </h2>
        <p className="mt-1 text-sm text-slate-500">
          {t('organizer.tournaments.venuesEditor.help')}
        </p>
      </div>

      {loading ? (
        <p className="text-sm text-slate-500">{t('organizer.tournaments.venuesEditor.loading')}</p>
      ) : venues.length === 0 ? (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {t('organizer.tournaments.venuesEditor.empty')}
        </p>
      ) : (
        <fieldset className="space-y-3 rounded-md border border-slate-200 p-4">
          <VenueSelect
            label={t('organizer.tournaments.venuesEditor.pools')}
            value={poolVenueId}
            venues={venues}
            onChange={setPoolVenueId}
          />
          <VenueSelect
            label={t('organizer.tournaments.venuesEditor.bracket')}
            value={bracketVenueId}
            venues={venues}
            onChange={setBracketVenueId}
          />
        </fieldset>
      )}

      <button
        type="button"
        onClick={() => void save()}
        disabled={saving || loading || venues.length === 0}
        className="rounded-md bg-red-800 px-4 py-2 text-sm font-semibold text-white hover:bg-red-900 disabled:opacity-50"
      >
        {saving ? t('common.saving') : t('organizer.tournaments.settings.save')}
      </button>
    </div>
  );
}

function VenueSelect({
  label,
  value,
  venues,
  onChange,
}: {
  label: string;
  value: string;
  venues: VenueOption[];
  onChange: (v: string) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-3">
      <span className="text-sm text-slate-700">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-64 rounded-md border border-slate-300 px-3 py-1.5 text-sm"
      >
        <option value="">{t('organizer.tournaments.venuesEditor.none')}</option>
        {venues.map((v) => (
          <option key={v.id} value={v.id}>
            {v.name}
          </option>
        ))}
      </select>
    </label>
  );
}
