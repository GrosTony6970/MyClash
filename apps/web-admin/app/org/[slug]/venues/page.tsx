'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { t } from '@myclash/i18n';
import {
  DataTable,
  DataTableCell,
  DataTableHead,
  DataTableRow,
  Modal,
  useConfirm,
} from '@myclash/ui';
import { localeToBcp47, type AppLocale } from '@myclash/time';
import { useI18n } from '../../../../src/i18n/I18nProvider';
import { getPublicApiUrl } from '@/lib/api-url';

interface VenueArea {
  id: string;
  name: string;
  sort_order: number;
}

// Venue lices share the area shape (id/name/sort_order).
type VenueLice = VenueArea;

interface VenueRow {
  id: string;
  organization_id: string;
  name: string;
  address: string | null;
  hosts_tournament: boolean;
  hosts_workshop: boolean;
  sort_order: number;
  venue_areas: VenueArea[] | null;
  venue_lices: VenueLice[] | null;
  /** Events that use this venue (via their lices / workshop sessions). */
  events: Array<{ id: string; name: string; slug: string }> | null;
}

/** Minimal event shape for the modal's "attach to event" checklist. */
interface OrgEventOption {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  status: string;
}

const apiUrl = getPublicApiUrl();

/** "22/05/2027" or "22/05/2027 - 23/05/2027"; '' when there are no dates. */
function formatEventDateRange(startDate: string, endDate: string, locale: AppLocale): string {
  const fmt = (iso: string): string => {
    if (!iso) return '';
    const d = new Date(iso.includes('T') ? iso : `${iso}T00:00:00`);
    return Number.isNaN(d.getTime())
      ? ''
      : d.toLocaleDateString(localeToBcp47(locale), {
          day: '2-digit',
          month: '2-digit',
          year: 'numeric',
        });
  };
  const s = fmt(startDate);
  const e = fmt(endDate);
  if (s && e && s !== e) return `${s} - ${e}`;
  return s || e || '';
}

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
  const [events, setEvents] = useState<OrgEventOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
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

  // Org events power the modal's "attach to event" checklist. Non-fatal: if it
  // fails the checklist just shows the empty state. Archived events are hidden;
  // most recent first.
  const loadEvents = useCallback(async (id: string) => {
    try {
      const res = await fetch(`${apiUrl}/api/v1/organizations/${id}/events`, {
        credentials: 'include',
      });
      if (!res.ok) return;
      const rows = (await res.json()) as Array<Record<string, unknown>>;
      setEvents(
        rows
          .map((r) => ({
            id: String(r['id']),
            name: String(r['name'] ?? ''),
            startDate: String(r['startDate'] ?? r['start_date'] ?? ''),
            endDate: String(r['endDate'] ?? r['end_date'] ?? ''),
            status: String(r['status'] ?? 'draft'),
          }))
          .filter((e) => e.status !== 'archived')
          .sort((a, b) => (a.startDate < b.startDate ? 1 : a.startDate > b.startDate ? -1 : 0)),
      );
    } catch {
      // non-fatal — the checklist falls back to its empty state
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
        await Promise.all([loadVenues(org.id), loadEvents(org.id)]);
      } finally {
        setLoading(false);
      }
    })();
  }, [slug, loadVenues, loadEvents]);

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
    <main className="mx-auto max-w-[110rem] p-8">
      <div className="mb-6 flex items-center justify-between gap-3">
        <div>
          <h1 className="font-display font-bold text-2xl sm:text-3xl">
            {t('organizer.venues.title')}
          </h1>
          <p className="text-muted text-sm mt-1">{t('organizer.venues.description')}</p>
        </div>
        <button
          type="button"
          onClick={() => {
            setNotice(null);
            setCreating(true);
          }}
          className="rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-accent-foreground hover:bg-accent-hover"
        >
          + {t('organizer.venues.newVenue')}
        </button>
      </div>

      {message && (
        <div className="mb-4 rounded-md border border-warning/30 bg-warning/10 px-4 py-2 text-sm text-warning">
          {message}
        </div>
      )}

      {notice && (
        <div className="mb-4 rounded-md border border-warning/30 bg-warning/10 px-4 py-2 text-sm text-warning">
          {notice}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-muted">{t('admin.leagues.loading')}</p>
      ) : venues.length === 0 ? (
        <p className="text-sm text-muted">{t('organizer.venues.empty')}</p>
      ) : (
        <DataTable>
          <DataTableHead>
            <DataTableCell as="th">{t('organizer.venues.name')}</DataTableCell>
            <DataTableCell as="th">{t('organizer.venues.address')}</DataTableCell>
            <DataTableCell as="th">{t('organizer.venues.hosts')}</DataTableCell>
            <DataTableCell as="th" className="text-center">
              {t('organizer.venues.areas')}
            </DataTableCell>
            <DataTableCell as="th">{t('organizer.venues.eventsColumn')}</DataTableCell>
            <DataTableCell as="th" className="text-right">
              {t('organizer.venues.actions')}
            </DataTableCell>
          </DataTableHead>
          <tbody>
            {venues.map((v) => (
              <DataTableRow key={v.id}>
                <DataTableCell className="font-medium text-foreground">{v.name}</DataTableCell>
                <DataTableCell className="text-foreground-secondary">
                  {v.address ?? '—'}
                </DataTableCell>
                <DataTableCell>
                  <div className="flex flex-wrap gap-1">
                    {v.hosts_tournament && (
                      <span className="rounded-full bg-info/10 px-2 py-0.5 text-xs font-semibold text-info">
                        {t('organizer.venues.tournamentBadge')}
                      </span>
                    )}
                    {v.hosts_workshop && (
                      <span className="rounded-full bg-success/10 px-2 py-0.5 text-xs font-semibold text-success">
                        {t('organizer.venues.workshopBadge')}
                      </span>
                    )}
                  </div>
                </DataTableCell>
                <DataTableCell className="text-center text-foreground-secondary tabular-nums">
                  {v.venue_areas?.length ?? 0}
                </DataTableCell>
                <DataTableCell>
                  {v.events && v.events.length > 0 ? (
                    <div className="flex flex-wrap gap-1">
                      {v.events.map((ev) => (
                        <span
                          key={ev.id}
                          className="rounded-full bg-background px-2 py-0.5 text-xs text-foreground-secondary"
                        >
                          {ev.name}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <span className="text-muted">—</span>
                  )}
                </DataTableCell>
                <DataTableCell className="text-right">
                  <button
                    type="button"
                    onClick={() => {
                      setNotice(null);
                      setEditing(v);
                    }}
                    className="text-xs rounded-md border border-border px-2.5 py-1 hover:bg-background mr-2"
                  >
                    {t('organizer.venues.edit')}
                  </button>
                  <button
                    type="button"
                    onClick={() => void onDelete(v)}
                    className="text-xs rounded-md border border-danger/30 px-2.5 py-1 text-danger hover:bg-danger/10"
                  >
                    {t('organizer.venues.delete')}
                  </button>
                </DataTableCell>
              </DataTableRow>
            ))}
          </tbody>
        </DataTable>
      )}

      {creating && orgId && (
        <VenueFormModal
          orgId={orgId}
          venue={null}
          events={events}
          onClose={() => setCreating(false)}
          onSaved={async (msg) => {
            setCreating(false);
            setNotice(msg ?? null);
            if (orgId) await loadVenues(orgId);
          }}
        />
      )}

      {editing && orgId && (
        <VenueFormModal
          orgId={orgId}
          venue={editing}
          events={events}
          onClose={() => setEditing(null)}
          onSaved={async (msg) => {
            setEditing(null);
            setNotice(msg ?? null);
            if (orgId) await loadVenues(orgId);
          }}
        />
      )}
      {confirmDialog}
    </main>
  );
}

// ── Create / edit modal ─────────────────────────────────────────────────────

/** Next auto-numbered default name, mirroring the new-event wizard's lice naming
 *  so the operator can just click "Add" instead of typing each name. */
const nextLiceName = (count: number) => `Lice ${count + 1}`;
const nextAreaName = (count: number) => `Area ${count + 1}`;

/** Pull a human error out of a failed response (RFC 9457 problem+json: `detail`,
 *  with the legacy `message` + status as fallbacks) so the modal can show the
 *  real reason instead of a generic "could not save". */
async function responseErrorMessage(res: Response): Promise<string> {
  const body = (await res.json().catch(() => null)) as {
    detail?: string;
    message?: string;
  } | null;
  return body?.detail || body?.message || `HTTP ${res.status}`;
}

interface VenueFormModalProps {
  orgId: string;
  venue: VenueRow | null;
  events: OrgEventOption[];
  onClose: () => void;
  onSaved: (message?: string) => void | Promise<void>;
}

function VenueFormModal({ orgId, venue, events, onClose, onSaved }: VenueFormModalProps) {
  const { locale } = useI18n();
  const isEdit = venue !== null;
  const [name, setName] = useState(venue?.name ?? '');
  const [address, setAddress] = useState(venue?.address ?? '');
  // Don't pre-select either host on a brand-new venue — the operator picks
  // what the venue actually hosts, which reveals the lices / areas editors.
  const [hostsTournament, setHostsTournament] = useState(venue?.hosts_tournament ?? false);
  const [hostsWorkshop, setHostsWorkshop] = useState(venue?.hosts_workshop ?? false);
  const [areas, setAreas] = useState<VenueArea[]>(venue?.venue_areas ?? []);
  const [newArea, setNewArea] = useState(nextAreaName(venue?.venue_areas?.length ?? 0));
  const [lices, setLices] = useState<VenueLice[]>(venue?.venue_lices ?? []);
  const [newLice, setNewLice] = useState(nextLiceName(venue?.venue_lices?.length ?? 0));
  // Events this venue is attached to. Seeded from the venue's current (effective)
  // events; ticking/unticking attaches/detaches on save.
  const [selectedEventIds, setSelectedEventIds] = useState<string[]>(
    venue?.events?.map((e) => e.id) ?? [],
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggleEvent = (id: string) =>
    setSelectedEventIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );

  /**
   * Reconcile this venue's event attachments. The only API is the per-event
   * replace-all `PUT /events/:id/venues`, so for each changed event we GET its
   * current venue ids, add/remove this venue, and PUT the full list. Detach is
   * safe-guarded server-side (a venue with matches/sessions is kept and reported
   * in `blocked`). Returns a human message if any detach was blocked.
   */
  const reconcileEvents = async (venueId: string): Promise<string | undefined> => {
    const initial = new Set(venue?.events?.map((e) => e.id) ?? []);
    const selected = new Set(selectedEventIds);
    const changed = [
      ...[...selected].filter((id) => !initial.has(id)), // attach
      ...[...initial].filter((id) => !selected.has(id)), // detach
    ];
    if (changed.length === 0) return undefined;

    const blockedIds = await Promise.all(
      changed.map(async (eventId) => {
        const attach = selected.has(eventId);
        const listRes = await fetch(`${apiUrl}/api/v1/events/${eventId}/venues`, {
          credentials: 'include',
        });
        if (!listRes.ok) throw new Error(await responseErrorMessage(listRes));
        const currentIds = ((await listRes.json()) as Array<{ id: string }>).map((v) => v.id);
        const venueIds = attach
          ? Array.from(new Set([...currentIds, venueId]))
          : currentIds.filter((id) => id !== venueId);
        const putRes = await fetch(`${apiUrl}/api/v1/events/${eventId}/venues`, {
          method: 'PUT',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ venueIds }),
        });
        if (!putRes.ok) throw new Error(await responseErrorMessage(putRes));
        const result = (await putRes.json()) as { blocked?: Array<{ venueId: string }> };
        return (result.blocked ?? []).some((b) => b.venueId === venueId) ? eventId : null;
      }),
    );

    const blockedNames = blockedIds
      .filter((id): id is string => id !== null)
      .map((id) => events.find((e) => e.id === id)?.name ?? id);
    return blockedNames.length > 0
      ? t('organizer.venues.eventsBlocked').replace('{events}', blockedNames.join(', '))
      : undefined;
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      let venueId: string;
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
        if (!res.ok) throw new Error(await responseErrorMessage(res));
        venueId = venue!.id;
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
        if (!res.ok) throw new Error(await responseErrorMessage(res));
        const created = (await res.json()) as { id: string };
        venueId = created.id;
        // Persist the lices/areas buffered during creation now that the venue
        // has an id (only for the hosts the operator actually enabled). Each
        // POST is checked so a failure surfaces its real reason instead of
        // silently dropping the lice/area.
        if (hostsTournament) {
          await Promise.all(
            lices.map(async (lice, index) => {
              const r = await fetch(`${apiUrl}/api/v1/venues/${created.id}/lices`, {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: lice.name.trim(), sortOrder: index }),
              });
              if (!r.ok) throw new Error(await responseErrorMessage(r));
            }),
          );
        }
        if (hostsWorkshop) {
          await Promise.all(
            areas.map(async (area, index) => {
              const r = await fetch(`${apiUrl}/api/v1/venues/${created.id}/areas`, {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: area.name.trim(), sortOrder: index }),
              });
              if (!r.ok) throw new Error(await responseErrorMessage(r));
            }),
          );
        }
      }
      // Attach/detach events last, so a tournament venue's lice catalogue exists
      // before an event seeds its lices from it.
      const blockedMsg = await reconcileEvents(venueId);
      await onSaved(blockedMsg);
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : t('organizer.venues.saveError'));
    } finally {
      setSaving(false);
    }
  };

  // Add/remove work in both modes: in EDIT they hit the API immediately; in
  // CREATE they buffer locally (temp id) and get persisted on save().
  const addArea = async () => {
    const value = newArea.trim();
    if (!value) return;
    if (!isEdit) {
      setAreas([...areas, { id: crypto.randomUUID(), name: value, sort_order: areas.length }]);
      setNewArea(nextAreaName(areas.length + 1));
      return;
    }
    try {
      const res = await fetch(`${apiUrl}/api/v1/venues/${venue!.id}/areas`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: value }),
      });
      if (!res.ok) return;
      const area = (await res.json()) as VenueArea;
      setAreas([...areas, area]);
      setNewArea(nextAreaName(areas.length + 1));
    } catch {
      // swallow — operator can retry
    }
  };

  const removeArea = async (areaId: string) => {
    if (!isEdit) {
      setAreas(areas.filter((a) => a.id !== areaId));
      return;
    }
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

  const addLice = async () => {
    const value = newLice.trim();
    if (!value) return;
    if (!isEdit) {
      setLices([...lices, { id: crypto.randomUUID(), name: value, sort_order: lices.length }]);
      setNewLice(nextLiceName(lices.length + 1));
      return;
    }
    try {
      const res = await fetch(`${apiUrl}/api/v1/venues/${venue!.id}/lices`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: value }),
      });
      if (!res.ok) return;
      const lice = (await res.json()) as VenueLice;
      setLices([...lices, lice]);
      setNewLice(nextLiceName(lices.length + 1));
    } catch {
      // swallow — operator can retry
    }
  };

  const removeLice = async (liceId: string) => {
    if (!isEdit) {
      setLices(lices.filter((l) => l.id !== liceId));
      return;
    }
    try {
      const res = await fetch(`${apiUrl}/api/v1/venue-lices/${liceId}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (res.ok || res.status === 204) {
        setLices(lices.filter((l) => l.id !== liceId));
      }
    } catch {
      // swallow
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      busy={saving}
      size="md"
      title={isEdit ? t('organizer.venues.editVenueTitle') : t('organizer.venues.newVenueTitle')}
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-md border border-border px-4 py-2 text-sm font-semibold text-foreground-secondary hover:bg-background disabled:opacity-50"
          >
            {t('organizer.venues.cancel')}
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving || !name.trim()}
            className="rounded-md bg-accent px-5 py-2 text-sm font-semibold text-accent-foreground hover:bg-accent-hover disabled:opacity-50"
          >
            {saving ? t('organizer.venues.saving') : t('organizer.venues.save')}
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <label className="grid gap-1 text-sm font-medium">
          {t('organizer.venues.name')}
          <input
            value={name}
            onChange={(ev) => setName(ev.target.value)}
            disabled={saving}
            className="rounded-md border border-border px-3 py-2 text-sm font-normal"
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
            className="rounded-md border border-border px-3 py-2 text-sm font-normal"
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

        {hostsTournament && (
          <div className="grid gap-2 text-sm font-medium">
            <span>{t('organizer.venues.licesSection')}</span>
            <p className="text-xs font-normal text-muted">{t('organizer.venues.licesHelp')}</p>
            <ul className="space-y-1">
              {lices.map((lice) => (
                <li
                  key={lice.id}
                  className="flex items-center justify-between rounded border border-border px-3 py-1 text-sm font-normal"
                >
                  <span>{lice.name}</span>
                  <button
                    type="button"
                    onClick={() => void removeLice(lice.id)}
                    className="text-xs text-danger hover:underline"
                  >
                    {t('organizer.venues.removeLice')}
                  </button>
                </li>
              ))}
            </ul>
            <div className="flex gap-2">
              <input
                value={newLice}
                onChange={(ev) => setNewLice(ev.target.value)}
                placeholder={t('organizer.venues.newLicePlaceholder')}
                className="flex-1 rounded-md border border-border px-3 py-1.5 text-sm font-normal"
              />
              <button
                type="button"
                onClick={() => void addLice()}
                disabled={!newLice.trim()}
                className="rounded-md border border-border px-3 py-1.5 text-sm font-semibold hover:bg-background disabled:opacity-50"
              >
                {t('organizer.venues.addLice')}
              </button>
            </div>
          </div>
        )}

        {hostsWorkshop && (
          <div className="grid gap-2 text-sm font-medium">
            <span>{t('organizer.venues.areasSection')}</span>
            <p className="text-xs font-normal text-muted">{t('organizer.venues.areasHelp')}</p>
            <ul className="space-y-1">
              {areas.map((area) => (
                <li
                  key={area.id}
                  className="flex items-center justify-between rounded border border-border px-3 py-1 text-sm font-normal"
                >
                  <span>{area.name}</span>
                  <button
                    type="button"
                    onClick={() => void removeArea(area.id)}
                    className="text-xs text-danger hover:underline"
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
                className="flex-1 rounded-md border border-border px-3 py-1.5 text-sm font-normal"
              />
              <button
                type="button"
                onClick={() => void addArea()}
                disabled={!newArea.trim()}
                className="rounded-md border border-border px-3 py-1.5 text-sm font-semibold hover:bg-background disabled:opacity-50"
              >
                {t('organizer.venues.addArea')}
              </button>
            </div>
          </div>
        )}

        <div className="grid gap-2 text-sm font-medium">
          <span>{t('organizer.venues.eventsSection')}</span>
          <p className="text-xs font-normal text-muted">{t('organizer.venues.eventsHelp')}</p>
          {events.length === 0 ? (
            <p className="text-xs font-normal text-muted">{t('organizer.venues.noEvents')}</p>
          ) : (
            <ul className="max-h-40 space-y-1 overflow-y-auto">
              {events.map((ev) => {
                const range = formatEventDateRange(ev.startDate, ev.endDate, locale);
                return (
                  <li key={ev.id}>
                    <label className="flex items-center gap-2 rounded border border-border px-3 py-1 text-sm font-normal">
                      <input
                        type="checkbox"
                        checked={selectedEventIds.includes(ev.id)}
                        onChange={() => toggleEvent(ev.id)}
                        disabled={saving}
                      />
                      <span className="flex-1 truncate">{ev.name}</span>
                      {range && <span className="shrink-0 text-xs text-muted">{range}</span>}
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {error && <p className="text-sm text-danger">{error}</p>}
      </div>
    </Modal>
  );
}
