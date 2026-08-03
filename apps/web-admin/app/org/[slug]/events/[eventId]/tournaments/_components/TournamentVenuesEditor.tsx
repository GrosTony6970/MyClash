'use client';

import { useEffect, useState } from 'react';
import { t } from '@myclash/i18n';
import { useToast } from '@myclash/ui';
import { getPublicApiUrl } from '@/lib/api-url';

const apiUrl = getPublicApiUrl();

interface VenueOption {
  id: string;
  name: string;
}

/**
 * Per-phase venue picker for a tournament: assign which venue the Pools, the
 * Swiss rounds and the Bracket run at. Used both in the create wizard (Step 4)
 * and the tournament settings (Venues tab). Saving stores INTENT (PUT
 * /tournaments/:id/phase-venues) — it steers future scheduling but does not
 * move existing matches. The explicit "Move now" buttons re-point a phase's
 * already-scheduled matches on demand.
 *
 * Finals run with the bracket, so they share its venue and have no row here.
 */
type PhaseVenueKind = 'pool' | 'swiss' | 'bracket';
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
  const [swissVenueId, setSwissVenueId] = useState<string>('');
  const [bracketVenueId, setBracketVenueId] = useState<string>('');
  // The persisted assignment (≠ the editing selects) — gates the "Move now" buttons.
  const [savedPool, setSavedPool] = useState<string>('');
  const [savedSwiss, setSavedSwiss] = useState<string>('');
  const [savedBracket, setSavedBracket] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [movingKind, setMovingKind] = useState<PhaseVenueKind | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch(`${apiUrl}/api/v1/events/${eventId}/venues`, { credentials: 'include' }).then((r) =>
        r.ok ? r.json() : [],
      ),
      fetch(`${apiUrl}/api/v1/tournaments/${tournamentId}/phase-venues`, {
        credentials: 'include',
      }).then((r) => (r.ok ? r.json() : { pool: null, swiss: null, bracket: null })),
    ])
      .then(([venueRows, phaseVenues]) => {
        if (cancelled) return;
        const opts = (Array.isArray(venueRows) ? venueRows : [])
          .filter((v: Record<string, unknown>) => v['hosts_tournament'] !== false)
          .map((v: Record<string, unknown>) => ({ id: String(v['id']), name: String(v['name']) }));
        setVenues(opts);
        const pool = phaseVenues?.pool?.id ?? '';
        const swiss = phaseVenues?.swiss?.id ?? '';
        const bracket = phaseVenues?.bracket?.id ?? '';
        setPoolVenueId(pool);
        setSwissVenueId(swiss);
        setBracketVenueId(bracket);
        setSavedPool(pool);
        setSavedSwiss(swiss);
        setSavedBracket(bracket);
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
        body: JSON.stringify({
          pool: poolVenueId || null,
          swiss: swissVenueId || null,
          bracket: bracketVenueId || null,
        }),
      });
      if (!res.ok) throw new Error(t('organizer.tournaments.venuesEditor.saveError'));
      setSavedPool(poolVenueId);
      setSavedSwiss(swissVenueId);
      setSavedBracket(bracketVenueId);
      toast.success(t('organizer.tournaments.venuesEditor.saved'));
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : t('organizer.tournaments.venuesEditor.saveError'),
      );
    } finally {
      setSaving(false);
    }
  }

  async function moveNow(kind: PhaseVenueKind) {
    setMovingKind(kind);
    try {
      const res = await fetch(
        `${apiUrl}/api/v1/tournaments/${tournamentId}/phase-venues/${kind}/apply`,
        { method: 'POST', credentials: 'include' },
      );
      if (!res.ok) throw new Error(t('organizer.tournaments.venuesEditor.moveError'));
      const body = (await res.json()) as { moved?: number };
      toast.success(t('organizer.tournaments.venuesEditor.moved', { count: body.moved ?? 0 }));
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : t('organizer.tournaments.venuesEditor.moveError'),
      );
    } finally {
      setMovingKind(null);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-display font-semibold text-lg sm:text-xl text-foreground">
          {t('organizer.tournaments.venuesEditor.title')}
        </h2>
        <p className="mt-1 text-sm text-muted">{t('organizer.tournaments.venuesEditor.help')}</p>
      </div>

      {loading ? (
        <p className="text-sm text-muted">{t('organizer.tournaments.venuesEditor.loading')}</p>
      ) : venues.length === 0 ? (
        <p className="rounded-md border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning">
          {t('organizer.tournaments.venuesEditor.empty')}
        </p>
      ) : (
        <fieldset className="space-y-3 rounded-md border border-border p-4">
          <VenueSelect
            label={t('organizer.tournaments.venuesEditor.pools')}
            value={poolVenueId}
            venues={venues}
            onChange={setPoolVenueId}
          />
          <VenueSelect
            label={t('organizer.tournaments.venuesEditor.swiss')}
            value={swissVenueId}
            venues={venues}
            onChange={setSwissVenueId}
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
        className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-accent-foreground hover:bg-accent-hover disabled:opacity-50"
      >
        {saving ? t('common.saving') : t('organizer.tournaments.settings.save')}
      </button>

      {(savedPool || savedSwiss || savedBracket) && (
        <div className="rounded-md border border-border bg-background p-4">
          <p className="text-sm text-foreground-secondary">
            {t('organizer.tournaments.venuesEditor.moveHelp')}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {savedPool && (
              <button
                type="button"
                onClick={() => void moveNow('pool')}
                disabled={movingKind !== null}
                className="rounded-md border border-border bg-surface px-3 py-1.5 text-xs font-semibold text-foreground-secondary hover:bg-background disabled:opacity-50"
              >
                {movingKind === 'pool'
                  ? t('common.saving')
                  : t('organizer.tournaments.venuesEditor.movePools')}
              </button>
            )}
            {savedSwiss && (
              <button
                type="button"
                onClick={() => void moveNow('swiss')}
                disabled={movingKind !== null}
                className="rounded-md border border-border bg-surface px-3 py-1.5 text-xs font-semibold text-foreground-secondary hover:bg-background disabled:opacity-50"
              >
                {movingKind === 'swiss'
                  ? t('common.saving')
                  : t('organizer.tournaments.venuesEditor.moveSwiss')}
              </button>
            )}
            {savedBracket && (
              <button
                type="button"
                onClick={() => void moveNow('bracket')}
                disabled={movingKind !== null}
                className="rounded-md border border-border bg-surface px-3 py-1.5 text-xs font-semibold text-foreground-secondary hover:bg-background disabled:opacity-50"
              >
                {movingKind === 'bracket'
                  ? t('common.saving')
                  : t('organizer.tournaments.venuesEditor.moveBracket')}
              </button>
            )}
          </div>
        </div>
      )}
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
      <span className="text-sm text-foreground-secondary">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-64 rounded-md border border-border px-3 py-1.5 text-sm"
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
