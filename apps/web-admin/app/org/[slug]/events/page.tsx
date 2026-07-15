'use client';

/**
 * /org/[slug]/events — Events list (R1 of the events-list overhaul)
 *
 * Replaces the prior redirect shim with the table-driven view that used to
 * live at /events/manage. Adds columns for logo thumbnail, creator name,
 * split start/end dates, and a visibility badge that's a one-click toggle
 * between draft and published.
 *
 * Backend dependencies (see migration 0058 + events.service.ts):
 *   - GET /api/v1/organizations/:orgId/events now returns
 *     `created_by_user_id`, `created_by_user_name`, `logo_url`, and
 *     `tournament_count` on every row.
 *   - POST /api/v1/events/:id/logo accepts multipart and stores the result
 *     in `events.logo_url`.
 */

import {
  Button,
  CountryCombobox,
  SortableHeader,
  Switch,
  formatCountryName,
  nextSortState,
  sortRows,
  statusPillTone,
  tournamentStatusSemantic,
} from '@myclash/ui';
import { localeToBcp47, type AppLocale } from '@myclash/time';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { type ChangeEvent, type FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { useI18n } from '../../../../src/i18n/I18nProvider';
import { validateLogoFile } from '../../../../src/lib/validate-logo-file';
import { RequestDeletionModal } from './_components/RequestDeletionModal';

interface OrgEvent {
  id: string;
  slug: string;
  name: string;
  city: string | null;
  country: string | null;
  startDate: string;
  endDate: string;
  status: string;
  publicLandingMd: string;
  createdAt: string;
  createdByUserId: string | null;
  createdByUserName: string | null;
  logoUrl: string | null;
  tournamentCount: number;
  participantCount: number;
  // True when any match has progressed past `scheduled` — hard delete is then
  // forbidden and the event must go through the deletion-request flow.
  hasRecordedResults: boolean;
  // Test/dry-run event: hidden from public/personal/stats and hard-deletable
  // even with recorded results.
  isTestEvent: boolean;
}

interface EventForm {
  name: string;
  startDate: string;
  endDate: string;
  city: string;
  country: string | null;
  status: string;
  publicLandingMd: string;
  isTestEvent: boolean;
}

function normalizeEvent(row: Record<string, unknown>): OrgEvent {
  return {
    id: String(row['id']),
    slug: String(row['slug'] ?? ''),
    name: String(row['name'] ?? ''),
    city: typeof row['city'] === 'string' ? row['city'] : null,
    country: typeof row['country'] === 'string' ? row['country'] : null,
    startDate: String(row['startDate'] ?? row['start_date'] ?? ''),
    endDate: String(row['endDate'] ?? row['end_date'] ?? ''),
    status: String(row['status'] ?? 'draft'),
    publicLandingMd:
      typeof (row['publicLandingMd'] ?? row['public_landing_md']) === 'string'
        ? String(row['publicLandingMd'] ?? row['public_landing_md'])
        : '',
    createdAt: String(row['createdAt'] ?? row['created_at'] ?? ''),
    createdByUserId:
      typeof (row['createdByUserId'] ?? row['created_by_user_id']) === 'string'
        ? String(row['createdByUserId'] ?? row['created_by_user_id'])
        : null,
    createdByUserName:
      typeof (row['createdByUserName'] ?? row['created_by_user_name']) === 'string'
        ? String(row['createdByUserName'] ?? row['created_by_user_name'])
        : null,
    logoUrl:
      typeof (row['logoUrl'] ?? row['logo_url']) === 'string'
        ? String(row['logoUrl'] ?? row['logo_url'])
        : null,
    tournamentCount: Number(row['tournamentCount'] ?? row['tournament_count'] ?? 0),
    participantCount: Number(row['participantCount'] ?? row['participant_count'] ?? 0),
    hasRecordedResults: (row['hasRecordedResults'] ?? row['has_recorded_results']) === true,
    isTestEvent: (row['isTestEvent'] ?? row['is_test_event']) === true,
  };
}

function toForm(event: OrgEvent): EventForm {
  return {
    name: event.name,
    startDate: event.startDate,
    endDate: event.endDate,
    city: event.city ?? '',
    country: event.country,
    status: event.status,
    publicLandingMd: event.publicLandingMd,
    isTestEvent: event.isTestEvent,
  };
}

export default function OrgEventsListPage() {
  const params = useParams<{ slug: string }>();
  const { slug } = params;
  const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';
  const { t, locale } = useI18n();

  const [events, setEvents] = useState<OrgEvent[]>([]);
  const [orgName, setOrgName] = useState<string>(slug);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editing, setEditing] = useState<OrgEvent | null>(null);
  const [form, setForm] = useState<EventForm | null>(null);
  // Staged logo edits live next to the modal's `form` state but are not
  // part of the JSON PATCH body — uploads use the multipart endpoint
  // first, and the remove path becomes `logoUrl: null` in the same
  // PATCH. Reset on every openEdit / close to avoid leaking between
  // sessions.
  const [logoPendingFile, setLogoPendingFile] = useState<File | null>(null);
  const [logoRemove, setLogoRemove] = useState(false);
  const [draftingDesc, setDraftingDesc] = useState(false);
  const [draftDescError, setDraftDescError] = useState<string | null>(null);
  const editLogoInput = useRef<HTMLInputElement | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<OrgEvent | null>(null);
  // Event targeted by the "Request deletion" modal (archive + submit request).
  const [deletionTarget, setDeletionTarget] = useState<OrgEvent | null>(null);
  // event id → pending deletion request, so rows under review show the pending
  // pill + a cancel action instead of a delete button.
  const [pendingDeletions, setPendingDeletions] = useState<Map<string, { id: string }>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<string | null>('createdAt');
  const [sortDir, setSortDir] = useState<'asc' | 'desc' | null>('desc');
  // Venue editing: the org's venue catalogue (options) + the venues the event
  // currently spreads on (checked set), reconciled on save.
  const [orgVenues, setOrgVenues] = useState<
    Array<{ id: string; name: string; hosts_tournament: boolean; hosts_workshop: boolean }>
  >([]);
  const [eventVenueIds, setEventVenueIds] = useState<string[]>([]);

  // One ref per row, keyed by event id, so the per-row "Upload logo" button
  // can trigger its own hidden <input type="file">.
  const logoInputs = useRef<Record<string, HTMLInputElement | null>>({});

  const fetchEvents = async (signal: AbortSignal) => {
    const orgRes = await fetch(`${apiUrl}/api/v1/organizations/slug/${encodeURIComponent(slug)}`, {
      credentials: 'include',
      signal,
    });
    if (!orgRes.ok) throw new Error(t('organizer.events.loadError'));
    const org = (await orgRes.json()) as { id: string; name: string };

    const eventsRes = await fetch(`${apiUrl}/api/v1/organizations/${org.id}/events`, {
      credentials: 'include',
      signal,
    });
    if (!eventsRes.ok) throw new Error(t('organizer.events.loadError'));
    const rows = (await eventsRes.json()) as Array<Record<string, unknown>>;

    // Org venue catalogue — options for the per-event venue multi-select.
    const venues = await fetch(`${apiUrl}/api/v1/organizations/${org.id}/venues`, {
      credentials: 'include',
      signal,
    })
      .then((r) => (r.ok ? r.json() : []))
      .catch(() => []);

    // Pending deletion requests for the org — one fetch, mapped by event id so
    // rows can show "under review" inline rather than the delete control.
    const pendingRows = (await fetch(
      `${apiUrl}/api/v1/organizations/${org.id}/deletion-requests?status=pending`,
      { credentials: 'include', signal },
    )
      .then((r) => (r.ok ? r.json() : []))
      .catch(() => [])) as Array<Record<string, unknown>>;
    const pending = new Map<string, { id: string }>();
    for (const row of pendingRows ?? []) {
      const targetType = String(row['targetType'] ?? row['target_type'] ?? '');
      const targetId = String(row['targetId'] ?? row['target_id'] ?? '');
      const id = String(row['id'] ?? '');
      if (targetType === 'event' && targetId && id) pending.set(targetId, { id });
    }

    return { orgName: org.name, events: rows.map(normalizeEvent), venues, pending };
  };

  const load = () => {
    const controller = new AbortController();
    setLoading(true);
    fetchEvents(controller.signal)
      .then(({ orgName: nextOrgName, events: nextEvents, venues, pending }) => {
        setOrgName(nextOrgName);
        setEvents(nextEvents);
        setPendingDeletions(pending);
        setOrgVenues(
          (venues ?? []) as Array<{
            id: string;
            name: string;
            hosts_tournament: boolean;
            hosts_workshop: boolean;
          }>,
        );
        setError(null);
      })
      .catch((err: unknown) => {
        if (err instanceof Error && err.name === 'AbortError') return;
        setError(err instanceof Error ? err.message : t('organizer.events.loadError'));
      })
      .finally(() => setLoading(false));
    return controller;
  };

  useEffect(() => {
    // load() flips setLoading(true) synchronously — intentional for the initial
    // fetch spinner; not a cascading-render hazard.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    const controller = load();
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, apiUrl]);

  const sortedEvents = useMemo(
    () =>
      sortRows(events, sortKey, sortDir, (row, key) => {
        switch (key) {
          case 'name':
            return row.name;
          case 'createdAt':
            return row.createdAt;
          case 'createdBy':
            return row.createdByUserName ?? '';
          case 'startDate':
            return row.startDate;
          case 'endDate':
            return row.endDate;
          case 'tournamentCount':
            return row.tournamentCount;
          case 'participantCount':
            return row.participantCount;
          case 'visibility':
            return row.status === 'draft' ? 0 : 1;
          default:
            return '';
        }
      }) as OrgEvent[],
    [events, sortKey, sortDir],
  );

  function toggleSort(columnKey: string) {
    const next = nextSortState(sortKey, sortDir, columnKey);
    setSortKey(next.key);
    setSortDir(next.direction);
  }

  function openEdit(event: OrgEvent) {
    setEditing(event);
    setForm(toForm(event));
    setLogoPendingFile(null);
    setLogoRemove(false);
    setEventVenueIds([]);
    setError(null);
    setNotice(null);
  }

  async function generateDescription() {
    if (!editing) return;
    setDraftingDesc(true);
    setDraftDescError(null);
    try {
      const res = await fetch(
        `${apiUrl}/api/v1/generated-content/organizer_content/${editing.id}/generate?locale=${locale}`,
        { method: 'POST', credentials: 'include' },
      );
      if (!res.ok) throw new Error(t('organizer.events.aiDraftError'));
      const data = (await res.json()) as { content: string };
      setForm((f) => (f ? { ...f, publicLandingMd: data.content } : f));
    } catch (e) {
      setDraftDescError(e instanceof Error ? e.message : t('organizer.events.aiDraftError'));
    } finally {
      setDraftingDesc(false);
    }
  }

  function closeEdit() {
    setEditing(null);
    setForm(null);
    setLogoPendingFile(null);
    setLogoRemove(false);
    setEventVenueIds([]);
  }

  // Load the venues the event currently spreads on when the modal opens.
  // (The reset to [] lives in openEdit/closeEdit — event handlers — so this
  // effect stays side-effect-only and doesn't setState synchronously.)
  useEffect(() => {
    if (!editing) return;
    const controller = new AbortController();
    fetch(`${apiUrl}/api/v1/events/${editing.id}/venues`, {
      credentials: 'include',
      signal: controller.signal,
    })
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: Array<{ id: string }>) => setEventVenueIds(rows.map((v) => v.id)))
      .catch(() => undefined);
    return () => controller.abort();
  }, [editing, apiUrl]);

  const toggleVenue = (id: string) =>
    setEventVenueIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  // Local preview URL for the staged file. Revoke when it changes so we
  // don't leak the previous one.
  const stagedLogoPreview = useMemo(
    () => (logoPendingFile ? URL.createObjectURL(logoPendingFile) : null),
    [logoPendingFile],
  );
  useEffect(() => {
    if (!stagedLogoPreview) return;
    return () => URL.revokeObjectURL(stagedLogoPreview);
  }, [stagedLogoPreview]);

  function handleEditLogoPick(file: File) {
    const check = validateLogoFile(file);
    if (!check.ok) {
      setError(t(check.errorKey));
      return;
    }
    setError(null);
    setLogoPendingFile(file);
    setLogoRemove(false);
  }

  async function saveEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing || !form) return;
    setBusyId(editing.id);
    setError(null);
    setNotice(null);
    try {
      // Two-step save when a logo change is staged: upload first so the
      // backend has the new asset, then PATCH the rest of the form.
      // Remove takes a single PATCH with `logoUrl: null`. Picking a new
      // file always wins over a prior Remove (Remove is cleared on pick).
      if (logoPendingFile) {
        const fd = new FormData();
        fd.append('file', logoPendingFile);
        const upload = await fetch(`${apiUrl}/api/v1/events/${editing.id}/logo`, {
          method: 'POST',
          credentials: 'include',
          body: fd,
        });
        if (!upload.ok) {
          const body = (await upload.json().catch(() => ({}))) as { message?: string };
          throw new Error(body.message ?? t('organizer.events.logoUploadFailed'));
        }
      }
      const patchBody: Record<string, unknown> = {
        name: form.name,
        startDate: form.startDate,
        endDate: form.endDate,
        city: form.city || null,
        country: form.country || null,
        status: form.status,
        publicLandingMd: form.publicLandingMd || null,
        isTestEvent: form.isTestEvent,
      };
      if (logoRemove && !logoPendingFile) patchBody['logoUrl'] = null;
      const res = await fetch(`${apiUrl}/api/v1/events/${editing.id}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(patchBody),
      });
      if (!res.ok) {
        const body = (await res.json()) as { message?: string };
        throw new Error(body.message ?? t('organizer.events.saveError'));
      }
      // Reconcile the event's venues (adds links + seeds tournament lices;
      // safe-removes — venues with matches/sessions are reported as blocked).
      let blockedNames: string[] = [];
      const venuesRes = await fetch(`${apiUrl}/api/v1/events/${editing.id}/venues`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ venueIds: eventVenueIds }),
      });
      if (venuesRes.ok) {
        const result = (await venuesRes.json()) as { blocked?: Array<{ venueId: string }> };
        blockedNames = (result.blocked ?? []).map(
          (b) => orgVenues.find((v) => v.id === b.venueId)?.name ?? b.venueId,
        );
      }
      closeEdit();
      setNotice(
        blockedNames.length > 0
          ? t('organizer.events.venuesBlocked', { venues: blockedNames.join(', ') })
          : t('organizer.events.saved'),
      );
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('organizer.events.saveError'));
    } finally {
      setBusyId(null);
    }
  }

  async function toggleVisibility(event: OrgEvent) {
    // The visibility toggle flips between draft ↔ published only. Events at
    // running/completed/archived keep their status (the button is disabled).
    const mode = event.status === 'draft' ? 'publish' : 'unpublish';
    setBusyId(event.id);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`${apiUrl}/api/v1/events/${event.id}/${mode}`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(body.message ?? t('organizer.events.visibilityError'));
      }
      setNotice(
        t(mode === 'publish' ? 'organizer.events.published' : 'organizer.events.unpublished'),
      );
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('organizer.events.visibilityError'));
    } finally {
      setBusyId(null);
    }
  }

  async function uploadLogo(eventId: string, file: File) {
    const check = validateLogoFile(file);
    if (!check.ok) {
      setError(t(check.errorKey));
      return;
    }
    setBusyId(eventId);
    setError(null);
    setNotice(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch(`${apiUrl}/api/v1/events/${eventId}/logo`, {
        method: 'POST',
        credentials: 'include',
        body: fd,
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(body.message ?? t('organizer.events.logoUploadFailed'));
      }
      setNotice(t('organizer.events.logoUploadSuccess'));
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('organizer.events.logoUploadFailed'));
    } finally {
      setBusyId(null);
    }
  }

  async function hardDeleteEvent() {
    if (!confirmDelete) return;
    setBusyId(confirmDelete.id);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`${apiUrl}/api/v1/events/${confirmDelete.id}?mode=hard`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok) {
        const body = (await res.json()) as { message?: string };
        throw new Error(body.message ?? t('organizer.events.deleteError'));
      }
      setConfirmDelete(null);
      setNotice(t('organizer.events.deleted'));
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('organizer.events.deleteError'));
    } finally {
      setBusyId(null);
    }
  }

  async function cancelDeletionRequest(event: OrgEvent) {
    const pending = pendingDeletions.get(event.id);
    if (!pending) return;
    setBusyId(event.id);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`${apiUrl}/api/v1/deletion-requests/${pending.id}/cancel`, {
        method: 'PATCH',
        credentials: 'include',
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(body.message ?? t('common.error'));
      }
      setNotice(t('organizer.deletionRequest.deletionRequestCancelled'));
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common.error'));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <main className="mx-auto max-w-7xl px-6 py-8 lg:px-8">
      <div className="mb-8 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-accent">
            {t('organizer.events.eyebrow')}
          </p>
          <h1 className="mt-2 font-display font-bold text-2xl sm:text-3xl text-foreground">
            {t('organizer.events.listTitle')}
          </h1>
          <p className="mt-1 text-sm text-muted">
            {t('organizer.events.listDescription', { organization: orgName })}
          </p>
        </div>
        <Link
          href={`/org/${slug}/events/new`}
          className="inline-flex w-fit items-center rounded-md bg-accent px-5 py-2.5 text-sm font-semibold text-accent-foreground shadow-sm transition-colors hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
        >
          {t('organizer.events.create')}
        </Link>
      </div>

      {error && (
        <div className="mb-6 rounded-md border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
          {error}
        </div>
      )}
      {notice && (
        <div className="mb-6 rounded-md border border-success/30 bg-success/10 px-4 py-3 text-sm text-success">
          {notice}
        </div>
      )}

      <section className="overflow-hidden rounded-lg border border-border bg-surface shadow-sm">
        {loading && (
          <div className="flex items-center gap-2 px-5 py-8 text-sm text-muted">
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-border border-t-accent" />
            {t('organizer.events.loading')}
          </div>
        )}

        {!loading && events.length === 0 && (
          <div className="flex flex-col items-center justify-center px-6 py-20 text-center">
            <h2 className="mb-3 font-display font-semibold text-lg sm:text-xl text-foreground">
              {t('organizer.dashboard.emptyTitle')}
            </h2>
            <p className="mb-6 max-w-md text-sm text-muted">
              {t('organizer.dashboard.emptyDescription')}
            </p>
            <Link
              href={`/org/${slug}/events/new`}
              className="rounded-md bg-accent px-6 py-2.5 text-sm font-semibold text-accent-foreground transition-colors hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
            >
              {t('organizer.events.create')}
            </Link>
          </div>
        )}

        {!loading && events.length > 0 && (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-border text-sm">
              <thead className="bg-background text-left text-xs font-bold uppercase tracking-[0.14em] text-muted">
                <tr>
                  <th className="px-4 py-3">{t('organizer.events.table.logo')}</th>
                  <th className="px-4 py-3">
                    <SortableHeader
                      label={t('organizer.events.table.event')}
                      columnKey="name"
                      currentKey={sortKey}
                      direction={sortKey === 'name' ? sortDir : null}
                      onToggle={toggleSort}
                    />
                  </th>
                  <th className="px-4 py-3">
                    <SortableHeader
                      label={t('organizer.events.table.created')}
                      columnKey="createdAt"
                      currentKey={sortKey}
                      direction={sortKey === 'createdAt' ? sortDir : null}
                      onToggle={toggleSort}
                    />
                  </th>
                  <th className="px-4 py-3">
                    <SortableHeader
                      label={t('organizer.events.table.createdBy')}
                      columnKey="createdBy"
                      currentKey={sortKey}
                      direction={sortKey === 'createdBy' ? sortDir : null}
                      onToggle={toggleSort}
                    />
                  </th>
                  <th className="px-4 py-3 text-center">
                    <SortableHeader
                      label={t('organizer.events.table.tournaments')}
                      columnKey="tournamentCount"
                      currentKey={sortKey}
                      direction={sortKey === 'tournamentCount' ? sortDir : null}
                      onToggle={toggleSort}
                      align="center"
                    />
                  </th>
                  <th className="px-4 py-3 text-center">
                    <SortableHeader
                      label={t('organizer.events.table.participants')}
                      columnKey="participantCount"
                      currentKey={sortKey}
                      direction={sortKey === 'participantCount' ? sortDir : null}
                      onToggle={toggleSort}
                      align="center"
                    />
                  </th>
                  <th className="px-4 py-3">
                    <SortableHeader
                      label={t('organizer.events.table.startDate')}
                      columnKey="startDate"
                      currentKey={sortKey}
                      direction={sortKey === 'startDate' ? sortDir : null}
                      onToggle={toggleSort}
                    />
                  </th>
                  <th className="px-4 py-3">
                    <SortableHeader
                      label={t('organizer.events.table.endDate')}
                      columnKey="endDate"
                      currentKey={sortKey}
                      direction={sortKey === 'endDate' ? sortDir : null}
                      onToggle={toggleSort}
                    />
                  </th>
                  <th className="px-4 py-3">
                    <SortableHeader
                      label={t('organizer.events.table.visibility')}
                      columnKey="visibility"
                      currentKey={sortKey}
                      direction={sortKey === 'visibility' ? sortDir : null}
                      onToggle={toggleSort}
                    />
                  </th>
                  <th className="px-4 py-3">{t('organizer.events.table.actions')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {sortedEvents.map((event) => (
                  <tr key={event.id} className="align-top">
                    <td className="px-4 py-4">
                      <Link
                        href={`/org/${slug}/events/${event.id}`}
                        className="block h-10 w-10 overflow-hidden rounded-md border border-border bg-background"
                        aria-label={event.name}
                      >
                        {event.logoUrl ? (
                          /* eslint-disable-next-line @next/next/no-img-element */
                          <img src={event.logoUrl} alt="" className="h-full w-full object-cover" />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center text-[10px] font-semibold uppercase tracking-wider text-muted">
                            {event.name.slice(0, 2)}
                          </div>
                        )}
                      </Link>
                    </td>
                    <td className="px-4 py-4">
                      <Link
                        href={`/org/${slug}/events/${event.id}`}
                        className="font-semibold text-foreground hover:text-accent"
                      >
                        {event.name}
                      </Link>
                      {event.isTestEvent && (
                        <span className="ml-2 inline-flex items-center rounded-full border border-warning/30 bg-warning/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-warning align-middle">
                          {t('organizer.events.testBadge')}
                        </span>
                      )}
                      <p className="mt-1 text-xs text-muted">
                        {[event.city, formatCountryName(event.country, locale)]
                          .filter(Boolean)
                          .join(', ') || t('organizer.dashboard.noLocation')}
                      </p>
                    </td>
                    <td className="px-4 py-4 text-foreground-secondary">
                      {formatDate(event.createdAt, locale)}
                    </td>
                    <td className="px-4 py-4 text-foreground-secondary">
                      {event.createdByUserName ?? '—'}
                    </td>
                    <td className="px-4 py-4 text-center font-mono tabular-nums text-foreground-secondary">
                      {event.tournamentCount}
                    </td>
                    <td className="px-4 py-4 text-center font-mono tabular-nums text-foreground-secondary">
                      {event.participantCount}
                    </td>
                    <td className="px-4 py-4 text-foreground-secondary">
                      {formatDate(event.startDate, locale)}
                    </td>
                    <td className="px-4 py-4 text-foreground-secondary">
                      {formatDate(event.endDate, locale)}
                    </td>
                    <td className="px-4 py-4">
                      {event.status === 'draft' ? (
                        <button
                          type="button"
                          onClick={() => void toggleVisibility(event)}
                          disabled={busyId === event.id}
                          className="inline-flex items-center gap-1.5 rounded-md bg-success px-3 py-1.5 text-xs font-semibold text-success-foreground shadow-sm transition-colors hover:bg-success-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-60"
                          title={t('organizer.events.setPublic')}
                        >
                          <svg
                            aria-hidden="true"
                            viewBox="0 0 20 20"
                            fill="currentColor"
                            className="h-3.5 w-3.5"
                          >
                            <path d="M3.105 3.105a.75.75 0 01.815-.16l13.5 5.25a.75.75 0 010 1.41l-13.5 5.25a.75.75 0 01-1-.927l1.4-4.673H9a.75.75 0 000-1.5H4.32l-1.4-4.673a.75.75 0 01.185-.977z" />
                          </svg>
                          {t('organizer.events.publishCta')}
                        </button>
                      ) : event.status === 'published' ? (
                        <div className="flex items-center gap-2">
                          <span
                            className={[
                              'rounded-full border px-2.5 py-0.5 text-xs font-semibold',
                              statusPillTone(tournamentStatusSemantic('published'), 'light')
                                .className,
                            ].join(' ')}
                          >
                            {t('organizer.events.statuses.published') ?? 'published'}
                          </span>
                          <button
                            type="button"
                            onClick={() => void toggleVisibility(event)}
                            disabled={busyId === event.id}
                            className="text-xs font-medium text-muted underline-offset-2 hover:text-foreground-secondary hover:underline disabled:cursor-not-allowed disabled:opacity-60"
                            title={t('organizer.events.setDraft')}
                          >
                            {t('organizer.events.unpublish')}
                          </button>
                        </div>
                      ) : (
                        <span
                          className={[
                            'rounded-full border px-2.5 py-0.5 text-xs font-semibold',
                            statusPillTone(tournamentStatusSemantic(event.status), 'light')
                              .className,
                          ].join(' ')}
                        >
                          {t(`organizer.events.statuses.${event.status}`) ?? event.status}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-4">
                      <div className="flex flex-wrap gap-2">
                        <input
                          ref={(el) => {
                            logoInputs.current[event.id] = el;
                          }}
                          type="file"
                          accept="image/png,image/jpeg,image/webp"
                          className="hidden"
                          onChange={(ev: ChangeEvent<HTMLInputElement>) => {
                            const file = ev.target.files?.[0];
                            if (file) void uploadLogo(event.id, file);
                            ev.target.value = '';
                          }}
                        />
                        <Button
                          type="button"
                          size="sm"
                          variant="back"
                          onClick={() => openEdit(event)}
                        >
                          {t('organizer.events.edit')}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="back"
                          disabled={busyId === event.id}
                          onClick={() => logoInputs.current[event.id]?.click()}
                        >
                          {t('organizer.events.uploadLogo')}
                        </Button>
                        {pendingDeletions.has(event.id) ? (
                          <div className="flex items-center gap-2">
                            <span className="inline-flex items-center rounded-full border border-warning/30 bg-warning/10 px-2.5 py-0.5 text-xs font-semibold text-warning">
                              {t('organizer.events.deletionPending')}
                            </span>
                            <Button
                              type="button"
                              size="sm"
                              variant="back"
                              disabled={busyId === event.id}
                              onClick={() => void cancelDeletionRequest(event)}
                            >
                              {t('organizer.deletionRequest.cancelRequest')}
                            </Button>
                          </div>
                        ) : !event.isTestEvent &&
                          (event.status === 'archived' || event.hasRecordedResults) ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="danger"
                            disabled={busyId === event.id}
                            onClick={() => setDeletionTarget(event)}
                          >
                            {t('organizer.deletionRequest.requestDeletion')}
                          </Button>
                        ) : (
                          // Test events delete directly even with results — no
                          // archive / deletion-request detour.
                          <Button
                            type="button"
                            size="sm"
                            variant="danger"
                            disabled={busyId === event.id}
                            onClick={() => setConfirmDelete(event)}
                          >
                            {t('organizer.events.hardDelete')}
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {editing && form && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4">
          <form
            onSubmit={(event) => void saveEdit(event)}
            className="w-full max-w-2xl rounded-lg bg-surface p-6 shadow-2xl"
          >
            <h2 className="font-display font-semibold text-lg sm:text-xl text-foreground">
              {t('organizer.events.editTitle')}
            </h2>
            <p className="mt-1 text-sm text-muted">
              {t('organizer.events.slugReadOnly', { slug: editing.slug })}
            </p>

            {/* Logo edit block — staged. Picking a file shows a local
                preview only; the actual upload runs from saveEdit
                alongside the field PATCH. Remove flags the slot for
                clearing on Save without touching anything until then. */}
            <div className="mt-5 flex items-center gap-4 rounded-lg border border-border bg-background p-3">
              <div className="h-16 w-16 flex-shrink-0 overflow-hidden rounded-md border border-border bg-surface">
                {stagedLogoPreview ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img src={stagedLogoPreview} alt="" className="h-full w-full object-cover" />
                ) : logoRemove || !editing.logoUrl ? (
                  <div className="flex h-full w-full items-center justify-center text-xs font-semibold uppercase tracking-wider text-muted">
                    {editing.name.slice(0, 2)}
                  </div>
                ) : (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img src={editing.logoUrl} alt="" className="h-full w-full object-cover" />
                )}
              </div>
              <div className="flex flex-1 flex-wrap items-center gap-2">
                <input
                  ref={editLogoInput}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleEditLogoPick(file);
                    if (editLogoInput.current) editLogoInput.current.value = '';
                  }}
                />
                <button
                  type="button"
                  onClick={() => editLogoInput.current?.click()}
                  disabled={busyId === editing.id}
                  className="rounded-md border border-border bg-surface px-3 py-1.5 text-xs font-semibold text-foreground-secondary hover:bg-background disabled:opacity-50"
                >
                  {logoPendingFile || editing.logoUrl
                    ? t('organizer.events.logoReplace')
                    : t('organizer.events.uploadLogo')}
                </button>
                {(logoPendingFile || (editing.logoUrl && !logoRemove)) && (
                  <button
                    type="button"
                    onClick={() => {
                      setLogoPendingFile(null);
                      setLogoRemove(true);
                    }}
                    disabled={busyId === editing.id}
                    className="rounded-md px-3 py-1.5 text-xs font-semibold text-danger hover:bg-danger/10 disabled:opacity-50"
                  >
                    {t('organizer.events.logoRemove')}
                  </button>
                )}
                {logoPendingFile && (
                  <span className="text-xs text-muted">{logoPendingFile.name}</span>
                )}
                {logoRemove && !logoPendingFile && (
                  <span className="text-xs italic text-muted">
                    {t('organizer.events.logoEmpty')}
                  </span>
                )}
              </div>
            </div>

            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <label className="grid gap-1 text-sm font-semibold text-foreground-secondary">
                {t('organizer.newEvent.eventName')}
                <input
                  value={form.name}
                  onChange={(event) => setForm({ ...form, name: event.target.value })}
                  className="rounded-md border border-border px-3 py-2 text-sm"
                />
              </label>
              <label className="grid gap-1 text-sm font-semibold text-foreground-secondary">
                {t('organizer.events.visibility')}
                <select
                  value={form.status}
                  onChange={(event) => setForm({ ...form, status: event.target.value })}
                  className="rounded-md border border-border px-3 py-2 text-sm"
                >
                  {(['draft', 'published', 'running', 'completed', 'archived'] as const).map(
                    (status) => (
                      <option key={status} value={status}>
                        {t(`organizer.events.statuses.${status}`) || status}
                      </option>
                    ),
                  )}
                </select>
                <span className="text-xs font-normal text-muted">
                  {t('organizer.events.statusHelp')}
                </span>
              </label>
              <div className="grid gap-1.5 text-sm font-semibold text-foreground-secondary sm:col-span-2">
                <span>{t('organizer.events.testEvent')}</span>
                <div className="flex items-start gap-3">
                  <Switch
                    checked={form.isTestEvent}
                    onChange={(value) => setForm({ ...form, isTestEvent: value })}
                    ariaLabel={t('organizer.events.testEvent')}
                  />
                  <span className="text-xs font-normal text-muted">
                    {t('organizer.events.testEventHelp')}
                  </span>
                </div>
              </div>
              <label className="grid gap-1 text-sm font-semibold text-foreground-secondary">
                {t('organizer.newEvent.startDate')}
                <input
                  type="date"
                  value={form.startDate}
                  onChange={(event) => setForm({ ...form, startDate: event.target.value })}
                  className="rounded-md border border-border px-3 py-2 text-sm"
                />
              </label>
              <label className="grid gap-1 text-sm font-semibold text-foreground-secondary">
                {t('organizer.newEvent.endDate')}
                <input
                  type="date"
                  value={form.endDate}
                  min={form.startDate}
                  onChange={(event) => setForm({ ...form, endDate: event.target.value })}
                  className="rounded-md border border-border px-3 py-2 text-sm"
                />
              </label>
              <label className="grid gap-1 text-sm font-semibold text-foreground-secondary">
                {t('organizer.newEvent.city')}
                <input
                  value={form.city}
                  onChange={(event) => setForm({ ...form, city: event.target.value })}
                  placeholder={t('organizer.newEvent.cityPlaceholder')}
                  className="rounded-md border border-border px-3 py-2 text-sm"
                />
              </label>
              <label className="grid gap-1 text-sm font-semibold text-foreground-secondary">
                {t('organizer.newEvent.country')}
                <CountryCombobox
                  value={form.country}
                  onChange={(code) => setForm({ ...form, country: code })}
                  locale={locale}
                  placeholder={t('organizer.newEvent.countryPlaceholder')}
                />
              </label>
              <label className="grid gap-1 text-sm font-semibold text-foreground-secondary sm:col-span-2">
                {t('organizer.events.publicLanding')}
                <textarea
                  rows={4}
                  value={form.publicLandingMd}
                  onChange={(event) => setForm({ ...form, publicLandingMd: event.target.value })}
                  className="rounded-md border border-border px-3 py-2 text-sm"
                />
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void generateDescription()}
                    disabled={draftingDesc}
                    className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground-secondary hover:bg-background disabled:opacity-50"
                  >
                    {draftingDesc
                      ? t('organizer.events.aiDrafting')
                      : t('organizer.events.aiDraft')}
                  </button>
                  {draftDescError && <span className="text-xs text-danger">{draftDescError}</span>}
                </div>
              </label>
              {orgVenues.length > 0 && (
                <div className="grid gap-1 text-sm font-semibold text-foreground-secondary sm:col-span-2">
                  <span>{t('organizer.events.venuesSection')}</span>
                  <p className="text-xs font-normal text-muted">
                    {t('organizer.events.venuesHelp')}
                  </p>
                  <div className="grid gap-1.5 sm:grid-cols-2">
                    {orgVenues.map((v) => (
                      <label
                        key={v.id}
                        className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm font-normal"
                      >
                        <input
                          type="checkbox"
                          checked={eventVenueIds.includes(v.id)}
                          onChange={() => toggleVenue(v.id)}
                        />
                        <span className="min-w-0 flex-1 truncate">{v.name}</span>
                        {v.hosts_tournament && (
                          <span className="shrink-0 rounded-full bg-info/10 px-1.5 py-0.5 text-[10px] font-semibold text-info">
                            {t('organizer.venues.tournamentBadge')}
                          </span>
                        )}
                        {v.hosts_workshop && (
                          <span className="shrink-0 rounded-full bg-success/10 px-1.5 py-0.5 text-[10px] font-semibold text-success">
                            {t('organizer.venues.workshopBadge')}
                          </span>
                        )}
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <div className="mt-6 flex justify-end gap-3">
              <Button type="button" variant="cancel" onClick={closeEdit}>
                {t('common.cancel')}
              </Button>
              <Button type="submit" variant="primary" loading={busyId === editing.id}>
                {t('organizer.events.save')}
              </Button>
            </div>
          </form>
        </div>
      )}

      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4">
          <div className="w-full max-w-md rounded-lg bg-surface p-6 shadow-2xl">
            <h2 className="font-display font-semibold text-lg sm:text-xl text-foreground">
              {t('organizer.events.deleteTitle')}
            </h2>
            <p className="mt-2 text-sm text-foreground-secondary">
              {t('organizer.events.deleteWarning', { name: confirmDelete.name })}
            </p>
            <div className="mt-6 flex justify-end gap-3">
              <Button type="button" variant="cancel" onClick={() => setConfirmDelete(null)}>
                {t('common.cancel')}
              </Button>
              <Button
                type="button"
                variant="danger"
                loading={busyId === confirmDelete.id}
                onClick={() => void hardDeleteEvent()}
              >
                {t('organizer.events.confirmHardDelete')}
              </Button>
            </div>
          </div>
        </div>
      )}

      {deletionTarget && (
        <RequestDeletionModal
          targetType="event"
          targetId={deletionTarget.id}
          targetLabel={deletionTarget.name}
          archiveFirst={deletionTarget.status !== 'archived'}
          onSuccess={() => {
            setDeletionTarget(null);
            load();
          }}
          onClose={() => setDeletionTarget(null)}
        />
      )}
    </main>
  );
}

function formatDate(value: string, locale: AppLocale): string {
  if (!value) return '—';
  const date = new Date(value.includes('T') ? value : `${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(localeToBcp47(locale), {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}
