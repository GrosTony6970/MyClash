'use client';

import { Button, TournamentColorDot } from '@myclash/ui';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { type FormEvent, useEffect, useState } from 'react';
import { useI18n } from '../../../../../../src/i18n/I18nProvider';
import { computeWizardStep } from './new/_wizard/compute-wizard-step';
import { useEventStatus } from '../_hooks/useEventStatus';
import { RequestDeletionModal } from '../_components/RequestDeletionModal';

interface Tournament {
  id: string;
  slug: string;
  name: string;
  weapon: string | null;
  category: string | null;
  status: string;
  color: string | null;
  ruleset_code: string | null;
  ruleset_version: string | null;
  scoring_config_json: Record<string, unknown> | null;
  ruleset_config: Record<string, unknown> | null;
  lock_config_json: Record<string, unknown> | null;
}

interface TournamentForm {
  name: string;
  status: string;
}

const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-slate-100 text-slate-700 border-slate-200',
  published: 'bg-blue-50 text-blue-700 border-blue-100',
  running: 'bg-green-50 text-green-700 border-green-100',
  completed: 'bg-slate-100 text-slate-500 border-slate-200',
  archived: 'bg-slate-900 text-slate-200 border-slate-800',
};

function normalizeTournament(row: Record<string, unknown>): Tournament {
  return {
    id: String(row['id']),
    slug: String(row['slug'] ?? ''),
    name: String(row['name'] ?? ''),
    weapon: typeof row['weapon'] === 'string' ? row['weapon'] : null,
    category: typeof row['category'] === 'string' ? row['category'] : null,
    status: String(row['status'] ?? 'draft'),
    color: typeof row['color'] === 'string' ? row['color'] : null,
    ruleset_code: typeof row['ruleset_code'] === 'string' ? row['ruleset_code'] : null,
    ruleset_version: typeof row['ruleset_version'] === 'string' ? row['ruleset_version'] : null,
    scoring_config_json:
      row['scoring_config_json'] != null &&
      typeof row['scoring_config_json'] === 'object' &&
      !Array.isArray(row['scoring_config_json'])
        ? (row['scoring_config_json'] as Record<string, unknown>)
        : null,
    ruleset_config:
      row['ruleset_config'] != null &&
      typeof row['ruleset_config'] === 'object' &&
      !Array.isArray(row['ruleset_config'])
        ? (row['ruleset_config'] as Record<string, unknown>)
        : null,
    lock_config_json:
      row['lock_config_json'] != null &&
      typeof row['lock_config_json'] === 'object' &&
      !Array.isArray(row['lock_config_json'])
        ? (row['lock_config_json'] as Record<string, unknown>)
        : null,
  };
}

function toForm(tournament: Tournament): TournamentForm {
  return {
    name: tournament.name,
    status: tournament.status,
  };
}

export default function EventTournamentsPage() {
  const params = useParams<{ slug: string; eventId: string }>();
  const { slug, eventId } = params;
  const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';
  const { t } = useI18n();
  const { isArchived, isReadOnly } = useEventStatus(eventId);

  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [eventName, setEventName] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editing, setEditing] = useState<Tournament | null>(null);
  const [form, setForm] = useState<TournamentForm | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Tournament | null>(null);
  const [deletionRequestTarget, setDeletionRequestTarget] = useState<Tournament | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const fetchTournaments = async (signal: AbortSignal) => {
    const tourRes = await fetch(`${apiUrl}/api/v1/events/${eventId}/tournaments`, {
      credentials: 'include',
      signal,
    });
    if (!tourRes.ok) throw new Error(t('organizer.tournaments.loadError'));
    const rows = (await tourRes.json()) as Array<Record<string, unknown>>;
    return rows.map(normalizeTournament);
  };

  const fetchEventName = async (signal: AbortSignal) => {
    const res = await fetch(`${apiUrl}/api/v1/events/${eventId}`, {
      credentials: 'include',
      signal,
    });
    if (!res.ok) return '';
    const data = (await res.json()) as { name?: string };
    return data.name ?? '';
  };

  const load = () => {
    const controller = new AbortController();
    setLoading(true);
    fetchTournaments(controller.signal)
      .then((rows) => {
        setTournaments(rows);
        setError(null);
      })
      .catch((err: unknown) => {
        if (err instanceof Error && err.name === 'AbortError') return;
        setError(err instanceof Error ? err.message : t('organizer.tournaments.loadError'));
      })
      .finally(() => setLoading(false));
    return controller;
  };

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([fetchTournaments(controller.signal), fetchEventName(controller.signal)])
      .then(([rows, name]) => {
        setTournaments(rows);
        setEventName(name);
        setError(null);
      })
      .catch((err: unknown) => {
        if (err instanceof Error && err.name === 'AbortError') return;
        setError(err instanceof Error ? err.message : t('organizer.tournaments.loadError'));
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId, apiUrl]);

  function openEdit(tournament: Tournament) {
    setEditing(tournament);
    setForm(toForm(tournament));
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
      const res = await fetch(`${apiUrl}/api/v1/tournaments/${editing.id}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: form.name,
          status: form.status,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(body.message ?? t('organizer.tournaments.saveError'));
      }
      setEditing(null);
      setForm(null);
      setNotice(t('organizer.tournaments.saved'));
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('organizer.tournaments.saveError'));
    } finally {
      setBusyId(null);
    }
  }

  async function archiveTournament(tournament: Tournament) {
    setBusyId(tournament.id);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`${apiUrl}/api/v1/tournaments/${tournament.id}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status: 'archived' }),
      });
      if (!res.ok) throw new Error(t('organizer.tournaments.archiveError'));
      setNotice(t('organizer.tournaments.archived'));
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('organizer.tournaments.archiveError'));
    } finally {
      setBusyId(null);
    }
  }

  async function toggleVisibility(tournament: Tournament, mode: 'publish' | 'unpublish') {
    setBusyId(tournament.id);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`${apiUrl}/api/v1/tournaments/${tournament.id}/${mode}`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(body.message ?? t('organizer.tournaments.visibilityError'));
      }
      setNotice(
        t(
          mode === 'publish'
            ? 'organizer.tournaments.published'
            : 'organizer.tournaments.unpublished',
        ),
      );
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('organizer.tournaments.visibilityError'));
    } finally {
      setBusyId(null);
    }
  }

  async function hardDeleteTournament() {
    if (!confirmDelete) return;
    setBusyId(confirmDelete.id);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`${apiUrl}/api/v1/tournaments/${confirmDelete.id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(body.message ?? t('organizer.tournaments.deleteError'));
      }
      setConfirmDelete(null);
      setNotice(t('organizer.tournaments.deleted'));
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('organizer.tournaments.deleteError'));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <main className="p-6 lg:p-8">
      {(loading || tournaments.length > 0) && (
        <div className="mb-8 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="flex items-center gap-2 text-sm text-slate-500">
              <Link href={`/org/${slug}`} className="hover:text-[#1d4ed8]">
                {slug}
              </Link>
              <span>/</span>
              <Link href={`/org/${slug}/events/${eventId}`} className="hover:text-[#1d4ed8]">
                {eventName || t('organizer.shell.nav.eventOverview')}
              </Link>
              <span>/</span>
              <span className="font-medium text-[#0f172a]">
                {t('organizer.shell.nav.tournaments')}
              </span>
            </div>
            <h1 className="mt-2 text-3xl font-bold text-[#0f172a]">
              {t('organizer.tournaments.title')}
            </h1>
            <p className="mt-1 text-sm text-slate-500">
              {t('organizer.tournaments.description', { event: eventName || eventId })}
            </p>
          </div>
          {isArchived ? (
            <span
              title={t('organizer.deletionRequest.archivedReadOnly')}
              className="inline-flex w-fit items-center rounded-md bg-slate-200 px-5 py-2.5 text-sm font-semibold text-slate-400 cursor-not-allowed"
            >
              {t('organizer.tournaments.create')}
            </span>
          ) : (
            <Link
              href={`/org/${slug}/events/${eventId}/tournaments/new`}
              className="inline-flex w-fit items-center rounded-md bg-[#dc2626] px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-red-700"
            >
              {t('organizer.tournaments.create')}
            </Link>
          )}
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
          tournaments.length > 0 || loading
            ? 'overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm'
            : ''
        }
      >
        {loading && (
          <div className="flex items-center gap-2 px-5 py-8 text-sm text-slate-500">
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-[#1d4ed8]" />
            {t('organizer.tournaments.loading')}
          </div>
        )}

        {!loading && tournaments.length === 0 && (
          <div className="flex flex-col items-center justify-center px-6 py-20 text-center">
            <h2 className="mb-3 text-2xl font-bold text-[#0f172a]">
              {t('organizer.tournaments.emptyTitle')}
            </h2>
            <p className="mb-6 max-w-md text-sm text-slate-500">
              {t('organizer.tournaments.emptyDescription')}
            </p>
            <Link
              href={`/org/${slug}/events/${eventId}/tournaments/new`}
              className="rounded-md bg-[#dc2626] px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-red-700"
            >
              {t('organizer.tournaments.create')}
            </Link>
          </div>
        )}

        {!loading && tournaments.length > 0 && (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50 text-left text-xs font-bold uppercase tracking-[0.14em] text-slate-500">
                <tr>
                  <th className="px-4 py-3">{t('organizer.tournaments.table.tournament')}</th>
                  <th className="px-4 py-3">{t('organizer.tournaments.table.weapon')}</th>
                  <th className="px-4 py-3">{t('organizer.tournaments.table.category')}</th>
                  <th className="px-4 py-3">{t('organizer.tournaments.table.status')}</th>
                  <th className="px-4 py-3">{t('organizer.tournaments.table.actions')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {tournaments.map((tournament) => (
                  <tr key={tournament.id} className="align-top">
                    <td className="px-4 py-4">
                      <p className="inline-flex items-center gap-1.5 font-semibold text-[#0f172a]">
                        <TournamentColorDot color={tournament.color} />
                        {tournament.name}
                      </p>
                      <p className="mt-1 font-mono text-xs text-slate-400">/{tournament.slug}</p>
                    </td>
                    <td className="px-4 py-4 text-slate-600">{tournament.weapon ?? '-'}</td>
                    <td className="px-4 py-4 text-slate-600">{tournament.category ?? '-'}</td>
                    <td className="px-4 py-4">
                      <span
                        className={[
                          'rounded-full border px-2.5 py-0.5 text-xs font-semibold',
                          STATUS_COLORS[tournament.status] ?? STATUS_COLORS['draft']!,
                        ].join(' ')}
                      >
                        {tournament.status}
                      </span>
                    </td>
                    <td className="px-4 py-4">
                      <div className="flex flex-wrap gap-2">
                        <Button
                          type="button"
                          size="sm"
                          variant="back"
                          disabled={isReadOnly}
                          onClick={() => openEdit(tournament)}
                        >
                          {t('organizer.tournaments.edit')}
                        </Button>
                        <Link
                          href={`/org/${slug}/events/${eventId}/tournaments/${tournament.id}/settings#basics`}
                          className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                        >
                          {t('organizer.tournaments.settings.action')}
                        </Link>
                        {(() => {
                          if (tournament.status !== 'draft') return null;
                          const wizardStep = computeWizardStep({
                            id: tournament.id,
                            name: tournament.name,
                            slug: tournament.slug,
                            ruleset_code: tournament.ruleset_code,
                            ruleset_version: tournament.ruleset_version,
                            scoring_config: tournament.scoring_config_json,
                            ruleset_config: tournament.ruleset_config,
                            lock_config: tournament.lock_config_json,
                            status: tournament.status,
                          });
                          if (wizardStep === null) return null;
                          return (
                            <>
                              <Link
                                href={`/org/${slug}/events/${eventId}/tournaments/new?id=${tournament.id}&step=${wizardStep}`}
                                className="rounded-md bg-red-800 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-900"
                              >
                                {t('organizer.tournaments.list.resumeSetup')}
                              </Link>
                              <span className="text-xs text-slate-400">
                                Draft — step {wizardStep} of 4
                              </span>
                            </>
                          );
                        })()}
                        {tournament.status === 'draft' && (
                          <Button
                            type="button"
                            size="sm"
                            variant="next"
                            disabled={busyId === tournament.id}
                            onClick={() => void toggleVisibility(tournament, 'publish')}
                          >
                            {t('organizer.tournaments.publish')}
                          </Button>
                        )}
                        {tournament.status === 'published' && (
                          <Button
                            type="button"
                            size="sm"
                            variant="back"
                            disabled={busyId === tournament.id}
                            onClick={() => void toggleVisibility(tournament, 'unpublish')}
                          >
                            {t('organizer.tournaments.unpublish')}
                          </Button>
                        )}
                        <Button
                          type="button"
                          size="sm"
                          variant="cancel"
                          disabled={
                            busyId === tournament.id ||
                            tournament.status === 'archived' ||
                            isReadOnly
                          }
                          onClick={() => void archiveTournament(tournament)}
                        >
                          {t('organizer.tournaments.archive')}
                        </Button>
                        {isArchived ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="danger"
                            onClick={() => setDeletionRequestTarget(tournament)}
                          >
                            {t('organizer.deletionRequest.requestDeletion')}
                          </Button>
                        ) : (
                          <Button
                            type="button"
                            size="sm"
                            variant="danger"
                            disabled={busyId === tournament.id}
                            onClick={() => setConfirmDelete(tournament)}
                          >
                            {t('organizer.tournaments.hardDelete')}
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
          <form
            onSubmit={(event) => void saveEdit(event)}
            className="w-full max-w-2xl rounded-lg bg-white p-6 shadow-2xl"
          >
            <h2 className="text-xl font-bold text-[#0f172a]">
              {t('organizer.tournaments.editTitle')}
            </h2>
            <p className="mt-1 font-mono text-xs text-slate-400">/{editing.slug}</p>
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <label className="grid gap-1 text-sm font-semibold text-slate-700 sm:col-span-2">
                {t('organizer.tournaments.table.tournament')}
                <input
                  value={form.name}
                  onChange={(event) => setForm({ ...form, name: event.target.value })}
                  className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                />
              </label>
              <label className="grid gap-1 text-sm font-semibold text-slate-700 sm:col-span-2">
                {t('organizer.tournaments.status')}
                <select
                  value={form.status}
                  onChange={(event) => setForm({ ...form, status: event.target.value })}
                  className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                >
                  {['draft', 'published', 'running', 'completed', 'archived'].map((status) => (
                    <option key={status} value={status}>
                      {status}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="my-4 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-900">
              {t('organizer.tournaments.editModal.openSettingsHint')}{' '}
              <Link
                href={`/org/${slug}/events/${eventId}/tournaments/${editing.id}/settings#basics`}
                className="font-semibold underline"
                onClick={() => setEditing(null)}
              >
                {t('organizer.tournaments.editModal.openSettingsLink')} →
              </Link>
            </div>
            <div className="mt-6 flex justify-end gap-3">
              <Button type="button" variant="cancel" onClick={() => setEditing(null)}>
                {t('common.cancel')}
              </Button>
              <Button type="submit" variant="next" loading={busyId === editing.id}>
                {t('organizer.tournaments.save')}
              </Button>
            </div>
          </form>
        </div>
      )}

      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
          <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-2xl">
            <h2 className="text-xl font-bold text-[#0f172a]">
              {t('organizer.tournaments.deleteTitle')}
            </h2>
            <p className="mt-2 text-sm text-slate-600">
              {t('organizer.tournaments.deleteWarning', { name: confirmDelete.name })}
            </p>
            <div className="mt-6 flex justify-end gap-3">
              <Button type="button" variant="cancel" onClick={() => setConfirmDelete(null)}>
                {t('common.cancel')}
              </Button>
              <Button
                type="button"
                variant="danger"
                loading={busyId === confirmDelete.id}
                onClick={() => void hardDeleteTournament()}
              >
                {t('organizer.tournaments.confirmHardDelete')}
              </Button>
            </div>
          </div>
        </div>
      )}

      {deletionRequestTarget && (
        <RequestDeletionModal
          targetType="tournament"
          targetId={deletionRequestTarget.id}
          targetLabel={deletionRequestTarget.name}
          onSuccess={() => setDeletionRequestTarget(null)}
          onClose={() => setDeletionRequestTarget(null)}
        />
      )}
    </main>
  );
}
