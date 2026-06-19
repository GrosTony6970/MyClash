'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { t } from '@myclash/i18n';
import { useConfirm } from '@myclash/ui';

interface VenueArea {
  id: string;
  name: string;
  sort_order: number;
}

interface VenueRow {
  id: string;
  organization_id: string;
  name: string;
  address: string | null;
  hosts_tournament: boolean;
  hosts_workshop: boolean;
  sort_order: number;
  venue_areas: VenueArea[] | null;
}

const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';

/**
 * Org-level venue catalogue. Venues belong to the operator's org and
 * can be reused across many of its events. Lices (for tournaments)
 * and workshop sessions (with optional areas) point at venues; this
 * page is where the operator manages the catalogue itself.
 */
export default function OrgVenuesPage() {
  const params = useParams<{ slug: string }>();
  const slug = params.slug ?? '';
  const { confirm, confirmDialog } = useConfirm();

  const [orgId, setOrgId] = useState<string | null>(null);
  const [venues, setVenues] = useState<VenueRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [editing, setEditing] = useState<VenueRow | null>(null);
  const [creating, setCreating] = useState(false);

  const loadVenues = useCallback(async (id: string) => {
    try {
      const res = await fetch(`${apiUrl}/api/v1/organizations/${id}/venues`, {
        credentials: 'include',
      });
      if (res.ok) setVenues((await res.json()) as VenueRow[]);
    } catch {
      setMessage(t('organizer.venues.loadError'));
    }
  }, []);

  useEffect(() => {
    if (!slug) return;
    void (async () => {
      setLoading(true);
      try {
        const res = await fetch(`${apiUrl}/api/v1/organizations/slug/${encodeURIComponent(slug)}`, {
          credentials: 'include',
        });
        if (!res.ok) {
          setMessage(t('organizer.venues.loadError'));
          return;
        }
        const org = (await res.json()) as { id: string };
        setOrgId(org.id);
        await loadVenues(org.id);
      } finally {
        setLoading(false);
      }
    })();
  }, [slug, loadVenues]);

  const onDelete = async (venue: VenueRow) => {
    if (
      !(await confirm({
        title: t('organizer.venues.deleteConfirm').replace('{name}', venue.name),
        danger: true,
      }))
    )
      return;
    try {
      const res = await fetch(`${apiUrl}/api/v1/venues/${venue.id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (res.status === 409) {
        const body = (await res.json().catch(() => null)) as { message?: string } | null;
        setMessage(body?.message ?? t('organizer.venues.deleteInUse'));
        return;
      }
      if (!res.ok) {
        setMessage(t('organizer.venues.deleteError'));
        return;
      }
      if (orgId) await loadVenues(orgId);
    } catch {
      setMessage(t('organizer.venues.deleteError'));
    }
  };

  return (
    <main className="p-8">
      <div className="mb-6 flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{t('organizer.venues.title')}</h1>
          <p className="text-gray-500 text-sm mt-1">{t('organizer.venues.description')}</p>
        </div>
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="rounded-lg bg-red-700 px-3 py-2 text-sm font-semibold text-white hover:bg-red-800"
        >
          + {t('organizer.venues.newVenue')}
        </button>
      </div>

      {message && (
        <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-700">
          {message}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-gray-500">{t('admin.leagues.loading')}</p>
      ) : venues.length === 0 ? (
        <p className="text-sm text-gray-500">{t('organizer.venues.empty')}</p>
      ) : (
        <table className="w-full max-w-4xl border-collapse">
          <thead>
            <tr className="border-b border-gray-200 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">
              <th className="py-2 pr-3">{t('organizer.venues.name')}</th>
              <th className="py-2 pr-3">{t('organizer.venues.address')}</th>
              <th className="py-2 pr-3">{t('organizer.venues.hosts')}</th>
              <th className="py-2 pr-3 text-center">{t('organizer.venues.areas')}</th>
              <th className="py-2 pr-3 text-right">{t('organizer.venues.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {venues.map((v) => (
              <tr key={v.id} className="border-b border-gray-100 text-sm">
                <td className="py-3 pr-3 font-medium text-gray-900">{v.name}</td>
                <td className="py-3 pr-3 text-gray-600">{v.address ?? '—'}</td>
                <td className="py-3 pr-3">
                  <div className="flex flex-wrap gap-1">
                    {v.hosts_tournament && (
                      <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-700">
                        {t('organizer.venues.tournamentBadge')}
                      </span>
                    )}
                    {v.hosts_workshop && (
                      <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-700">
                        {t('organizer.venues.workshopBadge')}
                      </span>
                    )}
                  </div>
                </td>
                <td className="py-3 pr-3 text-center text-gray-600 tabular-nums">
                  {v.venue_areas?.length ?? 0}
                </td>
                <td className="py-3 pr-3 text-right">
                  <button
                    type="button"
                    onClick={() => setEditing(v)}
                    className="text-xs rounded-md border border-gray-300 px-2.5 py-1 hover:bg-gray-50 mr-2"
                  >
                    {t('organizer.venues.edit')}
                  </button>
                  <button
                    type="button"
                    onClick={() => void onDelete(v)}
                    className="text-xs rounded-md border border-red-300 px-2.5 py-1 text-red-700 hover:bg-red-50"
                  >
                    {t('organizer.venues.delete')}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {creating && orgId && (
        <VenueFormModal
          orgId={orgId}
          venue={null}
          onClose={() => setCreating(false)}
          onSaved={async () => {
            setCreating(false);
            if (orgId) await loadVenues(orgId);
          }}
        />
      )}

      {editing && orgId && (
        <VenueFormModal
          orgId={orgId}
          venue={editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            if (orgId) await loadVenues(orgId);
          }}
        />
      )}
      {confirmDialog}
    </main>
  );
}

// ── Create / edit modal ─────────────────────────────────────────────────────

interface VenueFormModalProps {
  orgId: string;
  venue: VenueRow | null;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}

function VenueFormModal({ orgId, venue, onClose, onSaved }: VenueFormModalProps) {
  const isEdit = venue !== null;
  const [name, setName] = useState(venue?.name ?? '');
  const [address, setAddress] = useState(venue?.address ?? '');
  const [hostsTournament, setHostsTournament] = useState(venue?.hosts_tournament ?? true);
  const [hostsWorkshop, setHostsWorkshop] = useState(venue?.hosts_workshop ?? true);
  const [areas, setAreas] = useState<VenueArea[]>(venue?.venue_areas ?? []);
  const [newArea, setNewArea] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      if (isEdit) {
        const res = await fetch(`${apiUrl}/api/v1/venues/${venue!.id}`, {
          method: 'PATCH',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: name.trim(),
            address: address.trim() || null,
            hostsTournament,
            hostsWorkshop,
          }),
        });
        if (!res.ok) throw new Error('save');
      } else {
        const res = await fetch(`${apiUrl}/api/v1/organizations/${orgId}/venues`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: name.trim(),
            address: address.trim() || null,
            hostsTournament,
            hostsWorkshop,
          }),
        });
        if (!res.ok) throw new Error('save');
        // Areas can only be added once we have a venue id (edit mode).
      }
      await onSaved();
    } catch {
      setError(t('organizer.venues.saveError'));
    } finally {
      setSaving(false);
    }
  };

  const addArea = async () => {
    if (!isEdit || !newArea.trim()) return;
    try {
      const res = await fetch(`${apiUrl}/api/v1/venues/${venue!.id}/areas`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newArea.trim() }),
      });
      if (!res.ok) return;
      const area = (await res.json()) as VenueArea;
      setAreas([...areas, area]);
      setNewArea('');
    } catch {
      // swallow — operator can retry
    }
  };

  const removeArea = async (areaId: string) => {
    try {
      const res = await fetch(`${apiUrl}/api/v1/venue-areas/${areaId}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (res.ok || res.status === 204) {
        setAreas(areas.filter((a) => a.id !== areaId));
      }
    } catch {
      // swallow
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4"
      onClick={(ev) => {
        if (ev.target === ev.currentTarget && !saving) onClose();
      }}
    >
      <div className="flex w-full max-w-md flex-col gap-4 rounded-2xl bg-white p-5 shadow-xl">
        <header>
          <h2 className="text-lg font-bold text-slate-900">
            {isEdit ? t('organizer.venues.editVenueTitle') : t('organizer.venues.newVenueTitle')}
          </h2>
        </header>

        <label className="grid gap-1 text-sm font-medium">
          {t('organizer.venues.name')}
          <input
            value={name}
            onChange={(ev) => setName(ev.target.value)}
            disabled={saving}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
            maxLength={200}
            required
          />
        </label>

        <label className="grid gap-1 text-sm font-medium">
          {t('organizer.venues.address')}
          <input
            value={address}
            onChange={(ev) => setAddress(ev.target.value)}
            disabled={saving}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
            maxLength={500}
            placeholder={t('organizer.venues.addressPlaceholder')}
          />
        </label>

        <fieldset className="grid gap-2 text-sm font-medium">
          <legend>{t('organizer.venues.hosts')}</legend>
          <label className="flex items-center gap-2 font-normal">
            <input
              type="checkbox"
              checked={hostsTournament}
              onChange={(ev) => setHostsTournament(ev.target.checked)}
              disabled={saving}
            />
            {t('organizer.venues.tournamentBadge')}
          </label>
          <label className="flex items-center gap-2 font-normal">
            <input
              type="checkbox"
              checked={hostsWorkshop}
              onChange={(ev) => setHostsWorkshop(ev.target.checked)}
              disabled={saving}
            />
            {t('organizer.venues.workshopBadge')}
          </label>
        </fieldset>

        {isEdit && (
          <div className="grid gap-2 text-sm font-medium">
            <span>{t('organizer.venues.areasSection')}</span>
            <p className="text-xs font-normal text-slate-500">{t('organizer.venues.areasHelp')}</p>
            <ul className="space-y-1">
              {areas.map((area) => (
                <li
                  key={area.id}
                  className="flex items-center justify-between rounded border border-slate-200 px-3 py-1 text-sm font-normal"
                >
                  <span>{area.name}</span>
                  <button
                    type="button"
                    onClick={() => void removeArea(area.id)}
                    className="text-xs text-rose-600 hover:underline"
                  >
                    {t('organizer.venues.removeArea')}
                  </button>
                </li>
              ))}
            </ul>
            <div className="flex gap-2">
              <input
                value={newArea}
                onChange={(ev) => setNewArea(ev.target.value)}
                placeholder={t('organizer.venues.newAreaPlaceholder')}
                className="flex-1 rounded-md border border-slate-300 px-3 py-1.5 text-sm font-normal"
              />
              <button
                type="button"
                onClick={() => void addArea()}
                disabled={!newArea.trim()}
                className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-semibold hover:bg-slate-50 disabled:opacity-50"
              >
                {t('organizer.venues.addArea')}
              </button>
            </div>
          </div>
        )}

        {error && <p className="text-sm text-rose-600">{error}</p>}

        <footer className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-md border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            {t('organizer.venues.cancel')}
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving || !name.trim()}
            className="rounded-md bg-red-700 px-5 py-2 text-sm font-semibold text-white hover:bg-red-800 disabled:opacity-50"
          >
            {saving ? t('organizer.venues.saving') : t('organizer.venues.save')}
          </button>
        </footer>
      </div>
    </div>
  );
}
