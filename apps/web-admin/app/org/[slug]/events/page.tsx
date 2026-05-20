'use client';

import { Button } from '@myclash/ui';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { type FormEvent, useEffect, useState } from 'react';
import { useI18n } from '../../../../src/i18n/I18nProvider';

interface OrgEvent {
  id: string;
  slug: string;
  name: string;
  location: string | null;
  startDate: string;
  endDate: string;
  status: string;
  publicLandingMd: string;
  tournamentCount: number;
}

interface EventForm {
  name: string;
  startDate: string;
  endDate: string;
  location: string;
  status: string;
  publicLandingMd: string;
}

const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-slate-100 text-slate-700 border-slate-200',
  published: 'bg-blue-50 text-blue-700 border-blue-100',
  running: 'bg-green-50 text-green-700 border-green-100',
  completed: 'bg-slate-100 text-slate-500 border-slate-200',
  archived: 'bg-slate-900 text-slate-200 border-slate-800',
};

function normalizeEvent(row: Record<string, unknown>, tournamentCount: number): OrgEvent {
  return {
    id: String(row['id']),
    slug: String(row['slug'] ?? ''),
    name: String(row['name'] ?? ''),
    location: typeof row['location'] === 'string' ? row['location'] : null,
    startDate: String(row['startDate'] ?? row['start_date'] ?? ''),
    endDate: String(row['endDate'] ?? row['end_date'] ?? ''),
    status: String(row['status'] ?? 'draft'),
    publicLandingMd:
      typeof (row['publicLandingMd'] ?? row['public_landing_md']) === 'string'
        ? String(row['publicLandingMd'] ?? row['public_landing_md'])
        : '',
    tournamentCount,
  };
}

function toForm(event: OrgEvent): EventForm {
  return {
    name: event.name,
    startDate: event.startDate,
    endDate: event.endDate,
    location: event.location ?? '',
    status: event.status,
    publicLandingMd: event.publicLandingMd,
  };
}

export default function OrgEventsPage() {
  const params = useParams<{ slug: string }>();
  const { slug } = params;
  const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';
  const { t } = useI18n();

  const [events, setEvents] = useState<OrgEvent[]>([]);
  const [orgName, setOrgName] = useState<string>(slug);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editing, setEditing] = useState<OrgEvent | null>(null);
  const [form, setForm] = useState<EventForm | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<OrgEvent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

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
    const withCounts = await Promise.all(
      rows.map(async (row) => {
        const eventId = String(row['id']);
        const tournamentsRes = await fetch(`${apiUrl}/api/v1/events/${eventId}/tournaments`, {
          credentials: 'include',
          signal,
        });
        const tournaments = tournamentsRes.ok ? ((await tournamentsRes.json()) as unknown[]) : [];
        return normalizeEvent(row, tournaments.length);
      }),
    );
    return { orgName: org.name, events: withCounts };
  };

  const load = () => {
    const controller = new AbortController();
    setLoading(true);
    fetchEvents(controller.signal)
      .then(({ orgName: nextOrgName, events: nextEvents }) => {
        setOrgName(nextOrgName);
        setEvents(nextEvents);
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
    const controller = new AbortController();
    fetchEvents(controller.signal)
      .then(({ orgName: nextOrgName, events: nextEvents }) => {
        setOrgName(nextOrgName);
        setEvents(nextEvents);
        setError(null);
      })
      .catch((err: unknown) => {
        if (err instanceof Error && err.name === 'AbortError') return;
        setError(err instanceof Error ? err.message : t('organizer.events.loadError'));
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, apiUrl]);

  function openEdit(event: OrgEvent) {
    setEditing(event);
    setForm(toForm(event));
    setError(null);
    setNotice(null);
  }

  async function saveEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing || !form) return;
    setBusyId(editing.id);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`${apiUrl}/api/v1/events/${editing.id}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: form.name,
          startDate: form.startDate,
          endDate: form.endDate,
          location: form.location || null,
          status: form.status,
          publicLandingMd: form.publicLandingMd || null,
        }),
      });
      if (!res.ok) {
        const body = (await res.json()) as { message?: string };
        throw new Error(body.message ?? t('organizer.events.saveError'));
      }
      setEditing(null);
      setForm(null);
      setNotice(t('organizer.events.saved'));
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('organizer.events.saveError'));
    } finally {
      setBusyId(null);
    }
  }

  async function toggleVisibility(event: OrgEvent, mode: 'publish' | 'unpublish') {
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

  async function archiveEvent(event: OrgEvent) {
    setBusyId(event.id);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`${apiUrl}/api/v1/events/${event.id}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status: 'archived' }),
      });
      if (!res.ok) throw new Error(t('organizer.events.archiveError'));
      setNotice(t('organizer.events.archived'));
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('organizer.events.archiveError'));
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

  return (
    <main className="p-6 lg:p-8">
      {(loading || events.length > 0) && (
        <div className="mb-8 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#1d4ed8]">
              {t('organizer.events.eyebrow')}
            </p>
            <h1 className="mt-2 text-3xl font-bold text-[#0f172a]">
              {t('organizer.events.title')}
            </h1>
            <p className="mt-1 text-sm text-slate-500">
              {t('organizer.events.description', { organization: orgName })}
            </p>
          </div>
          <Link
            href={`/org/${slug}/events/new`}
            className="inline-flex w-fit items-center rounded-md bg-[#dc2626] px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-red-700"
          >
            {t('organizer.events.create')}
          </Link>
        </div>
      )}

      {error && (
        <div className="mb-6 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}
      {notice && (
        <div className="mb-6 rounded-md border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
          {notice}
        </div>
      )}

      <section
        className={
          events.length > 0 || loading
            ? 'overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm'
            : ''
        }
      >
        {(loading || events.length > 0) && (
          <div className="border-b border-slate-200 px-5 py-4">
            <p className="text-sm font-semibold text-[#0f172a]">
              {t('organizer.events.currentSelection')}
            </p>
            <p className="mt-1 text-sm text-slate-500">{t('organizer.events.noSelection')}</p>
          </div>
        )}

        {loading && (
          <div className="flex items-center gap-2 px-5 py-8 text-sm text-slate-500">
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-[#1d4ed8]" />
            {t('organizer.events.loading')}
          </div>
        )}

        {!loading && events.length === 0 && (
          <div className="flex flex-col items-center justify-center px-6 py-20 text-center">
            <h2 className="mb-3 text-2xl font-bold text-[#0f172a]">
              {t('organizer.dashboard.emptyTitle')}
            </h2>
            <p className="mb-6 max-w-md text-sm text-slate-500">
              {t('organizer.dashboard.emptyDescription')}
            </p>
            <Link
              href={`/org/${slug}/events/new`}
              className="rounded-md bg-[#dc2626] px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-red-700"
            >
              {t('organizer.events.create')}
            </Link>
          </div>
        )}

        {!loading && events.length > 0 && (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50 text-left text-xs font-bold uppercase tracking-[0.14em] text-slate-500">
                <tr>
                  <th className="px-4 py-3">{t('organizer.events.table.event')}</th>
                  <th className="px-4 py-3">{t('organizer.events.table.date')}</th>
                  <th className="px-4 py-3">{t('organizer.events.table.status')}</th>
                  <th className="px-4 py-3">{t('organizer.events.table.tournaments')}</th>
                  <th className="px-4 py-3">{t('organizer.events.table.actions')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {events.map((event) => (
                  <tr key={event.id} className="align-top">
                    <td className="px-4 py-4">
                      <p className="font-semibold text-[#0f172a]">{event.name}</p>
                      <p className="mt-1 font-mono text-xs text-slate-400">/e/{event.slug}</p>
                      <p className="mt-1 text-xs text-slate-500">
                        {event.location ?? t('organizer.dashboard.noLocation')}
                      </p>
                    </td>
                    <td className="px-4 py-4 text-slate-600">
                      {formatDate(event.startDate)}
                      {event.startDate !== event.endDate ? ` - ${formatDate(event.endDate)}` : ''}
                    </td>
                    <td className="px-4 py-4">
                      <span
                        className={[
                          'rounded-full border px-2.5 py-0.5 text-xs font-semibold',
                          STATUS_COLORS[event.status] ?? STATUS_COLORS['draft']!,
                        ].join(' ')}
                      >
                        {t(`organizer.events.statuses.${event.status}`) || event.status}
                      </span>
                    </td>
                    <td className="px-4 py-4 text-slate-600">{event.tournamentCount}</td>
                    <td className="px-4 py-4">
                      <div className="flex flex-wrap gap-2">
                        <Link
                          href={`/org/${slug}/events/${event.id}`}
                          className="rounded-md bg-[#1d4ed8] px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-800"
                        >
                          {t('organizer.events.select')}
                        </Link>
                        <Button
                          type="button"
                          size="sm"
                          variant="back"
                          onClick={() => openEdit(event)}
                        >
                          {t('organizer.events.edit')}
                        </Button>
                        {event.status === 'draft' && (
                          <Button
                            type="button"
                            size="sm"
                            variant="next"
                            disabled={busyId === event.id}
                            onClick={() => void toggleVisibility(event, 'publish')}
                          >
                            {t('organizer.events.publish')}
                          </Button>
                        )}
                        {event.status === 'published' && (
                          <Button
                            type="button"
                            size="sm"
                            variant="back"
                            disabled={busyId === event.id}
                            onClick={() => void toggleVisibility(event, 'unpublish')}
                          >
                            {t('organizer.events.unpublish')}
                          </Button>
                        )}
                        <Button
                          type="button"
                          size="sm"
                          variant="cancel"
                          disabled={busyId === event.id || event.status === 'archived'}
                          onClick={() => void archiveEvent(event)}
                        >
                          {t('organizer.events.archive')}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="danger"
                          disabled={busyId === event.id}
                          onClick={() => setConfirmDelete(event)}
                        >
                          {t('organizer.events.hardDelete')}
                        </Button>
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
          <form
            onSubmit={(event) => void saveEdit(event)}
            className="w-full max-w-2xl rounded-lg bg-white p-6 shadow-2xl"
          >
            <h2 className="text-xl font-bold text-[#0f172a]">{t('organizer.events.editTitle')}</h2>
            <p className="mt-1 text-sm text-slate-500">
              {t('organizer.events.slugReadOnly', { slug: editing.slug })}
            </p>
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <label className="grid gap-1 text-sm font-semibold text-slate-700">
                {t('organizer.newEvent.eventName')}
                <input
                  value={form.name}
                  onChange={(event) => setForm({ ...form, name: event.target.value })}
                  className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                />
              </label>
              <label className="grid gap-1 text-sm font-semibold text-slate-700">
                {t('organizer.events.status')}
                <select
                  value={form.status}
                  onChange={(event) => setForm({ ...form, status: event.target.value })}
                  className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                >
                  {(['draft', 'published', 'running', 'completed', 'archived'] as const).map(
                    (status) => (
                      <option key={status} value={status}>
                        {t(`organizer.events.statuses.${status}`) || status}
                      </option>
                    ),
                  )}
                </select>
                <span className="text-xs font-normal text-slate-500">
                  {t('organizer.events.statusHelp')}
                </span>
              </label>
              <label className="grid gap-1 text-sm font-semibold text-slate-700">
                {t('organizer.newEvent.startDate')}
                <input
                  type="date"
                  value={form.startDate}
                  onChange={(event) => setForm({ ...form, startDate: event.target.value })}
                  className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                />
              </label>
              <label className="grid gap-1 text-sm font-semibold text-slate-700">
                {t('organizer.newEvent.endDate')}
                <input
                  type="date"
                  value={form.endDate}
                  min={form.startDate}
                  onChange={(event) => setForm({ ...form, endDate: event.target.value })}
                  className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                />
              </label>
              <label className="grid gap-1 text-sm font-semibold text-slate-700 sm:col-span-2">
                {t('organizer.newEvent.location')}
                <input
                  value={form.location}
                  onChange={(event) => setForm({ ...form, location: event.target.value })}
                  className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                />
              </label>
              <label className="grid gap-1 text-sm font-semibold text-slate-700 sm:col-span-2">
                {t('organizer.events.publicLanding')}
                <textarea
                  rows={4}
                  value={form.publicLandingMd}
                  onChange={(event) => setForm({ ...form, publicLandingMd: event.target.value })}
                  className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                />
              </label>
            </div>
            <div className="mt-6 flex justify-end gap-3">
              <Button type="button" variant="cancel" onClick={() => setEditing(null)}>
                {t('common.cancel')}
              </Button>
              <Button type="submit" variant="next" loading={busyId === editing.id}>
                {t('organizer.events.save')}
              </Button>
            </div>
          </form>
        </div>
      )}

      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
          <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-2xl">
            <h2 className="text-xl font-bold text-[#0f172a]">
              {t('organizer.events.deleteTitle')}
            </h2>
            <p className="mt-2 text-sm text-slate-600">
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
    </main>
  );
}

function formatDate(value: string): string {
  if (!value) return '-';
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}
